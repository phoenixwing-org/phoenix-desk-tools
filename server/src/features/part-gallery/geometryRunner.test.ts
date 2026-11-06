import {installPrivateNativeGateForTest} from "../../../test-support/native-gate.js";
installPrivateNativeGateForTest();
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import { spawn, spawnSync, type SpawnOptions } from "node:child_process";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { runtimeUserDataDir } from "../../lib/appRuntimePaths.js";
import { resolveFreecadCommand } from "../../lib/freecadProcessSecurity.js";
import { acquireDrawingExecution } from "../drawing-research/executionGate.js";
import { GeometryConfigurationError, geometryConfigurationFailureMessage, geometryReadFailureMessage, geometryResultFailureMessage, geometryResultSuccessMessage, readGeometryBatch, type GeometryInput } from "./geometryRunner.js";

vi.mock("node:child_process", async original => {
  const actual = await original<typeof import("node:child_process")>(), mock = vi.fn();
  return { ...actual, spawn: mock, default: { ...actual, spawn: mock } };
});
vi.mock("../../lib/appRuntimePaths.js", () => ({ runtimeUserDataDir: vi.fn() }));
vi.mock("../../lib/freecadProcessSecurity.js", async original => ({
  ...await original<typeof import("../../lib/freecadProcessSecurity.js")>(), resolveFreecadCommand: vi.fn(),
}));
const roots: string[] = [];
const prefix = "DESK_GALLERY_GEOMETRY_ITEM ";
type Row = { index: number; rel: string; bounding_box: { x_mm: number; y_mm: number; z_mm: number } | null; code: string };
type Native = { child: EventEmitter & { stdout: EventEmitter; kill: ReturnType<typeof vi.fn> }; command: string; args: string[]; options: SpawnOptions; script: string; job: { report: string; items: GeometryInput[] } };
function workspace() { const root = fs.mkdtempSync(path.join(os.tmpdir(), "gallery-geometry-test-")); roots.push(root); return root; }
function input(root: string, rel = "parts/Unit.FCStd", node = "Body"): GeometryInput {
  const filename = path.join(root, rel); fs.mkdirSync(path.dirname(filename), { recursive: true });
  // Synthetic inert bytes; mocked child processes never load FreeCAD or this file.
  fs.writeFileSync(filename, "independently generated mock FCStd source"); return { rel, filename, node };
}
function ready(item: GeometryInput, index = 0): Row { return { index, rel: item.rel, bounding_box: { x_mm: 12.5, y_mm: 4.25, z_mm: 0 }, code: "ready" }; }
function report(native: Native, rows: unknown[]) { fs.writeFileSync(native.job.report, JSON.stringify({ version: 1, state: "completed", rows })); }
function progress(native: Native, row: unknown) { native.child.stdout.emit("data", Buffer.from(`${prefix}${JSON.stringify(row)}\n`)); }
function nativeProcess(run: (native: Native) => void) {
  const launches: Native[] = [];
  vi.mocked(spawn).mockImplementation((...arguments_: unknown[]) => {
    const child = Object.assign(new EventEmitter(), { pid:43022, stdout: new EventEmitter(), kill: vi.fn() });
    child.kill.mockImplementation(() => { queueMicrotask(() => child.emit("close", null)); return true; });
    const options = arguments_[2] as SpawnOptions, args = arguments_[1] as string[];
    const job = JSON.parse(fs.readFileSync(path.join(options.cwd as string, "job.json"), "utf8"));
    const native = { child, command: arguments_[0] as string, args, options, script: fs.readFileSync(args.at(-1)!, "utf8"), job };
    launches.push(native); queueMicrotask(() => {child.emit('spawn');run(native);});
    return child as unknown as ReturnType<typeof spawn>;
  });
  return launches;
}
beforeEach(() => {
  vi.mocked(runtimeUserDataDir).mockReturnValue(workspace());
  vi.mocked(resolveFreecadCommand).mockReturnValue("synthetic-freecadcmd");
  vi.stubEnv("PHOENIX_FREECAD_CMD", "synthetic-override");
});
afterEach(() => {
  vi.useRealTimers(); vi.restoreAllMocks(); vi.clearAllMocks(); vi.unstubAllEnvs();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

it("gallery geometry runner reads one bounded batch in a single isolated command with real millimetre axes and no source writes", async () => {
  const root = workspace(), items = [input(root), input(root, "parts/测试件.FCStd", "Body001")];
  const original = items.map(item => fs.readFileSync(item.filename)); const onItem = vi.fn();
  vi.stubEnv("SYNTHETIC_API_TOKEN", "not-forwarded"); vi.stubEnv("NODE_OPTIONS", "not-forwarded");
  const launches = nativeProcess(native => {
    const rows = native.job.items.map(ready); report(native, rows);
    native.child.stdout.emit("data", Buffer.from("FreeCAD startup chatter\n"));
    progress(native, rows[0]);
    // Split a multibyte relative filename across stdout chunks.
    const bytes = Buffer.from(`${prefix}${JSON.stringify(rows[1])}\n`), split = bytes.indexOf(Buffer.from("测试")) + 1;
    native.child.stdout.emit("data", bytes.subarray(0, split)); native.child.stdout.emit("data", bytes.subarray(split));
    native.child.emit("close", 0);
  });
  const result = await readGeometryBatch(items, onItem);
  expect(result.map(row => row.bounding_box)).toEqual([{ x_mm: 12.5, y_mm: 4.25, z_mm: 0 }, { x_mm: 12.5, y_mm: 4.25, z_mm: 0 }]);
  expect(result[0].message).toContain("文档 XYZ 轴"); expect(onItem).toHaveBeenCalledTimes(2); expect(launches).toHaveLength(1);
  const native = launches[0], temporary = native.options.cwd as string;
  expect(native.command).toBe("synthetic-freecadcmd"); expect(native.args.slice(0, 4)).toEqual(["-u", path.join(temporary, "user.cfg"), "-s", path.join(temporary, "system.cfg")]);
  expect(native.options.env).toMatchObject({ QT_QPA_PLATFORM: "offscreen" });
  expect(native.options.env).toMatchObject({ FREECAD_USER_HOME: path.join(temporary, "native-config"), FREECAD_USER_DATA: path.join(temporary, "native-data"), FREECAD_USER_TEMP: path.join(temporary, "native-temp") });
  expect(native.options.env).not.toHaveProperty("SYNTHETIC_API_TOKEN"); expect(native.options.env).not.toHaveProperty("NODE_OPTIONS");
  expect(native.script).toContain("doc.getObject(item['node'])"); expect(native.script).toContain("obj.Shape.BoundBox");
  for (const axis of ["XLength", "YLength", "ZLength"]) expect(native.script).toContain(`box.${axis}`);
  for (const text of ["Assembly::", "App::Part", "App::LinkGroup", "callable(valid)"]) expect(native.script).toContain(text);
  expect(native.script).not.toMatch(/recompute\s*\(|\.save(?:As)?\s*\(|ParamGet|saveParameter|FreeCADGui|Diameter/);
  expect(fs.existsSync(temporary)).toBe(false); expect(native.child.kill).not.toHaveBeenCalled();
  for (let index = 0; index < items.length; index++) expect(fs.readFileSync(items[index].filename)).toEqual(original[index]);
});

it.each(["ready_assembly_optimal", "ready_assembly_standard"])("accepts the fixed %s success only for an explicit assembly request", async code => {
  const item = { ...input(workspace(), "Example.ASSY.FCStd", "总成根"), kind: "assembly" as const };
  const onItem = vi.fn();
  const launches = nativeProcess(native => {
    const row = { ...ready(item), code }; report(native, [row]); progress(native, row); native.child.emit("close", 0);
  });
  const [row] = await readGeometryBatch([item], onItem);
  expect(row.bounding_box).toEqual(ready(item).bounding_box);
  expect(row.message).toContain(code.endsWith("optimal") ? "优化包围盒" : "标准包围盒");
  expect(geometryResultSuccessMessage(row, "assembly")).toBe(row.message);
  expect(geometryResultSuccessMessage(row, "part")).toBeNull(); expect(geometryResultFailureMessage(row)).toBeNull();
  expect(onItem).toHaveBeenCalledWith(row);
  expect(launches[0].job.items).toEqual([{ ...item, filename: fs.realpathSync(item.filename) }]);
});

it.each([
  [undefined, "ready_assembly_optimal"], ["part", "ready_assembly_standard"], ["assembly", "ready"],
] as const)("rejects successful mode confusion: kind=%s code=%s", async (kind, code) => {
  const item = { ...input(workspace()), ...(kind ? { kind } : {}) };
  const onItem = vi.fn(); const launches = nativeProcess(native => progress(native, { ...ready(item), code }));
  await expect(readGeometryBatch([item], onItem)).rejects.toThrow("报告与请求不一致");
  expect(onItem).not.toHaveBeenCalled(); expect(launches[0].child.kill).toHaveBeenCalledWith("SIGTERM");
});

it("keeps legacy part messages and mixed batch wire identities compatible", async () => {
  const directory = workspace(), items: GeometryInput[] = [input(directory), { ...input(directory, "Example.ASSY.FCStd", "装配_根"), kind: "assembly" }];
  nativeProcess(native => {
    const rows = items.map((item, index) => ({ ...ready(item, index), code: index === 0 ? "ready" : "ready_assembly_optimal" }));
    report(native, rows); rows.forEach(row => progress(native, row)); native.child.emit("close", 0);
  });
  const rows = await readGeometryBatch(items);
  expect(rows[0].message).toBe("保存主实体在文档 XYZ 轴的边界盒（mm）");
  expect(geometryResultSuccessMessage(rows[0], "part")).toBe(rows[0].message);
  expect(geometryResultSuccessMessage(rows[1], "assembly")).toBe(rows[1].message);
});

it.each(["unsupported_assembly_root", "incomplete_assembly", "empty_assembly_shape", "assembly_bounds_failed", "assembly_limit"])("keeps assembly %s safely null with a fixed public reason", async code => {
  const item = { ...input(workspace()), kind: "assembly" as const };
  nativeProcess(native => { const row = { index: 0, rel: item.rel, bounding_box: null, code }; report(native, [row]); progress(native, row); native.child.emit("close", 0); });
  const [row] = await readGeometryBatch([item]);
  expect(row.bounding_box).toBeNull(); expect(geometryResultFailureMessage(row)).toBe(row.message); expect(geometryResultSuccessMessage(row)).toBeNull();
});

it.each([null, "unknown", 1])("rejects invalid kind %s before launching", async kind => {
  await expect(readGeometryBatch([{ ...input(workspace()), kind: kind as GeometryInput["kind"] }])).rejects.toThrow("输入");
  expect(spawn).not.toHaveBeenCalled();
});

it.each(["总成根", "Élément_Ⅰ", "_零件1"])("accepts the serialized Unicode internal object identity %s", async node => {
  const item = input(workspace(), "Example.FCStd", node);
  nativeProcess(native => { const row = ready(item); report(native, [row]); progress(native, row); native.child.emit("close", 0); });
  expect(await readGeometryBatch([item])).toHaveLength(1);
});

it.each(["9Body", "Body.Part", "Body/Part", "Body\nPart", " Body", "A".repeat(257)])("rejects a non-serialized object name %s", async node => {
  await expect(readGeometryBatch([input(workspace(), "Example.FCStd", node)])).rejects.toThrow("输入");
  expect(spawn).not.toHaveBeenCalled();
});

it("only exposes fixed success messages, optionally narrowed to the requested kind", () => {
  const part = "保存主实体在文档 XYZ 轴的边界盒（mm）";
  const assembly = "已保存总成几何在文档 XYZ 轴的外包络（mm，优化包围盒；非加工尺寸）";
  expect(geometryResultSuccessMessage(part)).toBe(part); expect(geometryResultSuccessMessage({ message: assembly }, "assembly")).toBe(assembly);
  expect(geometryResultSuccessMessage(part, "assembly")).toBeNull(); expect(geometryResultSuccessMessage(assembly, "part")).toBeNull();
  for (const value of [null, undefined, 1, "ready", "/synthetic/private-like-error", { message: "主零件节点的 Shape 为空" }, { message: "ready_assembly_optimal" }])
    expect(geometryResultSuccessMessage(value)).toBeNull();
  expect(geometryResultSuccessMessage({ get message() { throw new Error("not public"); } })).toBeNull();
});

it.each([
  { code: "ready_assembly_optimal", bounding_box: null },
  { code: "ready_assembly_standard", bounding_box: { x_mm: -1, y_mm: 2, z_mm: 3 } },
  { code: "ready_assembly_optimal", bounding_box: { x_mm: 0, y_mm: 0, z_mm: 0 } },
  { code: "incomplete_assembly", bounding_box: { x_mm: 1, y_mm: 2, z_mm: 3 } },
])("rejects invalid assembly success/failure bounds %#", async patch => {
  const item = { ...input(workspace()), kind: "assembly" as const };
  nativeProcess(native => progress(native, { ...ready(item), ...patch }));
  await expect(readGeometryBatch([item])).rejects.toThrow("边界盒");
});

it("does not replace an optimal assembly progress receipt with a different final measurement method", async () => {
  const item = { ...input(workspace()), kind: "assembly" as const };
  nativeProcess(native => {
    progress(native, { ...ready(item), code: "ready_assembly_optimal" });
    report(native, [{ ...ready(item), code: "ready_assembly_standard" }]); native.child.emit("close", 0);
  });
  await expect(readGeometryBatch([item])).rejects.toThrow("与进度不一致");
});

it("keeps the assembly Native plan rooted in verified saved instances without solving, source writes or double placement", async () => {
  const item = { ...input(workspace(), "Example.ASSY.FCStd", "总成根"), kind: "assembly" as const };
  const launches = nativeProcess(native => {
    const row = { ...ready(item), code: "ready_assembly_optimal" }; report(native, [row]); progress(native, row); native.child.emit("close", 0);
  });
  await readGeometryBatch([item]); const script = launches[0].script;
  expect(script).toContain("Part.getShape(root, subname, needSubElement=False, transform=True, retType=1)");
  expect(script).toContain("owner is expected_owner"); expect(script).toContain("Part.makeCompound(shapes)");
  expect(script).toContain("optimal(False, False)"); expect(script).toContain("except (TypeError, AttributeError, NotImplementedError)");
  expect(script).toContain("len(leaves) < 2000"); expect(script).toContain("depth <= 64");
  expect(script).toContain("sorted(child.Name for child in actual) == sorted(expected)");
  expect(script).toContain("target.Name == expected_name"); expect(script).toContain("('Placement', 'LinkPlacement')");
  expect(script).toContain("result == source_signature"); expect(script).toContain("Counter({identity: 1})");
  expect(script).not.toContain("shape.isValid()");
  expect(script).not.toMatch(/recompute\s*\(|\.save(?:As)?\s*\(|\.Rigid\s*=|\.Visibility\s*=|\.transformShape\s*\(|\.transformGeometry\s*\(|\.fuse\s*\(|FreeCADGui|UtilsAssembly/);
});

// Execute only the fixed Python control flow with in-memory fake App/Part/ZIP
// modules, like nativeCamera.test. This is not FreeCAD, geometry evidence or a
// substitute for the independently gated synthetic Native acceptance.
const ASSEMBLY_PYTHON_MOCK = String.raw`
import sys, types, io, json, os, zipfile, xml.etree.ElementTree as mock_et
from pathlib import Path
mock_spec = json.loads(Path(MOCK_JOB).read_text(encoding='utf-8'))
host_name = mock_spec['items'][0]['filename']
source_name = str(Path(host_name).parent / 'Definitions.FCStd')
class Box:
    XMin, XMax, YMin, YMax, ZMin, ZMax = 0., 24., 0., 13., 0., 9.
    XLength, YLength, ZLength = 24., 13., 9.
    def isValid(self): return True
class Shape:
    BoundBox = Box()
    def __init__(self, null=False): self.null = null
    def isNull(self): return self.null
    def isValid(self): raise AssertionError('topology validation is not required for an envelope')
class Compound(Shape):
    def optimalBoundingBox(self, triangulation, tolerance):
        assert triangulation is False and tolerance is False
        if CASE == 'unsupported_optimal': raise NotImplementedError()
        if CASE == 'broken_optimal': raise RuntimeError('/synthetic/private-like-error')
        if CASE == 'invalid_bounds':
            value = Box(); value.XLength = -1; return value
        return Box()
class Doc:
    def __init__(self, filename): self.FileName=filename; self.Name=Path(filename).stem; self.objects={}
    def getObject(self, name): return self.objects.get(name)
class Obj:
    def __init__(self, doc, name, kind):
        self.Document=doc; self.Name=name; self.TypeId=kind; self.Group=[]; self.State=[]
        self.Placement=types.SimpleNamespace(Base=types.SimpleNamespace(x=0.,y=0.,z=0.),Rotation=types.SimpleNamespace(Q=(0.,0.,0.,1.)))
        self.saved_target=None; self.LinkedObject=None; self.ElementCount=0; self.Visibility=True
        self.Shape=Shape(); doc.objects[name]=self
    def isDerivedFrom(self, kind):
        return kind == 'Part::Feature' and self.TypeId in ('Part::Feature','Part::FeaturePython','Sketcher::SketchObject')
host=Doc(host_name); source=Doc(source_name)
root=Obj(host,mock_spec['items'][0]['node'],'Assembly::AssemblyObject')
normal=Obj(host,'IndependentFeature','Part::Feature')
definition=Obj(source,'SubDefinition','Assembly::AssemblyObject')
a=Obj(source,'DefinitionA','Part::Feature'); b=Obj(source,'DefinitionB','Part::Feature')
definition.Group=[a,b]
instance=Obj(host,'Instance','Assembly::AssemblyLink'); instance.LinkedObject=definition; instance.saved_target=definition
copy_a=Obj(host,'CopyA','App::Link'); copy_a.LinkedObject=a; copy_a.saved_target=a
copy_b=Obj(host,'CopyB','App::Link'); copy_b.LinkedObject=b; copy_b.saved_target=b
instance.Group=[copy_a,copy_b]; root.Group=[normal,instance]
owners={'IndependentFeature.':normal,'Instance.CopyA.':copy_a,'Instance.CopyB.':copy_b}
expected_count=3
if CASE == 'empty_instance': instance.Group=[]
if CASE == 'short_instance': instance.Group=[copy_a]
if CASE == 'extra_instance':
    extra=Obj(host,'ExtraCopyA','App::Link'); extra.LinkedObject=a; extra.saved_target=a; instance.Group.append(extra)
if CASE == 'missing_link': copy_b.LinkedObject=None
if CASE == 'unknown_component': normal.TypeId='Mesh::Feature'
if CASE == 'invalid_state': normal.State=['Invalid']
if CASE == 'pose_drift': normal.Placement.Base.x=2.
if CASE == 'group_drift': instance.saved_group=[copy_a,copy_b]; instance.Group=[copy_a]
if CASE == 'cycle': root.Group=[root]
if CASE == 'too_many': root.Group=[Obj(host,'Feature'+str(i),'Part::Feature') for i in range(2001)]
if CASE == 'hidden_and_auxiliary':
    definition.Visibility=False; instance.Visibility=False; normal.Visibility=False
    origin=Obj(host,'FarOrigin','App::Origin'); sketch=Obj(host,'FarSketch','Sketcher::SketchObject')
    root.Group.extend([origin,sketch])
if CASE == 'repeated_definition':
    # Two different saved occurrences of one definition are not one instance.
    second_source=Obj(source,'SourceAInstance','App::Link'); second_source.LinkedObject=a; second_source.saved_target=a
    definition.Group=[a,second_source]; copy_b.LinkedObject=second_source; copy_b.saved_target=second_source
if CASE == 'lost_repeated_definition':
    second_source=Obj(source,'SourceAInstance','App::Link'); second_source.LinkedObject=a; second_source.saved_target=a
    definition.Group=[a,second_source]; instance.Group=[copy_a]
if CASE == 'array_not_attested': copy_a.ElementCount=3
if CASE == 'wrong_root': root.TypeId='Part::Feature'
if CASE == 'empty_root': root.Group=[]

payloads={}
for doc in (host,source):
    document=mock_et.Element('Document'); declarations=mock_et.SubElement(document,'Objects'); objects=mock_et.SubElement(document,'ObjectData')
    for obj in doc.objects.values():
        mock_et.SubElement(declarations,'Object',name=obj.Name,type=obj.TypeId)
        item=mock_et.SubElement(objects,'Object',name=obj.Name); props=mock_et.SubElement(item,'Properties')
        prop=mock_et.SubElement(props,'Property',name='Placement',type='App::PropertyPlacement')
        mock_et.SubElement(prop,'PropertyPlacement',Px='0',Py='0',Pz='0',Q0='0',Q1='0',Q2='0',Q3='1')
        if obj.TypeId in ('Assembly::AssemblyObject','Assembly::AssemblyLink','App::Part','App::LinkGroup','App::DocumentObjectGroup'):
            prop=mock_et.SubElement(props,'Property',name='Group',type='App::PropertyLinkList'); group=mock_et.SubElement(prop,'LinkList')
            for child in getattr(obj,'saved_group',obj.Group): mock_et.SubElement(group,'Link',value=child.Name)
        if obj.saved_target is not None:
            target=obj.saved_target; prop=mock_et.SubElement(props,'Property',name='LinkedObject',type='App::PropertyXLink')
            mock_et.SubElement(prop,'XLink',name=target.Name,file='' if target.Document is doc else os.path.relpath(target.Document.FileName,Path(doc.FileName).parent))
    payloads[str(Path(doc.FileName).resolve())]=mock_et.tostring(document,encoding='utf-8')
class Archive:
    def __init__(self,filename): self.data=payloads[str(Path(filename).resolve())]
    def __enter__(self): return self
    def __exit__(self,*unused): pass
    def infolist(self): return [types.SimpleNamespace(filename='Document.xml',file_size=len(self.data))]
    def open(self,entry): return io.BytesIO(self.data)
zipfile.ZipFile=Archive
calls=[]
def get_shape(actual_root,subname,**kwargs):
    assert actual_root is root and kwargs==dict(needSubElement=False,transform=True,retType=1)
    assert subname in owners
    calls.append(subname)
    return Shape(CASE=='null_leaf' and subname=='Instance.CopyB.'),object(),root if CASE=='wrong_owner' else owners[subname]
def compound(shapes):
    assert len(shapes)==expected_count and calls==list(owners)
    if CASE=='no_optimal': return Shape()
    return Compound()
sys.modules['Part']=types.SimpleNamespace(getShape=get_shape,makeCompound=compound)
sys.modules['FreeCAD']=types.SimpleNamespace(openDocument=lambda filename:host,listDocuments=lambda:{'Host':host,'Source':source},closeDocument=lambda name:None)
`;

const PYTHON_ASSEMBLY_CASES = [
  ["normal", "ready_assembly_optimal"], ["repeated_definition", "ready_assembly_optimal"],
  ["hidden_and_auxiliary", "ready_assembly_optimal"], ["unsupported_optimal", "ready_assembly_standard"], ["no_optimal", "ready_assembly_standard"],
  ["empty_instance", "incomplete_assembly"], ["short_instance", "incomplete_assembly"], ["extra_instance", "incomplete_assembly"],
  ["lost_repeated_definition", "incomplete_assembly"], ["missing_link", "incomplete_assembly"], ["group_drift", "incomplete_assembly"],
  ["unknown_component", "incomplete_assembly"], ["invalid_state", "incomplete_assembly"], ["pose_drift", "incomplete_assembly"],
  ["cycle", "incomplete_assembly"], ["array_not_attested", "incomplete_assembly"], ["wrong_owner", "incomplete_assembly"], ["null_leaf", "incomplete_assembly"],
  ["too_many", "assembly_limit"], ["wrong_root", "unsupported_assembly_root"], ["empty_root", "empty_assembly_shape"],
  ["broken_optimal", "assembly_bounds_failed"], ["invalid_bounds", "assembly_bounds_failed"],
] as const;
it.each(PYTHON_ASSEMBLY_CASES)("runs fixed Python with fake App/Part/ZIP for %s, never a FreeCAD process", async (scenario, expected) => {
  const item = { ...input(workspace(), "Example.ASSY.FCStd", "总成根"), kind: "assembly" as const };
  let actualCode: string | undefined, pythonError: string | undefined;
  nativeProcess(native => {
    const prelude = `MOCK_JOB=${JSON.stringify(path.join(native.options.cwd as string, "job.json"))}\nCASE=${JSON.stringify(scenario)}\n`;
    const executed = spawnSync("python3", ["-c", prelude + ASSEMBLY_PYTHON_MOCK + "\n" + native.script], {
      cwd: native.options.cwd, encoding: "utf8", timeout: 5000, maxBuffer: 2 * 1024 * 1024,
      env: { PATH: process.env.PATH || "/usr/bin:/bin", PYTHONDONTWRITEBYTECODE: "1" },
    });
    if (executed.status !== 0) { pythonError = executed.stderr || "synthetic Python process failed"; native.child.emit("close", 1); return; }
    const output = JSON.parse(fs.readFileSync(native.job.report, "utf8")); actualCode = output.rows[0].code;
    native.child.stdout.emit("data", Buffer.from(executed.stdout)); native.child.emit("close", 0);
  });
  const [row] = await readGeometryBatch([item]).catch(error => { if (pythonError) throw new Error(pythonError); throw error; }); expect(actualCode).toBe(expected);
  if (expected.startsWith("ready_")) expect(row.bounding_box).toEqual({ x_mm: 24, y_mm: 13, z_mm: 9 });
  else { expect(row.bounding_box).toBeNull(); expect(geometryResultSuccessMessage(row, "assembly")).toBeNull(); }
  expect(row.message).not.toContain("private-like-error");
});

it("replaces inherited FreeCAD user roots with owned existing private directories before spawn", async () => {
  const item = input(workspace());
  for (const key of ["FREECAD_USER_HOME", "FREECAD_USER_DATA", "FREECAD_USER_TEMP"]) vi.stubEnv(key, "/synthetic/never-read-user-profile");
  nativeProcess(native => {
    for (const key of ["FREECAD_USER_HOME", "FREECAD_USER_DATA", "FREECAD_USER_TEMP"]) {
      const directory = native.options.env?.[key]!;
      expect(path.dirname(directory)).toBe(native.options.cwd);
      expect(fs.lstatSync(directory).isDirectory()).toBe(true);
      expect(fs.lstatSync(directory).mode & 0o777).toBe(0o700);
      expect(fs.readdirSync(directory)).toEqual([]);
      expect(directory).not.toContain("never-read-user-profile");
    }
    const row = ready(item); report(native, [row]); progress(native, row); native.child.emit("close", 0);
  });
  const [row] = await readGeometryBatch([item]); expect(row.bounding_box).toEqual(ready(item).bounding_box);
});

it.each(["missing_node", "unsupported_node", "missing_shape", "empty_shape", "invalid_bounds", "read_failed"])("gallery geometry runner preserves explicit %s as null instead of guessing a different shape", async code => {
  const item = input(workspace()); nativeProcess(native => {
    const row = { index: 0, rel: item.rel, bounding_box: null, code }; report(native, [row]); progress(native, row); native.child.emit("close", 0);
  });
  const [row] = await readGeometryBatch([item]); expect(row.bounding_box).toBeNull(); expect(row.message).toBeTruthy(); expect(row).not.toHaveProperty("code");
  expect(geometryResultFailureMessage(row)).toBe(row.message);
});

it("gallery geometry runner does not start a process or read installation prefs for an empty batch", async () => {
  vi.mocked(runtimeUserDataDir).mockClear();
  expect(await readGeometryBatch([])).toEqual([]); expect(spawn).not.toHaveBeenCalled(); expect(runtimeUserDataDir).not.toHaveBeenCalled();
});

const invalidInputs: Array<[string, Partial<GeometryInput>]> = [
  ["absent node", { node: "" }], ["Python-like node", { node: "Body');print('injected" }],
  ["relative filename", { filename: "Unit.FCStd" }], ["wrong extension", { filename: "/synthetic/Unit.step" }],
  ["escaped rel", { rel: "../Unit.FCStd" }], ["absolute rel", { rel: "/Unit.FCStd" }],
];
it.each(invalidInputs)("gallery geometry runner rejects %s before launching native code", async (_name, patch) => {
  const item = input(workspace()); await expect(readGeometryBatch([{ ...item, ...patch }])).rejects.toThrow(/输入/); expect(spawn).not.toHaveBeenCalled();
});

it("gallery geometry runner rejects duplicate rels, unsafe sources and more than one hundred inputs", async () => {
  const root = workspace(), item = input(root);
  await expect(readGeometryBatch([item, item])).rejects.toThrow(/唯一/);
  await expect(readGeometryBatch(Array.from({ length: 101 }, () => item))).rejects.toThrow(/最多 100/);
  const linked = path.join(root, "Alias.FCStd"); fs.symlinkSync(item.filename, linked);
  await expect(readGeometryBatch([{ ...item, filename: linked }])).rejects.toThrow(/不可安全读取/);
  fs.truncateSync(item.filename, 64 * 1024 * 1024 + 1);
  await expect(readGeometryBatch([item])).rejects.toThrow(/不可安全读取/); expect(spawn).not.toHaveBeenCalled();
});

const invalidReports: Array<[string, Record<string, unknown>]> = [
  ["all-zero dimensions", { bounding_box: { x_mm: 0, y_mm: 0, z_mm: 0 } }],
  ["negative dimension", { bounding_box: { x_mm: -1, y_mm: 2, z_mm: 3 } }],
  ["string dimension", { bounding_box: { x_mm: "12", y_mm: 2, z_mm: 3 } }],
  ["non-finite encoded as null", { bounding_box: { x_mm: null, y_mm: 2, z_mm: 3 } }],
  ["pixel fields", { bounding_box: { width: 512, height: 512 } }],
  ["wrong relative identity", { rel: "elsewhere/Unit.FCStd" }], ["out-of-order index", { index: 1 }],
  ["unknown reason code", { code: "__proto__", bounding_box: null }],
  ["external error field", { error: "/synthetic/private-like-path" }],
];
it.each(invalidReports)("gallery geometry runner rejects %s in streamed reports and terminates only its own child", async (_name, patch) => {
  const item = input(workspace()); const launches = nativeProcess(native => progress(native, { ...ready(item), ...patch }));
  await expect(readGeometryBatch([item])).rejects.toThrow(/边界盒/);
  expect(launches[0].child.kill).toHaveBeenCalledWith("SIGTERM"); expect(fs.existsSync(launches[0].options.cwd as string)).toBe(false);
});

it("gallery geometry runner requires complete matching final JSON rather than trusting individual progress markers", async () => {
  const item = input(workspace()); const launches = nativeProcess(native => {
    progress(native, ready(item)); report(native, [{ ...ready(item), bounding_box: { x_mm: 99, y_mm: 2, z_mm: 3 } }]); native.child.emit("close", 0);
  });
  await expect(readGeometryBatch([item])).rejects.toThrow(/与进度不一致/); expect(fs.existsSync(launches[0].options.cwd as string)).toBe(false);
  nativeProcess(native => { report(native, []); native.child.emit("close", 0); });
  await expect(readGeometryBatch([item])).rejects.toThrow(/未完整/);
});

it("gallery geometry runner detects source changes before exposing measurements", async () => {
  const item = input(workspace()), onItem = vi.fn(); nativeProcess(native => {
    fs.appendFileSync(item.filename, "changed"); progress(native, ready(item));
  });
  await expect(readGeometryBatch([item], onItem)).rejects.toThrow(/文件已变化/); expect(onItem).not.toHaveBeenCalled();
});

it("gallery geometry runner rejects callback failures without leaking callback paths or secrets", async () => {
  const item = input(workspace()); nativeProcess(native => progress(native, ready(item)));
  const error = await readGeometryBatch([item], () => { throw new Error("synthetic-private-source/token"); }).catch(error => error as Error);
  expect(String(error)).toContain("进度处理失败"); expect(String(error)).not.toContain("synthetic-private-source");
  expect(geometryReadFailureMessage(error)).toBe("边界盒进度处理失败");
});

it.each(["spawn error", "abnormal exit", "no final report", "invalid final JSON"])("gallery geometry runner sanitizes %s and cleans its owned temporary directory", async mode => {
  const item = input(workspace()); const launches = nativeProcess(native => {
    if (mode === "spawn error") native.child.emit("error", new Error("/synthetic/private-like-path TOKEN=do-not-echo"));
    else if (mode === "abnormal exit") native.child.emit("close", 9);
    else { if (mode === "invalid final JSON") fs.writeFileSync(native.job.report, "not JSON"); native.child.emit("close", 0); }
  });
  const error = await readGeometryBatch([item]).catch(error => error as Error);
  expect(error).toBeInstanceOf(Error); expect(String(error)).not.toContain("private-like-path"); expect(String(error)).not.toContain("do-not-echo");
  expect(geometryReadFailureMessage(error)).toBe({
    "spawn error": "无法启动 FreeCADCmd 边界盒读取进程",
    "abnormal exit": "FreeCADCmd 边界盒读取进程异常退出",
    "no final report": "FreeCADCmd 未返回有效边界盒报告",
    "invalid final JSON": "最终边界盒报告不是有效 JSON",
  }[mode]);
  expect(fs.existsSync(launches[0].options.cwd as string)).toBe(false);
});

it("gallery geometry runner bounds stdout and final report size", async () => {
  const item = input(workspace()); nativeProcess(native => native.child.stdout.emit("data", Buffer.alloc(1024 * 1024 + 1, 65)));
  await expect(readGeometryBatch([item])).rejects.toThrow(/安全上限/);
  nativeProcess(native => { fs.writeFileSync(native.job.report, Buffer.alloc(1024 * 1024 + 1)); native.child.emit("close", 0); });
  await expect(readGeometryBatch([item])).rejects.toThrow(/有效边界盒报告/);
});

it("gallery geometry runner ends a stalled child at its overall deadline and leaves no pending timers", async () => {
  vi.useFakeTimers(); const item = input(workspace()), launches = nativeProcess(() => {});
  const pending = expect(readGeometryBatch([item])).rejects.toThrow(/超过 2 分钟/);
  await vi.advanceTimersByTimeAsync(120_000); await pending;
  expect(launches[0].child.kill).toHaveBeenCalledTimes(1); expect(fs.existsSync(launches[0].options.cwd as string)).toBe(false); expect(vi.getTimerCount()).toBe(0);
});

it("does not launch or inspect installation preferences for a pre-cancelled read", async () => {
  const signal = new AbortController(); signal.abort(); vi.mocked(runtimeUserDataDir).mockClear();
  await expect(readGeometryBatch([], undefined, {signal:signal.signal})).rejects.toThrow(/未启动/);
  expect(spawn).not.toHaveBeenCalled(); expect(runtimeUserDataDir).not.toHaveBeenCalled();
});

it("stops buffered progress after the first callback aborts, but retains ownership until actual close", async () => {
  vi.useFakeTimers(); const root = workspace(), items = [input(root), input(root, 'parts/Second.FCStd')], controller = new AbortController();
  const onItem = vi.fn(() => controller.abort());
  const launches = nativeProcess(native => {
    native.child.kill.mockReturnValue(false);
    const rows = items.map(ready); report(native, rows);
    native.child.stdout.emit('data', Buffer.from(rows.map(row => `${prefix}${JSON.stringify(row)}\n`).join('')));
  });
  let settled = false;
  const running = readGeometryBatch(items, onItem, {signal:controller.signal}).finally(() => { settled = true; });
  const rejected = expect(running).rejects.toThrow(/已等待自有进程关闭/);
  await Promise.resolve(); await vi.advanceTimersByTimeAsync(2000);
  const native = launches[0], folder = native.options.cwd as string;
  expect(onItem).toHaveBeenCalledTimes(1); expect(onItem.mock.calls[0]).toEqual([expect.objectContaining({rel:items[0].rel})]);
  expect(native.child.kill.mock.calls).toEqual([['SIGTERM'], ['SIGKILL']]);
  expect(settled).toBe(false); expect(fs.existsSync(folder)).toBe(true);
  expect(() => acquireDrawingExecution('buffered-progress-must-wait')).toThrow();
  native.child.emit('exit', null, 'SIGKILL'); await Promise.resolve(); expect(settled).toBe(false);
  native.child.emit('close', null, 'SIGKILL'); await rejected;
  expect(onItem).toHaveBeenCalledTimes(1); expect(fs.existsSync(folder)).toBe(false); expect(vi.getTimerCount()).toBe(0);
  const release = acquireDrawingExecution('after-buffered-progress-close'); release();
});

it("holds the CAD lease and temporary files after failed termination and even an exit event, until actual close", async () => {
  vi.useFakeTimers(); const item = input(workspace()), signal = new AbortController();
  const launches = nativeProcess(native => { native.child.kill.mockImplementation(() => { throw new Error('synthetic signal failure'); }); });
  let settled = false;
  const running = readGeometryBatch([item], undefined, {signal:signal.signal}).finally(() => { settled = true; });
  const rejected = expect(running).rejects.toThrow(/已等待自有进程关闭/);
  await Promise.resolve(); signal.abort(); await vi.advanceTimersByTimeAsync(5000);
  const native = launches[0], folder = native.options.cwd as string;
  expect(native.child.kill.mock.calls).toEqual([['SIGTERM'], ['SIGKILL']]);
  expect(settled).toBe(false); expect(fs.existsSync(folder)).toBe(true);
  expect(() => acquireDrawingExecution('another-typed-owner')).toThrow();
  native.child.emit('exit', null, 'SIGTERM'); await Promise.resolve(); expect(settled).toBe(false);
  native.child.emit('close', null, 'SIGTERM'); await rejected;
  expect(fs.existsSync(folder)).toBe(false); expect(vi.getTimerCount()).toBe(0);
  const release = acquireDrawingExecution('after-real-close'); release();
});

it("does not clean up on the deadline or kill grace if the owned child has not closed", async () => {
  vi.useFakeTimers(); const item = input(workspace());
  const launches = nativeProcess(native => { native.child.kill.mockReturnValue(false); });
  let settled = false; const running = readGeometryBatch([item]).finally(() => { settled = true; });
  const rejected = expect(running).rejects.toThrow(/超过 2 分钟/);
  await vi.advanceTimersByTimeAsync(125000);
  expect(settled).toBe(false); expect(fs.existsSync(launches[0].options.cwd as string)).toBe(true);
  expect(() => acquireDrawingExecution('must-still-wait')).toThrow();
  launches[0].child.emit('close', null, 'SIGKILL'); await rejected;
  expect(fs.existsSync(launches[0].options.cwd as string)).toBe(false); expect(vi.getTimerCount()).toBe(0);
});

it("shares the existing same-process CAD execution gate without launching or stopping another owner", async () => {
  const item = input(workspace()), release = acquireDrawingExecution('independent-drawing-owner');
  try { await expect(readGeometryBatch([item])).rejects.toThrow(/已有原生 CAD 任务/); expect(spawn).not.toHaveBeenCalled(); }
  finally { release(); }
  nativeProcess(native => { const row = ready(item); report(native,[row]); progress(native,row); native.child.emit('close',0); });
  await expect(readGeometryBatch([item])).resolves.toHaveLength(1);
});

it("also clears termination timers if a host emits close synchronously during the signal request", async () => {
  vi.useFakeTimers(); const item = input(workspace()), signal = new AbortController();
  nativeProcess(native => { native.child.kill.mockImplementation(() => { native.child.emit('close',null,'SIGTERM'); return true; }); });
  const pending = expect(readGeometryBatch([item],undefined,{signal:signal.signal})).rejects.toThrow(/已等待自有进程关闭/);
  await Promise.resolve(); signal.abort(); await pending; expect(vi.getTimerCount()).toBe(0);
});

it("gallery geometry runner reports missing or unsafe FreeCADCmd configuration without a native launch", async () => {
  const item = input(workspace()); vi.mocked(resolveFreecadCommand).mockReturnValueOnce(null);
  await expect(readGeometryBatch([item])).rejects.toThrow(/安装目录/);
  vi.mocked(resolveFreecadCommand).mockImplementationOnce(() => { throw new Error("/synthetic/private-like-path"); });
  const error = await readGeometryBatch([item]).catch(error => error as Error);
  expect(String(error)).toContain("配置不可用"); expect(String(error)).not.toContain("private-like-path"); expect(spawn).not.toHaveBeenCalled();
});

it("gallery geometry runner discovers only the standard macOS installation when no command is configured", async () => {
  vi.stubEnv("PHOENIX_FREECAD_CMD", ""); vi.spyOn(os, "platform").mockReturnValue("darwin");
  const prefs = path.join(runtimeUserDataDir(), "launcher-prefs.json");
  fs.writeFileSync(prefs, JSON.stringify({ freecad_dir: "" }));
  const before = fs.readFileSync(prefs), item = input(workspace());
  const launches = nativeProcess(native => {
    const row = ready(item); report(native, [row]); progress(native, row); native.child.emit("close", 0);
  });
  const [row] = await readGeometryBatch([item]);
  expect(row.bounding_box).toEqual(ready(item).bounding_box);
  expect(resolveFreecadCommand).toHaveBeenCalledExactlyOnceWith("/Applications/FreeCAD.app", "");
  expect(launches[0].command).toBe("synthetic-freecadcmd"); expect(fs.readFileSync(prefs)).toEqual(before);
});

it.each(["linux", "win32"] as const)("gallery geometry runner does not guess a default installation on %s", async platform => {
  vi.stubEnv("PHOENIX_FREECAD_CMD", ""); vi.spyOn(os, "platform").mockReturnValue(platform);
  const error = await readGeometryBatch([input(workspace())]).catch(error => error as Error);
  expect(error).toBeInstanceOf(GeometryConfigurationError);
  expect((error as GeometryConfigurationError).code).toBe("freecad_not_found");
  expect(geometryConfigurationFailureMessage(error)).toBe("未找到 FreeCADCmd，请先配置 FreeCAD 安装目录");
  expect(resolveFreecadCommand).not.toHaveBeenCalled(); expect(spawn).not.toHaveBeenCalled();
});

it.each(["environment", "preference"] as const)("gallery geometry runner never falls back from an invalid explicit %s setting", async source => {
  vi.spyOn(os, "platform").mockReturnValue("darwin");
  const explicit = "/synthetic/private-like-invalid-install";
  vi.stubEnv("PHOENIX_FREECAD_CMD", source === "environment" ? explicit : "");
  fs.writeFileSync(path.join(runtimeUserDataDir(), "launcher-prefs.json"), JSON.stringify({ freecad_dir: source === "preference" ? explicit : "/synthetic/other-install" }));
  vi.mocked(resolveFreecadCommand).mockReturnValueOnce(null);
  const error = await readGeometryBatch([input(workspace())]).catch(error => error as Error);
  expect(error).toBeInstanceOf(GeometryConfigurationError);
  expect((error as GeometryConfigurationError).code).toBe("freecad_configuration_invalid");
  expect(resolveFreecadCommand).toHaveBeenCalledExactlyOnceWith(source === "preference" ? explicit : "", source === "environment" ? explicit : "");
  expect(geometryConfigurationFailureMessage(error)).toBe("FreeCADCmd 配置不可用，请确认安装目录而非图形启动器");
  expect(String(error)).not.toContain("private-like"); expect(spawn).not.toHaveBeenCalled();
});

it("gallery geometry runner gives a safe missing-command error when the standard macOS installation is absent", async () => {
  vi.stubEnv("PHOENIX_FREECAD_CMD", ""); vi.spyOn(os, "platform").mockReturnValue("darwin");
  vi.mocked(resolveFreecadCommand).mockReturnValueOnce(null);
  const error = await readGeometryBatch([input(workspace())]).catch(error => error as Error);
  expect((error as GeometryConfigurationError).code).toBe("freecad_not_found");
  expect(resolveFreecadCommand).toHaveBeenCalledExactlyOnceWith("/Applications/FreeCAD.app", "");
  expect(spawn).not.toHaveBeenCalled();
});

it("gallery geometry runner does not hide malformed explicit preferences behind default discovery", async () => {
  vi.stubEnv("PHOENIX_FREECAD_CMD", ""); vi.spyOn(os, "platform").mockReturnValue("darwin");
  fs.writeFileSync(path.join(runtimeUserDataDir(), "launcher-prefs.json"), "not JSON");
  const error = await readGeometryBatch([input(workspace())]).catch(error => error as Error);
  expect((error as GeometryConfigurationError).code).toBe("freecad_configuration_invalid");
  expect(resolveFreecadCommand).not.toHaveBeenCalled(); expect(spawn).not.toHaveBeenCalled();
  expect(geometryConfigurationFailureMessage(new Error("/synthetic/private-like-error"))).toBeNull();
  const controlled = new GeometryConfigurationError("freecad_not_found"); controlled.message = "/synthetic/private-like-error";
  expect(geometryConfigurationFailureMessage(controlled)).toBe("未找到 FreeCADCmd，请先配置 FreeCAD 安装目录");
  Object.defineProperty(controlled, "code", { value: "__proto__" });
  expect(geometryConfigurationFailureMessage(controlled)).toBeNull();
});

it("gallery geometry failure helpers reject native text, forged errors, ready statuses and arbitrary reader results", async () => {
  const arbitrary = "/synthetic/private-like-path TOKEN=do-not-persist";
  expect(geometryReadFailureMessage(new Error(arbitrary))).toBeNull();
  expect(geometryReadFailureMessage(new Error("无法启动 FreeCADCmd 边界盒读取进程"))).toBeNull();
  expect(geometryReadFailureMessage({ message: "无法启动 FreeCADCmd 边界盒读取进程" })).toBeNull();
  const configuration = new GeometryConfigurationError("freecad_not_found"); configuration.message = arbitrary;
  expect(geometryReadFailureMessage(configuration)).toBe("未找到 FreeCADCmd，请先配置 FreeCAD 安装目录");
  for (const value of [null, undefined, 5, arbitrary, { message: arbitrary }, { message: "保存主实体在文档 XYZ 轴的边界盒（mm）" }, { message: { code: "empty_shape" } }]) {
    expect(geometryResultFailureMessage(value)).toBeNull();
  }
  expect(geometryResultFailureMessage({ get message() { throw new Error(arbitrary); } })).toBeNull();
  expect(geometryResultFailureMessage("主零件节点的 Shape 为空")).toBe("主零件节点的 Shape 为空");
  nativeProcess(native => native.child.emit("error", new Error(arbitrary)));
  const error = await readGeometryBatch([input(workspace())]).catch(error => error as Error);
  expect(geometryReadFailureMessage(error)).toBe("无法启动 FreeCADCmd 边界盒读取进程");
  (error as Error).message = arbitrary; expect(geometryReadFailureMessage(error)).toBeNull();
});
