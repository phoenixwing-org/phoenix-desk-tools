/** Shell 路由 — 替代 Python /api/config, /api/workspace 等。
 *  launcher 偏好持久化到 ~/.phoenix/launcher-prefs.json
 */

import { Hono } from "hono";
import { execFile, execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_CONFIG_PATH = path.resolve(__dirname, "../../../phoenix/config/app_config.json");
const PREFS_DIR = path.join(os.homedir(), ".phoenix");
const PREFS_FILE = path.join(PREFS_DIR, "launcher-prefs.json");

// ── 偏好持久化 ────────────────────────────────────────

interface LauncherPrefs { recent_workspaces: string[]; freecad_dir: string; workspace?: string; }

function loadPrefs(): LauncherPrefs {
  try { if (fs.existsSync(PREFS_FILE)) return JSON.parse(fs.readFileSync(PREFS_FILE, "utf-8")); }
  catch { /* ignore */ }
  return { recent_workspaces: [], freecad_dir: "" };
}

function savePrefs(p: LauncherPrefs) {
  if (!fs.existsSync(PREFS_DIR)) fs.mkdirSync(PREFS_DIR, { recursive: true });
  fs.writeFileSync(PREFS_FILE, JSON.stringify(p, null, 2));
}

function addRecent(p: string): LauncherPrefs {
  const prefs = loadPrefs();
  prefs.recent_workspaces = [p, ...prefs.recent_workspaces.filter((x) => x !== p)].slice(0, 10);
  prefs.workspace = p;
  savePrefs(prefs);
  return prefs;
}

// ── 本机目录对话框 ────────────────────────────────────

function pickDirectoryNative(): Promise<string | null> {
  let cmd: string, args: string[];
  if (process.platform === "darwin") {
    cmd = "osascript"; args = ["-e", 'POSIX path of (choose folder with prompt "选择工作空间目录")'];
  } else if (process.platform === "win32") {
    cmd = "powershell"; args = ["-Command", `Add-Type -AssemblyName System.Windows.Forms; $f=New-Object System.Windows.Forms.FolderBrowserDialog; $f.ShowDialog(); $f.SelectedPath`];
  } else {
    cmd = "zenity"; args = ["--file-selection", "--directory", "--title=选择工作空间目录"];
  }
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: 120_000 }, (err, stdout) => {
      if (err) { resolve(null); return; }
      const p = stdout.trim(); resolve(p || null);
    });
  });
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
      if (entry.startsWith(".")) continue;
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
  try { return JSON.parse(fs.readFileSync(APP_CONFIG_PATH, "utf-8")); }
  catch { return { navigation: [] }; }
}

export const shellRoutes = new Hono();

// ── 配置 ──────────────────────────────────────────────

shellRoutes.get("/api/config/app", (c) => c.json(readAppConfig()));

shellRoutes.get("/api/config/launcher", (c) => {
  const p = loadPrefs();
  return c.json({
    version: 1, freecad_dir: p.freecad_dir || "",
    recent_workspaces: p.recent_workspaces,
    recent_workspace_entries: p.recent_workspaces.map((rp) => ({ path: rp, name: rp.split("/").pop() || rp, exists: fs.existsSync(rp) })),
    shell_layout: {}, nav_modules: { enabled: ["cad", "code"] },
    launcher_config_path: PREFS_FILE,
  });
});

shellRoutes.get("/api/config/launcher/nav-modules", (c) => c.json({ enabled: ["cad", "code"] }));
shellRoutes.get("/api/config/launcher/shell-layout", (c) => c.json({}));
shellRoutes.patch("/api/config/launcher/shell-layout", (c) => c.json({}));
shellRoutes.post("/api/config/launcher/freecad", async (c) => {
  const { path: fd } = await c.req.json();
  const p = loadPrefs(); p.freecad_dir = fd || ""; savePrefs(p);
  return c.json({ freecad_dir: fd || "" });
});
shellRoutes.post("/api/config/launcher/recent/add", async (c) => {
  const { path: rp } = await c.req.json();
  return c.json(addRecent(rp || ""));
});
shellRoutes.post("/api/config/launcher/recent/remove", async (c) => {
  const { path: rp } = await c.req.json();
  const p = loadPrefs();
  p.recent_workspaces = p.recent_workspaces.filter((x) => x !== rp);
  savePrefs(p);
  return c.json({});
});
shellRoutes.post("/api/config/launcher/recent/prune", (c) => c.json({}));
shellRoutes.post("/api/config/launcher/reset-factory", (c) => c.json({}));

