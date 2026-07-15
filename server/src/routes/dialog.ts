import fs from "node:fs/promises";
import path from "node:path";
import {
  caaDialogGroupKey,
  caaDialogGroupLabel,
  extractCatDlgDialogName,
  patchCatNls,
  patchCatDlgGridLayout,
  emitCatDlg,
  PNX_BOM_ANALYSIS_DEMO,
  emitCatNlsFile,
  buildLocaleNlsInitialKeys,
  inferLocaleCatNlsRel,
  CAA_NLS_LOCALE_SIMPLIFIED_CHINESE,
  parseCatNls,
  emitCatDlgText,
  collectCatNlsKeysFromNode,
  patchWizardHeaderDeclarations,
  patchWizardCppConstruction,
  validateCaaDialogIrRoot,
  type CaaDialogNode,
  type GridLayoutPatch,
} from "@desk-tools/catdlg-core";
import { findRepoRoot } from "@desk-tools/catdlg-core/node";
import { Hono } from "hono";
import { parseDialogFull } from "../parseDialogFull.js";
import { walkCatDlgRelPaths } from "../scanWorkspaceCatDlg.js";
import { caaLog } from "../caaLog.js";
import {
  loadCaaDialogIndex,
  scanCaaDialogIndex,
} from "../lib/caaIndexService.js";
import { runtimeUserDataDir } from "../lib/appRuntimePaths.js";
import {
  enqueueCaaDialogOpenPayload,
  acknowledgeCaaDialogOpenRequests,
  listCaaDialogOpenRequests,
} from "../lib/caaDialogOpenRequestService.js";

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

