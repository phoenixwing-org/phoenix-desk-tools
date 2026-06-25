import fs from "node:fs/promises";
import path from "node:path";
import {
  caaDialogGroupKey,
  caaDialogGroupLabel,
  extractCatDlgDialogName,
  findRepoRoot,
  patchCatNls,
  emitCatDlg,
  PNX_BOM_ANALYSIS_DEMO,
  emitCatNlsFile,
  buildLocaleNlsInitialKeys,
  inferLocaleCatNlsRel,
  CAA_NLS_LOCALE_SIMPLIFIED_CHINESE,
  parseCatNls,
} from "@phoenix/catdlg-core";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { parseDialogFull } from "../parseDialogFull.js";
import { walkCatDlgRelPaths } from "../scanWorkspaceCatDlg.js";
import { caaLog } from "../caaLog.js";

export const dialogRoutes = new Hono();

export type CaaDialogListItem = {
  catDlgRel: string;
  dialogName: string;
  fileName: string;
  groupKey: string;
  groupLabel: string;
  isDemo?: boolean;
};

export type CaaDialogListGroup = {
  groupKey: string;
  label: string;
  items: CaaDialogListItem[];
};

async function readUtf8(filePath: string): Promise<string> {
  return fs.readFile(filePath, "utf8");
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function resolveUnderRoot(root: string, rel: string): string {
  const base = path.resolve(root);
  const full = path.resolve(base, rel);
  if (full !== base && !full.startsWith(base + path.sep)) {
    throw new Error("path escapes workspace root");
  }
  return full;
}

function buildListItem(catDlgRel: string, dialogName: string): CaaDialogListItem {
  const groupKey = caaDialogGroupKey(catDlgRel);
  return {
    catDlgRel,
    dialogName,
    fileName: path.posix.basename(catDlgRel.replace(/\\/g, "/")),
    groupKey,
    groupLabel: caaDialogGroupLabel(groupKey),
  };
}

function groupListItems(items: CaaDialogListItem[]): CaaDialogListGroup[] {
  const byGroup = new Map<string, CaaDialogListItem[]>();
  for (const item of items) {
    const list = byGroup.get(item.groupKey) ?? [];
    list.push(item);
    byGroup.set(item.groupKey, list);
  }
  return [...byGroup.entries()]
    .sort(([a], [b]) => a.localeCompare(b, undefined, { sensitivity: "base" }))
    .map(([groupKey, groupItems]) => ({
      groupKey,
      label: caaDialogGroupLabel(groupKey),
      items: groupItems.sort((a, b) =>
        a.dialogName.localeCompare(b.dialogName, undefined, { sensitivity: "base" }),
      ),
    }));
}

async function loadDialogName(root: string, catDlgRel: string): Promise<string> {
  try {
    const text = await readUtf8(resolveUnderRoot(root, catDlgRel));
    return extractCatDlgDialogName(text) ?? path.posix.basename(catDlgRel, ".CATDlg");
  } catch {
    return path.posix.basename(catDlgRel, ".CATDlg");
  }
}

dialogRoutes.post("/list", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    workspaceRoot?: string;
    includeDemo?: boolean;
    /** 由 Code 索引等提供的相对路径列表；有则跳过全量 walk */
    rels?: string[];
  };

  const items: CaaDialogListItem[] = [];

  const root = body.workspaceRoot?.trim();
  if (root) {
    try {
      const relsFromBody = Array.isArray(body.rels)
        ? body.rels.map((r) => r.replace(/\\/g, "/").trim()).filter(Boolean)
        : [];
      const rels =
        relsFromBody.length > 0
          ? relsFromBody.filter((r) => r.toLowerCase().endsWith(".catdlg"))
          : await walkCatDlgRelPaths(root);
      for (const rel of rels) {
        const dialogName = await loadDialogName(root, rel);
        items.push(buildListItem(rel, dialogName));
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return c.json({ error: msg }, 500);
    }
  }

  if (body.includeDemo !== false) {
    const repo = findRepoRoot();
    if (repo) {
      const demoDlg = PNX_BOM_ANALYSIS_DEMO.catDlg;
      const demoAbs = path.join(repo, demoDlg);
      if (await pathExists(demoAbs) && !items.some((i) => i.catDlgRel === demoDlg)) {
        const dialogName = await loadDialogName(repo, demoDlg);
        const item = buildListItem(demoDlg, dialogName);
        const inWorkspace = root ? await pathExists(resolveUnderRoot(root, demoDlg)) : false;
        if (!inWorkspace) item.isDemo = true;
        items.push(item);
      }
    }
  }

  const groups = groupListItems(items);
  return c.json({
    workspaceRoot: root ?? "",
    count: items.length,
    groups,
  });
});

