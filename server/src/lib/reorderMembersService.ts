import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pnwCodeIsIgnoredName } from "@phoenix-wing/code-core";
import { reorderCppText } from "./reorderCppEngine.js";
import { extractLockedRegionContents, reorderHeaderText } from "./reorderHeaderEngine.js";
import { readSourceText, writeSourceText } from "./sourceTextCodec.js";
import { runtimeUserDataDir } from "./appRuntimePaths.js";
import {
  loadWorkspacePrefs,
  replaceWorkspaceSection,
} from "./workspacePrefsService.js";

type KevinSystemCodeMode = "merge_strip" | "keep_markers" | "off";

type ReorderPrefsPatch = {
  include_cpp?: boolean;
  include_header?: boolean;
  sort_members?: boolean;
  verbose?: boolean;
  kevin_system_code_mode?: KevinSystemCodeMode;
  last_selected?: string[];
};

type ReorderRunOptions = ReorderPrefsPatch & {
  targets?: string[];
  repo_rel_paths?: string[];
  dry_run?: boolean;
};

type ReorderContext = {
  prefsDir?: string;
  ignorePatterns?: string[];
};

type SourceKind = "cpp" | "header";

type SourceFile = {
  abs: string;
  rel: string;
  kind: SourceKind;
};

const CPP_EXTS = new Set([".cpp", ".cc", ".cxx"]);
const HEADER_EXTS = new Set([".h", ".hpp", ".hh", ".hxx"]);
const DEFAULT_REORDER_PREFS = {
  include_cpp: true,
  include_header: true,
  sort_members: false,
  verbose: false,
  kevin_system_code_mode: "merge_strip" as KevinSystemCodeMode,
  last_selected: [] as string[],
};

function defaultPrefsDir(): string {
  return runtimeUserDataDir();
}

function reorderPrefsPath(ctx?: ReorderContext): string {
  return path.join(ctx?.prefsDir || defaultPrefsDir(), "reorder-members-prefs.json");
}

function codeIgnorePath(ctx?: ReorderContext): string {
  return path.join(ctx?.prefsDir || defaultPrefsDir(), "code-ignore.json");
}

function pathDisplay(p: string): string {
  return p ? path.normalize(p) : "";
}

function normalizeRelPath(rel: string): string {
  return rel.replace(/\\/g, "/");
}

function safeRepoRel(rel: string): string {
  const normalized = normalizeRelPath(rel).replace(/^\.\//, "").trim();
  if (!normalized || normalized.split("/").includes("..") || path.isAbsolute(normalized)) {
    throw new Error(`Invalid repo relative path: ${rel}`);
  }
  return normalized;
}

function resolveUnderWorkspace(root: string, rel: string): string {
  const full = path.resolve(root, safeRepoRel(rel));
  const back = path.relative(root, full);
  if (back.startsWith("..") || path.isAbsolute(back)) {
    throw new Error(`Path escapes workspace: ${rel}`);
  }
  return full;
}

function normalizeKevinSystemCodeMode(raw: unknown): KevinSystemCodeMode {
  return raw === "keep_markers" || raw === "off" || raw === "merge_strip" ? raw : "merge_strip";
}

function normalizeIncludeFlags(includeCpp: unknown, includeHeader: unknown): { include_cpp: boolean; include_header: boolean } {
  const next = {
    include_cpp: includeCpp !== false,
    include_header: includeHeader !== false,
  };
  if (!next.include_cpp && !next.include_header) next.include_cpp = true;
  return next;
}

function sourceKind(filename: string): SourceKind | null {
  const ext = path.extname(filename).toLowerCase();
  if (CPP_EXTS.has(ext)) return "cpp";
  if (HEADER_EXTS.has(ext)) return "header";
  return null;
}

function isSourceFile(filename: string, includeCpp = true, includeHeader = true): boolean {
  const kind = sourceKind(filename);
  return kind === "cpp" ? includeCpp : kind === "header" ? includeHeader : false;
}

function isIgnoredName(name: string, patterns: string[]): boolean {
  return pnwCodeIsIgnoredName(name, patterns, { caseSensitive: false });
}

function ignoreInfo(ctx?: ReorderContext) {
  const file = codeIgnorePath(ctx);
  let configured: string[] = [];
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    configured = [
      ...(Array.isArray(raw.presetPatterns) ? raw.presetPatterns : []),
      ...(Array.isArray(raw.customPatterns) ? raw.customPatterns : []),
      ...(Array.isArray(raw.patterns) ? raw.patterns : []),
    ].map(String);
  } catch {
    configured = ["build-*", "node_modules", ".git"];
  }
  const merged = [...configured, ...(ctx?.ignorePatterns || [])];
  const patterns = [...new Set(merged.map((p) => p.trim()).filter(Boolean))];
  return {
    ignore_file: file,
    ignore_file_display: pathDisplay(file),
    ignore_file_exists: fs.existsSync(file),
    ignore_patterns: patterns,
  };
}

