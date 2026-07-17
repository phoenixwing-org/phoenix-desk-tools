import fs from "node:fs";
import path from "node:path";
import { runtimeUserDataDir } from "./appRuntimePaths.js";
import {
  loadWorkspacePrefs,
  loadWorkspacePrefsSnapshot,
  replaceWorkspaceSection,
} from "./workspacePrefsService.js";

type CodeIgnoreContext = {
  prefsDir?: string;
};

type ProcessDirSuggestion = {
  name: string;
  kind: "dir";
  reason: "process_dir";
  repo_rel_path: string;
  suggested_pattern: string;
};

const IGNORE_FILENAME = "code.ignore";
const LEGACY_IGNORE_FILENAMES = ["reorder-members.ignore", "code-rename.ignore"];
const DEFAULT_BUILTIN_PATTERNS = [
  ".phoenix",
  ".git",
  ".svn",
  ".hg",
  ".vs",
  ".idea",
  ".cursor",
  "build",
  "Build",
  "Debug",
  "Release",
  "dist",
  "node_modules",
  "web-ui",
  "__pycache__",
  ".venv",
  ".venv-desktop",
  "venv",
  "phoenix_desk_tools.egg-info",
  "cmake-build-debug",
  "cmake-build-release",
  "build-*",
  "cmake-build-*",
  "out",
  "bin",
  "obj",
  "x64",
  "x86",
  "Win32",
  "Intermediate",
  "DerivedData",
  ".cache",
  "_build",
];

const IGNORE_PRESETS: Record<string, string[]> = {
  caa: ["ImportedInterfaces", "LocalGenerated", "ProtectedGenerated", "PrivateGenerated", "intel_a", "win_b64"],
};

const PROCESS_DIR_GLOB_PATTERNS = [
  "build-*",
  "cmake-build-*",
  "CMakeFiles",
  "out",
  "bin",
  "obj",
  "x64",
  "x86",
  "Win32",
  "Intermediate",
  "ipch",
  "DerivedData",
  ".cache",
  "_build",
  "bld",
];

const PROCESS_DIR_EXACT_NAMES = new Set([
  "build",
  "Build",
  "Debug",
  "Release",
  "RelWithDebInfo",
  "MinSizeRel",
  "xcodebuild",
  "artifacts",
  "target",
]);

function defaultPrefsDir(): string {
  return runtimeUserDataDir();
}

function legacyPrefsPath(ctx?: CodeIgnoreContext): string {
  return path.join(ctx?.prefsDir || defaultPrefsDir(), "code-ignore.json");
}

function workspaceKey(root: string): string {
  return root ? path.resolve(root) : "__default__";
}

function pathDisplay(p: string): string {
  return p ? path.normalize(p) : "";
}

function dedupePatterns(patterns: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of patterns) {
    const p = String(raw || "").trim();
    if (!p || p.startsWith("#")) continue;
    const key = p.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  return out;
}

function parseCustomIgnore(raw: unknown): string[] {
  if (Array.isArray(raw)) return dedupePatterns(raw.map(String));
  if (typeof raw === "string") return dedupePatterns(raw.split(/\r?\n/));
  return [];
}

function wildcardMatch(name: string, pattern: string): boolean {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".");
  return new RegExp(`^${escaped}$`, "i").test(name);
}

export function isIgnoredName(name: string, patterns: string[]): boolean {
  if (name.startsWith(".")) return true;
  const lower = name.toLowerCase();
  return patterns.some((raw) => {
    const p = String(raw || "").trim();
    if (!p) return false;
    if (/[*?[\]]/.test(p)) return wildcardMatch(name, p);
    return lower === p.toLowerCase();
  });
}

function readPatternFile(file: string): string[] {
  try {
    return dedupePatterns(fs.readFileSync(file, "utf8").split(/\r?\n/));
  } catch {
    return [];
  }
}

function ignoreFileInfo(workspaceRoot: string) {
  const phoenixDir = workspaceRoot ? path.join(workspaceRoot, ".phoenix") : "";
  const primary = phoenixDir ? path.join(phoenixDir, IGNORE_FILENAME) : "";
  const primaryPatterns = primary ? readPatternFile(primary) : [];
  if (primary && fs.existsSync(primary)) {
    return { patterns: primaryPatterns, file: primary, exists: true, legacy: [] as Array<{ filename: string; patterns: string[] }> };
  }
  const patterns: string[] = [];
  const legacy: Array<{ filename: string; patterns: string[] }> = [];
  for (const filename of LEGACY_IGNORE_FILENAMES) {
    const file = phoenixDir ? path.join(phoenixDir, filename) : "";
    const pats = file ? readPatternFile(file) : [];
    if (pats.length) {
      legacy.push({ filename, patterns: pats });
      patterns.push(...pats);
    }
  }
  return { patterns: dedupePatterns(patterns), file: primary, exists: false, legacy };
}

