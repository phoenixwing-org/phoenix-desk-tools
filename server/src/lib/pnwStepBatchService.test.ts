import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import childProcess, { spawn, spawnSync, type SpawnOptions } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getStepBatchPrefs,
  previewStepBatch,
  resolveFreecadCommand,
  runStepBatch,
  saveStepBatchPrefs,
} from "./pnwStepBatchService.js";
import { loadWorkspacePrefs } from "./workspacePrefsService.js";
import * as executionGate from "../features/drawing-research/executionGate.js";
import { installPrivateNativeGateForTest } from "../../test-support/native-gate.js";

vi.mock("node:child_process", async original => {
  const actual = await original<typeof import("node:child_process")>();
  const spawn = vi.fn();
  return { ...actual, spawn, default: { ...actual, spawn } };
});
installPrivateNativeGateForTest();

const tempRoots: string[] = [];

function makeTempRoot(name = "pnw-step-batch-") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), name));
  tempRoots.push(root);
  return root;
}

function writeFile(root: string, rel: string, text = "ISO-10303-21;\n") {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text, "utf8");
  return file;
}

function fakeRunner(root: string) {
  return writeFile(root, "fake-freecad-runner.py", "# inert fixture; never executed by FreeCAD\n");
}

type Native = { child: EventEmitter & { pid?: number; stdout: EventEmitter; stderr: EventEmitter; kill: ReturnType<typeof vi.fn> };
  folder: string; args: string[]; options: SpawnOptions; script: string; spec: { runner: string; owner: string; nonce: string } };
function nativeProcess(run: (native: Native) => void = native => native.child.emit("close", 0, null), autoSpawn = true) {
  const launches: Native[] = [];
  vi.mocked(spawn).mockImplementation((...args: unknown[]) => {
    const child = Object.assign(new EventEmitter(), { pid: 54081 as number | undefined, stdout: new EventEmitter(), stderr: new EventEmitter(), kill: vi.fn((_signal?: NodeJS.Signals) => true) });
    const parameters = args[1] as string[], options = args[2] as SpawnOptions, scriptPath = parameters.at(-1)!;
    const folder = path.dirname(scriptPath);
    const native = { child, folder, args: parameters, options, script: fs.readFileSync(scriptPath, "utf8"), spec: JSON.parse(fs.readFileSync(path.join(folder, "job.json"), "utf8")) };
    launches.push(native);
    if (autoSpawn) queueMicrotask(() => { child.emit("spawn"); queueMicrotask(() => { receipt(native); run(native); }); });
    return child as unknown as ReturnType<typeof spawn>;
  });
  return launches;
}
function receipt(native: Native, patch: Record<string, unknown> = {}) {
  fs.writeFileSync(path.join(native.folder, "launch-result.json"), JSON.stringify({ version: 1, status: "completed", pid: native.child.pid, nonce: native.spec.nonce, ...patch }));
}
function fixture() {
  const workspace = makeTempRoot(); writeFile(workspace, "step/a.stp");
  return { workspace, options: { step_dir: "./step", out_dir: "./out" },
    ctx: { freecadCmd: writeFile(workspace, "freecadcmd", "inert mock command\n"), runnerPath: fakeRunner(workspace), env: {} } };
}
async function flush() { for (let i = 0; i < 12; i++) await Promise.resolve(); }

beforeEach(() => { vi.mocked(spawn).mockReset(); });

