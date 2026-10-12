/** Shell 路由 — 替代 Python /api/config, /api/workspace 等。
 *  launcher preferences are stored under the configured runtime user data directory.
 */

import { Hono } from "hono";
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DESK_TOOLS_APP_VERSION } from "../lib/deskToolsRegistration.js";
import {
  hasSafeFreecadCommand,
  normalizeFreecadDirectoryPreference,
} from "../lib/freecadProcessSecurity.js";
import {
  getCodeIgnorePrefs,
  listCodeIgnoreSuggestions,
  saveCodeIgnorePrefs,
} from "../lib/codeIgnoreService.js";
import {
  loadFileWorksets,
  pruneMissingFileWorksetPaths,
  saveFileWorksets,
} from "../lib/fileWorksetService.js";
import { fileDetailXrefs, refreshBomXrefForHost } from "../lib/pnwBomXrefService.js";
import {
  analyzeRenameReferences,
  executeDiskFileRename,
} from "../lib/pnwRenameService.js";
import {
  loadBomPreview,
  renameBomFcstdFile,
} from "../lib/bomAttributeService.js";
import {
  buildUnitTestPlan,
  buildUnitTestSuites,
  cancelUnitTestRun,
  discoverUnitTestCatalog,
  runUnitTests,
} from "../lib/unitTestService.js";
import {
  ensureRuntimeCatalog,
  runtimeCatalogStatus,
  runtimeTestCaseMap,
  runtimeTestModuleMap,
  searchRuntimeCatalog,
  syncRuntimeCatalog,
} from "../lib/runtimeCatalogService.js";
import {
  loadWorkspaceNavModules,
  normalizeWorkspaceNavModules,
  saveWorkspaceNavModules,
  type WorkspaceNavModules,
} from "../lib/workspaceStateService.js";
import {
  loadWorkbenchSession,
  saveWorkbenchSession,
} from "../lib/workbenchSessionService.js";
import {
  getPhoenixDatabaseStatus,
  PHOENIX_SCHEMA_VERSION,
  recreatePhoenixDatabase,
} from "../lib/phoenixDatabaseService.js";
import { loadCadIndexStatus } from "../lib/cadIndexStatusService.js";
import { pickDirectoryNative } from "../lib/nativeDirectoryPicker.js";
import { syncTestFixtureCheckouts } from "../lib/testFixtureService.js";
import {
  runtimeAppConfigPath,
  runtimeRepoRoot,
  runtimeTestFixtureCatalogPath,
  runtimeTestFixtureCheckoutRoot,
  runtimeUserDataDir,
} from "../lib/appRuntimePaths.js";
import {
  gitWorkspaceChanges,
  gitWorkspaceCommit,
  gitWorkspaceDiff,
  gitWorkspaceInfo,
  gitWorkspaceInit,
  gitWorkspaceRestore,
  gitWorkspaceStage,
  type GitDiffScope,
  type GitRestoreScope,
} from "../lib/gitWorkspaceService.js";

const APP_CONFIG_PATH = runtimeAppConfigPath();
const REPO_ROOT = runtimeRepoRoot();
const TEST_FIXTURE_CATALOG_PATH = runtimeTestFixtureCatalogPath();
const PREFS_DIR = runtimeUserDataDir();
const PREFS_FILE = path.join(PREFS_DIR, "launcher-prefs.json");

// ── 偏好持久化 ────────────────────────────────────────

interface TestFixturePrefs { checkout_root?: string | null; enabled?: string[]; }
interface LauncherPrefs {
  version?: number;
  recent_workspaces: string[];
  workspace_types?: Record<string, string>;
  freecad_dir: string;
  workspace?: string;
  test_fixtures?: TestFixturePrefs;
  nav_modules?: { enabled: string[] };
  shell_layout?: ShellLayout;
}

const DEFAULT_NAV_MODULES = ["cad", "code"];
const MAX_RECENT_WORKSPACES = 10;

type SideDock = "left" | "right";

interface ShellLayout {
  nav_rail_mode: 0 | 1;
  ribbon_mode: 0 | 1;
  right_panel_open: boolean;
  mid_right_sash_px: number | null;
  left_panel_width_px: number;
  right_panel_width_px: number;
  log_panel_open: boolean;
  log_panel_height_px: number;
  log_auto_open_on_append: boolean;
  workspace_tree_dock: SideDock;
  shell_log_dock: SideDock;
  properties_panel_open: boolean;
  properties_panel_height_px: number;
  properties_footer_height_px: number;
  properties_panel_dock: SideDock;
  properties_name_col_width_px: number;
  git_commit_panel_open: boolean;
  git_commit_panel_dock: SideDock;
  workset_panel_dock: SideDock;
  workset_panel_open: boolean;
}

const DEFAULT_SHELL_LAYOUT: ShellLayout = {
  nav_rail_mode: 0,
  ribbon_mode: 1,
  right_panel_open: true,
  mid_right_sash_px: null,
  left_panel_width_px: 300,
  right_panel_width_px: 300,
  log_panel_open: true,
  log_panel_height_px: 180,
  log_auto_open_on_append: true,
  workspace_tree_dock: "right",
  shell_log_dock: "left",
  properties_panel_open: true,
  properties_panel_height_px: 220,
  properties_footer_height_px: 160,
  properties_panel_dock: "left",
  properties_name_col_width_px: 132,
  git_commit_panel_open: true,
  git_commit_panel_dock: "left",
  workset_panel_dock: "right",
  workset_panel_open: false,
};