function readJsonObject(filename: string): Record<string, any> {
  try {
    const raw = JSON.parse(fs.readFileSync(filename, "utf8"));
    return raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  } catch {
    return {};
  }
}

function prefsForWorkspace(
  workspaceRoot: string,
  ctx?: CodeIgnoreContext,
  options: { readOnly?: boolean } = {},
) {
  const workspaceStore = workspaceRoot && fs.existsSync(workspaceRoot) && fs.statSync(workspaceRoot).isDirectory()
    ? options.readOnly
      ? loadWorkspacePrefsSnapshot(workspaceRoot)
      : loadWorkspacePrefs(workspaceRoot)
    : {};
  const workspaceSection = workspaceStore.code_ignore && typeof workspaceStore.code_ignore === "object"
    ? workspaceStore.code_ignore
    : null;
  const legacyStore = readJsonObject(legacyPrefsPath(ctx));
  const legacyByWorkspace = legacyStore.byWorkspace && typeof legacyStore.byWorkspace === "object" ? legacyStore.byWorkspace : null;
  const legacySection = legacyByWorkspace ? legacyByWorkspace[workspaceKey(workspaceRoot)] || {} : legacyStore;
  const raw = workspaceSection || legacySection || {};
  let custom = parseCustomIgnore(raw.custom_ignore ?? raw.customPatterns ?? raw.custom_ignore_lines);
  let preset = String(raw.ignore_preset || raw.ignorePreset || "").trim().toLowerCase();
  if (!custom.length) {
    const renameRaw = workspaceStore.code_rename;
    const rename = renameRaw && typeof renameRaw === "object" && !Array.isArray(renameRaw)
      ? renameRaw as Record<string, unknown>
      : {};
    custom = parseCustomIgnore(rename.custom_ignore);
    if (!preset) preset = String(rename.ignore_preset || "").trim().toLowerCase();
  }
  return {
    custom_ignore: custom,
    ignore_preset: preset in IGNORE_PRESETS ? preset : "",
    process_dirs_seeded: Boolean(raw.process_dirs_seeded),
  };
}

function savePrefsForWorkspace(workspaceRoot: string, patch: any, ctx?: CodeIgnoreContext) {
  const root = workspaceRoot.trim();
  if (!root || !fs.existsSync(root) || !fs.statSync(root).isDirectory()) throw new Error("Workspace is not configured");
  const current = prefsForWorkspace(workspaceRoot, ctx);
  const next = { ...current };
  if (Object.prototype.hasOwnProperty.call(patch, "custom_ignore")) {
    next.custom_ignore = parseCustomIgnore(patch.custom_ignore);
  }
  if (Object.prototype.hasOwnProperty.call(patch, "ignore_preset")) {
    const preset = String(patch.ignore_preset || "").trim().toLowerCase();
    if (preset && !(preset in IGNORE_PRESETS)) throw new Error(`Unknown ignore_preset: ${preset}`);
    next.ignore_preset = preset;
  }
  if (Object.prototype.hasOwnProperty.call(patch, "process_dirs_seeded")) {
    next.process_dirs_seeded = Boolean(patch.process_dirs_seeded);
  }
  replaceWorkspaceSection(root, "code_ignore", next);
}

function processDirName(name: string): boolean {
  if (!name || name === "." || name === "..") return false;
  if (name.startsWith(".")) return true;
  if ([...PROCESS_DIR_EXACT_NAMES].some((n) => n.toLowerCase() === name.toLowerCase())) return true;
  return isIgnoredName(name, PROCESS_DIR_GLOB_PATTERNS);
}

function suggestedPatternForName(name: string): string {
  const lower = name.toLowerCase();
  if (lower.startsWith("build-")) return "build-*";
  if (lower.startsWith("cmake-build-")) return "cmake-build-*";
  return name;
}

export function patternsToSeedFromSuggestions(suggestions: ProcessDirSuggestion[]): string[] {
  return dedupePatterns(suggestions.map((s) => s.suggested_pattern || s.name));
}

function maybeSeedProcessDirIgnores(workspaceRoot: string, ctx?: CodeIgnoreContext): string[] {
  const root = workspaceRoot.trim();
  if (!root || !fs.existsSync(root) || !fs.statSync(root).isDirectory()) return [];
  const pref = prefsForWorkspace(root, ctx);
  if (pref.process_dirs_seeded) return [];
  const fileInfo = ignoreFileInfo(root);
  const custom = dedupePatterns([
    ...pref.custom_ignore,
    ...(pref.ignore_preset ? IGNORE_PRESETS[pref.ignore_preset] : []),
  ]);
  const effective = dedupePatterns([...DEFAULT_BUILTIN_PATTERNS, ...fileInfo.patterns, ...custom]);
  const seeded = patternsToSeedFromSuggestions(suggestProcessDirIgnores(root, effective));
  savePrefsForWorkspace(root, {
    custom_ignore: dedupePatterns([...pref.custom_ignore, ...seeded]),
    process_dirs_seeded: true,
  }, ctx);
  return seeded;
}

