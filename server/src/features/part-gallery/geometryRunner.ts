import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { runtimeUserDataDir } from "../../lib/appRuntimePaths.js";
import { buildFreecadChildEnvironment, resolveFreecadCommand } from "../../lib/freecadProcessSecurity.js";
import { acquireDrawingExecution, type DrawingExecutionLease } from "../drawing-research/executionGate.js";
import { isFcstdObjectName } from "../../lib/fcstdLinkIdentity.js";

export type GeometryInput = { rel: string; filename: string; node: string; kind?: "part" | "assembly" };
export type GeometryResult = { rel: string; bounding_box: { x_mm: number; y_mm: number; z_mm: number } | null; message: string };
const PREFIX = "DESK_GALLERY_GEOMETRY_ITEM ";
const MAX_ITEMS = 100, MAX_SOURCE_BYTES = 64 * 1024 * 1024, MAX_REPORT_BYTES = 1024 * 1024;
const TIMEOUT_MS = 120_000, KILL_GRACE_MS = 1000;
const MESSAGES: Record<string, string> = {
  ready: "保存主实体在文档 XYZ 轴的边界盒（mm）",
  ready_assembly_optimal: "已保存总成几何在文档 XYZ 轴的外包络（mm，优化包围盒；非加工尺寸）",
  ready_assembly_standard: "已保存总成几何在文档 XYZ 轴的外包络（mm，标准包围盒；非加工尺寸）",
  missing_node: "未找到指定主零件节点",
  unsupported_node: "所选节点是装配或链接容器，不读取零件边界盒",
  missing_shape: "主零件节点没有可读取的 Shape",
  empty_shape: "主零件节点的 Shape 为空",
  invalid_bounds: "主零件节点的边界盒无效",
  read_failed: "无法读取已保存的模型几何",
  unsupported_assembly_root: "所选节点不是受支持的总成根对象",
  incomplete_assembly: "总成结构或链接暂无法完整确认，未提供整体尺寸",
  empty_assembly_shape: "总成没有可读取的非空几何",
  assembly_bounds_failed: "无法确认总成几何的有效包围盒",
  assembly_limit: "总成范围超过安全读取上限，未提供整体尺寸",
};
const SUCCESS_CODES = new Set(["ready", "ready_assembly_optimal", "ready_assembly_standard"]);
type WireRow = { index: number; rel: string; bounding_box: GeometryResult["bounding_box"]; code: string };
class GeometryFailure extends Error {}
const READ_FAILURE_MESSAGES = new Set([
  "边界盒来源必须是安全范围内的普通 FCStd 文件",
  `一次边界盒读取最多 ${MAX_ITEMS} 个文件，请分批读取`,
  "边界盒输入必须包含唯一相对路径、已验证的绝对 FCStd 路径及主节点名",
  "边界盒来源文件不存在或不可安全读取",
  "边界盒报告与请求不一致",
  "边界盒报告包含无效毫米尺寸",
  "缺失几何报告不能包含边界盒尺寸",
  "边界盒隔离临时目录不可用",
  "边界盒进度报告不是有效 JSON",
  "读取期间模型文件已变化，请重新更新图册",
  "边界盒进度处理失败",
  "边界盒进程输出超过安全上限",
  "边界盒进度行超过安全上限",
  "无法读取边界盒进度报告",
  "无法启动 FreeCADCmd 边界盒读取进程",
  "FreeCADCmd 边界盒读取进程异常退出",
  "无法读取最终边界盒进度报告",
  "边界盒读取超过 2 分钟，已终止本次隔离进程",
  "FreeCADCmd 未返回有效边界盒报告",
  "最终边界盒报告不是有效 JSON",
  "边界盒报告未完整处理本批文件",
  "最终边界盒报告与进度不一致",
  "隔离读取模型边界盒失败，请确认 FreeCADCmd 可用后重试",
  "边界盒隔离临时目录清理失败",
  "边界盒读取已取消，未启动原生程序",
  "边界盒读取已取消，已等待自有进程关闭",
  "已有原生 CAD 任务运行中，请等待完成后重试",
]);
const RESULT_FAILURE_MESSAGES = new Set(Object.entries(MESSAGES).filter(([code]) => !SUCCESS_CODES.has(code)).map(([, message]) => message));
const RESULT_SUCCESS_MESSAGES = new Set([...SUCCESS_CODES].map(code => MESSAGES[code]));
const CONFIGURATION_MESSAGES = {
  freecad_not_found: "未找到 FreeCADCmd，请先配置 FreeCAD 安装目录",
  freecad_configuration_invalid: "FreeCADCmd 配置不可用，请确认安装目录而非图形启动器",
} as const;
export type GeometryConfigurationCode = keyof typeof CONFIGURATION_MESSAGES;
export class GeometryConfigurationError extends Error {
  constructor(readonly code: GeometryConfigurationCode) {
    super(CONFIGURATION_MESSAGES[code]);
    this.name = "GeometryConfigurationError";
  }
}
/** Only fixed adapter-authored configuration messages may cross the job boundary. */
export function geometryConfigurationFailureMessage(cause: unknown): string | null {
  return cause instanceof GeometryConfigurationError && Object.hasOwn(CONFIGURATION_MESSAGES, cause.code)
    ? CONFIGURATION_MESSAGES[cause.code] : null;
}
/** Native errors and arbitrary injected-reader messages are never public diagnostics. */
export function geometryReadFailureMessage(cause: unknown): string | null {
  return geometryConfigurationFailureMessage(cause)
    ?? (cause instanceof GeometryFailure && READ_FAILURE_MESSAGES.has(cause.message) ? cause.message : null);
}
/** Accept only the reader's fixed non-ready row statuses, not external failure text. */
export function geometryResultFailureMessage(value: unknown): string | null {
  let message: unknown;
  try { message = typeof value === "string" ? value : (value as { message?: unknown } | null)?.message; }
  catch { return null; }
  return typeof message === "string" && RESULT_FAILURE_MESSAGES.has(message) ? message : null;
}
/** Only fixed success wording is persisted; arbitrary Native output is never a label. */
export function geometryResultSuccessMessage(value: unknown, kind?: "part" | "assembly"): string | null {
  let message: unknown;
  try { message = typeof value === "string" ? value : (value as { message?: unknown } | null)?.message; }
  catch { return null; }
  if (typeof message !== "string" || !RESULT_SUCCESS_MESSAGES.has(message)) return null;
  if (kind !== undefined && kind !== "part" && kind !== "assembly") return null;
  if (kind === "part" && message !== MESSAGES.ready) return null;
  if (kind === "assembly" && message !== MESSAGES.ready_assembly_optimal && message !== MESSAGES.ready_assembly_standard) return null;
  return message;
}

