import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import iconv from "iconv-lite";
import { afterEach, describe, expect, it } from "vitest";
import {
  codeAssetKind,
  codeIndexCatDlg,
  discoverCodeIndexExtensions,
  exportCodeIndexJson,
  isBinarySuffix,
  isCodeIndexFilename,
  isIgnoredName,
  isProcessDirName,
  isScannableDir,
  loadCodeIndex,
  normalizeWorksetPaths,
  applyRenameInWorkspace,
  previewRenameInWorkspace,
  purgeMissingCodeIndex,
  queryCodeIndexEntries,
  saveCodeIndexExtraExtensions,
  scanCodeIndex,
  applyUuidsInWorkspace,
  scanUuidsInWorkspace,
  getCodeRenamePrefs,
  saveCodeRenamePrefs,
} from "./pdtCodeService.js";
import { loadWorkspacePrefs } from "./workspacePrefsService.js";
import { decodeSourceBuffer } from "./sourceTextCodec.js";

const tempRoots: string[] = [];

function makeTempRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pdt-code-service-"));
  tempRoots.push(root);
  return root;
}

function writeFile(root: string, rel: string, text: string) {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, text, "utf8");
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("pdtCodeService code kinds", () => {
  it("classifies code asset kinds", () => {
    expect(codeAssetKind("main.cpp")).toBe("source");
    expect(codeAssetKind("header.h")).toBe("source");
    expect(codeAssetKind("CMakeLists.txt")).toBe("config");
    expect(codeAssetKind("readme.md")).toBe("doc");
    expect(codeAssetKind("icon.png")).toBe("resource");
    expect(codeAssetKind("unknown.xyz")).toBeNull();
  });

  it("detects indexable filenames", () => {
    expect(isCodeIndexFilename("main.cpp")).toBe(true);
    expect(isCodeIndexFilename("x.xyz")).toBe(false);
    expect(isCodeIndexFilename("x.xyz", [".xyz"])).toBe(true);
  });
});

describe("pdtCodeService ignore and process dirs", () => {
  it("matches ignore patterns", () => {
    expect(isIgnoredName("build-debug", ["build-*"])).toBe(true);
    expect(isIgnoredName("src", ["build-*"])).toBe(false);
  });

  it("detects process dirs", () => {
    expect(isProcessDirName("build")).toBe(true);
    expect(isProcessDirName("build-release")).toBe(true);
    expect(isProcessDirName(".cache")).toBe(true);
    expect(isProcessDirName("src")).toBe(false);
  });
});

describe("pdtCodeService rename helpers", () => {
  it("detects binary suffixes", () => {
    expect(isBinarySuffix("a.exe")).toBe(true);
    expect(isBinarySuffix("a.png")).toBe(true);
    expect(isBinarySuffix("a.cpp")).toBe(false);
    expect(isBinarySuffix("a.txt")).toBe(false);
  });

  it("detects scannable dirs", () => {
    expect(isScannableDir("src")).toBe(true);
    expect(isScannableDir(".git")).toBe(false);
    expect(isScannableDir("node_modules")).toBe(false);
  });

  it("normalizes workset paths", () => {
    expect(normalizeWorksetPaths(["a\\b", "a/b", ""])).toEqual(["a/b"]);
  });
});