function loadPrefs(): LauncherPrefs {
  try {
    if (fs.existsSync(PREFS_FILE)) {
      const raw = JSON.parse(fs.readFileSync(PREFS_FILE, "utf-8"));
      if (raw && typeof raw === "object" && !Array.isArray(raw)) {
        return {
          ...raw,
          version: Number.isInteger(raw.version) ? raw.version : 2,
          recent_workspaces: Array.isArray(raw.recent_workspaces)
            ? raw.recent_workspaces.map(String).filter(Boolean)
            : [],
          workspace_types: raw.workspace_types && typeof raw.workspace_types === "object" && !Array.isArray(raw.workspace_types)
            ? { ...raw.workspace_types }
            : {},
          freecad_dir: String(raw.freecad_dir || ""),
          nav_modules: normalizeNavModules(raw.nav_modules),
          shell_layout: normalizeShellLayout(raw.shell_layout),
        };
      }
    }
  }
  catch { /* ignore */ }
  return factoryPrefs();
}

function savePrefs(p: LauncherPrefs) {
  if (!fs.existsSync(PREFS_DIR)) fs.mkdirSync(PREFS_DIR, { recursive: true });
  fs.writeFileSync(PREFS_FILE, `${JSON.stringify(p, null, 2)}\n`, "utf8");
}

function isDir(p: string): boolean {
  try { return fs.statSync(p).isDirectory(); }
  catch { return false; }
}

function workspaceName(ws: string): string {
  return ws ? path.basename(path.normalize(ws)) : "";
}

function normalizeEnabled(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const name = String(item || "").trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out;
}

function normalizeNavModules(raw: unknown): { enabled: string[] } {
  const values = Array.isArray(raw)
    ? raw
    : raw && typeof raw === "object" && Array.isArray((raw as any).enabled)
      ? (raw as any).enabled
      : [];
  const enabled = normalizeEnabled(values).filter((name) => DEFAULT_NAV_MODULES.includes(name));
  return { enabled: enabled.length ? enabled : [...DEFAULT_NAV_MODULES] };
}

function sanitizeShellLayoutPatch(raw: unknown): Partial<ShellLayout> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const block = raw as Record<string, unknown>;
  const out: Partial<ShellLayout> = {};
  const writable = out as Record<string, unknown>;

  for (const key of [
    "right_panel_open",
    "log_panel_open",
    "log_auto_open_on_append",
    "properties_panel_open",
    "git_commit_panel_open",
    "workset_panel_open",
  ]) {
    if (typeof block[key] === "boolean") writable[key] = block[key];
  }
  for (const key of [
    "workspace_tree_dock",
    "shell_log_dock",
    "properties_panel_dock",
    "git_commit_panel_dock",
    "workset_panel_dock",
  ]) {
    if (block[key] === "left" || block[key] === "right") writable[key] = block[key];
  }
  for (const key of ["nav_rail_mode", "ribbon_mode"]) {
    if (block[key] === 0 || block[key] === 1) writable[key] = block[key];
  }
  const boundedNumbers: Array<[keyof ShellLayout, number, number]> = [
    ["left_panel_width_px", 160, 560],
    ["right_panel_width_px", 160, 560],
    ["log_panel_height_px", 80, 4096],
    ["properties_panel_height_px", 80, 4096],
    ["properties_footer_height_px", 80, 4096],
    ["properties_name_col_width_px", 72, 240],
  ];
  for (const [key, min, max] of boundedNumbers) {
    const value = block[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      writable[key] = Math.round(Math.min(max, Math.max(min, value)));
    }
  }
  if (block.mid_right_sash_px === null) {
    out.mid_right_sash_px = null;
  } else if (typeof block.mid_right_sash_px === "number" && Number.isFinite(block.mid_right_sash_px)) {
    out.mid_right_sash_px = Math.round(Math.min(4096, Math.max(1, block.mid_right_sash_px)));
  }
  return out;
}

function normalizeShellLayout(raw: unknown): ShellLayout {
  return { ...DEFAULT_SHELL_LAYOUT, ...sanitizeShellLayoutPatch(raw) };
}

function factoryPrefs(): LauncherPrefs {
  return {
    version: 2,
    recent_workspaces: [],
    workspace_types: {},
    freecad_dir: "",
    workspace: "",
    shell_layout: { ...DEFAULT_SHELL_LAYOUT },
    nav_modules: { enabled: [...DEFAULT_NAV_MODULES] },
    test_fixtures: { checkout_root: null, enabled: [] },
  };
}

