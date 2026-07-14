import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const tempRoots: string[] = [];
const originalHome = process.env.HOME;
const originalUserProfile = process.env.USERPROFILE;
const originalHost = process.env.PHOENIX_SW_COM_HOST;
const originalRunner = process.env.PHOENIX_SW_COM_RUNNER;
const originalDirect = process.env.PHOENIX_SW_COM_DIRECT;

function makeTempRoot(name: string) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), name));
  tempRoots.push(root);
  return root;
}

function writeFile(root: string, rel: string, text = "fixture\n") {
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

function fakeAdapter(root: string) {
  return writeFile(
    root,
    "fake-route-sw-adapter.cjs",
    [
      'const fs = require("node:fs");',
      'const path = require("node:path");',
      'const job = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));',
      'fs.mkdirSync(job.out_step_dir, { recursive: true });',
      'const output = path.join(job.out_step_dir, "route.step");',
      'fs.writeFileSync(output, "STEP fixture\\n", "utf8");',
      'console.log(JSON.stringify({ ok: [output], failed: [], logs: ["route adapter ran"], fatal_error: null }));',
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
  restoreEnv("PHOENIX_SW_COM_HOST", originalHost);
  restoreEnv("PHOENIX_SW_COM_RUNNER", originalRunner);
  restoreEnv("PHOENIX_SW_COM_DIRECT", originalDirect);
  vi.resetModules();
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("cad SolidWorks STEP routes", () => {
  it("serves prefs, preview, and adapter execution without Python API fallback", async () => {
    const home = makeTempRoot("cad-sw-home-");
    const workspace = makeTempRoot("cad-sw-ws-");
    writeFile(workspace, "models/root.SLDPRT");
    writeFile(workspace, "models/nested/sub.sldasm");
    configurePrefs(home, workspace);
    process.env.HOME = home;
    process.env.USERPROFILE = home;
    process.env.PHOENIX_SW_COM_HOST = process.execPath;
    process.env.PHOENIX_SW_COM_RUNNER = fakeAdapter(workspace);
    process.env.PHOENIX_SW_COM_DIRECT = "1";
    vi.resetModules();
    const { cadRoutes } = await import("./cad.js");

    const prefsRes = await cadRoutes.request("/sw-step/prefs");
    expect(prefsRes.status).toBe(200);
    await expect(prefsRes.json()).resolves.toMatchObject({
      source_dir: ".",
      out_step_dir: ".",
      com_available: true,
      adapter_available: true,
      solidworks_registered: null,
      availability_code: "custom_adapter",
    });

    const saveRes = await cadRoutes.request("/sw-step/prefs", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ source_dir: "./models", out_step_dir: "./step", recursive_scan: true }),
    });
    expect(saveRes.status).toBe(200);

    const previewRes = await cadRoutes.request("/sw-step/preview", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(previewRes.status).toBe(200);
    const preview = await previewRes.json();
    expect(preview).toMatchObject({ source_display: "./models", model_count: 2, _native: "node" });
    expect(preview).not.toHaveProperty("_stub");
    expect(preview).not.toHaveProperty("_proxy");

    const runRes = await cadRoutes.request("/sw-step/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(runRes.status).toBe(200);
    const run = await runRes.json();
    expect(run).toMatchObject({
      ok_count: 1,
      failed_count: 0,
      log: "route adapter ran",
      out_display: "./step",
      _native: "node",
      engine: "powershell-com",
    });
    expect(run).not.toHaveProperty("_stub");
    expect(run).not.toHaveProperty("_proxy");
  });

  it("returns a validation error for a missing model directory", async () => {
    const home = makeTempRoot("cad-sw-invalid-home-");
    const workspace = makeTempRoot("cad-sw-invalid-ws-");
    configurePrefs(home, workspace);
    process.env.HOME = home;
    process.env.USERPROFILE = home;
    vi.resetModules();
    const { cadRoutes } = await import("./cad.js");
    const res = await cadRoutes.request("/sw-step/preview", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ source_dir: "./missing" }),
    });
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ detail: expect.stringMatching(/model directory does not exist/i) });
  });
});