export function suggestProcessDirIgnores(workspaceRoot: string, patterns: string[]): ProcessDirSuggestion[] {
  const root = workspaceRoot.trim();
  if (!root || !fs.existsSync(root)) return [];
  const out: ProcessDirSuggestion[] = [];
  const seen = new Set<string>();
  for (const item of fs.readdirSync(root, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (!item.isDirectory() || item.isSymbolicLink()) continue;
    if (!processDirName(item.name)) continue;
    if (isIgnoredName(item.name, patterns)) continue;
    const key = item.name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      name: item.name,
      kind: "dir",
      reason: "process_dir",
      repo_rel_path: item.name,
      suggested_pattern: suggestedPatternForName(item.name),
    });
  }
  return out;
}

export function getCodeIgnorePrefs(
  workspaceRoot: string,
  ctx?: CodeIgnoreContext,
  options: { autoSeed?: boolean } = {},
) {
  const root = workspaceRoot.trim();
  const autoSeeded = options.autoSeed === false ? [] : maybeSeedProcessDirIgnores(root, ctx);
  const pref = prefsForWorkspace(root, ctx);
  const fileInfo = ignoreFileInfo(root);
  const custom = dedupePatterns([
    ...pref.custom_ignore,
    ...(pref.ignore_preset ? IGNORE_PRESETS[pref.ignore_preset] : []),
  ]);
  const ignorePatterns = dedupePatterns([...DEFAULT_BUILTIN_PATTERNS, ...fileInfo.patterns, ...custom]);
  const suggestions = suggestProcessDirIgnores(root, ignorePatterns);
  return {
    workspace_path: root,
    workspace_path_display: pathDisplay(root),
    ignore_preset: pref.ignore_preset,
    ignore_presets: Object.entries(IGNORE_PRESETS).map(([id, patterns]) => ({ id, label: id.toUpperCase(), patterns })),
    custom_ignore: pref.custom_ignore,
    ignore_file: fileInfo.file,
    ignore_file_display: pathDisplay(fileInfo.file),
    ignore_file_exists: fileInfo.exists,
    legacy_ignore_sources: fileInfo.legacy,
    ignore_builtin: DEFAULT_BUILTIN_PATTERNS,
    ignore_file_patterns: fileInfo.patterns,
    ignore_custom_patterns: custom,
    ignore_patterns: ignorePatterns,
    consumers: ["code_index", "reorder_members", "kt_codegen", "code_rename", "code_uuid"],
    process_dir_suggestions: suggestions,
    process_dirs_auto_seeded: autoSeeded,
    process_dirs_seeded: pref.process_dirs_seeded,
  };
}

export function saveCodeIgnorePrefs(workspaceRoot: string, patch: any, ctx?: CodeIgnoreContext) {
  savePrefsForWorkspace(workspaceRoot.trim(), patch || {}, ctx);
  return getCodeIgnorePrefs(workspaceRoot, ctx);
}

export function listCodeIgnoreSuggestions(workspaceRoot: string, ctx?: CodeIgnoreContext) {
  const prefs = getCodeIgnorePrefs(workspaceRoot, ctx, { autoSeed: false });
  const suggestions = suggestProcessDirIgnores(workspaceRoot.trim(), prefs.ignore_patterns);
  return {
    suggestions,
    suggested_patterns: patternsToSeedFromSuggestions(suggestions),
  };
}

export function effectiveCodeIgnorePatterns(workspaceRoot: string, ctx?: CodeIgnoreContext): string[] {
  try {
    const root = workspaceRoot.trim();
    const pref = prefsForWorkspace(root, ctx, { readOnly: true });
    const fileInfo = ignoreFileInfo(root);
    const custom = dedupePatterns([
      ...pref.custom_ignore,
      ...(pref.ignore_preset ? IGNORE_PRESETS[pref.ignore_preset] : []),
    ]);
    return dedupePatterns([
      ...DEFAULT_BUILTIN_PATTERNS,
      ...fileInfo.patterns,
      ...custom,
    ]);
  } catch {
    // 索引、预检等只读消费者不应因工作空间数据库只读/损坏而完全不可用。
    // 偏好配置 API 仍保留原错误；这里只退回无需数据库的稳定规则。
    const fileInfo = ignoreFileInfo(workspaceRoot.trim());
    return dedupePatterns([
      ...DEFAULT_BUILTIN_PATTERNS,
      ...fileInfo.patterns,
    ]);
  }
}