function normalizedPathKey(raw: string): string {
  const resolved = path.resolve(raw);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

const WORKSPACE_TYPE_ID_PATTERN = /^[a-z0-9][a-z0-9._-]*$/u;

function normalizeWorkspaceTypeId(raw: unknown): string {
  const value = String(raw || "").trim().toLocaleLowerCase();
  if (!WORKSPACE_TYPE_ID_PATTERN.test(value)) throw new Error("Invalid workspace type id");
  return value;
}

function workspaceTypeForPath(prefs: LauncherPrefs, workspace: string): string {
  const targetKey = normalizedPathKey(workspace);
  for (const [rawPath, rawType] of Object.entries(prefs.workspace_types || {})) {
    if (normalizedPathKey(rawPath) !== targetKey) continue;
    try {
      return normalizeWorkspaceTypeId(rawType);
    } catch {
      break;
    }
  }
  const scope = recentWorkspaceScope(workspace);
  return scope === "cad" || scope === "code" ? scope : "mixed";
}

function setWorkspaceType(rawPath: unknown, rawType: unknown): void {
  const workspace = String(rawPath || "").trim();
  if (!workspace) throw new Error("Workspace path is required");
  const resolved = path.resolve(workspace);
  const prefs = loadPrefs();
  const targetKey = normalizedPathKey(resolved);
  if (!prefs.recent_workspaces.some((item) => normalizedPathKey(item) === targetKey)) {
    throw new Error("Workspace is not in the recent list");
  }
  const existing = Object.fromEntries(Object.entries(prefs.workspace_types || {}).filter(
    ([itemPath]) => normalizedPathKey(itemPath) !== targetKey,
  ));
  prefs.workspace_types = { ...existing, [resolved]: normalizeWorkspaceTypeId(rawType) };
  savePrefs(prefs);
}

function isEphemeralWorkspacePath(raw: string): boolean {
  const resolved = path.resolve(raw);
  if (normalizedPathKey(resolved) === normalizedPathKey(REPO_ROOT)) return true;
  const tempRoot = path.resolve(os.tmpdir());
  const relativeToTemp = path.relative(tempRoot, resolved);
  if (!relativeToTemp || (!relativeToTemp.startsWith("..") && !path.isAbsolute(relativeToTemp))) return true;
  return false;
}

function pruneRecentPrefs(prefs: LauncherPrefs): { prefs: LauncherPrefs; removed: number } {
  const kept: string[] = [];
  const seen = new Set<string>();
  let removed = 0;
  for (const raw of prefs.recent_workspaces || []) {
    const value = String(raw || "").trim();
    if (!value) {
      removed += 1;
      continue;
    }
    const resolved = path.resolve(value);
    const key = normalizedPathKey(resolved);
    if (seen.has(key) || !isDir(resolved) || isEphemeralWorkspacePath(resolved)) {
      removed += 1;
      continue;
    }
    seen.add(key);
    kept.push(resolved);
  }
  if (removed) {
    prefs.recent_workspaces = kept;
    const keptKeys = new Set(kept.map(normalizedPathKey));
    prefs.workspace_types = Object.fromEntries(Object.entries(prefs.workspace_types || {}).filter(
      ([itemPath]) => keptKeys.has(normalizedPathKey(itemPath)),
    ));
  }
  return { prefs, removed };
}

function recentWorkspaceScope(workspace: string): string {
  if (!isDir(workspace)) return "all";
  try {
    return loadWorkspaceNavModules(workspace).scope;
  } catch {
    return "all";
  }
}

function launcherPrefsPayload(extra: Record<string, unknown> = {}) {
  // 读取 recent 时保留已失效条目，让 Host/UI 能明确呈现 missing 状态；
  // 真正删除只由 /recent/prune 或用户的单条 remove 动作执行。
  const prefs = loadPrefs();
  const entries = prefs.recent_workspaces.map((raw) => {
    const resolved = path.resolve(raw);
    return {
      path: resolved,
      name: workspaceName(resolved),
      exists: isDir(resolved),
      ephemeral: false,
      module_scope: recentWorkspaceScope(resolved),
      workspace_type_id: workspaceTypeForPath(prefs, resolved),
    };
  });
  return {
    version: prefs.version || 2,
    recent_workspaces: entries.filter((entry) => entry.exists).map((entry) => entry.path),
    recent_workspace_entries: entries,
    freecad_dir: prefs.freecad_dir || "",
    default_freecad_dir: "",
    platform: process.platform,
    shell_layout: normalizeShellLayout(prefs.shell_layout),
    nav_modules: normalizeNavModules(prefs.nav_modules),
    launcher_config_path: PREFS_FILE,
    ...extra,
  };
}

function resolveWorkspaceDirectory(raw: unknown): string {
  const value = String(raw || "").trim();
  if (!value) throw new Error("Workspace path is required");
  const resolved = path.resolve(value);
  if (!isDir(resolved)) throw new Error(`Not a valid directory: ${resolved}`);
  if (normalizedPathKey(resolved) === normalizedPathKey(REPO_ROOT)) {
    throw new Error("The phoenix-desk-tools installation cannot be used as a workspace");
  }
  return resolved;
}

function recordRecentWorkspace(raw: unknown, activate: boolean): LauncherPrefs {
  const resolved = resolveWorkspaceDirectory(raw);
  const prefs = loadPrefs();
  if (!isEphemeralWorkspacePath(resolved)) {
    const targetKey = normalizedPathKey(resolved);
    prefs.recent_workspaces = [
      resolved,
      ...prefs.recent_workspaces.filter((item) => normalizedPathKey(item) !== targetKey),
    ].slice(0, MAX_RECENT_WORKSPACES);
  }
  if (activate) prefs.workspace = resolved;
  savePrefs(prefs);
  return prefs;
}

function removeRecentWorkspaceEntry(raw: unknown): void {
  const value = String(raw || "").trim();
  if (!value) throw new Error("Workspace path is required");
  const targetKey = normalizedPathKey(value);
  const prefs = loadPrefs();
  prefs.recent_workspaces = prefs.recent_workspaces.filter((item) => normalizedPathKey(item) !== targetKey);
  prefs.workspace_types = Object.fromEntries(Object.entries(prefs.workspace_types || {}).filter(
    ([itemPath]) => normalizedPathKey(itemPath) !== targetKey,
  ));
  savePrefs(prefs);
}

type ShellLogLine = { text: string; source: string };
type ShellShutdownHandler = () => void | Promise<void>;
const SHELL_LOG_MAX = 300;
const shellLog: ShellLogLine[] = [];
let shellShutdownHandler: ShellShutdownHandler | null = null;

export function setShellShutdownHandler(handler: ShellShutdownHandler | null): void {
  shellShutdownHandler = handler;
}

function appendShellLogLine(rawText: unknown, rawSource: unknown): void {
  const text = String(rawText || "").trim();
  if (!text) return;
  shellLog.push({ text, source: String(rawSource || "server") });
  if (shellLog.length > SHELL_LOG_MAX) shellLog.splice(0, shellLog.length - SHELL_LOG_MAX);
}

function onboardingStatusPayload() {
  const prefs = loadPrefs();
  const workspace = currentWorkspace();
  const freecadOk = hasSafeFreecadCommand(prefs.freecad_dir);
  if (!workspace) {
    return {
      workspace_ok: false,
      workspace_path: "",
      freecad_ok: freecadOk,
      index_scanned: false,
      last_scan_at: "",
    };
  }
  const workspaceKey = normalizedPathKey(workspace);
  const configured = prefs.recent_workspaces.some((entry) => {
    return !isEphemeralWorkspacePath(entry) && normalizedPathKey(entry) === workspaceKey;
  });
  let readable = false;
  try {
    fs.accessSync(workspace, fs.constants.R_OK);
    readable = true;
  } catch {
    readable = false;
  }
  const workspaceOk = isDir(workspace) && readable && configured;
  let lastScanAt = "";
  let indexScanned = false;
  if (workspaceOk) {
    try {
      const status = loadCadIndexStatus(workspace);
      lastScanAt = status.lastScanAt;
      indexScanned = status.indexed;
    } catch {
      // A damaged or migration-era index should not prevent onboarding from loading.
    }
  }
  return {
    workspace_ok: workspaceOk,
    workspace_path: workspace,
    freecad_ok: freecadOk,
    index_scanned: indexScanned,
    last_scan_at: lastScanAt,
  };
}

function emptyPhoenixDatabaseStatus() {
  return {
    legacy_detected: false,
    needs_recreate: false,
    reasons: [],
    old_tables_found: [],
    legacy_file_exists: false,
    database_exists: false,
    database_path: "",
    legacy_database_path: "",
    legacy_database_paths: [],
    database_filename: "phoenix-workspace.sqlite",
    legacy_database_filename: "cad-database.sqlite",
    legacy_database_filenames: ["cad-database.sqlite", "phoenix-cad.sqlite"],
    expected_schema_version: PHOENIX_SCHEMA_VERSION,
    schema_version: null,
    database_path_display: "",
  };
}

function loadTestFixtureCatalog(): any[] {
  try {
    const data = JSON.parse(fs.readFileSync(TEST_FIXTURE_CATALOG_PATH, "utf-8"));
    return Array.isArray(data.projects) ? data.projects : [];
  } catch {
    return [];
  }
}

function updateTestFixturePrefs(body: any): LauncherPrefs {
  const prefs = loadPrefs();
  const block: TestFixturePrefs = { ...(prefs.test_fixtures || {}) };
  if (body && Object.prototype.hasOwnProperty.call(body, "enabled")) {
    block.enabled = normalizeEnabled(body.enabled);
  }
  if (body && Object.prototype.hasOwnProperty.call(body, "checkout_root")) {
    const raw = String(body.checkout_root || "").trim();
    if (!raw) {
      block.checkout_root = null;
    } else {
      const resolved = path.resolve(raw);
      if (!isDir(resolved)) throw new Error(`Not a valid directory: ${resolved}`);
      block.checkout_root = resolved;
    }
  }
  prefs.test_fixtures = block;
  savePrefs(prefs);
  return prefs;
}

function testFixturesPayload() {
  const prefs = loadPrefs();
  const block = prefs.test_fixtures || {};
  const defaultCheckoutRoot = runtimeTestFixtureCheckoutRoot();
  fs.mkdirSync(defaultCheckoutRoot, { recursive: true });
  const savedRoot = block.checkout_root ? path.resolve(String(block.checkout_root)) : "";
  const checkoutRoot = savedRoot && isDir(savedRoot) ? savedRoot : defaultCheckoutRoot;
  const enabled = normalizeEnabled(block.enabled);
  const enabledSet = new Set(enabled);
  const items = loadTestFixtureCatalog().map((entry) => {
    const name = String(entry?.name || "").trim();
    const target = path.join(checkoutRoot, name);
    const exists = Boolean(name) && isDir(target) && fs.existsSync(path.join(target, ".git"));
    return {
      name,
      description: String(entry?.description || ""),
      clone_url: String(entry?.clone_url || ""),
      enabled: enabledSet.has(name),
      checkout_path: target,
      checkout_exists: exists,
      link_status: exists ? "ok" : "missing",
      link_detail: exists ? `Already checked out at ${target}` : `Not checked out under ${checkoutRoot}`,
      symlink_path: "",
      target_path: target,
    };
  });
  return {
    checkout_root: checkoutRoot,
    default_checkout_root: defaultCheckoutRoot,
    enabled,
    repo_root: REPO_ROOT,
    catalog_path: TEST_FIXTURE_CATALOG_PATH,
    catalog_kind: "builtin",
    user_prefs_path_hint: "launcher-prefs.json -> test_fixtures",
    items,
  };
}

function currentWorkspace(): string {
  const prefs = loadPrefs();
  if (typeof prefs.workspace === "string") {
    const resolved = prefs.workspace ? path.resolve(prefs.workspace) : "";
    return resolved && isDir(resolved) ? resolved : "";
  }
  for (const recent of prefs.recent_workspaces) {
    const resolved = path.resolve(recent);
    if (isDir(resolved) && !isEphemeralWorkspacePath(resolved)) return resolved;
  }
  return "";
}


interface TreeNode { name: string; path: string; type: "dir" | "file"; children?: TreeNode[]; }

function buildFileTree(base: string, rel: string, exts: string[]): TreeNode | null {
  const full = rel ? path.join(base, rel) : base;
  if (!fs.existsSync(full)) return null;
  const stat = fs.statSync(full);
  if (stat.isFile()) {
    if (exts.length && !exts.some((e) => full.endsWith(e))) return null;
    return { name: path.basename(full), path: rel || full, type: "file" };
  }
  if (!stat.isDirectory()) return null;
  const children: TreeNode[] = [];
  try {
    for (const entry of fs.readdirSync(full)) {
      if (entry.startsWith(".") || entry === "__pycache__") continue;
      const child = buildFileTree(base, rel ? `${rel}/${entry}` : entry, exts);
      if (child) children.push(child);
    }
  } catch { /* skip unreadable dirs */ }
  children.sort((a, b) => {
    if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return { name: path.basename(full), path: rel || full, type: "dir", children };
}

function countFiles(tree: TreeNode | null): number {
  if (!tree) return 0;
  if (tree.type === "file") return 1;
  return (tree.children || []).reduce((s, c) => s + countFiles(c), 0);
}

function readAppConfig() {
  try {
    const raw = JSON.parse(fs.readFileSync(APP_CONFIG_PATH, "utf-8"));
    const app = raw?.app && typeof raw.app === "object" ? raw.app : {};
    return {
      title: String(app.title || "Phoenix 桌面工具"),
      navigation: Array.isArray(raw?.navigation) ? raw.navigation : [],
      toolbar: raw?.toolbar && typeof raw.toolbar === "object" ? raw.toolbar : { items: [] },
      workbench: raw?.workbench && typeof raw.workbench === "object" ? raw.workbench : {},
      // Keep the legacy field name while reporting the current SQLite owner.
      workspace_dotfile: ".phoenix/phoenix-workspace.sqlite",
      launcher_config_path: PREFS_FILE,
    };
  } catch {
    return {
      title: "Phoenix 桌面工具",
      navigation: [],
      toolbar: { items: [] },
      workbench: {},
      workspace_dotfile: ".phoenix/phoenix-workspace.sqlite",
      launcher_config_path: PREFS_FILE,
    };
  }
}

export const shellRoutes = new Hono();

// ── 配置 ──────────────────────────────────────────────

shellRoutes.get("/api/config/app", (c) => c.json(readAppConfig()));

shellRoutes.get("/api/config/launcher", (c) => c.json(launcherPrefsPayload()));

shellRoutes.get("/api/config/launcher/nav-modules", (c) => c.json(normalizeNavModules(loadPrefs().nav_modules)));
shellRoutes.patch("/api/config/launcher/nav-modules", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const navModules = normalizeNavModules(body?.enabled);
  const prefs = loadPrefs();
  prefs.nav_modules = navModules;
  savePrefs(prefs);
  return c.json(navModules);
});
shellRoutes.get("/api/config/launcher/shell-layout", (c) => {
  return c.json(normalizeShellLayout(loadPrefs().shell_layout));
});
shellRoutes.patch("/api/config/launcher/shell-layout", async (c) => {
  const patch = sanitizeShellLayoutPatch(await c.req.json().catch(() => ({})));
  if (!Object.keys(patch).length) return c.json({ detail: "No valid shell layout fields" }, 400);
  const prefs = loadPrefs();
  prefs.shell_layout = { ...normalizeShellLayout(prefs.shell_layout), ...patch };
  savePrefs(prefs);
  return c.json(prefs.shell_layout);
});
shellRoutes.post("/api/config/launcher/freecad", async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const freecadDir = normalizeFreecadDirectoryPreference(body?.path);
    const prefs = loadPrefs();
    prefs.freecad_dir = freecadDir;
    savePrefs(prefs);
    return c.json({ freecad_dir: freecadDir });
  } catch (e: any) {
    return c.json({ detail: e.message || String(e) }, 400);
  }
});
shellRoutes.post("/api/config/launcher/recent/add", async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    recordRecentWorkspace(body?.path, false);
    return c.json(launcherPrefsPayload());
  } catch (e: any) {
    return c.json({ detail: e.message || String(e) }, 400);
  }
});
shellRoutes.post("/api/config/launcher/recent/remove", async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    removeRecentWorkspaceEntry(body?.path);
    return c.json(launcherPrefsPayload());
  } catch (e: any) {
    return c.json({ detail: e.message || String(e) }, 400);
  }
});
shellRoutes.patch("/api/config/launcher/recent/workspace-type", async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    setWorkspaceType(body?.path, body?.workspace_type_id);
    return c.json(launcherPrefsPayload());
  } catch (e: any) {
    return c.json({ detail: e.message || String(e) }, 400);
  }
});
shellRoutes.post("/api/config/launcher/recent/prune", (c) => {
  const result = pruneRecentPrefs(loadPrefs());
  if (result.removed) savePrefs(result.prefs);
  return c.json(launcherPrefsPayload({ pruned_count: result.removed }));
});
shellRoutes.post("/api/config/launcher/reset-factory", (c) => {
  savePrefs(factoryPrefs());
  return c.json(launcherPrefsPayload());
});