dialogRoutes.post("/parse", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    demo?: boolean;
    workspaceRoot?: string;
    catDlgRel?: string;
    catNlsRel?: string;
  };

  caaLog("POST /parse", {
    demo: body.demo,
    workspaceRoot: body.workspaceRoot,
    catDlgRel: body.catDlgRel,
    catNlsRel: body.catNlsRel,
  });

  try {
    if (body.demo) {
      const repo = findRepoRoot();
      if (!repo) {
        return c.json({ error: "无法定位仓库根（需要 phoenix/config/app_config.json）" }, 500);
      }
      const catDlgRel = PNX_BOM_ANALYSIS_DEMO.catDlg;
      const ir = await parseDialogFull({
        readUtf8: readUtf8,
        resolveAbs: (rel) => path.join(repo, rel),
        catDlgRel,
        catDlgAbs: path.join(repo, catDlgRel),
        catNlsRel: PNX_BOM_ANALYSIS_DEMO.catNls,
      });
      if (ir.parseMeta?.resolvedAbs) {
        ir.parseMeta.resolvedAbs.workspaceRoot = repo;
      }
      return c.json(ir);
    }

    const root = body.workspaceRoot?.trim();
    const catDlgRel = body.catDlgRel?.trim();
    if (!root || !catDlgRel) {
      const err = "workspaceRoot 与 catDlgRel 必填，或传 demo: true";
      caaLog(`parse 拒绝: ${err}`);
      return c.json({ error: err }, 400);
    }

    const catDlgAbs = resolveUnderRoot(root, catDlgRel);
    const catDlgOk = await pathExists(catDlgAbs);
    caaLog("parse 路径", { workspaceRoot: root, catDlgRel, catDlgAbs, catDlgExists: catDlgOk });
    if (!catDlgOk) {
      const err = `.CATDlg 不存在：${catDlgRel}（绝对路径 ${catDlgAbs}）。请确认壳层工作空间根目录能拼出该相对路径。`;
      caaLog(`parse 失败: ${err}`);
      return c.json({ error: err }, 404);
    }

    const ir = await parseDialogFull({
      readUtf8: readUtf8,
      resolveAbs: (rel) => resolveUnderRoot(root, rel),
      catDlgRel,
      catDlgAbs,
      workspaceRoot: root,
      catNlsRel: body.catNlsRel?.trim(),
    });
    return c.json(ir);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    caaLog(`parse 异常: ${msg}`);
    return c.json({ error: msg }, 500);
  }
});

dialogRoutes.post("/save-nls", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    workspaceRoot?: string;
    catNlsRel?: string;
    entries?: { key: string; value: string }[];
    sourceText?: string;
  };

  const root = body.workspaceRoot?.trim();
  const catNlsRel = body.catNlsRel?.trim();
  const entries = body.entries;
  if (!root || !catNlsRel) {
    return c.json({ error: "workspaceRoot 与 catNlsRel 必填" }, 400);
  }
  if (!entries || !Array.isArray(entries) || entries.length === 0) {
    return c.json({ error: "entries 不能为空" }, 400);
  }

  caaLog("POST /save-nls", { workspaceRoot: root, catNlsRel, entryCount: entries.length });

  try {
    const abs = resolveUnderRoot(root, catNlsRel);
    if (!(await pathExists(abs))) {
      return c.json({ error: `.CATNls 不存在：${catNlsRel}` }, 404);
    }
    const sourceText =
      body.sourceText?.length ? body.sourceText : await readUtf8(abs);
    const patched = patchCatNls(sourceText, entries);
    await fs.writeFile(abs, patched, "utf8");
    caaLog("save-nls OK", { abs, bytes: patched.length });
    return c.json({
      ok: true,
      catNlsRel,
      absPath: abs,
      bytes: patched.length,
      sourceText: patched,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    caaLog(`save-nls 异常: ${msg}`);
    return c.json({ error: msg }, 500);
  }
});

