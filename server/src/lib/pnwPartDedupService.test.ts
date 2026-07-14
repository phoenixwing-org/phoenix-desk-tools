import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  exportPartDedupCsv,
  getPartDedupPrefs,
  parsePartFilename,
  savePartDedupPrefs,
  scanPartDedup,
} from "./pnwPartDedupService.js";
import { loadWorkspacePrefs } from "./workspacePrefsService.js";

const tempRoots: string[] = [];

function makeTempRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pnw-part-dedup-"));
  tempRoots.push(root);
  return root;
}

function writeFile(root: string, rel: string, text = "part\n") {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, text, "utf8");
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("pnwPartDedupService", () => {
  it("loads and saves workspace prefs", () => {
    const workspace = makeTempRoot();

    expect(getPartDedupPrefs(workspace)).toMatchObject({
      extension: ".SLDPRT",
      code_len: 6,
      ver_len: 3,
      scan_dir: ".",
    });

    const saved = savePartDedupPrefs(workspace, {
      extension: "step",
      code_len: 5,
      ver_len: 2,
      check_version: false,
      scan_dir: "models",
    });

    expect(saved).toMatchObject({
      extension: ".step",
      code_len: 5,
      ver_len: 2,
      check_version: false,
      scan_dir: "./models",
    });
    expect(loadWorkspacePrefs(workspace).part_dedup).toMatchObject({
      extension: ".step",
      scan_dir: "models",
    });
  });

  it("parses part code and version from filenames", () => {
    expect(parsePartFilename("100001.002-Frame.SLDPRT", {
      code_len: 6,
      ver_len: 3,
      check_version: true,
      code_must_be_digit: true,
    })).toEqual({ code: "100001", version: "002" });
    expect(parsePartFilename("ABC001.002-Frame.SLDPRT", {
      code_len: 6,
      ver_len: 3,
      check_version: true,
      code_must_be_digit: true,
    })).toEqual({ code: null, version: null });
  });

  it("scans duplicate filenames and duplicate code+version groups", () => {
    const workspace = makeTempRoot();
    writeFile(workspace, "models/100001.001-Frame.SLDPRT");
    writeFile(workspace, "copy/100001.001-Frame.SLDPRT");
    writeFile(workspace, "models/100001.002-Frame.SLDPRT");
    writeFile(workspace, "models/100002.001-Bracket.SLDPRT");
    writeFile(workspace, "models/ignored.STEP");

    const out = scanPartDedup(workspace, { extension: ".SLDPRT", scan_dir: "." });

    expect(out).toMatchObject({
      file_count: 4,
      extension: ".SLDPRT",
      stats: { name_dup: 1, code_dup: 0, ver_dup: 1 },
      _native: "node",
    });
    expect(out.results.name_dup[0]).toMatchObject({ label: "100001.001-Frame.SLDPRT" });
    expect(out.results.name_dup[0].paths_display).toEqual(expect.arrayContaining([
      "./copy/100001.001-Frame.SLDPRT",
      "./models/100001.001-Frame.SLDPRT",
    ]));
    expect(out.results.ver_dup[0]).toMatchObject({ label: "100001_001", code: "100001", version: "001" });
  });

  it("can scan by code when version checking is disabled", () => {
    const workspace = makeTempRoot();
    writeFile(workspace, "a/100001.001-Frame.SLDPRT");
    writeFile(workspace, "b/100001.002-Frame.SLDPRT");
    writeFile(workspace, "c/100002.001-Frame.SLDPRT");

    const out = scanPartDedup(workspace, {
      extension: ".SLDPRT",
      check_version: false,
      scan_dir: ".",
    });

    expect(out.stats).toMatchObject({ name_dup: 0, code_dup: 1, ver_dup: 0 });
    expect(out.results.code_dup[0]).toMatchObject({ label: "100001" });
  });

  it("keeps FCStd model and drawing duplicate groups separated", () => {
    const workspace = makeTempRoot();
    writeFile(workspace, "a/100001.001-Plate.FCStd");
    writeFile(workspace, "b/100001.001-Plate.FCStd");
    writeFile(workspace, "d1/100001.001-Plate.Drawing.FCStd");
    writeFile(workspace, "d2/100001.001-Plate.Drawing.FCStd");

    const out = scanPartDedup(workspace, { extension: ".FCStd", scan_dir: "." });

    expect(out.stats.ver_dup).toBe(2);
    expect(out.results.ver_dup.map((group) => group.csv_fc).sort()).toEqual(["|Drawing.FCStd", "|Model.FCStd"]);
  });

  it("exports CSV from scan results", () => {
    const workspace = makeTempRoot();
    writeFile(workspace, "a/100001.001-Frame.SLDPRT");
    writeFile(workspace, "b/100001.001-Frame.SLDPRT");
    const scan = scanPartDedup(workspace, { extension: ".SLDPRT", scan_dir: "." });

    const exported = exportPartDedupCsv(workspace, { results: scan.results });

    expect(exported.path_display).toBe("./.phoenix/exports/part_dedup.csv");
    expect(fs.existsSync(exported.path)).toBe(true);
    const csv = fs.readFileSync(exported.path, "utf8");
    expect(csv).toContain("name_dup");
    expect(csv).toContain("100001.001-Frame.SLDPRT");
  });

  it("rejects scan dirs outside the workspace", () => {
    const workspace = makeTempRoot();
    expect(() => savePartDedupPrefs(workspace, { scan_dir: ".." })).toThrow(/escapes workspace/i);
  });
});
