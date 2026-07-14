import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  getStepBatchPrefs,
  previewStepBatch,
  resolveFreecadCommand,
  runStepBatch,
  saveStepBatchPrefs,
} from "./pnwStepBatchService.js";
import { loadWorkspacePrefs } from "./workspacePrefsService.js";

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
  return writeFile(
    root,
    "fake-freecad-runner.cjs",
    [
      'const fs = require("node:fs");',
      'const path = require("node:path");',
      'const out = process.env.FCD_BATCH_OUT_DIR;',
      'fs.mkdirSync(out, { recursive: true });',
      'fs.writeFileSync(path.join(out, "captured-env.json"), JSON.stringify({',
      '  step: process.env.FCD_BATCH_STEP_DIR,',
      '  out,',
      '  skip: process.env.FCD_BATCH_SKIP_EXISTING,',
      '  last: process.env.FCD_BATCH_VIEW_FIT_LAST,',
      '  all: process.env.FCD_BATCH_VIEW_FIT_ALL,',
      '  recursive: process.env.FCD_BATCH_STEP_RECURSIVE,',
      '}), "utf8");',
      'fs.writeFileSync(path.join(out, "batch_step_convert_report.md"), "- statistics fixture\\n", "utf8");',
      'process.stderr.write("[phoenix] OK=2 skip=1 fail=0 total=3\\n");',
    ].join("\n"),
  );
}

afterEach(() => {
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

    expect(resolveFreecadCommand(app)).toBe(command);
    expect(resolveFreecadCommand(contents)).toBe(command);
    expect(resolveFreecadCommand(resources)).toBe(command);
    expect(resolveFreecadCommand("", command)).toBe(command);
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

  it("runs a configured command with the complete FreeCAD batch environment and parses its summary", async () => {
    const workspace = makeTempRoot();
    writeFile(workspace, "step/a.stp");
    const runner = fakeRunner(workspace);

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
      { freecadCmd: process.execPath, runnerPath: runner, env: { ...process.env } },
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

    const captured = JSON.parse(fs.readFileSync(path.join(workspace, "FreeCAD", "captured-env.json"), "utf8"));
    expect(captured).toEqual({
      step: path.join(workspace, "step"),
      out: path.join(workspace, "FreeCAD"),
      skip: "1",
      last: "0",
      all: "1",
      recursive: "1",
    });
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
});
