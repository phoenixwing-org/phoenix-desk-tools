import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  getSwStepPrefs,
  listSwModelPaths,
  previewSwStepExport,
  runSwStepExport,
  saveSwStepPrefs,
} from "./pnwSwStepExportService.js";

const tempRoots: string[] = [];

function makeTempRoot(name = "pnw-sw-step-") {
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

function fakeAdapter(root: string) {
  return writeFile(
    root,
    "fake-sw-adapter.cjs",
    [
      'const fs = require("node:fs");',
      'const path = require("node:path");',
      'const job = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));',
      'fs.mkdirSync(job.out_step_dir, { recursive: true });',
      'fs.writeFileSync(path.join(job.out_step_dir, "captured-job.json"), JSON.stringify(job), "utf8");',
      'const destination = path.join(job.out_step_dir, path.parse(job.models[0]).name + ".step");',
      'fs.writeFileSync(destination, "STEP fixture\\n", "utf8");',
      'process.stdout.write(JSON.stringify({',
      '  ok: [destination],',
      '  failed: job.models.slice(1).map((model) => ({ path: model, error: "fixture failure" })),',
      '  logs: ["adapter fixture ran"],',
      '  fatal_error: null,',
      '}) + "\\n");',
    ].join("\n"),
  );
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("pnwSwStepExportService", () => {
  it("persists prefs and previews only SolidWorks part/assembly models", () => {
    const workspace = makeTempRoot();
    writeFile(workspace, "models/a.sldprt");
    writeFile(workspace, "models/b.SLDASM");
    writeFile(workspace, "models/c.slddrw");
    writeFile(workspace, "models/nested/d.SLDPRT");

    expect(getSwStepPrefs(workspace, { platform: "linux", env: {} })).toEqual({
      source_dir: ".",
      out_step_dir: ".",
      recursive_scan: false,
      com_available: false,
      adapter_available: false,
      solidworks_registered: null,
      availability_code: "unsupported_platform",
      platform: "linux",
    });
    const prefs = saveSwStepPrefs(workspace, {
      source_dir: "./models",
      out_step_dir: "./step",
      recursive_scan: false,
    }, { platform: "linux", env: {} });
    expect(prefs).toMatchObject({ source_dir: "./models", out_step_dir: "./step", recursive_scan: false });

    expect(listSwModelPaths(path.join(workspace, "models"), false).map((file) => path.basename(file))).toEqual([
      "a.sldprt",
      "b.SLDASM",
    ]);
    expect(previewSwStepExport(workspace, {}, { platform: "linux", env: {} })).toMatchObject({
      source_display: "./models",
      model_count: 2,
      _native: "node",
    });
    expect(previewSwStepExport(workspace, { recursive_scan: true }, { platform: "linux", env: {} })).toMatchObject({
      model_count: 3,
      prefs: { recursive_scan: true },
    });
  });

  it("passes a complete job to an explicit COM adapter and returns failures in the frontend shape", async () => {
    const workspace = makeTempRoot();
    writeFile(workspace, "models/a.sldprt");
    writeFile(workspace, "models/nested/b.sldasm");
    const runner = fakeAdapter(workspace);
    const env = {
      ...process.env,
      PHOENIX_SW_OPEN_OPTIONS: "5",
      PHOENIX_SW_SAVEAS_SILENT_OPTS: "130,9",
    };

    const result = await runSwStepExport(workspace, {
      source_dir: "./models",
      out_step_dir: "./step",
      recursive_scan: true,
    }, {
      platform: "linux",
      comHost: process.execPath,
      runnerPath: runner,
      directRunner: true,
      env,
    });

    expect(result).toMatchObject({
      ok_count: 1,
      failed_count: 1,
      failed: [expect.objectContaining({ error: "fixture failure" })],
      log: "adapter fixture ran",
      out_display: "./step",
      prefs: {
        com_available: true,
        adapter_available: true,
        solidworks_registered: null,
        availability_code: "custom_adapter",
        platform: "linux",
      },
      _native: "node",
      engine: "powershell-com",
    });
    const job = JSON.parse(fs.readFileSync(path.join(workspace, "step", "captured-job.json"), "utf8"));
    expect(job).toMatchObject({ open_options: 5, save_version: 130, silent_options: 9 });
    expect(job.models).toHaveLength(2);
    expect(job.models.every((model: string) => path.isAbsolute(model))).toBe(true);

    const tmpDir = path.join(workspace, ".phoenix", "tmp");
    expect(fs.existsSync(tmpDir) ? fs.readdirSync(tmpDir) : []).toEqual([]);
  });

  it("does not report the standard Windows adapter ready until SolidWorks COM is registered", () => {
    const workspace = makeTempRoot();
    const runner = fakeAdapter(workspace);
    const baseContext = {
      platform: "win32" as const,
      comHost: process.execPath,
      runnerPath: runner,
      directRunner: false,
      env: { ...process.env },
    };

    expect(getSwStepPrefs(workspace, { ...baseContext, solidWorksRegistered: false })).toMatchObject({
      com_available: false,
      adapter_available: true,
      solidworks_registered: false,
      availability_code: "solidworks_not_registered",
    });
    expect(getSwStepPrefs(workspace, { ...baseContext, solidWorksRegistered: true })).toMatchObject({
      com_available: true,
      adapter_available: true,
      solidworks_registered: true,
      availability_code: "ready",
    });
  });

  it("rejects unsupported platforms, empty model sets, and missing source directories", async () => {
    const workspace = makeTempRoot();
    expect(() => previewSwStepExport(workspace, { source_dir: "./missing" }, { platform: "linux", env: {} }))
      .toThrow(/model directory does not exist/i);

    fs.mkdirSync(path.join(workspace, "models"), { recursive: true });
    await expect(runSwStepExport(workspace, {
      source_dir: "./models",
      out_step_dir: "./step",
    }, { platform: "linux", env: {} })).rejects.toThrow(/requires Windows/i);

    await expect(runSwStepExport(workspace, {
      source_dir: "./models",
      out_step_dir: "./step",
    }, {
      platform: "linux",
      comHost: process.execPath,
      runnerPath: fakeAdapter(workspace),
      directRunner: true,
      env: { ...process.env },
    })).rejects.toThrow(/No \.sldprt \/ \.sldasm/i);
  });

  it("keeps already-open SolidWorks documents open in the PowerShell adapter", () => {
    const script = fs.readFileSync(path.resolve("scripts", "sw-step-export.ps1"), "utf8");
    expect(script).toContain("GetOpenDocumentByName");
    expect(script).toContain("$openedByAdapter = $false");
    expect(script).toContain("if ($openedByAdapter -and $title)");
    expect(script).toContain("SaveAs3");
    expect(script).toContain("SaveAs2");
    expect(script).toContain("CloseDoc");
  });
});