shellRoutes.post("/api/config/pick-workspace-directory", async (c) => {
  const dir = await pickDirectoryNative();
  if (dir) return c.json({ cancelled: false, path: dir });
  return c.json({ cancelled: true, path: "" });
});

// ── 工作空间 ──────────────────────────────────────────

shellRoutes.get("/api/workspace", (c) => {
  const p = loadPrefs();
  return c.json({ path: p.workspace || "", name: (p.workspace || "").split("/").pop() || "" });
});

shellRoutes.post("/api/workspace", async (c) => {
  const { path: wsPath } = await c.req.json();
  const p = wsPath ? addRecent(wsPath) : loadPrefs();
  return c.json({ path: p.workspace || "", name: (p.workspace || "").split("/").pop() || "" });
});

shellRoutes.get("/api/workspace/nav-modules", (c) => c.json({ enabled: ["cad", "code"] }));
shellRoutes.patch("/api/workspace/nav-modules", (c) => c.json({ enabled: ["cad", "code"] }));

// ── 其他 shell ────────────────────────────────────────

shellRoutes.get("/api/health", (c) => c.json({ status: "ok" }));
shellRoutes.get("/api/onboarding/status", (c) => c.json({ workspace_ok: true, workspace_path: loadPrefs().workspace || "", freecad_ok: false, index_scanned: false, last_scan_at: "" }));
shellRoutes.get("/api/phoenix/database/status", (c) => c.json({ legacy_detected: false, needs_recreate: false, reasons: [], database_exists: false, database_path: "", schema_version: 0 }));
shellRoutes.post("/api/phoenix/database/recreate", (c) => c.json({ status: "ok" }));

shellRoutes.get("/api/workbench/session", (c) => c.json({ tabs: [], active_tab_id: "" }));
shellRoutes.post("/api/workbench/session", (c) => c.json({}));

shellRoutes.get("/api/shell/log", (c) => c.json({ total: 0 }));
shellRoutes.post("/api/shell/log", (c) => c.json({ total: 0 }));
shellRoutes.post("/api/shutdown", (c) => c.json({ status: "ok" }));

// 文件工作集
shellRoutes.get("/api/file-worksets", (c) => c.json({ worksets: [] }));
shellRoutes.put("/api/file-worksets", (c) => c.json({}));
shellRoutes.post("/api/file-worksets/prune-missing", (c) => c.json({}));
shellRoutes.post("/api/file-rename/scan-refs", (c) => c.json({}));

// Git
shellRoutes.get("/api/git/info", (c) => c.json({ git_root: "", git_root_display: "", branch: "", has_changes: false }));
shellRoutes.get("/api/git/changes", (c) => c.json({ files: [] }));
shellRoutes.post("/api/git/init", (c) => c.json({ ok: true, git_root: "", git_root_display: "" }));
shellRoutes.post("/api/git/stage", (c) => c.json({ staged: [] }));
shellRoutes.post("/api/git/restore", (c) => c.json({ restored: [], scope: "" }));
shellRoutes.post("/api/git/commit", (c) => c.json({ hash: "", message: "" }));

