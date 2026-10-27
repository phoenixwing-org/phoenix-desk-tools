import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import { spawn, type SpawnOptions } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("node:child_process", async original => {
  const actual = await original<typeof import("node:child_process")>(); const spawn = vi.fn();
  return { ...actual, spawn, default: { ...actual, spawn } };
});

const tempRoots: string[] = [];
const originalHome = process.env.HOME;
const originalUserProfile = process.env.USERPROFILE;
const originalFreecadCmd = process.env.PHOENIX_FREECAD_CMD;
const originalRunner = process.env.PHOENIX_STEP_BATCH_RUNNER;

function makeTempRoot(name: string) {
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

function configurePrefs(home: string, workspace: string) {
  const dir = path.join(home, ".phoenix");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "launcher-prefs.json"),
    JSON.stringify({ recent_workspaces: [workspace], freecad_dir: "", workspace }, null, 2),
    "utf8",
  );
}

function fakeRunner(root: string) {
  return writeFile(root, "fake-route-runner.py", "# inert fixture; no Native execution\n");
}

function restoreEnv(name: string, value: string | undefined) {
  if (value == null) delete process.env[name];
  else process.env[name] = value;
}

afterEach(() => {
  process.env.HOME = originalHome;
  process.env.USERPROFILE = originalUserProfile;
  restoreEnv("PHOENIX_FREECAD_CMD", originalFreecadCmd);
  restoreEnv("PHOENIX_STEP_BATCH_RUNNER", originalRunner);
  vi.resetModules();
  vi.mocked(spawn).mockReset();
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("cad STEP Batch routes", () => {
  it("serves prefs, preview, and FreeCADCmd execution without Python API fallback", async () => {
    const home = makeTempRoot("cad-step-home-");
    const workspace = makeTempRoot("cad-step-ws-");
    writeFile(workspace, "step/root.stp");
    writeFile(workspace, "step/nested/deep.step");
    configurePrefs(home, workspace);
    process.env.HOME = home;
    process.env.USERPROFILE = home;
    process.env.PHOENIX_FREECAD_CMD = process.execPath;
    process.env.PHOENIX_STEP_BATCH_RUNNER = fakeRunner(workspace);
    vi.resetModules();
    const gate = await import("../features/drawing-research/executionGate.js");
    const scopeRoot = fs.realpathSync(makeTempRoot("cad-step-route-gate-"));
    gate.configureDrawingExecutionBarrier(path.join(scopeRoot, "host-native"));
    vi.mocked(spawn).mockImplementation((...args: unknown[]) => {
      const parameters = args[1] as string[], options = args[2] as SpawnOptions;
      expect(parameters.slice(0, 4).filter(value => value === "-u" || value === "-s")).toEqual(["-u", "-s"]);
      const child = Object.assign(new EventEmitter(), { pid: 54091, stdout: new EventEmitter(), stderr: new EventEmitter(), kill: vi.fn() });
      queueMicrotask(() => {
        child.emit("spawn");
        queueMicrotask(() => {
          const folder = path.dirname(parameters.at(-1)!);
          const owner = JSON.parse(fs.readFileSync(path.join(folder, "owner.json"), "utf8"));
          expect(owner).toMatchObject({ pid: child.pid });
          fs.writeFileSync(path.join(folder, "launch-result.json"), JSON.stringify({ version: 1, status: "completed", pid: child.pid, nonce: owner.nonce }));
          fs.mkdirSync(options.env!.FCD_BATCH_OUT_DIR!, { recursive: true });
          child.stdout.emit("data", Buffer.from("EXAMPLE_API_KEY=unit-test-route-secret\n"));
          child.stderr.emit("data", Buffer.from("Authorization: Bearer unit-test-route-bearer\n[phoenix] OK=1 skip=0 fail=0 total=1\n"));
          child.emit("close", 0, null);
        });
      });
      return child as unknown as ReturnType<typeof spawn>;
    });
    const { cadRoutes } = await import("./cad.js");

    const prefsRes = await cadRoutes.request("/step-batch/prefs");
    expect(prefsRes.status).toBe(200);
    await expect(prefsRes.json()).resolves.toMatchObject({ step_dir: ".", out_dir: ".", skip_existing: true });

    const saveRes = await cadRoutes.request("/step-batch/prefs", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        step_dir: "./step",
        out_dir: "./FreeCAD",
        skip_existing: true,
        view_fit: "none",
        use_inbox_bridge: false,
        step_recursive: true,
      }),
    });
    expect(saveRes.status).toBe(200);

    const previewRes = await cadRoutes.request("/step-batch/preview", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(previewRes.status).toBe(200);
    const preview = await previewRes.json();
    expect(preview).toMatchObject({ top_level: 1, deep_total: 2, batch_count: 2, _native: "node" });
    expect(preview).not.toHaveProperty("_stub");
    expect(preview).not.toHaveProperty("_proxy");

    const runRes = await cadRoutes.request("/step-batch/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(runRes.status).toBe(200);
    const run = await runRes.json();
    expect(run).toMatchObject({
      exit_code: 0,
      ok_count: 1,
      skip_count: 0,
      fail_count: 0,
      total_count: 1,
      out_dir_display: "./FreeCAD",
      _native: "node",
      engine: "freecadcmd",
    });
    expect(run).not.toHaveProperty("_stub");
    expect(run).not.toHaveProperty("_proxy");
    expect(run.log).toContain("[REDACTED]");
    expect(run.log).not.toContain("unit-test-route-secret");
    expect(run.log).not.toContain("unit-test-route-bearer");
  });

  it("rejects an explicit macOS FreeCAD GUI launcher before it can run", async () => {
    const home = makeTempRoot("cad-step-gui-home-");
    const workspace = makeTempRoot("cad-step-gui-ws-");
    writeFile(workspace, "part.stp");
    const gui = writeFile(workspace, "FreeCAD.app/Contents/MacOS/FreeCAD", "not executable\n");
    configurePrefs(home, workspace);
    process.env.HOME = home;
    process.env.USERPROFILE = home;
    process.env.PHOENIX_FREECAD_CMD = gui;
    process.env.PHOENIX_STEP_BATCH_RUNNER = fakeRunner(workspace);
    vi.resetModules();
    const { cadRoutes } = await import("./cad.js");

    const response = await cadRoutes.request("/step-batch/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      detail: expect.stringMatching(/GUI launcher/i),
    });
  });

  it("returns a validation response for a missing STEP directory", async () => {
    const home = makeTempRoot("cad-step-invalid-home-");
    const workspace = makeTempRoot("cad-step-invalid-ws-");
    configurePrefs(home, workspace);
    process.env.HOME = home;
    process.env.USERPROFILE = home;
    vi.resetModules();
    const { cadRoutes } = await import("./cad.js");

    const res = await cadRoutes.request("/step-batch/preview", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ step_dir: "./missing" }),
    });
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ detail: expect.stringMatching(/STEP directory does not exist/i) });
  });
});