afterEach(() => {
  vi.useRealTimers(); vi.restoreAllMocks();
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("pnwStepBatchService", () => {
  it("locates FreeCADCmd from app, Contents, Resources, and explicit executable selections", () => {
    const root = makeTempRoot();
    const app = path.join(root, "FreeCAD.app");
    const contents = path.join(app, "Contents");
    const resources = path.join(contents, "Resources");
    const command = writeFile(root, "FreeCAD.app/Contents/Resources/bin/freecadcmd", "fixture\n");

    const canonicalCommand = fs.realpathSync.native(command);
    expect(resolveFreecadCommand(app)).toBe(canonicalCommand);
    expect(resolveFreecadCommand(contents)).toBe(canonicalCommand);
    expect(resolveFreecadCommand(resources)).toBe(canonicalCommand);
    expect(resolveFreecadCommand("", command)).toBe(canonicalCommand);

    const gui = writeFile(root, "FreeCAD.app/Contents/MacOS/FreeCAD", "fixture\n");
    expect(() => resolveFreecadCommand("", gui)).toThrow(/GUI launcher/i);
    expect(() => resolveFreecadCommand(gui)).toThrow(/GUI launcher/i);
  });

  it("persists Python-compatible prefs and previews shallow/recursive STEP counts", () => {
    const workspace = makeTempRoot();
    writeFile(workspace, "step/b.step");
    writeFile(workspace, "step/a.stp");
    writeFile(workspace, "step/readme.txt", "not STEP\n");
    writeFile(workspace, "step/nested/c.STEP");

    expect(getStepBatchPrefs(workspace)).toEqual({
      step_dir: ".",
      out_dir: ".",
      skip_existing: true,
      view_fit: "none",
      use_inbox_bridge: false,
      step_recursive: false,
    });

    const prefs = saveStepBatchPrefs(workspace, {
      step_dir: "./step",
      out_dir: "./FreeCAD",
      skip_existing: false,
      view_fit: "last",
      use_inbox_bridge: false,
      step_recursive: false,
    });
    expect(prefs).toEqual({
      step_dir: "./step",
      out_dir: "./FreeCAD",
      skip_existing: false,
      view_fit: "last",
      use_inbox_bridge: false,
      step_recursive: false,
    });

    const stored = loadWorkspacePrefs(workspace);
    expect(stored.step_batch).toMatchObject({ step_dir: "step", out_dir: "FreeCAD", project_relative: null });

    expect(previewStepBatch(workspace)).toMatchObject({
      step_dir_display: "./step",
      top_level: 2,
      deep_total: 3,
      batch_count: 2,
      recursive: false,
      _native: "node",
    });
    expect(previewStepBatch(workspace, { step_recursive: true })).toMatchObject({
      top_level: 2,
      deep_total: 3,
      batch_count: 3,
      recursive: true,
    });
  });

  it("runs with an allowlisted FreeCAD environment, redacts output, and parses its summary", async () => {
    const workspace = makeTempRoot();
    writeFile(workspace, "step/a.stp");
    const runner = fakeRunner(workspace);
    const sourceBefore = fs.readFileSync(path.join(workspace, "step/a.stp"));
    let captured: Record<string, unknown> = {};
    const launches = nativeProcess(native => {
      const env = native.options.env!;
      captured = { step: env.FCD_BATCH_STEP_DIR, out: env.FCD_BATCH_OUT_DIR, skip: env.FCD_BATCH_SKIP_EXISTING,
        last: env.FCD_BATCH_VIEW_FIT_LAST, all: env.FCD_BATCH_VIEW_FIT_ALL, recursive: env.FCD_BATCH_STEP_RECURSIVE,
        apiKey: env.EXAMPLE_API_KEY || null, authToken: env.EXAMPLE_AUTH_TOKEN || null, nodeOptions: env.NODE_OPTIONS || null };
      expect(childProcess.spawn).toBe(spawn);
      expect(JSON.parse(fs.readFileSync(native.spec.owner, "utf8"))).toEqual({ pid: native.child.pid, nonce: native.spec.nonce });
      expect(native.spec.runner).toBe(runner);
      expect(native.args.slice(0, 4)).toEqual(["-u", path.join(native.folder, "user.cfg"), "-s", path.join(native.folder, "system.cfg")]);
      expect(native.options).toMatchObject({ cwd: native.folder, shell: false, windowsHide: true });
      for (const name of ["FREECAD_USER_HOME", "FREECAD_USER_DATA", "FREECAD_USER_TEMP", "XDG_CONFIG_HOME", "XDG_CACHE_HOME", "XDG_DATA_HOME", "XDG_RUNTIME_DIR", "TMPDIR", "TMP", "TEMP"]) {
        const dir = env[name]!; expect(path.dirname(dir)).toBe(native.folder); expect(fs.statSync(dir).isDirectory()).toBe(true);
        expect(fs.statSync(dir).mode & 0o077).toBe(0);
      }
      fs.mkdirSync(env.FCD_BATCH_OUT_DIR!, { recursive: true });
      fs.writeFileSync(path.join(env.FCD_BATCH_OUT_DIR!, "batch_step_convert_report.md"), "- statistics fixture\n");
      native.child.stdout.emit("data", Buffer.from("EXAMPLE_API_KEY=unit-test-sensitive-value\n"));
      native.child.stderr.emit("data", Buffer.from("Authorization: Bearer unit-test-bearer-value\n[phoenix] OK=2 skip=1 fail=0 total=3\n"));
      native.child.emit("close", 0, null);
    });

    const result = await runStepBatch(
      workspace,
      {
        step_dir: "./step",
        out_dir: "./FreeCAD",
        skip_existing: true,
        view_fit: "all",
        use_inbox_bridge: false,
        step_recursive: true,
      },
      {
        freecadCmd: process.execPath,
        runnerPath: runner,
        env: {
          HOME: workspace,
          PATH: "/usr/bin:/bin",
          TMPDIR: os.tmpdir(),
          LANG: "C.UTF-8",
          NODE_OPTIONS: "--unit-test-only",
          EXAMPLE_API_KEY: "unit-test-sensitive-value",
          EXAMPLE_AUTH_TOKEN: "unit-test-auth-value",
          FREECAD_USER_DATA: "/synthetic/untrusted-parent-data",
          XDG_CONFIG_HOME: "/synthetic/untrusted-parent-config",
        },
      },
    );

    expect(result).toMatchObject({
      exit_code: 0,
      ok_count: 2,
      skip_count: 1,
      fail_count: 0,
      total_count: 3,
      out_dir_display: "./FreeCAD",
      report_display: "./FreeCAD/batch_step_convert_report.md",
      _native: "node",
      engine: "freecadcmd",
    });
    expect(result.log).toContain("[phoenix] OK=2 skip=1 fail=0 total=3");
    expect(result.log).toContain("[REDACTED]");
    expect(result.log).not.toContain("unit-test-sensitive-value");
    expect(result.log).not.toContain("unit-test-bearer-value");

    expect(captured).toEqual({
      step: path.join(workspace, "step"),
      out: path.join(workspace, "FreeCAD"),
      skip: "1",
      last: "0",
      all: "1",
      recursive: "1",
      apiKey: null,
      authToken: null,
      nodeOptions: null,
    });
    expect(fs.readFileSync(path.join(workspace, "step/a.stp"))).toEqual(sourceBefore);
    expect(fs.existsSync(launches[0].folder)).toBe(false);
  });

  it("rejects invalid input directories, inbox mode, and missing FreeCAD commands", async () => {
    const workspace = makeTempRoot();
    expect(() => previewStepBatch(workspace, { step_dir: "./missing" })).toThrow(/STEP directory does not exist/i);

    writeFile(workspace, "step/a.stp");
    await expect(runStepBatch(workspace, {
      step_dir: "./step",
      out_dir: "./out",
      use_inbox_bridge: true,
    })).rejects.toThrow(/inbox bridge/i);

    await expect(runStepBatch(workspace, {
      step_dir: "./step",
      out_dir: "./out",
      use_inbox_bridge: false,
    }, {
      freecadCmd: path.join(workspace, "missing-FreeCADCmd.exe"),
      runnerPath: fakeRunner(workspace),
      env: {},
    })).rejects.toThrow(/FreeCADCmd was not found/i);
  });

  it("does not settle, clean private files, or release the gate on error or exit before close", async () => {
    const data = fixture(), launches = nativeProcess(() => {});
    const pending = runStepBatch(data.workspace, data.options, data.ctx);
    const rejected = expect(pending).rejects.toThrow(/Failed to start or continue owned FreeCADCmd/);
    let settled = false; void pending.then(() => { settled = true; }, () => { settled = true; });
    await flush(); const native = launches[0];
    native.child.emit("error", new Error("EXAMPLE_API_KEY=must-not-leak"));
    native.child.emit("exit", 0, null); await flush();
    expect(settled).toBe(false); expect(fs.existsSync(native.folder)).toBe(true);
    expect(() => executionGate.acquireDrawingExecution("independent-next-job")).toThrow(/已有原生任务/);
    expect(native.child.kill).toHaveBeenCalledWith("SIGTERM");
    native.child.emit("close", 0, null); await rejected;
    expect(fs.existsSync(native.folder)).toBe(false);
    const release = executionGate.acquireDrawingExecution("independent-next-job"); release();
  });

  it("waits for actual close after an asynchronous no-PID spawn error without signalling anybody", async () => {
    const data = fixture(), launches = nativeProcess(() => {}, false);
    const pending = runStepBatch(data.workspace, data.options, data.ctx);
    const rejected = expect(pending).rejects.toThrow(/Failed to start or continue/);
    const native = launches[0]; native.child.pid = undefined;
    native.child.emit("error", Object.assign(new Error("synthetic launch failure"), { syscall: "spawn /synthetic/freecadcmd", code: "ENOENT" }));
    await flush(); expect(native.child.kill).not.toHaveBeenCalled(); expect(fs.existsSync(native.folder)).toBe(true);
    expect(() => executionGate.acquireDrawingExecution("next-job")).toThrow();
    native.child.emit("close", -2, null); await rejected;
    const release = executionGate.acquireDrawingExecution("next-job"); release();
  });

  it("keeps timeout and SIGKILL as stop requests until actual close", async () => {
    vi.useFakeTimers(); const data = fixture(), launches = nativeProcess(() => {});
    const pending = runStepBatch(data.workspace, data.options, data.ctx);
    const rejected = expect(pending).rejects.toThrow(/exceeded 2 minutes/);
    await flush(); const native = launches[0];
    await vi.advanceTimersByTimeAsync(120_000);
    expect(native.child.kill.mock.calls.map(call => call[0])).toEqual(["SIGTERM"]);
    expect(fs.existsSync(native.folder)).toBe(true);
    await vi.advanceTimersByTimeAsync(1000);
    expect(native.child.kill.mock.calls.map(call => call[0])).toEqual(["SIGTERM", "SIGKILL"]);
    expect(() => executionGate.acquireDrawingExecution("next-job")).toThrow();
    native.child.emit("close", null, "SIGKILL"); await rejected;
    expect(fs.existsSync(native.folder)).toBe(false);
  });

  it("does not spawn when already cancelled", async () => {
    const data = fixture(); const controller = new AbortController(); controller.abort();
    await expect(runStepBatch(data.workspace, data.options, { ...data.ctx, signal: controller.signal })).rejects.toThrow(/cancelled before native launch/);
    expect(spawn).not.toHaveBeenCalled();
  });

  it("never publishes a late owner after cancellation before spawn and waits for close even if kill throws", async () => {
    const data = fixture(), launches = nativeProcess(() => {}, false), controller = new AbortController();
    const pending = runStepBatch(data.workspace, data.options, { ...data.ctx, signal: controller.signal });
    const rejected = expect(pending).rejects.toThrow(/cancelled/); const native = launches[0];
    native.child.kill.mockImplementation(() => { throw new Error("synthetic kill failure"); });
    controller.abort(); native.child.emit("spawn"); await flush();
    expect(fs.existsSync(native.spec.owner)).toBe(false); expect(fs.existsSync(native.folder)).toBe(true);
    expect(() => executionGate.acquireDrawingExecution("next-job")).toThrow();
    native.child.emit("close", null, "SIGTERM"); await rejected;
    expect(fs.existsSync(native.folder)).toBe(false);
  });

  it("does not overwrite a foreign owner marker or authorize conversion", async () => {
    const data = fixture(), launches = nativeProcess(() => {}, false);
    const pending = runStepBatch(data.workspace, data.options, data.ctx);
    const rejected = expect(pending).rejects.toThrow(/ownership was not confirmed/);
    const native = launches[0], foreign = JSON.stringify({ pid: native.child.pid, nonce: "foreign-nonce" });
    fs.writeFileSync(native.spec.owner, foreign); native.child.emit("spawn");
    expect(fs.readFileSync(native.spec.owner, "utf8")).toBe(foreign);
    expect(native.child.kill).toHaveBeenCalledWith("SIGTERM");
    native.child.emit("close", 0, null); await rejected;
  });

  it("checks host durable health before the owner marker and waits for close on refusal", async () => {
    const original = executionGate.acquireDrawingExecution;
    vi.spyOn(executionGate, "acquireDrawingExecution").mockImplementation(owner => {
      const lease = original(owner); lease.assertHealthy = () => { throw new Error("synthetic durable uncertainty"); }; return lease;
    });
    const data = fixture(), launches = nativeProcess(() => {});
    const pending = runStepBatch(data.workspace, data.options, data.ctx);
    const rejected = expect(pending).rejects.toThrow(/ownership was not confirmed/);
    await flush(); const native = launches[0];
    expect(fs.existsSync(native.spec.owner)).toBe(false); expect(fs.existsSync(native.folder)).toBe(true);
    native.child.emit("close", 0, null); await rejected;
  });

  it("publishes only a completely written marker even at the create-before-first-write interleaving", async () => {
    const data = fixture(), launches = nativeProcess(() => {});
    const originalOpen = fs.openSync, originalWrite = fs.writeSync;
    let markerFd: number | undefined, owner = "", checked = false;
    vi.spyOn(fs, "openSync").mockImplementation(((...args: unknown[]) => {
      const fd = Reflect.apply(originalOpen, fs, args);
      if (typeof args[0] === "string" && /\/\.owner-[^/]+\.tmp$/.test(args[0])) { markerFd = fd; owner = path.join(path.dirname(args[0]), "owner.json"); }
      return fd;
    }) as typeof fs.openSync);
    vi.spyOn(fs, "writeSync").mockImplementation(((...args: unknown[]) => {
      if (args[0] === markerFd) { checked = true; expect(fs.existsSync(owner)).toBe(false); }
      return Reflect.apply(originalWrite, fs, args);
    }) as typeof fs.writeSync);
    const pending = runStepBatch(data.workspace, data.options, data.ctx);
    await flush(); const native = launches[0];
    expect(checked).toBe(true); expect(JSON.parse(fs.readFileSync(native.spec.owner, "utf8"))).toEqual({ pid: native.child.pid, nonce: native.spec.nonce });
    receipt(native); native.child.emit("close", 0, null); await pending;
  });

  it("bounds and redacts output while retaining summary and old nonzero exit contracts", async () => {
    const data = fixture();
    nativeProcess(native => {
      native.child.stdout.emit("data", Buffer.alloc(2 * 1024 * 1024, 120));
      native.child.stdout.emit("data", Buffer.from("\nEXAMPLE_AUTH_TOKEN=synthetic-secret\n[phoenix] OK=0 skip=0 fail=1 total=1\n"));
      native.child.emit("close", 7, null);
    });
    const result = await runStepBatch(data.workspace, data.options, data.ctx);
    expect(result).toMatchObject({ exit_code: 7, fail_count: 1, total_count: 1 });
    expect(result.log.length).toBeLessThanOrEqual(256 * 1024 + 200);
    expect(result.log).not.toContain("synthetic-secret"); expect(result.log).toContain("[REDACTED]");
  });

  it.each(["missing", "foreign-pid", "foreign-nonce", "extra-field", "oversize", "non-utf8", "symlink", "hardlink"])("rejects a %s completion receipt instead of accepting an old report", async kind => {
    const data = fixture();
    fs.mkdirSync(path.join(data.workspace, "out"));
    fs.writeFileSync(path.join(data.workspace, "out/batch_step_convert_report.md"), "统计：成功 90，跳过 0，失败 0，共 90\n");
    nativeProcess(native => {
      const file = path.join(native.folder, "launch-result.json");
      if (kind === "missing") fs.unlinkSync(file);
      if (kind === "foreign-pid") receipt(native, { pid: 1 });
      if (kind === "foreign-nonce") receipt(native, { nonce: "independent-foreign-nonce" });
      if (kind === "extra-field") receipt(native, { extra: true });
      if (kind === "oversize") fs.writeFileSync(file, "x".repeat(4097));
      if (kind === "non-utf8") fs.writeFileSync(file, Buffer.from([0xff, 0xfe]));
      if (kind === "symlink" || kind === "hardlink") {
        const alias = path.join(native.folder, "other.json"); fs.renameSync(file, alias);
        if (kind === "symlink") fs.symlinkSync(alias, file); else fs.linkSync(alias, file);
      }
      native.child.emit("close", 0, null);
    });
    await expect(runStepBatch(data.workspace, data.options, data.ctx)).rejects.toThrow(/completion was not confirmed; previous reports were not accepted/);
  });

  it("releases only a proven synchronous no-spawn failure without leaking the launch error", async () => {
    const data = fixture();
    vi.mocked(spawn).mockImplementation(() => { throw Object.assign(new Error("EXAMPLE_API_KEY=private-launch-secret"), { code: "ENOENT" }); });
    await expect(runStepBatch(data.workspace, data.options, data.ctx)).rejects.toThrow("spawn_failed");
    const release = executionGate.acquireDrawingExecution("independent-next-job"); release();
  });

  it("loads the exact fixed guard from its private cwd without importing a workspace json.py shadow", async () => {
    const data = fixture();
    writeFile(data.workspace, "json.py", "raise RuntimeError('workspace json.py must never be imported')\n");
    const source = fs.readFileSync(path.join(data.workspace, "step/a.stp"));
    nativeProcess(native => {
      expect(native.options.cwd).toBe(native.folder); expect(native.folder).not.toBe(data.workspace);
      expect(path.isAbsolute(native.options.env!.FCD_BATCH_STEP_DIR!)).toBe(true);
      expect(path.isAbsolute(native.options.env!.FCD_BATCH_OUT_DIR!)).toBe(true);
      fs.unlinkSync(path.join(native.folder, "launch-result.json"));
      const test = String.raw`
import json, os, pathlib, runpy, sys, types
assert pathlib.Path.cwd() == pathlib.Path(${JSON.stringify(native.folder)})
assert pathlib.Path(json.__file__).resolve() != pathlib.Path(${JSON.stringify(path.join(data.workspace, "json.py"))})
os.getpid=lambda:${native.child.pid}
lookup={'UserHomePath':'FREECAD_USER_HOME','UserAppData':'FREECAD_USER_DATA','UserCachePath':'FREECAD_USER_TEMP','AppTempPath':'FREECAD_USER_TEMP'}
sys.modules['FreeCAD']=types.SimpleNamespace(GuiUp=False,listDocuments=lambda:{},ConfigGet=lambda key:os.environ[lookup[key]])
called=[]
def original(filename,run_name):
    assert filename == ${JSON.stringify(native.spec.runner)} and run_name == '__main__'
    called.append(filename)
runpy.run_path=original
script=pathlib.Path(${JSON.stringify(native.args.at(-1))})
exec(compile(script.read_text(),str(script),'exec'),{})
assert called == [${JSON.stringify(native.spec.runner)}]
assert pathlib.Path(json.__file__).resolve() != pathlib.Path(${JSON.stringify(path.join(data.workspace, "json.py"))})
`;
      const checked = spawnSync("python3", ["-c", test], { cwd: native.options.cwd, env: { ...process.env, ...native.options.env, PYTHONPATH: "" }, encoding: "utf8" });
      expect(checked.status, checked.stderr).toBe(0);
      native.child.emit("close", 0, null);
    });
    await runStepBatch(data.workspace, data.options, data.ctx);
    expect(fs.readFileSync(path.join(data.workspace, "step/a.stp"))).toEqual(source);
  });

  it("executes the exact fixed guard with fake FreeCAD only and refuses unknown/foreign/no-owner reports before imports", async () => {
    const data = fixture();
    nativeProcess(native => {
      const script = native.script.split("\n").slice(1).join("\n");
      const test = String.raw`
import ast, json, os, pathlib, runpy, sys, tempfile, time, types
script = ${JSON.stringify(script)}
tree = ast.parse(script)
assert next(n.lineno for n in ast.walk(tree) if isinstance(n, ast.Import) and any(a.name=='FreeCAD' for a in n.names)) > next(n.lineno for n in ast.walk(tree) if isinstance(n, ast.If) and 'marker' in ast.unparse(n.test))
with tempfile.TemporaryDirectory(prefix='step-owned-guard-unit-') as root:
    root=pathlib.Path(root); owner=root/'owner.json'; job=root/'job.json'
    spec={'runner':str(root/'original.py'),'owner':str(owner),'nonce':'independent-nonce'}
    job.write_text(json.dumps(spec)); called=[]
    runpy.run_path=lambda filename,run_name:called.append((filename,run_name))
    dirs={key:str(root/key) for key in ('FREECAD_USER_HOME','FREECAD_USER_DATA','FREECAD_USER_TEMP')}
    for key,value in dirs.items():os.environ[key]=value;pathlib.Path(value).mkdir()
    lookup={'UserHomePath':'FREECAD_USER_HOME','UserAppData':'FREECAD_USER_DATA','UserCachePath':'FREECAD_USER_TEMP','AppTempPath':'FREECAD_USER_TEMP'}
    queried=[]
    def config_get(key):
        queried.append(key)
        return dirs[lookup[key]] if key in lookup else ''
    assert config_get('UserTempPath')==''
    queried.clear()
    app=types.SimpleNamespace(GuiUp=False,listDocuments=lambda:{},ConfigGet=config_get)
    sys.modules['FreeCAD']=app
    good={'pid':os.getpid(),'nonce':spec['nonce']}
    clock=time.monotonic
    for marker in (good, {**good,'extra':True}, {**good,'pid':1}, {**good,'nonce':'foreign'}, {}, None):
        time.monotonic=clock
        (root/'launch-result.json').unlink(missing_ok=True)
        if marker is None:
            owner.unlink(missing_ok=True);ticks=iter((0,100));time.monotonic=lambda:next(ticks)
        else:owner.write_text(json.dumps(marker))
        called.clear()
        try:exec(compile(script,'fixed-step-guard','exec'),{'JOB_PATH':str(job)})
        except SystemExit as error:assert marker!=good and error.code==2
        else:
            assert marker==good and called==[(spec['runner'],'__main__')]
            assert queried==list(lookup)
        assert not called or marker==good
    time.monotonic=clock
    (root/'launch-result.json').unlink(missing_ok=True)
    owner.write_text(json.dumps(good));app.GuiUp=True;called.clear()
    try:exec(compile(script,'fixed-step-guard','exec'),{'JOB_PATH':str(job)})
    except SystemExit:pass
    else:raise AssertionError('GUI process accepted')
    assert not called
    app.GuiUp=False;app.listDocuments=lambda:{'Unexpected':object()}
    try:exec(compile(script,'fixed-step-guard','exec'),{'JOB_PATH':str(job)})
    except SystemExit:pass
    else:raise AssertionError('unexpected document accepted')
    assert not called
    app.listDocuments=lambda:{};app.ConfigGet=lambda key:str(root/'uncontrolled')
    try:exec(compile(script,'fixed-step-guard','exec'),{'JOB_PATH':str(job)})
    except SystemExit:pass
    else:raise AssertionError('uncontrolled private path accepted')
    assert not called
    for wrong_key in ('UserCachePath','AppTempPath'):
        app.ConfigGet=lambda key: str(root/'uncontrolled') if key==wrong_key else config_get(key)
        try:exec(compile(script,'fixed-step-guard','exec'),{'JOB_PATH':str(job)})
        except SystemExit:pass
        else:raise AssertionError(wrong_key+' mismatch accepted')
        assert not called
    app.ConfigGet=config_get
    alias=root/'foreign-owner.json';owner.rename(alias);owner.symlink_to(alias)
    try:exec(compile(script,'fixed-step-guard','exec'),{'JOB_PATH':str(job)})
    except SystemExit:pass
    else:raise AssertionError('symlink marker accepted')
    assert not called
`;
      const checked = spawnSync("python3", ["-c", test], { encoding: "utf8" });
      expect(checked.status, checked.stderr).toBe(0);
      native.child.emit("close", 0, null);
    });
    await runStepBatch(data.workspace, data.options, data.ctx);
  });
});
