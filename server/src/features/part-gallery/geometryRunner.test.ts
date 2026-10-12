import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import { spawn, type SpawnOptions } from "node:child_process";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { runtimeUserDataDir } from "../../lib/appRuntimePaths.js";
import { resolveFreecadCommand } from "../../lib/freecadProcessSecurity.js";
import { GeometryConfigurationError, geometryConfigurationFailureMessage, geometryReadFailureMessage, geometryResultFailureMessage, readGeometryBatch, type GeometryInput } from "./geometryRunner.js";

vi.mock("node:child_process", () => ({ spawn: vi.fn() }));
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
    const child = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), kill: vi.fn() });
    child.kill.mockImplementation(() => { queueMicrotask(() => child.emit("close", null)); return true; });
    const options = arguments_[2] as SpawnOptions, args = arguments_[1] as string[];
    const job = JSON.parse(fs.readFileSync(path.join(options.cwd as string, "job.json"), "utf8"));
    const native = { child, command: arguments_[0] as string, args, options, script: fs.readFileSync(args.at(-1)!, "utf8"), job };
    launches.push(native); queueMicrotask(() => run(native));
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
  expect(native.options.env).not.toHaveProperty("SYNTHETIC_API_TOKEN"); expect(native.options.env).not.toHaveProperty("NODE_OPTIONS");
  expect(native.script).toContain("doc.getObject(item['node'])"); expect(native.script).toContain("obj.Shape.BoundBox");
  for (const axis of ["XLength", "YLength", "ZLength"]) expect(native.script).toContain(`box.${axis}`);
  for (const text of ["Assembly::", "App::Part", "App::LinkGroup", "callable(valid)"]) expect(native.script).toContain(text);
  expect(native.script).not.toMatch(/recompute\s*\(|\.save(?:As)?\s*\(|ParamGet|saveParameter|FreeCADGui|Part\.getShape|Visibility|Diameter/);
  expect(fs.existsSync(temporary)).toBe(false); expect(native.child.kill).not.toHaveBeenCalled();
  for (let index = 0; index < items.length; index++) expect(fs.readFileSync(items[index].filename)).toEqual(original[index]);
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
  expect(launches[0].child.kill).toHaveBeenCalledWith("SIGKILL"); expect(fs.existsSync(launches[0].options.cwd as string)).toBe(false);
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