/** Disk-only native geometry read in a disposable FreeCADCmd process. */
const PYTHON = String.raw`
import json, math, zipfile
from collections import Counter
from pathlib import Path
import xml.etree.ElementTree as ET
import FreeCAD as App
import Part

class IncompleteAssembly(Exception):
    pass
class AssemblyLimit(IncompleteAssembly):
    pass

ASSEMBLY_ROOTS = ('Assembly::AssemblyObject', 'App::Part', 'App::LinkGroup')
CONTAINERS = (*ASSEMBLY_ROOTS, 'Assembly::AssemblyLink', 'App::DocumentObjectGroup')
AUXILIARY = ('Assembly::JointGroup', 'Assembly::Joint', 'Assembly::BomGroup',
             'Assembly::ViewGroup', 'Assembly::SimulationGroup', 'App::Origin',
             'App::Plane', 'App::Line', 'App::Point', 'App::LocalCoordinateSystem',
             'PartDesign::Plane', 'PartDesign::Line', 'PartDesign::Point', 'Sketcher::SketchObject')

def assembly_shape(root):
    # The fixed scope is saved physical structure, independent of GUI hiding.
    # A Body is one physical leaf: its sketch/origin/feature history is not a
    # second component. Never use all document Shapes or source-file dedup.
    manifests, document_bytes, leaves, visited, signatures = {}, 0, [], 0, {}

    def require(value):
        if not value:
            raise IncompleteAssembly()
    def limit(value):
        if not value:
            raise AssemblyLimit()

    def manifest(doc):
        nonlocal document_bytes
        filename = str(Path(doc.FileName).resolve())
        if filename in manifests:
            return manifests[filename]
        require(bool(doc.FileName))
        limit(len(manifests) < 500)
        with zipfile.ZipFile(filename) as archive:
            entries = [info for info in archive.infolist() if info.filename.lower() == 'document.xml']
            require(len(entries) == 1 and entries[0].filename == 'Document.xml')
            limit(entries[0].file_size <= 16 * 1024 * 1024)
            with archive.open(entries[0]) as source:
                data = source.read(16 * 1024 * 1024 + 1)
        document_bytes += len(data)
        limit(len(data) <= 16 * 1024 * 1024 and document_bytes <= 64 * 1024 * 1024)
        require(b'<!doctype' not in data.lower() and b'<!entity' not in data.lower())
        document = ET.fromstring(data)
        require(document.tag == 'Document')
        declarations, objects = {}, {}
        for entry in document.findall('./Objects/Object'):
            name, type_id = entry.get('name'), entry.get('type')
            require(bool(name) and bool(type_id) and name not in declarations)
            declarations[name] = type_id
        for entry in document.findall('./ObjectData/Object'):
            name = entry.get('name')
            require(name in declarations and name not in objects)
            properties = {}
            for prop in entry.findall('./Properties/Property'):
                key = prop.get('name')
                require(bool(key) and key not in properties)
                properties[key] = prop
            objects[name] = (declarations[name], properties)
        require(set(objects) == set(declarations))
        manifests[filename] = objects
        return objects

    def saved(obj):
        entry = manifest(obj.Document).get(obj.Name)
        require(entry is not None and entry[0] == obj.TypeId)
        # openDocument may restore built-in objects, but it must not silently
        # change a saved component pose before we call this a saved envelope.
        for key in ('Placement', 'LinkPlacement'):
            prop = entry[1].get(key)
            if prop is None:
                continue
            values = list(prop)
            require(prop.get('type') == 'App::PropertyPlacement' and len(values) == 1 and values[0].tag == 'PropertyPlacement')
            expected = [float(values[0].get(name)) for name in ('Px', 'Py', 'Pz', 'Q0', 'Q1', 'Q2', 'Q3')]
            require(all(math.isfinite(value) for value in expected))
            actual = getattr(obj, key)
            require(max(abs(a-b) for a,b in zip(expected[:3], (actual.Base.x, actual.Base.y, actual.Base.z))) <= 1e-7)
            norm = math.sqrt(sum(value * value for value in expected[3:]))
            require(norm > 0)
            quaternion = [value / norm for value in expected[3:]]
            native = list(actual.Rotation.Q)
            require(min(max(abs(a-b) for a,b in zip(quaternion,native)), max(abs(a+b) for a,b in zip(quaternion,native))) <= 1e-9)
        return entry[1]

    def linked_target(obj, properties):
        prop = properties.get('LinkedObject')
        require(prop is not None and prop.get('type') in ('App::PropertyLink', 'App::PropertyXLink'))
        links = [element for element in prop.iter() if element.tag in ('Link', 'XLink')]
        require(len(links) == 1)
        expected_name = links[0].get('value') if links[0].tag == 'Link' else links[0].get('name')
        require(bool(expected_name))
        target = obj.LinkedObject
        require(target is not None and not isinstance(target, (tuple,list)) and target is not obj)
        expected_file = links[0].get('file', '')
        expected_path = Path(obj.Document.FileName).parent / expected_file if expected_file else Path(obj.Document.FileName)
        require(str(Path(target.Document.FileName).resolve()) == str(expected_path.resolve()) and target.Name == expected_name)
        require(target.Name in manifest(target.Document))
        return target

    def group_children(obj, properties):
        prop = properties.get('Group')
        require(prop is None or prop.get('type') == 'App::PropertyLinkList')
        expected = [] if prop is None else [entry.get('value') or entry.get('name') for entry in prop.findall('./LinkList/Link')]
        require(all(expected) and len(expected) == len(set(expected)))
        actual = list(getattr(obj, 'Group', []))
        require(all(child is not None for child in actual) and sorted(child.Name for child in actual) == sorted(expected))
        return actual

    def collect(obj, subname, owner, active, depth, measure=True):
        nonlocal visited
        visited += 1
        require(obj is not None)
        limit(visited <= 10000 and depth <= 64 and len(subname) <= 16384)
        identity = (str(Path(obj.Document.FileName).resolve()), obj.Name)
        require(identity not in active)
        if obj.TypeId in AUXILIARY or obj.isDerivedFrom('App::DatumElement'):
            return Counter()
        properties = saved(obj)
        require(not any(state in ('Invalid', 'Error') for state in getattr(obj, 'State', [])))
        # Definition signatures do not depend on occurrence placement. Reuse
        # only completed, read-only signatures; the active/cap checks stay above.
        if not measure and identity in signatures:
            return signatures[identity].copy()
        next_active = active | {identity}
        if obj.TypeId in ('App::Link', 'App::LinkElement'):
            # Link arrays/custom element visibility require a separate proven
            # occurrence contract. Ordinary repeated Links remain distinct.
            require(int(getattr(obj, 'ElementCount', 0)) == 0)
            result = collect(linked_target(obj, properties), subname, owner, next_active, depth + 1, measure)
            if not measure:
                signatures[identity] = result.copy()
            return result
        target = linked_target(obj, properties) if obj.TypeId == 'Assembly::AssemblyLink' else None
        if obj.TypeId not in CONTAINERS and (obj.TypeId == 'PartDesign::Body' or obj.isDerivedFrom('Part::Feature')):
            if measure:
                limit(len(leaves) < 2000)
                leaves.append((subname, owner))
            return Counter({identity: 1})
        require(obj.TypeId in CONTAINERS)
        result, count = Counter(), 0
        for child in group_children(obj, properties):
            require(bool(child.Name) and '.' not in child.Name and '/' not in child.Name and '\\' not in child.Name)
            child_signature = collect(child, subname + child.Name + '.', child, next_active, depth + 1, measure)
            count += sum(child_signature.values())
            limit(count <= 2000)
            result.update(child_signature)
        if target is not None:
            # A stale AssemblyLink can have a self-consistent but empty/short
            # local Group while its source has more components. Definition
            # multisets prove physical membership, retaining repeated instances.
            # Do not compare source/instance poses or refresh/solve the model.
            source_signature = collect(target, '', target, next_active, depth + 1, False)
            require(result == source_signature)
        if not measure:
            signatures[identity] = result.copy()
        return result

    collect(root, '', root, set(), 0)
    if not leaves:
        return None
    shapes = []
    for subname, expected_owner in leaves:
        # The official API accumulates ancestors, links and instance placement.
        # retType=1 proves the subname resolved to this exact occurrence; its
        # returned matrix is intentionally NOT applied a second time.
        shape, unused_matrix, owner = Part.getShape(root, subname, needSubElement=False, transform=True, retType=1)
        require(owner is expected_owner and not shape.isNull())
        shapes.append(shape)
    # Compound, not fuse: each actual transformed physical instance occurs once.
    return Part.makeCompound(shapes)

def valid_assembly_bounds(box):
    valid = getattr(box, 'isValid', None)
    if callable(valid) and not valid():
        return False
    values = [float(getattr(box, axis)) for axis in ('XMin','XMax','YMin','YMax','ZMin','ZMax','XLength','YLength','ZLength')]
    return all(math.isfinite(value) for value in values) and all(values[i] <= values[i+1] for i in (0,2,4)) and all(value >= 0 for value in values[6:]) and any(value > 0 for value in values[6:])

spec = json.loads(Path(JOB_PATH).read_text(encoding='utf-8'))
rows = []
for index, item in enumerate(spec['items']):
    row = {'index': index, 'rel': item['rel'], 'bounding_box': None, 'code': 'read_failed'}
    try:
        doc = App.openDocument(item['filename'])
        obj = doc.getObject(item['node'])
        if obj is None:
            row['code'] = 'missing_node'
        elif item.get('kind', 'part') == 'assembly':
            if obj.TypeId not in ASSEMBLY_ROOTS:
                row['code'] = 'unsupported_assembly_root'
            else:
                try:
                    shape = assembly_shape(obj)
                    if shape is None or shape.isNull():
                        row['code'] = 'empty_assembly_shape'
                    else:
                        optimal = getattr(shape, 'optimalBoundingBox', None)
                        code = 'ready_assembly_standard'
                        if callable(optimal):
                            try:
                                box = optimal(False, False)
                                code = 'ready_assembly_optimal'
                            except (TypeError, AttributeError, NotImplementedError):
                                box = shape.BoundBox
                        else:
                            box = shape.BoundBox
                        if not valid_assembly_bounds(box):
                            row['code'] = 'assembly_bounds_failed'
                        else:
                            row['bounding_box'] = dict(zip(['x_mm','y_mm','z_mm'], [float(box.XLength),float(box.YLength),float(box.ZLength)]))
                            row['code'] = code
                except AssemblyLimit:
                    row['code'] = 'assembly_limit'
                except IncompleteAssembly:
                    row['code'] = 'incomplete_assembly'
                except Exception:
                    row['code'] = 'assembly_bounds_failed'
        elif str(obj.TypeId).startswith('Assembly::') or obj.TypeId in ('App::Part', 'App::LinkGroup'):
            row['code'] = 'unsupported_node'
        elif not hasattr(obj, 'Shape'):
            row['code'] = 'missing_shape'
        elif obj.Shape.isNull():
            row['code'] = 'empty_shape'
        else:
            box = obj.Shape.BoundBox
            valid = getattr(box, 'isValid', None)
            if callable(valid) and not valid():
                row['code'] = 'invalid_bounds'
            else:
                lengths = [float(box.XLength), float(box.YLength), float(box.ZLength)]
                if any(not math.isfinite(value) or value < 0 for value in lengths) or not any(value > 0 for value in lengths):
                    row['code'] = 'invalid_bounds'
                else:
                    row['bounding_box'] = dict(zip(['x_mm', 'y_mm', 'z_mm'], lengths))
                    row['code'] = 'ready'
    except Exception:
        # No source paths, Python tracebacks or external exception text in reports.
        row['code'] = 'read_failed'
    finally:
        # All these documents belong only to this isolated child process.
        for opened in list(App.listDocuments().values()):
            App.closeDocument(opened.Name)
    rows.append(row)
    print('DESK_GALLERY_GEOMETRY_ITEM ' + json.dumps(row, ensure_ascii=False, allow_nan=False), flush=True)

report = Path(spec['report'])
temporary = report.with_suffix('.tmp')
temporary.write_text(json.dumps({'version': 1, 'state': 'completed', 'rows': rows}, ensure_ascii=False, allow_nan=False), encoding='utf-8')
temporary.replace(report)
`;

