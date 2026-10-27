import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { runtimeUserDataDir } from "../../lib/appRuntimePaths.js";
import { buildFreecadChildEnvironment, resolveFreecadCommand } from "../../lib/freecadProcessSecurity.js";
import { acquireDrawingExecution, type DrawingExecutionLease } from "../drawing-research/executionGate.js";

export type GeometryInput = { rel: string; filename: string; node: string };
export type GeometryResult = { rel: string; bounding_box: { x_mm: number; y_mm: number; z_mm: number } | null; message: string };
const PREFIX = "DESK_GALLERY_GEOMETRY_ITEM ";
const MAX_ITEMS = 100, MAX_SOURCE_BYTES = 64 * 1024 * 1024, MAX_REPORT_BYTES = 1024 * 1024;
const TIMEOUT_MS = 120_000, KILL_GRACE_MS = 1000;
const MESSAGES: Record<string, string> = {
  ready: "保存主实体在文档 XYZ 轴的边界盒（mm）",
  missing_node: "未找到指定主零件节点",
  unsupported_node: "所选节点是装配或链接容器，不读取零件边界盒",
  missing_shape: "主零件节点没有可读取的 Shape",
  empty_shape: "主零件节点的 Shape 为空",
  invalid_bounds: "主零件节点的边界盒无效",
  read_failed: "无法读取已保存的模型几何",
};
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
const RESULT_FAILURE_MESSAGES = new Set(Object.entries(MESSAGES).filter(([code]) => code !== "ready").map(([, message]) => message));
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

/** Disk-only native geometry read in a disposable FreeCADCmd process. */
const PYTHON = String.raw`
import json, math
from pathlib import Path
import FreeCAD as App

spec = json.loads(Path(JOB_PATH).read_text(encoding='utf-8'))
rows = []
for index, item in enumerate(spec['items']):
    row = {'index': index, 'rel': item['rel'], 'bounding_box': None, 'code': 'read_failed'}
    try:
        doc = App.openDocument(item['filename'])
        obj = doc.getObject(item['node'])
        if obj is None:
            row['code'] = 'missing_node'
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
      || typeof input.node !== "string" || !/^[A-Za-z_]\w{0,255}$/.test(input.node)) throw new GeometryFailure("边界盒输入必须包含唯一相对路径、已验证的绝对 FCStd 路径及主节点名");
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
  if (row.code === "ready") {
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