shellRoutes.get("/api/test-fixtures", (c) => c.json(testFixturesPayload()));
shellRoutes.put("/api/test-fixtures", async (c) => {
  try {
    updateTestFixturePrefs(await c.req.json());
    return c.json(testFixturesPayload());
  } catch (e: any) {
    return c.json({ detail: e.message || String(e) }, 400);
  }
});
shellRoutes.post("/api/test-fixtures/sync", async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    updateTestFixturePrefs(body);
    const payload = testFixturesPayload();
    const enabled = normalizeEnabled(payload.enabled);
    const requested = Object.prototype.hasOwnProperty.call(body, "names")
      ? normalizeEnabled(body.names)
      : enabled;
    if (requested.some((name) => !enabled.includes(name))) {
      throw new Error("Requested fixtures must be enabled before checkout");
    }
    const syncResults = syncTestFixtureCheckouts({
      checkoutRoot: payload.checkout_root,
      enabled: requested,
      catalog: loadTestFixtureCatalog(),
    });
    return c.json({ ...testFixturesPayload(), sync_results: syncResults });
  } catch (e: any) {
    return c.json({ detail: e.message || String(e) }, 400);
  }
});

shellRoutes.post("/api/config/pick-workspace-directory", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const dir = await pickDirectoryNative(body?.path_hint, currentWorkspace());
  if (dir) return c.json({ cancelled: false, path: dir });
  return c.json({ cancelled: true, path: "" });
});