function sourceStamp(filename: string) {
  const stat = fs.lstatSync(filename);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_SOURCE_BYTES) throw new GeometryFailure("边界盒来源必须是安全范围内的普通 FCStd 文件");
  return [stat.dev, stat.ino, stat.size, stat.mtimeMs, stat.ctimeMs].join(":");
}
function validateInputs(inputs: GeometryInput[]) {
  if (!Array.isArray(inputs) || inputs.length > MAX_ITEMS) throw new GeometryFailure(`一次边界盒读取最多 ${MAX_ITEMS} 个文件，请分批读取`);
  const rels = new Set<string>();
  return inputs.map(input => {
    if (!input || typeof input.rel !== "string" || !input.rel || input.rel.length > 4096 || /[\\\x00-\x1f]/.test(input.rel)
      || path.isAbsolute(input.rel) || /^[A-Za-z]:/.test(input.rel) || input.rel.split("/").some(piece => !piece || piece === "." || piece === ".." || piece.toLowerCase() === ".git")
      || rels.has(input.rel) || typeof input.filename !== "string" || !path.isAbsolute(input.filename) || !/\.fcstd$/i.test(input.filename)
      || typeof input.node !== "string" || input.node.length > 256 || !isFcstdObjectName(input.node)
      || (input.kind !== undefined && input.kind !== "part" && input.kind !== "assembly")) throw new GeometryFailure("边界盒输入必须包含唯一相对路径、已验证的绝对 FCStd 路径及主节点名");
    rels.add(input.rel);
    try {
      sourceStamp(input.filename);
      const filename = fs.realpathSync(input.filename);
      return { ...input, filename, stamp: sourceStamp(filename) };
    } catch { throw new GeometryFailure("边界盒来源文件不存在或不可安全读取"); }
  });
}
function wireRow(value: unknown, inputs: GeometryInput[], expected: number): WireRow {
  const row = value as Partial<WireRow> | null;
  if (!row || typeof row !== "object" || Array.isArray(row) || row.index !== expected || row.rel !== inputs[expected]?.rel
    || typeof row.code !== "string" || !Object.hasOwn(MESSAGES, row.code)
    || Object.keys(row).sort().join(",") !== "bounding_box,code,index,rel") throw new GeometryFailure("边界盒报告与请求不一致");
  if (SUCCESS_CODES.has(row.code)) {
    if ((inputs[expected].kind === "assembly") !== row.code.startsWith("ready_assembly_")) throw new GeometryFailure("边界盒报告与请求不一致");
    const box = row.bounding_box;
    if (!box || typeof box !== "object" || Array.isArray(box) || Object.keys(box).sort().join(",") !== "x_mm,y_mm,z_mm"
      || [box.x_mm, box.y_mm, box.z_mm].some(value => typeof value !== "number" || !Number.isFinite(value) || value < 0)
      || ![box.x_mm, box.y_mm, box.z_mm].some(value => value > 0)) throw new GeometryFailure("边界盒报告包含无效毫米尺寸");
  } else if (row.bounding_box !== null) throw new GeometryFailure("缺失几何报告不能包含边界盒尺寸");
  return { index: row.index as number, rel: row.rel as string, code: row.code,
    bounding_box: row.bounding_box ? { x_mm: row.bounding_box.x_mm, y_mm: row.bounding_box.y_mm, z_mm: row.bounding_box.z_mm } : null };
}
function result(row: WireRow): GeometryResult {
  return { rel: row.rel, bounding_box: row.bounding_box ? { ...row.bounding_box } : null, message: MESSAGES[row.code] };
}
function configuredCommand() {
  const override = String(process.env.PHOENIX_FREECAD_CMD || "").trim();
  let home: unknown = "";
  if (!override) {
    try { home = JSON.parse(fs.readFileSync(path.join(runtimeUserDataDir(), "launcher-prefs.json"), "utf8")).freecad_dir; }
    catch (cause) {
      if ((cause as NodeJS.ErrnoException)?.code !== "ENOENT") throw new GeometryConfigurationError("freecad_configuration_invalid");
    }
  }
  if (home != null && typeof home !== "string") throw new GeometryConfigurationError("freecad_configuration_invalid");
  const directory = typeof home === "string" ? home.trim() : "";
  const explicit = Boolean(override || directory);
  // Standard macOS installs are discoverable without changing launcher preferences.
  // A nonempty explicit setting always wins, including when it is invalid.
  const location = directory || (!override && os.platform() === "darwin" ? "/Applications/FreeCAD.app" : "");
  if (!explicit && !location) throw new GeometryConfigurationError("freecad_not_found");
  try {
    const command = resolveFreecadCommand(location, override);
    if (command) return command;
  } catch { throw new GeometryConfigurationError("freecad_configuration_invalid"); }
  throw new GeometryConfigurationError(explicit ? "freecad_configuration_invalid" : "freecad_not_found");
}

