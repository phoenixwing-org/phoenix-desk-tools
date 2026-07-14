import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

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
  return writeFile(
    root,
    "fake-route-runner.cjs",
    [
      'const fs = require("node:fs");',
      'fs.mkdirSync(process.env.FCD_BATCH_OUT_DIR, { recursive: true });',
      'process.stderr.write("[phoenix] OK=1 skip=0 fail=0 total=1\\n");',
    ].join("\n"),
  );
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