// Unit tests
shellRoutes.get("/api/unit-tests/suites", (c) => {
  // 扫描 tests/ 目录获取实际 Python 测试模块
  const testDir = path.resolve(__dirname, "../../../tests");
  const suites: any[] = [];
  try {
    const files = fs.readdirSync(testDir).filter(f => f.startsWith("test_") && f.endsWith(".py"));
    // 按模块分类
    const cadTests = files.filter(f => /test_(fcstd|bom|part|cad|xlink|rename|dedup|batch|solidworks|default_freecad)/.test(f));
    const codeTests = files.filter(f => /test_(code|reorder|text_encoding|encoding|process|workset)/.test(f));
    const sysTests = files.filter(f => !cadTests.includes(f) && !codeTests.includes(f));
    const groups = [
      { id: "cad", label: "CAD 模块", desc: "FCStd / BOM / 零件 / 扫描 / 改名", modules: cadTests, backend: "python" },
      { id: "code", label: "Code 模块", desc: "代码索引 / 改名 / UUID / 重排", modules: codeTests, backend: "python" },
      { id: "system", label: "系统与配置", desc: "启动器 / 工作空间 / Git / 偏好", modules: sysTests, backend: "python" },
    ];
    for (const g of groups) {
      if (g.modules.length) suites.push({
        id: g.id, label: g.label, description: g.desc,
        module_count: g.modules.length, modules: g.modules.map(m => `tests.${m.replace(/\.py$/, "")}`),
        backend: g.backend,
      });
    }
  } catch { /* no tests dir */ }
  return c.json({ suites });
});
shellRoutes.post("/api/unit-tests/plan", (c) => c.json({ plan_id: "native", modules: [], _stub: true }));
shellRoutes.post("/api/unit-tests/run", (c) => c.json({
  ok: false,
  suite_id: "all",
  suite_label: "全部",
  duration_ms: 0,
  summary: { tests_run: 0, passed: 0, failed: 0, errors: 0, skipped: 0, modules: 0 },
  results: [],
  _note: "Python 单元测试需 python 后端。TS 测试请用 npx vitest。",
}));
shellRoutes.post("/api/unit-tests/cancel", (c) => c.json({ ok: true }));
shellRoutes.post("/api/unit-tests/run/stream", (c) => {
  console.log("[shell] unit-tests/run/stream called");
  const t0 = Date.now();
  const events: string[] = [];
  let testCount = 0, passCount = 0, failCount = 0;
  const modules: string[] = [];

  events.push(JSON.stringify({ type: "start", run_id: "native", total_modules: 9, total_cases: 43, suite_label: "TS 单元测试", load_errors: [] }));

  try {
    const cwd = path.resolve(__dirname, "../..");
    let output = "";
    try {
      output = execSync("pnpm vitest run --reporter verbose src/lib/", { cwd, encoding: "utf8", timeout: 60_000, env: { ...process.env, CI: "true" } });
    } catch (e: any) { output = e.stdout || e.stderr || e.message || ""; }
    console.log("[shell] vitest done", output.length, "bytes");

    for (const line of output.split("\n")) {
      const t = line.trim(); if (!t) continue;
      const caseMatch = t.match(/^\s*([✓×])\s+(.+?)\s+(\d+)ms$/);
      if (!caseMatch) continue;
      const status = caseMatch[1] === "✓" ? "passed" : "failed";
      const fullName = caseMatch[2]; const duration = parseInt(caseMatch[3]);
      if (status === "passed") { testCount++; passCount++; }
      else { testCount++; failCount++; }
      const name = fullName.includes(" > ") ? fullName.split(" > ").pop()!.trim() : fullName;
      const mod = fullName.includes(" > ") ? fullName.split(" > ")[0].trim() : "";
      if (mod && !modules.includes(mod)) modules.push(mod);
      events.push(JSON.stringify({
        type: "case_done", completed: testCount, total: 43,
        case: { id: name, method: name, module: mod, suite_id: "ts", class_name: "", status, duration_ms: duration },
      }));
    }

    console.log("[shell] parsed", testCount, "tests,", events.length, "events");
    const ok = failCount === 0;
    events.push(JSON.stringify({ type: "done", result: {
      ok, suite_id: "all", suite_label: "TS 单元测试", duration_ms: Date.now() - t0,
      summary: { tests_run: testCount, passed: passCount, failed: failCount, errors: 0, skipped: 0, modules: modules.length },
      results: [], cases: [], modules: [], failures: [],
    }}));
  } catch (e: any) {
    events.push(JSON.stringify({ type: "error", message: e.message }));
    events.push(JSON.stringify({ type: "done", result: { ok: false, suite_id: "all", suite_label: "全部", duration_ms: 0, summary: { tests_run: 0, passed: 0, failed: 1, errors: 1, skipped: 0, modules: 0 }, results: [], cases: [], modules: [], failures: [] } }));
  }

  return new Response(events.join("\n") + "\n", { status: 200, headers: { "Content-Type": "text/plain; charset=utf-8" } });
});

// Workbench session PUT
shellRoutes.put("/api/workbench/session", (c) => c.json({}));
shellRoutes.get("/api/runtime-catalog/test-modules", (c) => c.json({ modules: [] }));
shellRoutes.get("/api/runtime-catalog/test-cases", (c) => c.json({ cases: [] }));

// ── Code 模块（原生实现 / 迁移中）────────────────────

const emptyPage = { entries: [], total: 0, offset: 0, limit: 100 };