describe("pdtCodeService code index", () => {
  it("persists scan results and serves paged entries", () => {
    const workspace = makeTempRoot();
    const storageDir = path.join(makeTempRoot(), "prefs");
    writeFile(workspace, "src/main.cpp", "int main() { return 0; }\n");
    writeFile(workspace, "src/view.CATDlg", "CATDlgDialog View;\n");
    writeFile(workspace, "README.md", "# hello\n");
    writeFile(workspace, "build/generated.cpp", "ignored\n");

    const scanned = scanCodeIndex(workspace, { storageDir });

    expect(scanned.file_count).toBe(3);
    expect(scanned.present_count).toBe(3);
    expect(scanned.stats.source).toBe(1);
    expect(scanned.stats.resource).toBe(1);
    expect(scanned.last_scan_at).toBeTruthy();

    const loaded = loadCodeIndex(workspace, { storageDir });
    expect(loaded.file_count).toBe(3);

    const entries = queryCodeIndexEntries(workspace, { storageDir, kind: "source", limit: 10 });
    expect(entries.total).toBe(1);
    expect(entries.entries[0]?.repo_rel_path).toBe("src/main.cpp");

    const catdlg = codeIndexCatDlg(workspace, { storageDir });
    expect(catdlg.indexed).toBe(true);
    expect(catdlg.count).toBe(1);
    expect(catdlg.entries[0]?.repo_rel_path).toBe("src/view.CATDlg");
  });

  it("supports extra extensions, discovery, purge missing, and export", () => {
    const workspace = makeTempRoot();
    const storageDir = path.join(makeTempRoot(), "prefs");
    writeFile(workspace, "tool.kev", "custom\n");
    writeFile(workspace, "note.todo", "not adopted yet\n");
    writeFile(workspace, "part.FCStd", "cad\n");
    writeFile(workspace, "ignored/skip.xyz", "ignored\n");

    const discovery = discoverCodeIndexExtensions(workspace, { storageDir, ignorePatterns: ["ignored"] });
    const discoveredExts = discovery.candidates.map((c) => c.ext);
    expect(discoveredExts).toContain(".kev");
    expect(discoveredExts).toContain(".todo");
    expect(discoveredExts).not.toContain(".fcstd");
    expect(discoveredExts).not.toContain(".xyz");

    saveCodeIndexExtraExtensions(workspace, ["kev"], { storageDir });
    const scanned = scanCodeIndex(workspace, { storageDir });
    expect(scanned.file_count).toBe(1);
    expect(queryCodeIndexEntries(workspace, { storageDir }).entries[0]?.repo_rel_path).toBe("tool.kev");
    expect(fs.existsSync(path.join(workspace, ".phoenix", "phoenix-workspace.sqlite"))).toBe(true);
    expect(fs.existsSync(path.join(storageDir, "code-index.json"))).toBe(false);
    expect(fs.existsSync(path.join(storageDir, "code-index-extra-extensions.json"))).toBe(false);

    const exported = exportCodeIndexJson(workspace, { storageDir });
    expect(exported.path_display).toBe(".phoenix/exports/code_index.json");
    expect(fs.existsSync(exported.path)).toBe(true);

    fs.rmSync(path.join(workspace, "tool.kev"));
    const rescanned = scanCodeIndex(workspace, { storageDir });
    expect(rescanned.file_count).toBe(1);
    expect(rescanned.present_count).toBe(0);
    const missing = queryCodeIndexEntries(workspace, { storageDir, status: "missing" });
    expect(missing.total).toBe(1);
    const purged = purgeMissingCodeIndex(workspace, { storageDir });
    expect(purged.purge_deleted).toBe(1);
    expect(purged.file_count).toBe(0);
    expect(() => exportCodeIndexJson(workspace, { storageDir })).toThrow("Code 索引为空");
  });

  it("matches filename search like the Python index", () => {
    const workspace = makeTempRoot();
    const storageDir = path.join(makeTempRoot(), "prefs");
    writeFile(workspace, "src/main.cpp", "int main() { return 0; }\n");
    writeFile(workspace, "src/main_extra.cpp", "void main_extra() {}\n");
    writeFile(workspace, "tests/main.cpp", "int test_main() { return 0; }\n");

    scanCodeIndex(workspace, { storageDir });

    const exactFilename = queryCodeIndexEntries(workspace, {
      storageDir,
      searchMode: "filename",
      q: "main.cpp",
      limit: 10,
    });
    expect(exactFilename.total).toBe(2);
    expect(exactFilename.entries.map((entry) => entry.repo_rel_path)).toEqual(["src/main.cpp", "tests/main.cpp"]);

    const fuzzyFilename = queryCodeIndexEntries(workspace, {
      storageDir,
      searchMode: "filename",
      q: "main",
      limit: 10,
    });
    expect(fuzzyFilename.total).toBe(3);

    const exactPath = queryCodeIndexEntries(workspace, {
      storageDir,
      searchMode: "filename",
      q: "src/main.cpp",
      limit: 10,
    });
    expect(exactPath.total).toBe(1);
    expect(exactPath.entries[0]?.repo_rel_path).toBe("src/main.cpp");

    const contains = queryCodeIndexEntries(workspace, {
      storageDir,
      searchMode: "contains",
      q: "src/main.cpp",
      limit: 10,
    });
    expect(contains.total).toBe(1);
  });

  it("stores the same text encoding labels as the legacy index", () => {
    const workspace = makeTempRoot();
    const gbkPath = path.join(workspace, "src", "legacy.cpp");
    fs.mkdirSync(path.dirname(gbkPath), { recursive: true });
    fs.writeFileSync(gbkPath, iconv.encode("// 中文\n", "gbk"));
    writeFile(workspace, "src/ascii.h", "#pragma once\n");

    scanCodeIndex(workspace);

    const entries = queryCodeIndexEntries(workspace, { limit: 10 }).entries;
    expect(entries.find((entry) => entry.filename === "legacy.cpp")?.text_encoding).toBe("gbk");
    expect(entries.find((entry) => entry.filename === "ascii.h")?.text_encoding).toBe("ascii");
  });
});