// ── 工作空间 ──────────────────────────────────────────

shellRoutes.get("/api/workspace", (c) => {
  const workspace = currentWorkspace();
  const prefs = loadPrefs();
  return c.json({
    path: workspace,
    name: workspaceName(workspace),
    workspace_type_id: workspace ? workspaceTypeForPath(prefs, workspace) : undefined,
  });
});

shellRoutes.post("/api/workspace", async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const prefs = recordRecentWorkspace(body?.path, true);
    const workspace = currentWorkspace();
    let navModules: WorkspaceNavModules;
    let navWarning = "";
    try {
      navModules = loadWorkspaceNavModules(workspace);
    } catch (error: any) {
      navModules = normalizeWorkspaceNavModules(prefs.nav_modules);
      navWarning = error?.message || String(error);
    }
    return c.json({
      path: workspace,
      name: workspaceName(workspace),
      workspace_type_id: workspaceTypeForPath(prefs, workspace),
      nav_modules: navModules,
      nav_warning: navWarning || undefined,
    });
  } catch (e: any) {
    return c.json({ detail: e.message || String(e) }, 400);
  }
});

shellRoutes.delete("/api/workspace", (c) => {
  const p = loadPrefs();
  p.workspace = "";
  savePrefs(p);
  return c.json({ status: "closed" });
});