/**
 * Inputs are already workspace-validated; no directory discovery or shape inference.
 * The process-wide CAD lease is held until the owned child's actual close event.
 * This is not a cross-host/process lock or a unified queue execution ticket.
 */
export async function readGeometryBatch(inputs: GeometryInput[], onItem?: (item: GeometryResult) => void, options: { signal?: AbortSignal } = {}): Promise<GeometryResult[]> {
  if (options.signal?.aborted) throw new GeometryFailure("边界盒读取已取消，未启动原生程序");
  if (Array.isArray(inputs) && inputs.length === 0) return [];
  let release: DrawingExecutionLease;
  try { release = acquireDrawingExecution("geometry:" + randomUUID()); }
  catch { throw new GeometryFailure("已有原生 CAD 任务运行中，请等待完成后重试"); }
  try { return await readGeometryBatchOwned(inputs, release, onItem, options.signal); }
  finally { release(); }
}
async function readGeometryBatchOwned(inputs: GeometryInput[], release:DrawingExecutionLease, onItem?: (item: GeometryResult) => void, signal?: AbortSignal): Promise<GeometryResult[]> {
  const sources = validateInputs(inputs);
  if (!sources.length) return [];
  const command = configuredCommand(); let folder: string;
  try { folder = fs.mkdtempSync(path.join(os.tmpdir(), "desk-gallery-geometry-")); }
  catch { throw new GeometryFailure("边界盒隔离临时目录不可用"); }
  try {
    // -u/-s select configuration files, not the application data/cache roots.
    // FreeCAD's getCustomPaths requires these directories to exist; never
    // inherit a user's add-ons, macros, cache or configured temporary root.
    const privatePaths = Object.fromEntries(["FREECAD_USER_HOME", "FREECAD_USER_DATA", "FREECAD_USER_TEMP"].map((key, index) => {
      const directory = path.join(folder, ["native-config", "native-data", "native-temp"][index]);
      fs.mkdirSync(directory, { mode: 0o700 });
      return [key, directory];
    }));
    const report = path.join(folder, "report.json"), job = path.join(folder, "job.json"), script = path.join(folder, "read.py");
    fs.writeFileSync(job, JSON.stringify({ report, items: sources.map(({ stamp: _stamp, ...input }) => input) }), { flag: "wx" });
    fs.writeFileSync(script, `JOB_PATH = ${JSON.stringify(job)}\n${PYTHON}`, { flag: "wx" });
    const streamed: WireRow[] = [];
    await new Promise<void>((resolve, reject) => {
      const child = release.spawn(command, ["-u", path.join(folder, "user.cfg"), "-s", path.join(folder, "system.cfg"), script], {
        cwd: folder, env: { ...buildFreecadChildEnvironment(process.env), ...privatePaths }, stdio: ["ignore", "pipe", "ignore"], windowsHide: true,
      });
      let text = "", bytes = 0, stopped = "", settled = false;
      let grace: ReturnType<typeof setTimeout> | undefined;
      const decoder = new TextDecoder("utf-8", { fatal: true });
      const finish = (reason?: string) => {
        if (settled) return; settled = true; clearTimeout(timer); if (grace) clearTimeout(grace);
        signal?.removeEventListener("abort", aborted);
        child.stdout?.removeListener("data", data); child.removeListener("error", error); child.removeListener("close", close);
        if (reason) reject(new GeometryFailure(reason)); else resolve();
      };
      const stop = (reason: string) => {
        if (stopped || settled) return; stopped = reason;
        // A kill request (including a failed request) is not proof of exit.
        // Never settle, clean the directory or release CAD ownership on a timer.
        grace = setTimeout(() => { try { child.kill("SIGKILL"); } catch { /* Keep ownership until close. */ } }, KILL_GRACE_MS);
        grace.unref();
        try { child.kill("SIGTERM"); } catch { /* Wait for the owned close event. */ }
      };
      const progressStopped = () => {
        if (signal?.aborted && !stopped && !settled) stop("边界盒读取已取消，已等待自有进程关闭");
        return Boolean(stopped || settled || signal?.aborted);
      };
      const line = (value: string) => {
        if (progressStopped()) return;
        if (!value.startsWith(PREFIX)) return; // Ignore bounded native startup chatter.
        let parsed: unknown;
        try { parsed = JSON.parse(value.slice(PREFIX.length)); } catch { throw new GeometryFailure("边界盒进度报告不是有效 JSON"); }
        const row = wireRow(parsed, sources, streamed.length);
        if (sourceStamp(sources[row.index].filename) !== sources[row.index].stamp) throw new GeometryFailure("读取期间模型文件已变化，请重新更新图册");
        if (progressStopped()) return;
        streamed.push(row);
        if (onItem) try { onItem(result(row)); } catch { throw new GeometryFailure("边界盒进度处理失败"); }
        if (progressStopped()) return;
      };
      const data = (chunk: Uint8Array) => {
        if (progressStopped()) return;
        try {
          bytes += chunk.byteLength;
          if (bytes > MAX_REPORT_BYTES) throw new GeometryFailure("边界盒进程输出超过安全上限");
          text += decoder.decode(chunk, { stream: true });
          let end: number;
          // A callback can synchronously abort while several rows share this
          // chunk. Do not consume or publish its remaining buffered rows.
          while (!progressStopped() && (end = text.indexOf("\n")) >= 0) { const current = text.slice(0, end).replace(/\r$/, ""); text = text.slice(end + 1); line(current); }
          if (progressStopped()) return;
          if (Buffer.byteLength(text) > 16 * 1024) throw new GeometryFailure("边界盒进度行超过安全上限");
        } catch (cause) { stop(cause instanceof GeometryFailure ? cause.message : "无法读取边界盒进度报告"); }
      };
      const error = () => stop("无法启动 FreeCADCmd 边界盒读取进程");
      const close = (code: number | null, exitSignal: NodeJS.Signals | null) => {
        if (stopped) { finish(stopped); return; }
        if (code !== 0 || exitSignal) { finish("FreeCADCmd 边界盒读取进程异常退出"); return; }
        try { text += decoder.decode(); if (text) line(text.replace(/\r$/, "")); finish(); }
        catch { finish("无法读取最终边界盒进度报告"); }
      };
      const timer = setTimeout(() => stop("边界盒读取超过 2 分钟，已终止本次隔离进程"), TIMEOUT_MS);
      const aborted = () => stop("边界盒读取已取消，已等待自有进程关闭");
      child.stdout?.on("data", data); child.once("error", error); child.once("close", close);
      signal?.addEventListener("abort", aborted, { once: true });
      if (signal?.aborted) aborted();
    });
    if (signal?.aborted) throw new GeometryFailure("边界盒读取已取消，已等待自有进程关闭");
    if (!fs.existsSync(report)) throw new GeometryFailure("FreeCADCmd 未返回有效边界盒报告");
    const reportStat = fs.lstatSync(report);
    if (!reportStat.isFile() || reportStat.isSymbolicLink() || reportStat.size > MAX_REPORT_BYTES) throw new GeometryFailure("FreeCADCmd 未返回有效边界盒报告");
    let final: { version?: unknown; state?: unknown; rows?: unknown };
    try { final = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(fs.readFileSync(report))); } catch { throw new GeometryFailure("最终边界盒报告不是有效 JSON"); }
    if (!final || final.version !== 1 || final.state !== "completed" || !Array.isArray(final.rows) || final.rows.length !== sources.length || streamed.length !== sources.length) throw new GeometryFailure("边界盒报告未完整处理本批文件");
    const rows = final.rows.map((row, index) => wireRow(row, sources, index));
    if (JSON.stringify(rows) !== JSON.stringify(streamed)) throw new GeometryFailure("最终边界盒报告与进度不一致");
    for (const source of sources) if (sourceStamp(source.filename) !== source.stamp) throw new GeometryFailure("读取期间模型文件已变化，请重新更新图册");
    return rows.map(result);
  } catch (cause) {
    // Only adapter-authored reasons are public; never expose native paths/errors.
    const message = geometryReadFailureMessage(cause) ?? "隔离读取模型边界盒失败，请确认 FreeCADCmd 可用后重试";
    throw new GeometryFailure(message);
  } finally {
    try { fs.rmSync(folder, { recursive: true, force: true }); }
    catch { throw new GeometryFailure("边界盒隔离临时目录清理失败"); }
  }
}