describe("pdtCodeService code rename", () => {
  it("persists workspace-local prefs without replacing unrelated sections", () => {
    const workspace = makeTempRoot();
    writeFile(workspace, ".phoenix/phoenix-workspace-prefs.json", JSON.stringify({ unrelated: { keep: true } }));

    const saved = saveCodeRenamePrefs(workspace, {
      old: "OldName",
      new: "NewName",
      levels: ["file", "text"],
      scope: " src ",
      target_encoding: "gbk",
      include_ignored: true,
      rescan_index: true,
    });
    expect(saved).toMatchObject({
      old: "OldName",
      new: "NewName",
      levels: ["file", "text"],
      scope: "src",
      target_encoding: "gbk",
      include_ignored: true,
      rescan_index: true,
    });
    expect(getCodeRenamePrefs(workspace)).toEqual(saved);
    const stored = loadWorkspacePrefs(workspace);
    expect(stored.unrelated).toEqual({ keep: true });
    expect((stored.code_rename as any).old).toBe("OldName");
  });

  it("previews text, file, and directory rename hits", () => {
    const workspace = makeTempRoot();
    writeFile(workspace, "old/old", "old();\nold();\n");
    writeFile(workspace, "old/keep.txt", "nothing\n");
    writeFile(workspace, "old-dir/old-name.cpp", "nothing\n");

    const out = previewRenameInWorkspace(workspace, {
      old: "old",
      new: "new",
      levels: ["dir", "file", "text"],
    });

    expect(out.implemented).toBe(true);
    expect(out.dry_run).toBe(true);
    expect(out.summary.text_files).toBe(1);
    expect(out.summary.files).toBe(1);
    expect(out.summary.dirs).toBe(1);
    expect(out.summary.total_hits).toBe(4);
    expect(out.hits.some((h: any) => h.level === "text" && h.hits === 2)).toBe(true);
    expect(out.hits.some((h: any) => h.new_path === "old/new")).toBe(true);
    expect(out.hits.some((h: any) => h.new_path === "new")).toBe(true);
    expect(out.hits.some((h: any) => h.repo_rel_path === "old-dir/old-name.cpp" && h.level !== "text")).toBe(false);
  });

  it("applies text and path renames inside the workspace", () => {
    const workspace = makeTempRoot();
    writeFile(workspace, "src/old-name", "const char* s = \"old-name\";\n");

    const out = applyRenameInWorkspace(workspace, {
      old: "old-name",
      new: "new-name",
      levels: ["file", "text"],
    });

    expect(out.implemented).toBe(true);
    expect(out.dry_run).toBe(false);
    expect(out.summary.total_hits).toBe(2);
    expect(fs.existsSync(path.join(workspace, "src/new-name"))).toBe(true);
    expect(fs.existsSync(path.join(workspace, "src/old-name"))).toBe(false);
    expect(fs.readFileSync(path.join(workspace, "src/new-name"), "utf8")).toContain("new-name");
    expect(getCodeRenamePrefs(workspace)).toMatchObject({ old: "old-name", new: "new-name", levels: ["file", "text"] });
    expect(out.report_path_display).toMatch(/^\.phoenix\/reports\/code-rename-report-/);
    expect(fs.existsSync(out.report_path)).toBe(true);
    expect(JSON.parse(fs.readFileSync(out.report_path, "utf8"))).toMatchObject({
      old: "old-name",
      new: "new-name",
      dry_run: false,
    });
  });

  it("applies a case-only file rename without treating the same file as a conflict", () => {
    const workspace = makeTempRoot();
    writeFile(workspace, "src/CaseName.cpp", "int value = 1;\n");

    const out = applyRenameInWorkspace(workspace, {
      old: "CaseName.cpp",
      new: "casename.cpp",
      levels: ["file"],
    });

    expect(out.summary.files).toBe(1);
    expect(out.hits.find((hit: any) => hit.level === "file")?.status).toBe("written");
    expect(fs.readdirSync(path.join(workspace, "src"))).toEqual(["casename.cpp"]);
  });

  it("preserves GBK and honors target encoding for ASCII source", () => {
    const workspace = makeTempRoot();
    const gbkPath = path.join(workspace, "gbk.cpp");
    fs.writeFileSync(gbkPath, iconv.encode("// 中文 OldName\r\n", "gbk"));

    const preview = previewRenameInWorkspace(workspace, {
      old: "OldName",
      new: "NewName",
      levels: ["text"],
      target_encoding: "utf-8",
    });
    expect(preview.hits[0]).toMatchObject({ encoding_in: "gbk", encoding_out: "gbk", status: "preview" });
    const applied = applyRenameInWorkspace(workspace, {
      old: "OldName",
      new: "NewName",
      levels: ["text"],
      target_encoding: "utf-8",
    });
    expect(applied.hits[0]).toMatchObject({ encoding_in: "gbk", encoding_out: "gbk", status: "written" });
    expect(iconv.decode(fs.readFileSync(gbkPath), "gbk")).toBe("// 中文 NewName\r\n");
    expect(decodeSourceBuffer(fs.readFileSync(gbkPath))?.encoding).toBe("gbk");

    const asciiPath = path.join(workspace, "ascii.cpp");
    fs.writeFileSync(asciiPath, "OldName\r\n", "ascii");
    const converted = applyRenameInWorkspace(workspace, {
      old: "OldName",
      new: "新名称",
      levels: ["text"],
      repo_rel_paths: ["ascii.cpp"],
      target_encoding: "gbk",
    });
    expect(converted.hits[0]).toMatchObject({ encoding_in: "utf-8", encoding_out: "gbk", status: "written" });
    expect(iconv.decode(fs.readFileSync(asciiPath), "gbk")).toBe("新名称\r\n");
  });

  it("reports a GBK encoding error without corrupting the source", () => {
    const workspace = makeTempRoot();
    const filename = path.join(workspace, "gbk.cpp");
    const before = iconv.encode("// 中文 OldName\n", "gbk");
    fs.writeFileSync(filename, before);
    const preview = previewRenameInWorkspace(workspace, {
      old: "OldName",
      new: "\u{1f600}",
      levels: ["text"],
      target_encoding: "utf-8",
    });
    expect(preview.hits[0].status).toBe("encoding-error");
    expect(preview.summary.skipped).toBe(1);
    applyRenameInWorkspace(workspace, {
      old: "OldName",
      new: "\u{1f600}",
      levels: ["text"],
      target_encoding: "utf-8",
    });
    expect(fs.readFileSync(filename)).toEqual(before);
  });
});