async function directoryExists(dirPath: string): Promise<boolean> {
  try {
    return (await fs.stat(dirPath)).isDirectory();
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

async function loadWorkspaceRootFromPrefs(): Promise<string> {
  try {
    const prefsPath = path.join(runtimeUserDataDir(), "launcher-prefs.json");
    const raw = JSON.parse(await fs.readFile(prefsPath, "utf8"));
    return String(raw.workspace || "").trim();
  } catch {
    return "";
  }
}

async function resolveIndexWorkspaceRoot(c: any, body?: { workspaceRoot?: string; workspace?: string }): Promise<string> {
  const fromBody = String(body?.workspaceRoot || body?.workspace || "").trim();
  if (fromBody) return fromBody;
  const fromQuery = String(c.req.query("workspaceRoot") || c.req.query("workspace") || "").trim();
  if (fromQuery) return fromQuery;
  return loadWorkspaceRootFromPrefs();
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
    patches?: GridLayoutPatch[];
  };
  const root = body.workspaceRoot?.trim();
  const catDlgRel = body.catDlgRel?.trim();
  const rootNode = body.root;
  const patches = Array.isArray(body.patches) ? body.patches : [];
  if (!root || !catDlgRel || (!rootNode && !patches.length)) {
    return c.json({ error: "workspaceRoot, catDlgRel 以及 root/patches 必填" }, 400);
  }
  caaLog("POST /save-dialog", { root, catDlgRel });
  try {
    const abs = resolveUnderRoot(root, catDlgRel);
    const emitted = rootNode
      ? emitCatDlg(rootNode as any)
      : patchCatDlgGridLayout(await readUtf8(abs), patches);
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

dialogRoutes.post("/write", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    workspaceRoot?: string;
    catDlgRel?: string;
    catNlsRel?: string;
    headerRel?: string;
    cppRel?: string;
    ir?: {
      root?: unknown;
      dialogName?: string;
      sources?: { catDlg?: string; catNls?: string; header?: string; cpp?: string };
    };
    dryRun?: boolean;
    nlsKeys?: Record<string, string>;
    sourceText?: string;
  };

  const root = body.workspaceRoot?.trim();
  const ir = body.ir;
  const rootNode = ir?.root as CaaDialogNode | undefined;
  const catDlgRel = (body.catDlgRel || ir?.sources?.catDlg || "").trim().replace(/\\/g, "/");
  const catNlsRel = (body.catNlsRel || ir?.sources?.catNls || "").trim().replace(/\\/g, "/");
  const headerRel = (body.headerRel || ir?.sources?.header || "").trim().replace(/\\/g, "/");
  const cppRel = (body.cppRel || ir?.sources?.cpp || "").trim().replace(/\\/g, "/");
  const dryRun = Boolean(body.dryRun);
  if (!root || !catDlgRel || !rootNode) {
    return c.json({ error: "workspaceRoot, catDlgRel, ir.root 必填" }, 400);
  }

  const validation = validateCaaDialogIrRoot(rootNode);
  if (validation.errors.length) {
    return c.json({ error: validation.errors.join("；"), validation }, 400);
  }

  try {
    const catDlgAbs = resolveUnderRoot(root, catDlgRel);
    if (!(await pathExists(catDlgAbs))) {
      return c.json({ error: `.CATDlg 不存在：${catDlgRel}` }, 404);
    }

    const nextCatDlgText = emitCatDlgText(rootNode, { dialogName: ir?.dialogName || rootNode.id });
    const prevCatDlgText = await readUtf8(catDlgAbs);
    const catDlgChanged = prevCatDlgText !== nextCatDlgText;

    let catNlsAbs = "";
    let nextCatNlsText = "";
    let prevCatNlsText = "";
    let catNlsChanged = false;
    if (catNlsRel && body.nlsKeys && Object.keys(body.nlsKeys).length > 0) {
      catNlsAbs = resolveUnderRoot(root, catNlsRel);
      if (!(await pathExists(catNlsAbs))) {
        return c.json({ error: `.CATNls 不存在：${catNlsRel}` }, 404);
      }
      prevCatNlsText = body.sourceText?.length ? body.sourceText : await readUtf8(catNlsAbs);
      nextCatNlsText = patchCatNls(
        prevCatNlsText,
        Object.entries(body.nlsKeys).map(([key, value]) => ({ key, value })),
      );
      catNlsChanged = prevCatNlsText !== nextCatNlsText;
    }

    let headerAbs = "";
    let nextHeaderText = "";
    let prevHeaderText = "";
    let headerChanged = false;
    if (headerRel) {
      headerAbs = resolveUnderRoot(root, headerRel);
      if (await pathExists(headerAbs)) {
        prevHeaderText = await readUtf8(headerAbs);
        const patchedHeader = patchWizardHeaderDeclarations(prevHeaderText, rootNode);
        nextHeaderText = patchedHeader.text;
        headerChanged = patchedHeader.changed;
        validation.warnings.push(...patchedHeader.warnings);
      } else {
        validation.warnings.push(`Wizard .h 不存在，跳过声明段写回：${headerRel}`);
        headerAbs = "";
      }
    }

    let cppAbs = "";
    let nextCppText = "";
    let prevCppText = "";
    let cppChanged = false;
    if (cppRel) {
      cppAbs = resolveUnderRoot(root, cppRel);
      if (await pathExists(cppAbs)) {
        prevCppText = await readUtf8(cppAbs);
        const patchedCpp = patchWizardCppConstruction(prevCppText, rootNode);
        nextCppText = patchedCpp.text;
        cppChanged = patchedCpp.changed;
        validation.warnings.push(...patchedCpp.warnings);
      } else {
        validation.warnings.push(`Wizard .cpp 不存在，跳过构造段写回：${cppRel}`);
        cppAbs = "";
      }
    }

    if (!dryRun) {
      if (catDlgChanged) await fs.writeFile(catDlgAbs, nextCatDlgText, "utf8");
      if (catNlsAbs && catNlsChanged) await fs.writeFile(catNlsAbs, nextCatNlsText, "utf8");
      if (headerAbs && headerChanged) await fs.writeFile(headerAbs, nextHeaderText, "utf8");
      if (cppAbs && cppChanged) await fs.writeFile(cppAbs, nextCppText, "utf8");
    }

    caaLog("write OK", {
      catDlgAbs,
      catDlgChanged,
      catNlsAbs: catNlsAbs || undefined,
      catNlsChanged,
      headerAbs: headerAbs || undefined,
      headerChanged,
      cppAbs: cppAbs || undefined,
      cppChanged,
      dryRun,
      warnings: validation.warnings.length,
    });

    return c.json({
      ok: true,
      dryRun,
      validation,
      catDlgRel,
      catNlsRel: catNlsRel || undefined,
      headerRel: headerRel || undefined,
      cppRel: cppRel || undefined,
      absPath: catDlgAbs,
      bytes: nextCatDlgText.length,
      changed: {
        catDlg: catDlgChanged,
        catNls: catNlsChanged,
        header: headerChanged,
        cpp: cppChanged,
      },
      preview: dryRun
        ? {
            catDlg: { before: prevCatDlgText, after: nextCatDlgText },
            catNls: catNlsAbs ? { before: prevCatNlsText, after: nextCatNlsText } : undefined,
            header: headerAbs ? { before: prevHeaderText, after: nextHeaderText } : undefined,
            cpp: cppAbs ? { before: prevCppText, after: nextCppText } : undefined,
          }
        : undefined,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    caaLog(`write 异常: ${msg}`);
    return c.json({ error: msg }, 500);
  }
});

// ── 从 IR 写回 / 创建对话框文件到磁盘 ──

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

    const rootNode = ir.root as unknown as CaaDialogNode | undefined;
    if (!rootNode || typeof rootNode !== "object") {
      return c.json({ error: "ir.root 必须是 CAA 对话框 IR 节点" }, 400);
    }

    const validation = validateCaaDialogIrRoot({ ...rootNode, id: dialogName, type: "CATDlgDialog" });
    if (validation.errors.length) {
      return c.json({ error: validation.errors.join("；"), validation }, 400);
    }

    // 生成合法且可被 parseCatDlg 读回的 .CATDlg。根节点名称以用户输入为准。
    const catDlgText = emitCatDlgText(rootNode, { dialogName });
    await fs.writeFile(catDlgAbs, catDlgText, "utf8");

    // 生成 .CATNls（从 IR 树收集标准 NLS 键）
    const nlsKeys = collectCatNlsKeysFromNode(rootNode);
    if (!nlsKeys.Title) nlsKeys.Title = dialogName;
    const catNlsText = emitCatNlsFile(nlsKeys, {
      headerLines: ["// auto-generated"],
    });
    await fs.writeFile(catNlsAbs, catNlsText, "utf8");

    caaLog("create OK", { catDlgAbs, catNlsAbs, warnings: validation.warnings.length });
    return c.json({ ok: true, catDlgRel, catNlsRel, validation });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    caaLog(`create 异常: ${msg}`);
    return c.json({ error: msg }, 500);
  }
});

