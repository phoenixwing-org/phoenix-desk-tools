import fs from "node:fs";
import path from "node:path";
import {
  loadWorkspaceSection,
  replaceWorkspaceSection,
} from "./workspacePrefsService.js";

export type PartDedupPrefs = {
  extension: string;
  code_len: number;
  ver_len: number;
  check_code: boolean;
  check_version: boolean;
  code_must_be_digit: boolean;
  scan_dir: string;
};

export type PartDedupGroup = {
  label: string;
  paths: string[];
  paths_display?: string[];
  code?: string;
  version?: string;
  csv_fc?: string;
};

export type PartDedupResults = {
  name_dup: PartDedupGroup[];
  code_dup: PartDedupGroup[];
  ver_dup: PartDedupGroup[];
};

export type PartDedupScanResult = {
  file_count: number;
  extension: string;
  scan_display: string;
  summary: string;
  prefs: PartDedupPrefs;
  stats: { name_dup: number; code_dup: number; ver_dup: number };
  results: PartDedupResults;
  _native?: "node";
};

const DEFAULT_PREFS: PartDedupPrefs = {
  extension: ".SLDPRT",
  code_len: 6,
  ver_len: 3,
  check_code: true,
  check_version: true,
  code_must_be_digit: true,
  scan_dir: ".",
};

const EXT_OPTIONS = [".FCStd", ".SLDPRT", ".SLDASM", ".SLDDRW", ".step", ".stp"];
const FCSTD_DUP_TAG_DRAWING = "::fcd_draw";
const FCSTD_DUP_TAG_MODEL = "::fcd_model";
const SKIP_DIRS = new Set([".git", ".phoenix", "node_modules", "__pycache__", ".venv", ".venv-desktop"]);

function requireWorkspace(workspaceRoot: string): string {
  const root = path.resolve(String(workspaceRoot || "").trim());
  if (!root || !fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    throw new Error("workspace is required");
  }
  return root;
}

function coerceExt(rawValue: unknown): string {
  let raw = String(rawValue || "").trim() || DEFAULT_PREFS.extension;
  if (!raw.startsWith(".")) raw = `.${raw}`;
  const lower = raw.toLowerCase();
  return EXT_OPTIONS.find((ext) => ext.toLowerCase() === lower) || raw;
}

function positiveInt(raw: unknown, fallback: number): number {
  const value = Number(raw);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(1, Math.min(64, Math.trunc(value)));
}

function normalizeStoredScanDir(rawValue: unknown): string | null {
  const raw = String(rawValue || "").trim().replace(/\\/g, "/");
  if (!raw || raw === ".") return null;
  return raw;
}

function displayPath(absPath: string, workspaceRoot: string): string {
  const root = path.resolve(workspaceRoot);
  const abs = path.resolve(absPath);
  const rel = path.relative(root, abs).replace(/\\/g, "/");
  if (!rel || rel === ".") return ".";
  if (!rel.startsWith("..") && !path.isAbsolute(rel)) return `./${rel}`;
  return path.normalize(abs);
}

function displayStoredScanDir(stored: unknown, workspaceRoot: string): string {
  const resolved = resolveWorkspacePathEntry(String(stored || "."), workspaceRoot);
  return displayPath(resolved, workspaceRoot);
}

function resolveWorkspacePathEntry(rawValue: string, workspaceRoot: string): string {
  const root = path.resolve(workspaceRoot);
  const raw = String(rawValue || "").trim();
  const candidate = !raw || raw === "."
    ? root
    : path.isAbsolute(raw)
      ? path.resolve(raw)
      : path.resolve(root, raw.replace(/\\/g, "/"));
  const rel = path.relative(root, candidate);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(`Path escapes workspace: ${rawValue}`);
  }
  return candidate;
}

function storeScanDir(scanDir: unknown, workspaceRoot: string): string | null {
  const resolved = resolveWorkspacePathEntry(String(scanDir || "."), workspaceRoot);
  const rel = path.relative(path.resolve(workspaceRoot), resolved).replace(/\\/g, "/");
  return !rel || rel === "." ? null : rel;
}

function prefsFromRaw(raw: any, workspaceRoot: string): PartDedupPrefs {
  return {
    extension: coerceExt(raw?.extension),
    code_len: positiveInt(raw?.code_len, DEFAULT_PREFS.code_len),
    ver_len: positiveInt(raw?.ver_len, DEFAULT_PREFS.ver_len),
    check_code: raw?.check_code == null ? DEFAULT_PREFS.check_code : Boolean(raw.check_code),
    check_version: raw?.check_version == null ? DEFAULT_PREFS.check_version : Boolean(raw.check_version),
    code_must_be_digit: raw?.code_must_be_digit == null ? DEFAULT_PREFS.code_must_be_digit : Boolean(raw.code_must_be_digit),
    scan_dir: displayStoredScanDir(normalizeStoredScanDir(raw?.scan_dir) || ".", workspaceRoot),
  };
}