function readPrefsStore(ctx?: ReorderContext): any {
  try {
    return JSON.parse(fs.readFileSync(reorderPrefsPath(ctx), "utf8"));
  } catch {
    return { byWorkspace: {} };
  }
}

function normalizePrefs(raw: any = {}) {
  const flags = normalizeIncludeFlags(raw.include_cpp, raw.include_header);
  const lastSelected = Array.isArray(raw.last_selected)
    ? raw.last_selected.map(String).map((s: string) => s.trim()).filter(Boolean)
    : [];
  return {
    ...DEFAULT_REORDER_PREFS,
    ...flags,
    sort_members: Boolean(raw.sort_members),
    verbose: Boolean(raw.verbose),
    kevin_system_code_mode: normalizeKevinSystemCodeMode(raw.kevin_system_code_mode),
    last_selected: lastSelected,
  };
}

function prefsForWorkspace(root: string, ctx?: ReorderContext) {
  const workspaceStore = loadWorkspacePrefs(root);
  if (
    workspaceStore.code_reorder
    && typeof workspaceStore.code_reorder === "object"
    && !Array.isArray(workspaceStore.code_reorder)
  ) {
    return normalizePrefs(workspaceStore.code_reorder);
  }
  const legacyStore = readPrefsStore(ctx);
  const legacy = legacyStore.byWorkspace?.[path.resolve(root)];
  const migrated = normalizePrefs(legacy || {});
  if (legacy && typeof legacy === "object" && !Array.isArray(legacy)) {
    replaceWorkspaceSection(root, "code_reorder", migrated);
  }
  return migrated;
}

function savePrefsForWorkspace(root: string, patch: ReorderPrefsPatch, ctx?: ReorderContext) {
  const current = prefsForWorkspace(root, ctx);
  const next = normalizePrefs({
    ...current,
    ...patch,
    ...(patch.include_cpp != null || patch.include_header != null
      ? normalizeIncludeFlags(patch.include_cpp ?? current.include_cpp, patch.include_header ?? current.include_header)
      : {}),
  });
  replaceWorkspaceSection(root, "code_reorder", next);
  return next;
}

function invalidWorkspacePayload(root: string, ctx?: ReorderContext) {
  const ig = ignoreInfo(ctx);
  return {
    workspace_path: root,
    workspace_path_display: pathDisplay(root),
    ...DEFAULT_REORDER_PREFS,
    ...ig,
  };
}

export function getReorderMembersPrefs(workspaceRoot: string, ctx?: ReorderContext) {
  const root = workspaceRoot.trim();
  if (!root || !fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    return invalidWorkspacePayload(root, ctx);
  }
  return {
    workspace_path: root,
    workspace_path_display: pathDisplay(root),
    ...prefsForWorkspace(root, ctx),
    ...ignoreInfo(ctx),
  };
}

export function saveReorderMembersPrefs(workspaceRoot: string, patch: ReorderPrefsPatch, ctx?: ReorderContext) {
  const root = workspaceRoot.trim();
  if (!root || !fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    return invalidWorkspacePayload(root, ctx);
  }
  savePrefsForWorkspace(root, patch || {}, ctx);
  return getReorderMembersPrefs(root, ctx);
}