// ── 保存 .CATDlg（model → 文件完整 emit）──

dialogRoutes.post("/save-dialog", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    workspaceRoot?: string;
    catDlgRel?: string;
    root?: Record<string, unknown>;
  };
  const root = body.workspaceRoot?.trim();
  const catDlgRel = body.catDlgRel?.trim();
  const rootNode = body.root;
  if (!root || !catDlgRel || !rootNode) {
    return c.json({ error: "workspaceRoot, catDlgRel, root 必填" }, 400);
  }
  caaLog("POST /save-dialog", { root, catDlgRel });
  try {
    const abs = resolveUnderRoot(root, catDlgRel);
    const emitted = emitCatDlg(rootNode as any);
    await fs.writeFile(abs, emitted, "utf8");
    caaLog("save-dialog OK", { abs, bytes: emitted.length });
    return c.json({ ok: true, catDlgRel, absPath: abs, bytes: emitted.length });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    caaLog(`save-dialog 异常: ${msg}`);
    return c.json({ error: msg }, 500);
  }
});

const PREVIEW_IMAGE_EXTS = new Set([".png", ".bmp", ".gif", ".jpg", ".jpeg", ".ico", ".svg", ".webp"]);
const PREVIEW_MIME: Record<string, string> = {
  ".png": "image/png",
  ".bmp": "image/bmp",
  ".gif": "image/gif",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
};
const MAX_PREVIEW_TEXT_BYTES = 2 * 1024 * 1024;
const MAX_PREVIEW_IMAGE_BYTES = 8 * 1024 * 1024;

dialogRoutes.post("/file-preview", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    workspaceRoot?: string;
    repoRelPath?: string;
  };

  const root = body.workspaceRoot?.trim();
  const repoRelPath = body.repoRelPath?.trim().replace(/\\/g, "/");
  if (!root || !repoRelPath) {
    return c.json({ error: "workspaceRoot 与 repoRelPath 必填" }, 400);
  }

  caaLog("POST /file-preview", { workspaceRoot: root, repoRelPath });

  try {
    const abs = resolveUnderRoot(root, repoRelPath);
    if (!(await pathExists(abs))) {
      return c.json({ error: `文件不存在：${repoRelPath}` }, 404);
    }
    const stat = await fs.stat(abs);
    const ext = path.extname(abs).toLowerCase();
    const filename = path.posix.basename(repoRelPath);

    if (PREVIEW_IMAGE_EXTS.has(ext)) {
      if (stat.size > MAX_PREVIEW_IMAGE_BYTES) {
        return c.json({ error: `图片过大（${stat.size} 字节），上限 ${MAX_PREVIEW_IMAGE_BYTES}` }, 400);
      }
      const buf = await fs.readFile(abs);
      const mime = PREVIEW_MIME[ext] ?? "application/octet-stream";
      return c.json({
        kind: "image",
        repoRelPath,
        filename,
        sizeBytes: stat.size,
        mime,
        base64: buf.toString("base64"),
      });
    }

    if (stat.size > MAX_PREVIEW_TEXT_BYTES) {
      return c.json({ error: `文本过大（${stat.size} 字节），上限 ${MAX_PREVIEW_TEXT_BYTES}` }, 400);
    }
    const text = await readUtf8(abs);
    return c.json({
      kind: "text",
      repoRelPath,
      filename,
      sizeBytes: stat.size,
      text,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    caaLog(`file-preview 异常: ${msg}`);
    return c.json({ error: msg }, 500);
  }
});