export function getPartDedupPrefs(workspaceRoot: string): PartDedupPrefs {
  const root = requireWorkspace(workspaceRoot);
  const raw = loadWorkspaceSection<Record<string, any>>(root, "part_dedup", {});
  return prefsFromRaw(raw, root);
}

export function savePartDedupPrefs(workspaceRoot: string, patch: any = {}): PartDedupPrefs {
  const root = requireWorkspace(workspaceRoot);
  const current = loadWorkspaceSection<Record<string, any>>(root, "part_dedup", {});
  const next = { ...current };
  if (Object.prototype.hasOwnProperty.call(patch, "extension")) next.extension = coerceExt(patch.extension);
  if (Object.prototype.hasOwnProperty.call(patch, "code_len")) next.code_len = positiveInt(patch.code_len, DEFAULT_PREFS.code_len);
  if (Object.prototype.hasOwnProperty.call(patch, "ver_len")) next.ver_len = positiveInt(patch.ver_len, DEFAULT_PREFS.ver_len);
  for (const key of ["check_code", "check_version", "code_must_be_digit"] as const) {
    if (Object.prototype.hasOwnProperty.call(patch, key)) next[key] = Boolean(patch[key]);
  }
  if (Object.prototype.hasOwnProperty.call(patch, "scan_dir")) {
    const stored = storeScanDir(patch.scan_dir, root);
    if (stored == null) delete next.scan_dir;
    else next.scan_dir = stored;
  }
  replaceWorkspaceSection(root, "part_dedup", next);
  return getPartDedupPrefs(root);
}

function freecadFcstdDupTag(filename: string): string {
  const lower = path.basename(filename).toLowerCase();
  if (!lower.endsWith(".fcstd")) return "";
  return lower.endsWith(".drawing.fcstd") ? FCSTD_DUP_TAG_DRAWING : FCSTD_DUP_TAG_MODEL;
}

function splitFcstdGroupKey(full: string): [string, string] {
  if (full.endsWith(FCSTD_DUP_TAG_DRAWING)) return [full.slice(0, -FCSTD_DUP_TAG_DRAWING.length), FCSTD_DUP_TAG_DRAWING];
  if (full.endsWith(FCSTD_DUP_TAG_MODEL)) return [full.slice(0, -FCSTD_DUP_TAG_MODEL.length), FCSTD_DUP_TAG_MODEL];
  return [full, ""];
}

function fcstdDupCsvSuffix(tag: string): string {
  if (tag === FCSTD_DUP_TAG_DRAWING) return "|Drawing.FCStd";
  if (tag === FCSTD_DUP_TAG_MODEL) return "|Model.FCStd";
  return "";
}

export function parsePartFilename(
  name: string,
  opts: { code_len: number; ver_len: number; check_version: boolean; code_must_be_digit: boolean },
): { code: string | null; version: string | null } {
  const stem = path.parse(name).name;
  if (stem.length < opts.code_len) return { code: null, version: null };
  const code = stem.slice(0, opts.code_len);
  if (opts.code_must_be_digit && !/^\d+$/.test(code)) return { code: null, version: null };
  if (opts.check_version && stem.length >= opts.code_len + 1 + opts.ver_len) {
    return { code, version: stem.slice(opts.code_len + 1, opts.code_len + 1 + opts.ver_len) };
  }
  return { code, version: null };
}

function addGroup(map: Map<string, string[]>, key: string, file: string): void {
  map.set(key, [...(map.get(key) || []), file]);
}

function sortedFiles(scanPath: string, extension: string): string[] {
  const out: string[] = [];
  const extLower = extension.toLowerCase();
  const walk = (dir: string) => {
    let items: fs.Dirent[];
    try {
      items = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const item of items) {
      const abs = path.join(dir, item.name);
      if (item.isSymbolicLink()) continue;
      if (item.isDirectory()) {
        if (!SKIP_DIRS.has(item.name)) walk(abs);
        continue;
      }
      if (item.isFile() && path.extname(item.name).toLowerCase() === extLower) out.push(abs);
    }
  };
  walk(scanPath);
  return out.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
}