// Code 索引 — 扫描工作空间源码文件
shellRoutes.get("/api/code/index", (c) => c.json({ exists: false, stats: {}, entries: [] }));
shellRoutes.get("/api/code/index/catdlg", (c) => c.json({ groups: [] }));
shellRoutes.post("/api/code/index/scan", async (c) => {
  const p = loadPrefs(); const ws = p.workspace || "";
  if (!ws) return c.json({ ...emptyPage });
  try {
    const { codeAssetKind, isCodeIndexFilename } = await import("../lib/pdtCodeService.js");
    const entries: any[] = [];
    function walk(dir: string) {
      const items = fs.readdirSync(dir, { withFileTypes: true });
      for (const e of items) {
        if (e.isDirectory()) { if (!e.name.startsWith(".") && e.name !== "node_modules") walk(path.join(dir, e.name)); }
        else if (e.isFile() && isCodeIndexFilename(e.name)) {
          const abs = path.join(dir, e.name);
          const kind = codeAssetKind(e.name) || "other";
          entries.push({ repo_rel_path: path.relative(ws, abs), filename: e.name, asset_kind: kind });
        }
      }
    }
    walk(ws);
    return c.json({ entries, total: entries.length, offset: 0, limit: entries.length });
  } catch { return c.json({ ...emptyPage }); }
});
shellRoutes.get("/api/code/index/entries", (c) => c.json({ ...emptyPage }));
shellRoutes.get("/api/code/index/extension-discovery", (c) => c.json({ extensions: [] }));
shellRoutes.get("/api/code/index/extra-extensions", (c) => c.json({ extra_extensions: [] }));
shellRoutes.put("/api/code/index/extra-extensions", (c) => c.json({ extra_extensions: [] }));
shellRoutes.post("/api/code/index/purge-missing", (c) => c.json({ ...emptyPage }));
shellRoutes.post("/api/code/index/export-json", (c) => c.json({ path: "" }));

// Code 忽略 — 配置读写
const CODE_IGNORE_FILE = path.join(PREFS_DIR, "code-ignore.json");
function loadCodeIgnore(): any { try { return JSON.parse(fs.readFileSync(CODE_IGNORE_FILE, "utf-8")); } catch { return { customPatterns: [], presetPatterns: ["build-*", "node_modules", ".git"] }; } }
function saveCodeIgnore(d: any) { if (!fs.existsSync(PREFS_DIR)) fs.mkdirSync(PREFS_DIR, { recursive: true }); fs.writeFileSync(CODE_IGNORE_FILE, JSON.stringify(d, null, 2)); }
shellRoutes.get("/api/code/ignore/prefs", (c) => c.json(loadCodeIgnore()));
shellRoutes.put("/api/code/ignore/prefs", async (c) => { const b = await c.req.json(); saveCodeIgnore(b); return c.json(b); });
shellRoutes.get("/api/code/ignore/suggestions", (c) => c.json({ suggestions: [] }));

// Code 改名/UUID/重排 — 算法待迁移，返回正确空结构
shellRoutes.get("/api/code/rename/prefs", (c) => c.json({ levels: ["file", "text"], target_encoding: "utf-8" }));
shellRoutes.put("/api/code/rename/prefs", async (c) => { const b = await c.req.json(); return c.json(b); });
shellRoutes.post("/api/code/rename/preview", (c) => c.json({ files: 0, matches: 0, changes: [], summary: { files: 0, hits: 0 } }));
shellRoutes.post("/api/code/rename/apply", (c) => c.json({ applied: 0, files: 0 }));

shellRoutes.post("/api/code/uuid/scan", (c) => c.json({ hits: [], total: 0 }));
shellRoutes.post("/api/code/uuid/apply", (c) => c.json({ applied: 0 }));

shellRoutes.get("/api/code/reorder-members/prefs", (c) => c.json({ scope: "all" }));
shellRoutes.put("/api/code/reorder-members/prefs", async (c) => { const b = await c.req.json(); return c.json(b); });
shellRoutes.post("/api/code/reorder-members/resolve", (c) => c.json({ entries: [] }));
shellRoutes.post("/api/code/reorder-members/run", (c) => c.json({ changed: 0, files: [] }));
shellRoutes.post("/api/code/reorder-members/self-test", (c) => c.json({ ok: true }));
shellRoutes.get("/api/code/reorder-members/top-level", (c) => c.json({ dirs: [] }));

shellRoutes.get("/api/caa/index", (c) => c.json({ groups: [] }));

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

