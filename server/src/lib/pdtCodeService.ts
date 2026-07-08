/** pdtCodeService — 对应 Python code/ 模块 (14个文件)
 *  code/kinds + ignore + text_encoding + process_dirs + workset_resolve +
 *  git_workspace + rename/types + rename/binary + rename/walk
 */

// ── code/kinds.py ──────────────────────────────────────

const SOURCE_EXTS = [".cpp", ".c", ".cc", ".cxx", ".h", ".hpp", ".hh", ".hxx", ".m", ".mm"];
const CONFIG_EXTS = [".json", ".cmake", ".yaml", ".yml", ".toml", ".ini", ".cfg", ".conf", ".pro", ".pri", ".qss"];
const DOC_EXTS = [".md", ".markdown", ".rst", ".txt"];
const RESOURCE_EXTS = [".qrc", ".ui", ".qml", ".catdlg", ".catnls", ".catrsc", ".bmp", ".xpm", ".png", ".jpg", ".jpeg", ".gif", ".svg", ".ico", ".icns", ".wav", ".mp3", ".ttf", ".otf", ".woff", ".woff2"];

const EXT_KIND: Record<string, string> = {};
for (const e of SOURCE_EXTS) EXT_KIND[e] = "source";
for (const e of CONFIG_EXTS) EXT_KIND[e] = "config";
for (const e of DOC_EXTS) EXT_KIND[e] = "doc";
for (const e of RESOURCE_EXTS) EXT_KIND[e] = "resource";

const BASENAME_KIND: Record<string, string> = {
  "cmakelists.txt": "config", "makefile": "config",
  "pyproject.toml": "config", "package.json": "config", "requirements.txt": "config",
};

export const CODE_ASSET_KINDS = ["source", "config", "doc", "resource"] as const;
export const KIND_LABELS: Record<string, string> = { source: "源文件", config: "配置", doc: "文档", resource: "资源" };

export function normalizeIndexExtension(ext: string): string | null {
  let raw = (ext || "").trim().toLowerCase();
  if (!raw) return null;
  if (!raw.startsWith(".")) raw = "." + raw;
  return (raw.length >= 2 && raw.length <= 16) ? raw : null;
}

export function builtinIndexExtensions(): string[] { return Object.keys(EXT_KIND); }

/** 对应 Python: code_asset_kind */
export function codeAssetKind(filename: string, extraExts: string[] = []): string | null {
  const name = filename.toLowerCase();
  const ext = filename.slice(filename.lastIndexOf(".")).toLowerCase();
  if (name in BASENAME_KIND) return BASENAME_KIND[name];
  if (extraExts.includes(ext)) return "resource";
  if (ext in EXT_KIND) return EXT_KIND[ext];
  return null;
}

export function isCodeIndexFilename(filename: string, extraExts: string[] = []): boolean {
  return codeAssetKind(filename, extraExts) !== null;
}

// ── code/ignore.py ─────────────────────────────────────

export function isIgnoredName(name: string, patterns: string[]): boolean {
  return patterns.some(p => {
    if (p.includes("*")) {
      const re = new RegExp("^" + p.replace(/\*/g, ".*") + "$", "i");
      return re.test(name);
    }
    return name.toLowerCase() === p.toLowerCase();
  });
}

// ── code/process_dirs.py ───────────────────────────────

const PROCESS_DIR_NAMES = ["build", "Build", "Debug", "Release", "out", "bin", "obj", "dist", ".cache", "_build"];

export function isProcessDirName(name: string): boolean {
  if (!name || name === "." || name === "..") return false;
  if (name.startsWith(".")) return true;
  return PROCESS_DIR_NAMES.some(d => name.toLowerCase() === d.toLowerCase())
    || /^(build-|cmake-build-)/i.test(name);
}

// ── code/workset_resolve.py ────────────────────────────

export function normalizeWorksetPaths(paths: string[]): string[] {
  return [...new Set(paths.map(p => p.replace(/\\/g, "/").trim()).filter(Boolean))];
}

// ── code/git_workspace.py ──────────────────────────────

export async function gitWorkspaceInfo(_repoRoot: string): Promise<any> {
  return { git_root: "", git_root_display: "", branch: "", has_changes: false, _stub: true };
}

// ── code/rename/types.py ───────────────────────────────

export interface RenameScanOptions { levels: string[]; targetEncoding: string; }
export const DEFAULT_RENAME_LEVELS = ["file", "text"];
export const DEFAULT_TARGET_ENCODING = "utf-8";

// ── code/rename/binary.py ──────────────────────────────

const BINARY_EXTENSIONS = [".exe", ".dll", ".so", ".dylib", ".bin", ".dat", ".zip", ".png", ".jpg", ".gif", ".ico", ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".ttf", ".otf", ".woff", ".woff2", ".mp3", ".mp4", ".avi", ".mov", ".mkv"];

export function isBinarySuffix(filename: string): boolean {
  const ext = filename.slice(filename.lastIndexOf(".")).toLowerCase();
  return BINARY_EXTENSIONS.includes(ext);
}

// ── code/rename/walk.py ────────────────────────────────

const SKIP_NAMES = new Set([".git", "node_modules", "__pycache__", ".phoenix", ".obsidian", ".cursor", "dist", "build", ".venv"]);

export function isScannableDir(name: string): boolean {
  return !name.startsWith(".") && !SKIP_NAMES.has(name);
}

// ── code/text_encoding.py ──────────────────────────────

export function detectTextEncodingLabel(_filePath: string): string {
  return "utf-8"; // stub — Python used chardet
}

// ── code/rename/encoding.py ────────────────────────────

export interface TextPayload { path: string; content: string; encoding: string; hadBom: boolean; }
export function detectAndRead(_p: string): TextPayload { return { path: _p, content: "", encoding: "utf-8", hadBom: false }; }

// ── code/rename/scan.py ────────────────────────────────

export interface RenamePreview { files: number; matches: number; _stub: boolean; }
export function previewTextRename(_opts: any): RenamePreview { return { files: 0, matches: 0, _stub: true }; }

// ── code/rename/apply.py ───────────────────────────────

export function applyTextRename(_opts: any): any { return { _stub: true }; }

// ── code/rename/path_rename.py ─────────────────────────

export function previewPathRename(_opts: any): any { return { _stub: true }; }
export function applyPathRename(_opts: any): any { return { _stub: true }; }

// ── code/rename/uuid_scan.py ───────────────────────────

export function scanUuidHits(_opts: any): any { return { hits: [], _stub: true }; }
export function classifyUuidMatch(_m: string): string { return "uuid"; }

// ── code/rename/uuid_apply.py ──────────────────────────

export function applyUuidHits(_opts: any): any { return { _stub: true }; }

// ── code/rename/service.py ─────────────────────────────

export function previewRename(_opts: any): any { return { _stub: true }; }
export function applyRename(_opts: any): any { return { _stub: true }; }
export function scanUuids(_opts: any): any { return { hits: [], _stub: true }; }
export function applyUuids(_opts: any): any { return { _stub: true }; }

// ── code/rename/apply_batch.py ─────────────────────────

export function applyRenameAll(_opts: any): any { return { _stub: true }; }

// ── code/reorder_members.py (stub) ─────────────────────

export function reorderCppFile(_p: string): any { return { _stub: true, _note: "C++重排待迁移" }; }