function buildResults(files: string[], prefs: PartDedupPrefs): PartDedupResults {
  const nameGroups = new Map<string, string[]>();
  const codeGroups = new Map<string, string[]>();
  const verGroups = new Map<string, string[]>();
  const isFcstd = prefs.extension.toLowerCase() === ".fcstd";

  for (const file of files) {
    const name = path.basename(file);
    addGroup(nameGroups, name, file);
    if (!prefs.check_code) continue;
    const { code, version } = parsePartFilename(name, {
      code_len: prefs.code_len,
      ver_len: prefs.ver_len,
      check_version: prefs.check_version,
      code_must_be_digit: prefs.code_must_be_digit,
    });
    if (!code) continue;
    const tag = isFcstd ? freecadFcstdDupTag(name) : "";
    if (!version) addGroup(codeGroups, `${code}${tag}`, file);
    if (version && prefs.check_version) addGroup(verGroups, `${code}_${version}${tag}`, file);
  }

  const name_dup: PartDedupGroup[] = [];
  for (const [label, paths] of [...nameGroups.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (paths.length > 1) name_dup.push({ label, paths });
  }

  const code_dup: PartDedupGroup[] = [];
  if (prefs.check_code) {
    for (const [key, paths] of [...codeGroups.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      if (paths.length <= 1) continue;
      const [base, suffix] = splitFcstdGroupKey(key);
      code_dup.push({ label: `${base}${fcstdDupCsvSuffix(suffix)}`, paths });
    }
  }

  const ver_dup: PartDedupGroup[] = [];
  if (prefs.check_code && prefs.check_version) {
    for (const [key, paths] of [...verGroups.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      if (paths.length <= 1) continue;
      const [base, suffix] = splitFcstdGroupKey(key);
      const [code, version = ""] = base.split("_", 2);
      ver_dup.push({
        label: `${code}_${version}`,
        code,
        version,
        csv_fc: fcstdDupCsvSuffix(suffix),
        paths,
      });
    }
  }

  return { name_dup, code_dup, ver_dup };
}

function withDisplayPaths(results: PartDedupResults, workspaceRoot: string): PartDedupResults {
  const convert = (groups: PartDedupGroup[]) => groups.map((group) => ({
    ...group,
    paths_display: group.paths.map((p) => displayPath(p, workspaceRoot)),
  }));
  return {
    name_dup: convert(results.name_dup),
    code_dup: convert(results.code_dup),
    ver_dup: convert(results.ver_dup),
  };
}

export function scanPartDedup(workspaceRoot: string, opts: any = {}): PartDedupScanResult {
  const root = requireWorkspace(workspaceRoot);
  if (opts && Object.keys(opts).length) savePartDedupPrefs(root, opts);
  const prefs = getPartDedupPrefs(root);
  const scanPath = resolveWorkspacePathEntry(prefs.scan_dir, root);
  if (!fs.existsSync(scanPath) || !fs.statSync(scanPath).isDirectory()) {
    throw new Error(`Scan directory is not valid: ${displayPath(scanPath, root)}`);
  }
  const files = sortedFiles(scanPath, prefs.extension);
  const results = withDisplayPaths(buildResults(files, prefs), root);
  const stats = {
    name_dup: results.name_dup.length,
    code_dup: results.code_dup.length,
    ver_dup: results.ver_dup.length,
  };
  const totalGroups = stats.name_dup + stats.code_dup + stats.ver_dup;
  const scanDisplay = displayPath(scanPath, root);
  return {
    file_count: files.length,
    extension: prefs.extension,
    scan_display: scanDisplay,
    prefs,
    stats,
    results,
    summary: `Scanned ${scanDisplay}: ${files.length} ${prefs.extension} files, ${totalGroups} duplicate groups (name ${stats.name_dup}, code ${stats.code_dup}, code+version ${stats.ver_dup})`,
    _native: "node",
  };
}

function csvEscape(value: unknown): string {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, "\"\"")}"` : text;
}

function normalizeExportResults(body: any): PartDedupResults {
  const raw = body?.results && typeof body.results === "object" ? body.results : body;
  return {
    name_dup: Array.isArray(raw?.name_dup) ? raw.name_dup : [],
    code_dup: Array.isArray(raw?.code_dup) ? raw.code_dup : [],
    ver_dup: Array.isArray(raw?.ver_dup) ? raw.ver_dup : [],
  };
}

export function exportPartDedupCsv(workspaceRoot: string, body: any = {}): { path: string; path_display: string; _native: "node" } {
  const root = requireWorkspace(workspaceRoot);
  const results = Object.keys(body || {}).length ? normalizeExportResults(body) : scanPartDedup(root).results;
  const rows: string[][] = [["category", "label", "path"]];
  for (const group of results.name_dup) {
    for (const file of group.paths || []) rows.push(["name_dup", group.label || "", file]);
  }
  for (const group of results.code_dup) {
    for (const file of group.paths || []) rows.push(["code_dup", group.label || "", file]);
  }
  for (const group of results.ver_dup) {
    const label = `${group.code || ""}_${group.version || ""}${group.csv_fc || ""}`;
    for (const file of group.paths || []) rows.push(["ver_dup", label, file]);
  }
  const outPath = path.join(root, ".phoenix", "exports", "part_dedup.csv");
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `\ufeff${rows.map((row) => row.map(csvEscape).join(",")).join("\n")}\n`, "utf8");
  return { path: outPath, path_display: displayPath(outPath, root), _native: "node" };
}