shellRoutes.get("/api/workspace/nav-modules", (c) => {
  try {
    const requested = String(c.req.query("path") || "").trim();
    const workspace = requested ? resolveWorkspaceDirectory(requested) : currentWorkspace();
    if (!workspace) throw new Error("Workspace is not configured");
    return c.json(loadWorkspaceNavModules(workspace));
  } catch (e: any) {
    return c.json({ detail: e.message || String(e) }, 400);
  }
});
shellRoutes.patch("/api/workspace/nav-modules", async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const workspace = body?.path ? resolveWorkspaceDirectory(body.path) : currentWorkspace();
    if (!workspace) throw new Error("Workspace is not configured");
    return c.json(saveWorkspaceNavModules(workspace, body));
  } catch (e: any) {
    return c.json({ detail: e.message || String(e) }, 400);
  }
});

// ── 其他 shell ────────────────────────────────────────

shellRoutes.get("/api/health", (c) => c.json({
  status: "ok",
  service: "phoenix-node",
  protocol_version: 1,
  app_version: DESK_TOOLS_APP_VERSION,
}));
shellRoutes.get("/api/onboarding/status", (c) => c.json(onboardingStatusPayload()));
shellRoutes.get("/api/phoenix/database/status", (c) => {
  const workspace = currentWorkspace();
  if (!workspace) return c.json(emptyPhoenixDatabaseStatus());
  try {
    return c.json(getPhoenixDatabaseStatus(workspace));
  } catch (e: any) {
    return c.json({ detail: e.message || String(e) }, 400);
  }
});
shellRoutes.post("/api/phoenix/database/recreate", (c) => {
  try {
    return c.json(recreatePhoenixDatabase(currentWorkspace()));
  } catch (e: any) {
    return c.json({ detail: e.message || String(e), code: e.code || "PHOENIX_DATABASE_RECREATE_DISABLED" }, 409);
  }
});

shellRoutes.get("/api/workbench/session", (c) => {
  try {
    return c.json(loadWorkbenchSession(currentWorkspace()));
  } catch (e: any) {
    return c.json({ detail: e.message || String(e) }, 400);
  }
});
shellRoutes.put("/api/workbench/session", async (c) => {
  try {
    return c.json(saveWorkbenchSession(currentWorkspace(), await c.req.json().catch(() => ({}))));
  } catch (e: any) {
    return c.json({ detail: e.message || String(e) }, 400);
  }
});