export function createCaaApp() {
  const port = Number(process.env.CAA_SERVER_PORT || 5180);
  const app = new Hono();
  app.get("/api/caa/health", (c) =>
    c.json({
      ok: true,
      service: "caa",
      protocol_version: 1,
      port,
      url: `http://127.0.0.1:${port}`,
      proxyPath: "/api/caa",
    }),
  );
  app.get("/api/caa/index/groups", async (c) => {
    try {
      const workspaceRoot = await resolveIndexWorkspaceRoot(c);
      return c.json(loadCaaDialogIndex(workspaceRoot, c.req.query("q")));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return c.json({ error: msg }, 500);
    }
  });
  app.post("/api/caa/index/scan", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { workspaceRoot?: string; workspace?: string };
    try {
      const workspaceRoot = await resolveIndexWorkspaceRoot(c, body);
      return c.json(await scanCaaDialogIndex(workspaceRoot));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return c.json({ error: msg }, 400);
    }
  });
  app.post("/api/caa/dialog/open", async (c) => {
    const body = await c.req.json().catch(() => null);
    try {
      const requests = await enqueueCaaDialogOpenPayload(body, await loadWorkspaceRootFromPrefs());
      return c.json({ accepted: true, requests }, 202);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return c.json({ accepted: false, error: msg }, 400);
    }
  });
  app.get("/api/caa/dialog/open-requests", (c) => c.json({ requests: listCaaDialogOpenRequests() }));
  app.post("/api/caa/dialog/open-requests/ack", async (c) => {
    const body = await c.req.json().catch(() => null) as { ids?: unknown } | null;
    if (!body || !Array.isArray(body.ids) || body.ids.some((id) => !Number.isSafeInteger(id) || Number(id) <= 0)) {
      return c.json({ error: "ids 必须是正整数数组" }, 400);
    }
    return c.json({ acknowledged: acknowledgeCaaDialogOpenRequests(body.ids.map(Number)) });
  });
  app.route("/api/caa/dialog", dialogRoutes);
  return app;
}