describe("pdtCodeService code uuid", () => {
  it("scans dashed UUIDs, CAA GUID blocks, and optional guid32 hits", () => {
    const workspace = makeTempRoot();
    writeFile(
      workspace,
      "src/uuids.cpp",
      [
        "const char* iid = \"12345678-1234-1234-1234-1234567890ab\";",
        "static const GUID g = {0x12345678, 0x1234, 0x1234, {0x12, 0x34, 0x56, 0x78, 0x90, 0xab, 0xcd, 0xef}};",
        "const char* flat = \"123456781234123412341234567890ab\";",
        "",
      ].join("\n"),
    );

    const defaultScan = scanUuidsInWorkspace(workspace);
    expect(defaultScan.implemented).toBe(true);
    expect(defaultScan.ok).toBe(true);
    expect(defaultScan.hits.map((h: any) => h.kind)).toEqual(["uuid", "uuid"]);
    expect(defaultScan.summary.total_hits).toBe(2);

    const allKinds = scanUuidsInWorkspace(workspace, { kinds: ["uuid", "guid32"] });
    expect(allKinds.summary.total_hits).toBe(3);
    expect(allKinds.hits.some((h: any) => h.kind === "guid32")).toBe(true);
    expect(allKinds.hits.every((h: any) => h.file_hits === 3)).toBe(true);
  });

  it("previews mapped UUID replacements without writing files", () => {
    const workspace = makeTempRoot();
    const old = "12345678-1234-1234-1234-1234567890ab";
    writeFile(workspace, "src/a.cpp", `${old}\n{${old.toUpperCase()}}\n`);

    const scan = scanUuidsInWorkspace(workspace);
    const out = applyUuidsInWorkspace(workspace, {
      hit_ids: scan.hits.map((h: any) => h.hit_id),
      strategy: "map_per_value",
      dry_run: true,
    });

    expect(out.ok).toBe(true);
    expect(out.dry_run).toBe(true);
    expect(out.mappings).toHaveLength(2);
    expect(out.mappings[0].new.replace(/[{}-]/g, "").toLowerCase()).toBe(
      out.mappings[1].new.replace(/[{}-]/g, "").toLowerCase(),
    );
    expect(fs.readFileSync(path.join(workspace, "src/a.cpp"), "utf8")).toContain(old);
    expect(out.report_path).toBeUndefined();
  });

  it("applies only selected UUID hit occurrences", () => {
    const workspace = makeTempRoot();
    const old = "12345678-1234-1234-1234-1234567890ab";
    writeFile(workspace, "src/a.cpp", `${old}\n${old}\n`);

    const scan = scanUuidsInWorkspace(workspace);
    const out = applyUuidsInWorkspace(workspace, {
      hit_ids: [scan.hits[0].hit_id],
      strategy: "fresh_per_hit",
      dry_run: false,
    });

    expect(out.ok).toBe(true);
    expect(out.mappings).toHaveLength(1);
    expect(out.summary.unique_new_uuids).toBe(1);
    expect(out.report_path_display).toMatch(/^\.phoenix\/reports\/code-uuid-report-/);
    expect(fs.existsSync(out.report_path)).toBe(true);
    expect(JSON.parse(fs.readFileSync(out.report_path, "utf8"))).toMatchObject({
      strategy: "fresh_per_hit",
      dry_run: false,
    });
    const text = fs.readFileSync(path.join(workspace, "src/a.cpp"), "utf8");
    expect(text).toContain(old);
    expect(text.split(old)).toHaveLength(2);
    expect(text).toContain(out.mappings[0].new);
  });

  it("scans and applies UUIDs in a GBK source without changing its encoding", () => {
    const workspace = makeTempRoot();
    const old = "12345678-1234-1234-1234-1234567890ab";
    const filename = path.join(workspace, "src", "gbk.cpp");
    fs.mkdirSync(path.dirname(filename), { recursive: true });
    fs.writeFileSync(filename, iconv.encode(`// 中文\r\n${old}\r\n`, "gbk"));

    const scan = scanUuidsInWorkspace(workspace);
    expect(scan.summary.total_hits).toBe(1);
    const out = applyUuidsInWorkspace(workspace, {
      hit_ids: [scan.hits[0].hit_id],
      strategy: "fresh_per_hit",
      dry_run: false,
    });
    expect(out.mappings).toHaveLength(1);
    const bytes = fs.readFileSync(filename);
    expect(decodeSourceBuffer(bytes)?.encoding).toBe("gbk");
    const text = iconv.decode(bytes, "gbk");
    expect(text).toContain("// 中文\r\n");
    expect(text).not.toContain(old);
    expect(text).toContain(out.mappings[0].new);
  });
});