shellRoutes.get("/api/shell/log", (c) => {
  const parsed = Number(c.req.query("after") || 0);
  const after = Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : 0;
  const start = Math.min(after, shellLog.length);
  return c.json({ lines: shellLog.slice(start), total: shellLog.length });
});
shellRoutes.post("/api/shell/log", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  appendShellLogLine(body?.text, body?.source);
  return c.json({ total: shellLog.length });
});
shellRoutes.post("/api/shutdown", (c) => {
  if (!shellShutdownHandler) return c.json({ detail: "Server shutdown is not available" }, 503);
  const handler = shellShutdownHandler;
  setTimeout(() => {
    Promise.resolve(handler()).catch((error) => {
      console.error("Phoenix server shutdown failed", error);
    });
  }, 100);
  return c.json({ status: "stopping" });
});

// 文件工作集
shellRoutes.get("/api/file-worksets", (c) => c.json(loadFileWorksets(currentWorkspace())));
shellRoutes.put("/api/file-worksets", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  return c.json(saveFileWorksets(currentWorkspace(), body));
});
shellRoutes.post("/api/file-worksets/prune-missing", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  return c.json(pruneMissingFileWorksetPaths(currentWorkspace(), body));
});
shellRoutes.get("/api/file-detail/xrefs", async (c) => {
  const rel = c.req.query("rel") || "";
  const ws = currentWorkspace();
  try {
    if (!rel || !ws) return c.json({
      rel,
      index_pending: true,
      incoming: { count: 0, direct_count: 0, hosts: [] },
      outgoing: { count: 0, label_mismatch_count: 0, refs: [] },
    });
    if (c.req.query("refresh_disk") === "true") {
      refreshBomXrefForHost(ws, rel, { recursive: false });
    }
    return c.json(fileDetailXrefs(ws, rel, {
      limit: Number(c.req.query("limit") || 500),
      transitive: c.req.query("transitive") === "true",
      scope: (c.req.query("scope") as any) || "both",
    }));
  } catch (e: any) {
    return c.json({
      rel,
      index_pending: true,
      incoming: { count: 0, direct_count: 0, hosts: [] },
      outgoing: { count: 0, label_mismatch_count: 0, refs: [] },
      error: e.message || String(e),
    });
  }
});
shellRoutes.get("/api/file-rename/context", async (c) => {
  const rel = c.req.query("rel") || "";
  const ws = currentWorkspace();
  if (!rel) return c.json({ detail: "rel is required" }, 400);
  if (!ws) return c.json({ detail: "workspace is required" }, 400);
  try {
    return c.json({
      rel_path: rel,
      preview: loadBomPreview(ws, rel),
      _native: "node",
    });
  } catch (e: any) {
    return c.json({ detail: e.message || String(e) }, 400);
  }
});
shellRoutes.post("/api/file-rename/rename", async (c) => {
  try {
    const ws = currentWorkspace();
    const rel = c.req.query("rel") || "";
    const body = await c.req.json().catch(() => ({}));
    if (/\.fcstd$/i.test(rel)) return c.json(await renameBomFcstdFile(ws, rel, body));
    return c.json(executeDiskFileRename(ws, rel, body));
  } catch (e: any) {
    return c.json({ detail: e.message || String(e) }, 400);
  }
});
shellRoutes.post("/api/file-rename/scan-refs", async (c) => {
  try {
    const ws = currentWorkspace();
    const body = await c.req.json().catch(() => ({}));
    return c.json(analyzeRenameReferences(ws, body));
  } catch (e: any) {
    return c.json({ detail: e.message || String(e) }, 400);
  }
});

// Git
shellRoutes.get("/api/git/info", async (c) => c.json(await gitWorkspaceInfo(currentWorkspace())));
shellRoutes.get("/api/git/changes", async (c) => {
  try { return c.json(await gitWorkspaceChanges(currentWorkspace())); }
  catch (e: any) { return c.json({ detail: e.message || String(e) }, 500); }
});
shellRoutes.get("/api/git/diff", async (c) => {
  try {
    const scope = c.req.query("scope") || "worktree";
    if (scope !== "worktree" && scope !== "staged") throw new Error("scope must be worktree or staged");
    return c.json(await gitWorkspaceDiff(
      currentWorkspace(),
      c.req.query("path") || "",
      scope as GitDiffScope,
    ));
  }
  catch (e: any) { return c.json({ detail: e.message || String(e) }, 400); }
});
shellRoutes.post("/api/git/init", async (c) => {
  try {
    return c.json(await gitWorkspaceInit(currentWorkspace()));
  } catch (e: any) { return c.json({ detail: e.message || String(e) }, 400); }
});
shellRoutes.post("/api/git/stage", async (c) => {
  try {
    const body = await c.req.json();
    return c.json(await gitWorkspaceStage(currentWorkspace(), body?.paths));
  } catch (e: any) { return c.json({ detail: e.message || String(e) }, 400); }
});
shellRoutes.post("/api/git/restore", async (c) => {
  try {
    const body = await c.req.json();
    const scope = String(body?.scope || "worktree");
    if (!["worktree", "staged", "untracked"].includes(scope)) return c.json({ detail: "Invalid scope" }, 400);
    return c.json(await gitWorkspaceRestore(
      currentWorkspace(),
      body?.paths,
      scope as GitRestoreScope,
    ));
  } catch (e: any) { return c.json({ detail: e.message || String(e) }, 400); }
});
shellRoutes.post("/api/git/commit", async (c) => {
  try {
    const body = await c.req.json();
    return c.json(await gitWorkspaceCommit(currentWorkspace(), body?.message));
  } catch (e: any) { return c.json({ detail: e.message || String(e) }, 400); }
});