function listSourceFilesUnder(
  root: string,
  startAbs: string,
  opts: { includeCpp?: boolean; includeHeader?: boolean; ignorePatterns?: string[] },
): SourceFile[] {
  const includeCpp = opts.includeCpp !== false;
  const includeHeader = opts.includeHeader !== false;
  const ignorePatterns = opts.ignorePatterns || [];
  const out: SourceFile[] = [];
  const walk = (dir: string) => {
    for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
      if (isIgnoredName(item.name, ignorePatterns)) continue;
      const abs = path.join(dir, item.name);
      if (item.isDirectory()) {
        walk(abs);
      } else if (item.isFile() && isSourceFile(item.name, includeCpp, includeHeader)) {
        const kind = sourceKind(item.name)!;
        out.push({ abs, rel: normalizeRelPath(path.relative(root, abs)), kind });
      }
    }
  };
  if (!fs.existsSync(startAbs)) return out;
  const stat = fs.statSync(startAbs);
  if (stat.isFile() && isSourceFile(startAbs, includeCpp, includeHeader)) {
    out.push({ abs: startAbs, rel: normalizeRelPath(path.relative(root, startAbs)), kind: sourceKind(startAbs)! });
  } else if (stat.isDirectory()) {
    walk(startAbs);
  }
  return out.sort((a, b) => a.rel.localeCompare(b.rel, undefined, { sensitivity: "base" }));
}

function sourceCount(root: string, abs: string, ctx?: ReorderContext): number {
  return listSourceFilesUnder(root, abs, { includeCpp: true, includeHeader: true, ignorePatterns: ignoreInfo(ctx).ignore_patterns }).length;
}