dialogRoutes.post("/create-locale-nls", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    workspaceRoot?: string;
    defaultCatNlsRel?: string;
    localeDir?: string;
    nlsKeys?: Record<string, string>;
  };

  const root = body.workspaceRoot?.trim();
  const defaultCatNlsRel = body.defaultCatNlsRel?.trim().replace(/\\/g, "/");
  const localeDir = body.localeDir?.trim() || CAA_NLS_LOCALE_SIMPLIFIED_CHINESE;
  if (!root || !defaultCatNlsRel) {
    return c.json({ error: "workspaceRoot 与 defaultCatNlsRel 必填" }, 400);
  }

  const catNlsRel = inferLocaleCatNlsRel(defaultCatNlsRel, localeDir);
  caaLog("POST /create-locale-nls", { workspaceRoot: root, defaultCatNlsRel, localeDir, catNlsRel });

  try {
    const abs = resolveUnderRoot(root, catNlsRel);
    if (await pathExists(abs)) {
      return c.json({ error: `语言文件已存在：${catNlsRel}`, catNlsRel }, 409);
    }
    const defaultAbs = resolveUnderRoot(root, defaultCatNlsRel);
    let defaultFlat: Record<string, string> = {};
    if (await pathExists(defaultAbs)) {
      const defaultText = await readUtf8(defaultAbs);
      defaultFlat = parseCatNls(defaultText);
    }
    const nlsKeys =
      body.nlsKeys && Object.keys(body.nlsKeys).length > 0
        ? body.nlsKeys
        : buildLocaleNlsInitialKeys(defaultFlat);
    const sourceText = emitCatNlsFile(nlsKeys, {
      headerLines: [`// ${localeDir} translation`],
    });
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, sourceText, "utf8");
    caaLog("create-locale-nls OK", { abs, keyCount: Object.keys(nlsKeys).length });
    return c.json({
      ok: true,
      localeDir,
      catNlsRel,
      absPath: abs,
      sourceText,
      nlsKeys,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    caaLog(`create-locale-nls 异常: ${msg}`);
    return c.json({ error: msg }, 500);
  }
});

// ── 列出可放置对话框的模块目录 ──

async function collectModuleDirs(workspaceRoot: string): Promise<string[]> {
  const root = path.resolve(workspaceRoot);
  const seen = new Set<string>();

  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > 5) return;
    let entries: import("node:fs").Dirent[];
    try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const ent of entries) {
      if (!ent.isDirectory()) continue;
      const name = ent.name;
      if (name.startsWith(".") || name === "node_modules") continue;
      const full = path.join(dir, name);
      // 目录名包含 . 的是模块目录（如 *UI.m, *.d）
      if (name.includes(".")) {
        const rel = path.relative(root, full).split(path.sep).join("/");
        if (rel && !rel.startsWith("..")) seen.add(rel);
      }
      await walk(full, depth + 1);
    }
  }

  await walk(root, 0);
  return [...seen].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
}

dialogRoutes.get("/dirs", async (c) => {
  const workspaceRoot = c.req.query("workspaceRoot")?.trim();
  if (!workspaceRoot) return c.json({ error: "workspaceRoot 必填" }, 400);
  try {
    const dirs = await collectModuleDirs(workspaceRoot);
    return c.json({ dirs });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ error: msg }, 500);
  }
});

// ── 草稿 CRUD（.phoenix/caa-drafts/）──

const DRAFTS_DIRNAME = "caa-drafts";

function phoenixDraftsDir(workspaceRoot: string): string {
  return path.join(workspaceRoot, ".phoenix", DRAFTS_DIRNAME);
}

dialogRoutes.get("/drafts", async (c) => {
  const workspaceRoot = c.req.query("workspaceRoot")?.trim();
  if (!workspaceRoot) {
    return c.json({ error: "workspaceRoot 必填" }, 400);
  }
  try {
    const dir = phoenixDraftsDir(workspaceRoot);
    if (!(await pathExists(dir))) return c.json({ drafts: [] });
    const files = await fs.readdir(dir);
    const drafts = [];
    for (const f of files) {
      if (!f.endsWith(".json")) continue;
      try {
        const text = await readUtf8(path.join(dir, f));
        drafts.push(JSON.parse(text));
      } catch { /* skip corrupted */ }
    }
    return c.json({ drafts });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ error: msg }, 500);
  }
});

dialogRoutes.post("/drafts", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    workspaceRoot?: string;
    draft?: { id?: string };
  };
  const root = body.workspaceRoot?.trim();
  const draft = body.draft;
  if (!root || !draft?.id) {
    return c.json({ error: "workspaceRoot 与 draft.id 必填" }, 400);
  }
  try {
    const dir = phoenixDraftsDir(root);
    await fs.mkdir(dir, { recursive: true });
    const abs = path.join(dir, `${draft.id}.json`);
    await fs.writeFile(abs, JSON.stringify(draft, null, 2), "utf8");
    return c.json({ ok: true, id: draft.id });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ error: msg }, 500);
  }
});