shellRoutes.get("/api/unit-tests/suites", (c) => {
  try {
    const catalog = discoverUnitTestCatalog();
    ensureRuntimeCatalog(catalog);
    return c.json({ suites: buildUnitTestSuites(catalog) });
  } catch (e: any) {
    return c.json({ detail: e.message || String(e) }, 500);
  }
});
shellRoutes.post("/api/unit-tests/plan", async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const catalog = discoverUnitTestCatalog();
    ensureRuntimeCatalog(catalog);
    return c.json(buildUnitTestPlan(body, catalog));
  } catch (e: any) {
    return c.json({ detail: e.message || String(e) }, 500);
  }
});
shellRoutes.post("/api/unit-tests/run", async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    return c.json(await runUnitTests(body));
  } catch (e: any) {
    return c.json({ detail: e.message || String(e) }, 500);
  }
});
shellRoutes.post("/api/unit-tests/cancel", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const runId = String(body?.run_id || "");
  return c.json({ ok: runId ? cancelUnitTestRun(runId) : false });
});
shellRoutes.post("/api/unit-tests/run/stream", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      const send = (event: any) => controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      runUnitTests(body, send)
        .catch((e: any) => {
          try { send({ type: "error", message: e.message || String(e) }); } catch { /* client disconnected */ }
        })
        .finally(() => {
          try { controller.close(); } catch { /* stream already closed */ }
        });
    },
  });
  return new Response(stream, { status: 200, headers: { "Content-Type": "application/x-ndjson; charset=utf-8" } });
});

shellRoutes.get("/api/runtime-catalog/status", (c) => c.json(runtimeCatalogStatus()));
shellRoutes.post("/api/runtime-catalog/sync", (c) => {
  try {
    const force = c.req.query("force") === "true";
    return c.json(syncRuntimeCatalog(discoverUnitTestCatalog(force)));
  } catch (e: any) {
    return c.json({ detail: e.message || String(e) }, 500);
  }
});
shellRoutes.get("/api/runtime-catalog/search", (c) => {
  try {
    return c.json(searchRuntimeCatalog({
      q: c.req.query("q") || "",
      suite_id: c.req.query("suite_id") || "",
      entity_type: c.req.query("entity_type") || "",
      limit: Number(c.req.query("limit") || 40),
      offset: Number(c.req.query("offset") || 0),
    }));
  } catch (e: any) {
    return c.json({ detail: e.message || String(e) }, 500);
  }
});
shellRoutes.get("/api/runtime-catalog/test-modules", (c) => {
  try {
    const catalog = discoverUnitTestCatalog();
    ensureRuntimeCatalog(catalog);
    return c.json(runtimeTestModuleMap(c.req.queries("modules") || []));
  } catch (e: any) {
    return c.json({ detail: e.message || String(e) }, 500);
  }
});
shellRoutes.get("/api/runtime-catalog/test-cases", (c) => {
  try {
    const catalog = discoverUnitTestCatalog();
    ensureRuntimeCatalog(catalog);
    return c.json(runtimeTestCaseMap(c.req.queries("ids") || []));
  } catch (e: any) {
    return c.json({ detail: e.message || String(e) }, 500);
  }
});

// ── Code 忽略设定（保留）────────────────────────────

// Code 忽略 — 配置读写
shellRoutes.get("/api/code/ignore/prefs", (c) => c.json(getCodeIgnorePrefs(currentWorkspace(), { prefsDir: PREFS_DIR })));
shellRoutes.put("/api/code/ignore/prefs", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  return c.json(saveCodeIgnorePrefs(currentWorkspace(), body, { prefsDir: PREFS_DIR }));
});
shellRoutes.get("/api/code/ignore/suggestions", (c) => c.json(listCodeIgnoreSuggestions(currentWorkspace(), { prefsDir: PREFS_DIR })));


// ── 工作空间文件树 ────────────────────────────────────

shellRoutes.get("/api/tree", (c) => {
  const p = loadPrefs();
  const ws = p.workspace || "";
  if (!ws || !fs.existsSync(ws)) return c.json({ workspace: ws, workspace_name: "", file_count: 0, tree: null });

  const fcstd = c.req.query("fcstd") !== "false";
  const sw = c.req.query("sw") === "true";
  const cpp = c.req.query("cpp") === "true";
  const header = c.req.query("header") === "true";

  const extensions: string[] = [];
  if (fcstd) extensions.push(".fcstd", ".FCStd");
  if (sw) extensions.push(".sldprt", ".SLDPRT", ".sldasm", ".SLDASM");
  if (cpp) extensions.push(".cpp", ".CPP", ".cxx", ".CXX");
  if (header) extensions.push(".h", ".H", ".hpp", ".HPP");

  const tree = buildFileTree(ws, "", extensions);
  return c.json({ workspace: ws, workspace_name: ws.split("/").pop() || ws, file_count: countFiles(tree), tree });
});