export function listReorderTopLevelEntries(workspaceRoot: string, ctx?: ReorderContext) {
  const root = workspaceRoot.trim();
  const ig = ignoreInfo(ctx);
  if (!root || !fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    return { workspace_path: root, workspace_path_display: pathDisplay(root), entries: [], ignored: [], ...ig };
  }
  const entries: any[] = [];
  const ignored: any[] = [];
  for (const item of fs.readdirSync(root, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const abs = path.join(root, item.name);
    if (item.name === ".phoenix") {
      ignored.push({ name: item.name, kind: item.isDirectory() ? "dir" : "file", reason: "builtin" });
      continue;
    }
    if (isIgnoredName(item.name, ig.ignore_patterns)) {
      ignored.push({ name: item.name, kind: item.isDirectory() ? "dir" : "file", reason: "ignore" });
      continue;
    }
    if (item.isDirectory()) {
      entries.push({ name: item.name, kind: "dir", source_file_count: sourceCount(root, abs, ctx) });
    } else if (item.isFile() && isSourceFile(item.name, true, true)) {
      entries.push({ name: item.name, kind: "file", source_file_count: 1 });
    }
  }
  return { workspace_path: root, workspace_path_display: pathDisplay(root), entries, ignored, ...ig };
}

function expandRepoRelPaths(root: string, repoRelPaths: string[], ctx?: ReorderContext): SourceFile[] {
  const ig = ignoreInfo(ctx);
  const explicit = repoRelPaths.map(String).map((p) => p.trim()).filter(Boolean);
  const starts = explicit.length
    ? explicit.map((rel) => resolveUnderWorkspace(root, rel))
    : [root];
  const files = starts.flatMap((abs) => listSourceFilesUnder(root, abs, { includeCpp: true, includeHeader: true, ignorePatterns: ig.ignore_patterns }));
  const seen = new Set<string>();
  return files.filter((file) => {
    if (seen.has(file.rel)) return false;
    seen.add(file.rel);
    return true;
  });
}

export function resolveReorderMembersScope(workspaceRoot: string, body: { repo_rel_paths?: string[] }, ctx?: ReorderContext) {
  const root = workspaceRoot.trim();
  if (!root || !fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    return { workspace_path: root, resolved_files: [], total: 0 };
  }
  const files = expandRepoRelPaths(root, Array.isArray(body?.repo_rel_paths) ? body.repo_rel_paths : [], ctx);
  return { workspace_path: root, resolved_files: files.map((file) => file.rel), total: files.length };
}

function runOneFile(
  file: SourceFile,
  dryRun: boolean,
  opts: { sortMembers: boolean; kevinSystemCodeMode: KevinSystemCodeMode },
): { changed: boolean; skipped?: string; warnings?: string[] } {
  const payload = readSourceText(file.abs);
  if (!payload) return { changed: false, skipped: "unreadable" };
  const header = file.kind === "header"
    ? reorderHeaderText(payload.text, {
        sortMembers: opts.sortMembers,
        kevinSystemCodeMode: opts.kevinSystemCodeMode,
      })
    : null;
  const next = header?.text ?? reorderCppText(payload.text, path.parse(file.abs).name).text;
  if (next === payload.text) return { changed: false, warnings: header?.warnings };
  if (!dryRun) writeSourceText(file.abs, payload, next);
  return { changed: true, warnings: header?.warnings };
}

function runTarget(
  root: string,
  name: string,
  files: SourceFile[],
  opts: { dryRun: boolean; verbose: boolean; sortMembers: boolean; kevinSystemCodeMode: KevinSystemCodeMode },
) {
  const cppFiles = files.filter((file) => file.kind === "cpp");
  const hdrFiles = files.filter((file) => file.kind === "header");
  const changedFiles: string[] = [];
  const lines: string[] = [];
  for (const file of files) {
    if (opts.verbose) lines.push(`processing ${file.rel}...`);
    const result = runOneFile(file, opts.dryRun, opts);
    if (opts.verbose) {
      for (const warning of result.warnings || []) lines.push(`hint ${file.rel}: ${warning}`);
    }
    if (result.changed) {
      changedFiles.push(file.rel);
      if (opts.verbose) lines.push(`${opts.dryRun ? "[dry-run] " : ""}changed ${file.rel}`);
    } else if (opts.verbose && result.skipped) {
      lines.push(`skip ${file.rel}: ${result.skipped}`);
    }
  }
  return {
    name,
    kind: fs.existsSync(path.join(root, name)) && fs.statSync(path.join(root, name)).isFile() ? "file" : "dir",
    cpp_changed: changedFiles.filter((rel) => CPP_EXTS.has(path.extname(rel).toLowerCase())).length,
    hdr_changed: changedFiles.filter((rel) => HEADER_EXTS.has(path.extname(rel).toLowerCase())).length,
    files_scanned: cppFiles.length + hdrFiles.length,
    changed_files: changedFiles,
    lines,
  };
}

function formatSummary(targetCount: number, dryRun: boolean, cppChanged: number, hdrChanged: number, filesScanned: number, changedFiles: string[]) {
  const mode = dryRun ? "Preview" : "Written";
  const changed = cppChanged + hdrChanged;
  const head = `${mode}: ${targetCount} target(s), ${changed} changed file(s) (${cppChanged} .cpp, ${hdrChanged} header), ${filesScanned} source file(s) scanned`;
  return changedFiles.length ? `${head}\n${changedFiles.map((file) => `  - ${file}`).join("\n")}` : head;
}

export function runReorderMembersBatch(workspaceRoot: string, body: ReorderRunOptions = {}, ctx?: ReorderContext) {
  const root = workspaceRoot.trim();
  const dryRun = Boolean(body.dry_run);
  if (!root || !fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    return { ok: false, log: "Workspace is not configured", lines: ["Workspace is not configured"], dry_run: dryRun };
  }
  const prefs = saveReorderMembersPrefs(root, {
    include_cpp: body.include_cpp,
    include_header: body.include_header,
    sort_members: body.sort_members,
    verbose: body.verbose,
    kevin_system_code_mode: body.kevin_system_code_mode,
    last_selected: Array.isArray(body.targets) ? body.targets : Array.isArray(body.repo_rel_paths) ? body.repo_rel_paths : [],
  }, ctx);
  const ig = ignoreInfo(ctx);
  const includeCpp = prefs.include_cpp !== false;
  const includeHeader = prefs.include_header !== false;
  const verbose = Boolean(prefs.verbose);
  const sortMembers = Boolean(prefs.sort_members);
  const kevinSystemCodeMode = normalizeKevinSystemCodeMode(prefs.kevin_system_code_mode);
  let names = [
    ...(Array.isArray(body.targets) ? body.targets : []),
    ...(Array.isArray(body.repo_rel_paths) ? body.repo_rel_paths : []),
  ].map(String).map((s) => s.trim()).filter(Boolean);
  if (!names.length) {
    names = listReorderTopLevelEntries(root, ctx).entries.map((entry: any) => entry.name);
  }
  const seenNames = new Set<string>();
  names = names.filter((name) => {
    if (seenNames.has(name)) return false;
    seenNames.add(name);
    return true;
  });

  const itemResults: any[] = [];
  const allLines: string[] = [];
  let cppChanged = 0;
  let hdrChanged = 0;
  let filesScanned = 0;
  const allChanged: string[] = [];
  for (const name of names) {
    let abs: string;
    try {
      abs = resolveUnderWorkspace(root, name);
    } catch (e: any) {
      allLines.push(`${name}: ${e.message || String(e)}`);
      continue;
    }
    const files = listSourceFilesUnder(root, abs, { includeCpp, includeHeader, ignorePatterns: ig.ignore_patterns });
    const result = runTarget(root, safeRepoRel(name), files, {
      dryRun,
      verbose,
      sortMembers,
      kevinSystemCodeMode,
    });
    itemResults.push(result);
    cppChanged += result.cpp_changed;
    hdrChanged += result.hdr_changed;
    filesScanned += result.files_scanned;
    allChanged.push(...result.changed_files);
    if (verbose) allLines.push(...result.lines);
    else allLines.push(`${name}: ${result.cpp_changed + result.hdr_changed ? `changed ${result.cpp_changed + result.hdr_changed}` : "no changes"}; scanned ${result.files_scanned}`);
  }
  const summary = formatSummary(names.length, dryRun, cppChanged, hdrChanged, filesScanned, allChanged);
  allLines.push(summary);
  return {
    ok: true,
    log: allLines.join("\n"),
    lines: allLines,
    summary,
    dry_run: dryRun,
    cpp_changed: cppChanged,
    hdr_changed: hdrChanged,
    files_scanned: filesScanned,
    changed_files: allChanged,
    item_results: itemResults,
  };
}

export function runReorderMembersSelfTest() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "reorder-members-self-test-"));
  const prefsDir = fs.mkdtempSync(path.join(os.tmpdir(), "reorder-members-self-test-prefs-"));
  const cases: any[] = [];
  try {
    const src = [
      "class Foo;",
      "void Foo::zeta() {",
      "}",
      "",
      "Foo::Foo() {",
      "}",
      "",
      "void Foo::alpha() {",
      "}",
      "",
    ].join("\n");
    fs.writeFileSync(path.join(root, "Foo.cpp"), src, "utf8");
    const headerSource = [
      "class Foo {",
      "public:",
      "    void zeta();",
      "    // clang-format off",
      "    int WizardZ;",
      "    int WizardA;",
      "    // clang-format on",
      "    void alpha();",
      "    Foo();",
      "};",
      "",
    ].join("\n");
    fs.writeFileSync(path.join(root, "Foo.h"), headerSource, "utf8");
    const dry = runReorderMembersBatch(root, { repo_rel_paths: ["Foo.cpp"], dry_run: true }, { prefsDir });
    const write = runReorderMembersBatch(root, { repo_rel_paths: ["Foo.cpp"], dry_run: false }, { prefsDir });
    const text = fs.readFileSync(path.join(root, "Foo.cpp"), "utf8");
    cases.push({ id: "cpp-dry-run", pass: dry.cpp_changed === 1, message: "dry-run detects C++ member order changes" });
    cases.push({ id: "cpp-write", pass: write.cpp_changed === 1 && text.indexOf("Foo::Foo()") < text.indexOf("alpha") && text.indexOf("alpha") < text.indexOf("zeta"), message: "write reorders constructor before alphabetical members" });
    const headerDry = runReorderMembersBatch(root, {
      repo_rel_paths: ["Foo.h"],
      include_cpp: false,
      include_header: true,
      dry_run: true,
    }, { prefsDir });
    const headerWrite = runReorderMembersBatch(root, {
      repo_rel_paths: ["Foo.h"],
      include_cpp: false,
      include_header: true,
      dry_run: false,
    }, { prefsDir });
    const headerText = fs.readFileSync(path.join(root, "Foo.h"), "utf8");
    cases.push({ id: "header-dry-run", pass: headerDry.hdr_changed === 1, message: "dry-run detects header declaration order changes" });
    cases.push({
      id: "header-write-and-lock",
      pass: headerWrite.hdr_changed === 1
        && headerText.indexOf("Foo();") < headerText.indexOf("alpha")
        && headerText.indexOf("alpha") < headerText.indexOf("zeta")
        && JSON.stringify(extractLockedRegionContents(headerText)) === JSON.stringify(extractLockedRegionContents(headerSource)),
      message: "write reorders header methods while preserving locked regions",
    });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(prefsDir, { recursive: true, force: true });
  }
  const passed = cases.filter((c) => c.pass).length;
  const failed = cases.length - passed;
  return { ok: failed === 0, ran: cases.length, passed, failed, skipped: 0, summary: `${passed}/${cases.length} reorder self-tests passed`, cases };
}