dialogRoutes.delete("/drafts/:id", async (c) => {
  const workspaceRoot = c.req.query("workspaceRoot")?.trim();
  const id = c.req.param("id");
  if (!workspaceRoot || !id) {
    return c.json({ error: "workspaceRoot 与 id 必填" }, 400);
  }
  try {
    const abs = path.join(phoenixDraftsDir(workspaceRoot), `${id}.json`);
    if (await pathExists(abs)) await fs.unlink(abs);
    return c.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ error: msg }, 500);
  }
});

// ── 从 IR 创建对话框文件到磁盘 ──

dialogRoutes.post("/create", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    workspaceRoot?: string;
    targetDirRel?: string;
    dialogName?: string;
    ir?: Record<string, unknown>;
  };
  const root = body.workspaceRoot?.trim();
  const dirRel = body.targetDirRel?.trim();
  const dialogName = body.dialogName?.trim();
  const ir = body.ir;
  if (!root || !dirRel || !dialogName || !ir) {
    return c.json({ error: "workspaceRoot, targetDirRel, dialogName, ir 必填" }, 400);
  }
  try {
    const targetDir = resolveUnderRoot(root, dirRel);
    await fs.mkdir(targetDir, { recursive: true });

    const catDlgRel = `${dirRel}/${dialogName}.CATDlg`.replace(/\/+/g, "/");
    const catNlsRel = `${dirRel}/${dialogName}.CATNls`.replace(/\/+/g, "/");
    const catDlgAbs = path.join(targetDir, `${dialogName}.CATDlg`);
    const catNlsAbs = path.join(targetDir, `${dialogName}.CATNls`);

    if ((await pathExists(catDlgAbs)) || (await pathExists(catNlsAbs))) {
      return c.json({ error: `文件已存在：${dialogName}.CATDlg 或 .CATNls` }, 409);
    }

    // 生成合法的 .CATDlg
    const style = (ir.root as Record<string, unknown>)?.style as string[] | undefined;
    const styleStr = style?.length ? style.join("|") : "CATDlgWndBtn";
    const catDlgLines: string[] = [];
    catDlgLines.push(`${dialogName} CATDlgDialog`);
    catDlgLines.push("{");
    catDlgLines.push(`  STYLE = ${styleStr};`);
    catDlgLines.push("}");
    catDlgLines.push("");
    await fs.writeFile(catDlgAbs, catDlgLines.join("\n"), "utf8");

    // 生成 .CATNls（从 IR 收集 NLS 键）
    const nlsKeys: Record<string, string> = {};
    function collectNls(node: Record<string, unknown>) {
      const nls = node.nls as Record<string, string> | undefined;
      if (nls) {
        for (const [k, v] of Object.entries(nls)) {
          if (v?.trim()) nlsKeys[k] = v.trim();
        }
      }
      const children = node.children as Record<string, unknown>[] | undefined;
      if (children) for (const child of children) collectNls(child);
    }
    if (ir.root) collectNls(ir.root as Record<string, unknown>);
    const defaultTitleKey = `${dialogName}.Title`;
    if (!nlsKeys[defaultTitleKey]) nlsKeys[defaultTitleKey] = dialogName;
    const catNlsText = emitCatNlsFile(nlsKeys, {
      headerLines: ["// auto-generated"],
    });
    await fs.writeFile(catNlsAbs, catNlsText, "utf8");

    caaLog("create OK", { catDlgAbs, catNlsAbs });
    return c.json({ ok: true, catDlgRel, catNlsRel });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    caaLog(`create 异常: ${msg}`);
    return c.json({ error: msg }, 500);
  }
});

export function createCaaApp() {
  const port = Number(process.env.CAA_SERVER_PORT || 5180);
  const app = new Hono();
  app.use("*", cors());
  app.get("/api/caa/health", (c) =>
    c.json({
      ok: true,
      service: "caa",
      port,
      url: `http://127.0.0.1:${port}`,
      proxyPath: "/api/caa",
    }),
  );
  app.route("/api/caa/dialog", dialogRoutes);
  return app;
}
