/** CAD 模块
 *
 * Node/TypeScript 服务负责 API 编排；SQLite 与 FCStd ZIP/XML 均由 feature service 拥有。
 */

import { Hono } from "hono";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  loadAssemblyTreeFromXrefs,
  patchBomLinkLabels,
  queryXrefCountsForRel,
  refreshBomXrefForHost,
  refreshBomXrefForHostAsync,
  searchIncomingRefs,
  searchOutgoingRefs,
} from "../lib/pnwBomXrefService.js";
import {
  inferPartKeyFromWorkspaceRel,
  loadPartAssemblyTreePayload,
  loadPartKeyDetailPayload,
  loadPartKeysPayload,
  patchPartFileLink,
  patchPartKey,
} from "../lib/pnwPartKeyService.js";
import {
  applyBomLabelFormula,
  fillBomFromEmbedded,
  fillBomFromFilename,
  fillRecommendedValues,
  loadBomApplyPrefs,
  loadBomPreview,
  readBomDocumentKinds,
  recommendBomField,
  recommendBomFieldsAll,
  recommendBomFilename,
  renameBomFcstdFile,
  writeBomToFcstd,
} from "../lib/bomAttributeService.js";
import {
  exportPartDedupCsv,
  getPartDedupPrefs,
  savePartDedupPrefs,
  scanPartDedup,
} from "../lib/pnwPartDedupService.js";
import {
  getStepBatchPrefs,
  previewStepBatch,
  runStepBatch,
  saveStepBatchPrefs,
} from "../lib/pnwStepBatchService.js";
import {
  getSwStepPrefs,
  previewSwStepExport,
  runSwStepExport,
  saveSwStepPrefs,
} from "../lib/pnwSwStepExportService.js";
import {
  analyzeXlinkFix,
  applyXlinkFixOverride,
  getXlinkPrefs,
  listXlinkFixCandidates,
  runXlinkFix,
  saveXlinkPrefs,
} from "../lib/pnwXlinkFixService.js";
import {
  analyzeRenameReferences,
  applyRenameCorrections,
  exportRenameReport,
  listRenameLogs,
  loadRenameAnalysis,
} from "../lib/pnwRenameService.js";
import { runtimeUserDataDir } from "../lib/appRuntimePaths.js";

function getWorkspace(c: any): string {
  const q = c.req.query("workspace") || "";
  if (q) return q;
  try {
    const p = path.join(runtimeUserDataDir(), "launcher-prefs.json");
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, "utf-8")).workspace || "";
  } catch { /* ignore */ }
  return "";
}

// ── helpers ────────────────────────────────────────────

function flattenAssemblyTreeItems(nodes: any[], depth = 0, prefix = ""): any[] {
  const out: any[] = [];
  for (const node of nodes || []) {
    const rel = node.repo_rel_path || node.xlink_file_attr || "";
    const pathKey = prefix ? `${prefix}/${node.basename || rel}` : (node.basename || rel);
    out.push({
      depth,
      part_rel: rel,
      part_key: node.part_key || "",
      quantity: node.ref_count || 1,
      bom_path: pathKey,
      ...node,
    });
    out.push(...flattenAssemblyTreeItems(node.children || [], depth + 1, pathKey));
  }
  return out;
}

// ── Hono app ────────────────────────────────────────────

export const cadRoutes = new Hono();

type BomXrefProgress = {
  scan_id: string;
  phase: string;
  step: number;
  status: string;
  cancelled: boolean;
  error: string;
  total_cad_files: number;
  total_fcstd_files: number;
  walk: { total: number; processed: number; percent: number; current_file?: string };
  bom: { total: number; processed: number; skipped: number; failed: number; current_file: string; percent: number; errors: Array<{ rel: string; error: string }> };
  xref: { total: number; processed: number; skipped: number; failed: number; current_file: string; percent: number; errors: Array<{ rel: string; error: string }> };
  result?: any;
};

const bomXrefProgress = new Map<string, BomXrefProgress>();

function percent(current: number, total: number): number {
  if (total <= 0) return current > 0 ? 100 : 0;
  return Math.max(0, Math.min(100, Math.round((current / total) * 100)));
}

function newBomXrefProgress(scanId: string): BomXrefProgress {
  return {
    scan_id: scanId,
    phase: "walk",
    step: 0,
    status: "running",
    cancelled: false,
    error: "",
    total_cad_files: 0,
    total_fcstd_files: 0,
    walk: { total: 1, processed: 0, percent: 0 },
    bom: { total: 0, processed: 0, skipped: 0, failed: 0, current_file: "", percent: 100, errors: [] },
    xref: { total: 0, processed: 0, skipped: 0, failed: 0, current_file: "", percent: 0, errors: [] },
  };
}

function updateBomXrefProgress(scanId: string, phase: "walk" | "xref", current: number, total: number, currentFile = ""): void {
  const progress = bomXrefProgress.get(scanId);
  if (!progress || progress.cancelled) return;
  progress.phase = phase;
  progress.step = phase === "walk" ? 0 : 2;
  const bucket = progress[phase];
  bucket.total = total;
  bucket.processed = current;
  bucket.percent = percent(current, total);
  if (currentFile) bucket.current_file = currentFile;
  if (phase === "xref") {
    progress.total_cad_files = total;
    progress.total_fcstd_files = total;
  }
}

function finishBomXrefProgress(scanId: string, result: any): void {
  const progress = bomXrefProgress.get(scanId);
  if (!progress) return;
  progress.result = result;
  progress.cancelled = progress.cancelled || Boolean(result?.cancelled);
  progress.status = progress.cancelled ? "cancelled" : "done";
  progress.phase = progress.status;
  progress.step = 2;
  if (!progress.cancelled) {
    progress.walk.percent = 100;
    progress.xref.percent = 100;
  }
}

/** GET /api/cad/health */
cadRoutes.get("/health", async (c) => {
  let sqliteOk = false;
  try {
    const ws = getWorkspace(c);
    if (ws) { loadPartKeysPayload(ws); sqliteOk = true; }
  } catch {}
  // module/native 字段是既有前端兼容 envelope，不再代表 Rust provider。
  return c.json({ ok: true, module: "cad-native",
    native: { available: sqliteOk, engine: "node-sqlite" },
  });
});

/** GET /api/cad/bom/file */
cadRoutes.get("/bom/file", async (c) => {
  const ws = getWorkspace(c);
  const rel = c.req.query("rel");
  if (!rel) return c.json({ error: "rel is required" }, 400);
  if (!ws) return c.json({ error: "workspace is required" }, 400);
  try {
    return c.json(loadBomPreview(ws, rel));
  } catch (e: any) {
    return c.json({ detail: e.message || String(e) }, 400);
  }
});

// ── 零件号（TypeScript / SQLite）────────────────────────

cadRoutes.get("/parts", (c) => {
  const ws = getWorkspace(c);
  if (!ws) return c.json({ error: "workspace is required" }, 400);
  return c.json(loadPartKeysPayload(ws, { search: c.req.query("q") || c.req.query("search") || "" }));
});

cadRoutes.get("/parts/:pn/:pv", async (c) => {
  const ws = getWorkspace(c);
  const { pn, pv } = c.req.param();
  if (!ws) return c.json({ error: "workspace is required" }, 400);
  try {
    return c.json(loadPartKeyDetailPayload(ws, pn, pv));
  } catch (e: any) {
    return c.json({ detail: e.message || String(e) }, 404);
  }
});

cadRoutes.patch("/parts/:pn/:pv", async (c) => {
  const ws = getWorkspace(c);
  const { pn, pv } = c.req.param();
  if (!ws) return c.json({ error: "workspace is required" }, 400);
  const body = await c.req.json().catch(() => ({}));
  try {
    return c.json(patchPartKey(ws, pn, pv, body));
  } catch (e: any) {
    return c.json({ detail: e.message || String(e) }, 404);
  }
});

cadRoutes.get("/parts/infer", (c) => {
  const ws = getWorkspace(c);
  const rel = c.req.query("rel") || "";
  if (!ws) return c.json({ error: "workspace is required" }, 400);
  try {
    return c.json(inferPartKeyFromWorkspaceRel(ws, rel));
  } catch (e: any) {
    return c.json({ detail: e.message || String(e) }, 400);
  }
});

cadRoutes.get("/parts/:pn/:pv/assembly-tree", async (c) => {
  const ws = getWorkspace(c);
  const { pn, pv } = c.req.param();
  const hostRel = c.req.query("host_rel") || c.req.query("rel") || "";
  if (!ws) return c.json({ error: "workspace is required" }, 400);
  if (!hostRel) return c.json({ error: "host_rel is required" }, 400);
  try {
    return c.json(loadPartAssemblyTreePayload(ws, pn, pv, hostRel, { full: c.req.query("full") === "true" }));
  } catch (e: any) {
    return c.json({ detail: e.message || String(e) }, 400);
  }
});

cadRoutes.patch("/parts/:pn/:pv/files/:fileId", async (c) => {
  const ws = getWorkspace(c);
  const { pn, pv, fileId } = c.req.param();
  if (!ws) return c.json({ error: "workspace is required" }, 400);
  const body = await c.req.json().catch(() => ({}));
  try {
    return c.json(patchPartFileLink(ws, pn, pv, Number(fileId), body));
  } catch (e: any) {
    return c.json({ detail: e.message || String(e) }, 404);
  }
});

// ── BOM XRef 详情（TypeScript / SQLite）───────────────

cadRoutes.get("/bom/xref/incoming", (c) => {
  const ws = getWorkspace(c);
  if (!ws) return c.json({ error: "workspace is required" }, 400);
  return c.json(searchIncomingRefs(ws, {
    rel: c.req.query("rel") || undefined,
    basename: c.req.query("basename") || undefined,
    limit: Number(c.req.query("limit") || 500),
    transitive: c.req.query("transitive") !== "false",
  }));
});

cadRoutes.get("/bom/xref/outgoing", (c) => {
  const ws = getWorkspace(c);
  const rel = c.req.query("rel") || "";
  if (!ws) return c.json({ error: "workspace is required" }, 400);
  if (!rel) return c.json({ error: "rel is required" }, 400);
  return c.json(searchOutgoingRefs(ws, rel, { limit: Number(c.req.query("limit") || 500) }));
});

cadRoutes.get("/bom/xref/counts", (c) => {
  const ws = getWorkspace(c);
  const rel = c.req.query("rel") || "";
  if (!ws) return c.json({ error: "workspace is required" }, 400);
  if (!rel) return c.json({ error: "rel is required" }, 400);
  return c.json(queryXrefCountsForRel(ws, rel));
});

cadRoutes.get("/bom/xref/assembly-tree", async (c) => {
  const rel = c.req.query("host_rel") || c.req.query("rel") || "";
  const full = c.req.query("full") === "true";
  const ws = getWorkspace(c);
  if (!rel) return c.json({ error: "host_rel is required" }, 400);
  if (!ws) return c.json({ error: "workspace is required" }, 400);
  return c.json(loadAssemblyTreeFromXrefs(ws, rel, { full }));
});

cadRoutes.post("/bom/xref/patch-labels", async (c) => {
  const ws = getWorkspace(c);
  if (!ws) return c.json({ error: "workspace is required" }, 400);
  const body = await c.req.json().catch(() => ({}));
  return c.json(patchBomLinkLabels(ws, Array.isArray(body?.patches) ? body.patches : []));
});

cadRoutes.post("/bom/xref/refresh-host-index", async (c) => {
  const ws = getWorkspace(c);
  if (!ws) return c.json({ error: "workspace is required" }, 400);
  const body = await c.req.json().catch(() => ({}));
  try {
    return c.json(refreshBomXrefForHost(ws, body.host_repo_rel || body.rel || "", {
      recursive: body.recursive !== false,
      maxHosts: Number(body.max_hosts || 64),
    }));
  } catch (error: any) {
    return c.json({ error: error?.message || String(error) }, 400);
  }
});
cadRoutes.post("/bom/xref/refresh-host-index/start", async (c) => {
  const ws = getWorkspace(c);
  if (!ws) return c.json({ error: "workspace is required" }, 400);
  const body = await c.req.json().catch(() => ({}));
  const scanId = `bom-xref-${Date.now()}-${randomUUID().slice(0, 8)}`;
  bomXrefProgress.set(scanId, newBomXrefProgress(scanId));
  void refreshBomXrefForHostAsync(ws, body.host_repo_rel || body.rel || "", {
    recursive: body.recursive !== false,
    maxHosts: Number(body.max_hosts || 64),
    isCancelled: () => Boolean(bomXrefProgress.get(scanId)?.cancelled),
    onProgress: (phase, current, total, currentFile) => updateBomXrefProgress(scanId, phase, current, total, currentFile),
  }).then((result) => finishBomXrefProgress(scanId, result)).catch((error: any) => {
    const progress = bomXrefProgress.get(scanId) || newBomXrefProgress(scanId);
    progress.status = "error";
    progress.phase = "error";
    progress.error = error?.message || String(error);
    bomXrefProgress.set(scanId, progress);
  });
  return c.json({ scan_id: scanId });
});
cadRoutes.get("/bom/xref/refresh-host-index/progress", async (c) => {
  const scanId = c.req.query("scan_id") || "";
  const progress = bomXrefProgress.get(scanId);
  if (!progress) return c.json({ error: "BOM xref task not found", scan_id: scanId }, 404);
  return c.json(progress);
});
cadRoutes.post("/bom/xref/refresh-host-index/cancel", async (c) => {
  const scanId = c.req.query("scan_id") || "";
  const progress = bomXrefProgress.get(scanId);
  const ok = Boolean(progress && progress.status === "running");
  if (ok && progress) {
    progress.cancelled = true;
    progress.status = "cancelled";
    progress.phase = "cancelled";
  }
  return c.json({ ok });
});


// ── BOM attribute write compatibility routes for file detail page ──────────────

cadRoutes.get("/bom/prefs", (c) => {
  const ws = getWorkspace(c);
  if (!ws) return c.json({ error: "workspace is required" }, 400);
  return c.json(loadBomApplyPrefs(ws));
});
cadRoutes.put("/bom/file", async (c) => {
  const ws = getWorkspace(c);
  if (!ws) return c.json({ error: "workspace is required" }, 400);
  const body = await c.req.json().catch(() => ({}));
  const rel = c.req.query("rel") || body.rel;
  if (!rel) return c.json({ error: "rel is required" }, 400);
  try {
    return c.json(await writeBomToFcstd(ws, rel, body));
  } catch (e: any) {
    return c.json({ detail: e.message || String(e) }, 500);
  }
});
cadRoutes.post("/bom/recommend-field", async (c) => {
  const ws = getWorkspace(c);
  if (!ws) return c.json({ error: "workspace is required" }, 400);
  const body = await c.req.json().catch(() => ({}));
  const rel = c.req.query("rel") || body.rel;
  const field = c.req.query("field") || body.field;
  if (!rel || !field) return c.json({ error: "rel and field are required" }, 400);
  try {
    return c.json(recommendBomField(ws, rel, field, body));
  } catch (e: any) {
    return c.json({ detail: e.message || String(e) }, 400);
  }
});
cadRoutes.post("/bom/recommend-all-fields", async (c) => {
  const ws = getWorkspace(c);
  if (!ws) return c.json({ error: "workspace is required" }, 400);
  const body = await c.req.json().catch(() => ({}));
  const rel = c.req.query("rel") || body.rel;
  if (!rel) return c.json({ error: "rel is required" }, 400);
  try {
    return c.json(recommendBomFieldsAll(ws, rel, body));
  } catch (e: any) {
    return c.json({ detail: e.message || String(e) }, 400);
  }
});
cadRoutes.post("/bom/fill-recommended-values", async (c) => {
  const ws = getWorkspace(c);
  if (!ws) return c.json({ error: "workspace is required" }, 400);
  const body = await c.req.json().catch(() => ({}));
  const rel = c.req.query("rel") || body.rel;
  if (!rel) return c.json({ error: "rel is required" }, 400);
  return c.json(fillRecommendedValues(ws, rel, body));
});
cadRoutes.post("/bom/fill-from-embedded", async (c) => {
  const ws = getWorkspace(c);
  if (!ws) return c.json({ error: "workspace is required" }, 400);
  const body = await c.req.json().catch(() => ({}));
  const rel = c.req.query("rel") || body.rel;
  if (!rel) return c.json({ error: "rel is required" }, 400);
  try {
    return c.json(fillBomFromEmbedded(ws, rel, body));
  } catch (e: any) {
    return c.json({ detail: e.message || String(e) }, 400);
  }
});
cadRoutes.post("/bom/fill-from-filename", async (c) => {
  const ws = getWorkspace(c);
  if (!ws) return c.json({ error: "workspace is required" }, 400);
  const body = await c.req.json().catch(() => ({}));
  const rel = c.req.query("rel") || body.rel;
  if (!rel) return c.json({ error: "rel is required" }, 400);
  return c.json(fillBomFromFilename(ws, rel));
});
cadRoutes.post("/bom/apply-label-formula", async (c) => {
  const ws = getWorkspace(c);
  if (!ws) return c.json({ error: "workspace is required" }, 400);
  const body = await c.req.json().catch(() => ({}));
  const rel = c.req.query("rel") || body.rel;
  if (!rel) return c.json({ error: "rel is required" }, 400);
  try {
    return c.json(applyBomLabelFormula(ws, rel, body, body.fill_empty_from_prefs !== false));
  } catch (e: any) {
    return c.json({ detail: e.message || String(e) }, 400);
  }
});
cadRoutes.get("/bom/document-kinds", (c) => {
  const ws = getWorkspace(c);
  if (!ws) return c.json({ error: "workspace is required" }, 400);
  const rel = c.req.query("rel") || "";
  if (!rel) return c.json({ error: "rel is required" }, 400);
  return c.json(readBomDocumentKinds(ws, rel));
});
cadRoutes.post("/bom/recommend-filename", async (c) => {
  const ws = getWorkspace(c);
  if (!ws) return c.json({ error: "workspace is required" }, 400);
  const body = await c.req.json().catch(() => ({}));
  const rel = c.req.query("rel") || body.rel;
  if (!rel) return c.json({ error: "rel is required" }, 400);
  try {
    return c.json(recommendBomFilename(ws, rel, body));
  } catch (e: any) {
    return c.json({ detail: e.message || String(e) }, 400);
  }
});
cadRoutes.post("/bom/rename", async (c) => {
  const ws = getWorkspace(c);
  if (!ws) return c.json({ error: "workspace is required" }, 400);
  const body = await c.req.json().catch(() => ({}));
  const rel = c.req.query("rel") || body.rel;
  if (!rel) return c.json({ error: "rel is required" }, 400);
  try {
    return c.json(await renameBomFcstdFile(ws, rel, body));
  } catch (e: any) {
    return c.json({ detail: e.message || String(e) }, 400);
  }
});

// ── BOM 展开树（TypeScript / SQLite）──────────────────

cadRoutes.get("/bom/tree", (c) => {
  const ws = getWorkspace(c);
  const rel = c.req.query("rel") || c.req.query("host_rel") || "";
  if (!ws) return c.json({ error: "workspace is required" }, 400);
  if (!rel) return c.json({ error: "rel is required" }, 400);
  const tree = loadAssemblyTreeFromXrefs(ws, rel, { full: c.req.query("full") !== "false" });
  return c.json({ ...tree, items: flattenAssemblyTreeItems(tree.nodes || []) });
});

// ── STEP batch + SolidWorks to STEP native routes ─────────────────────────────

cadRoutes.get("/step-batch/prefs", (c) => {
  try {
    const ws = getWorkspace(c);
    if (!ws) return c.json({ error: "workspace is required" }, 400);
    return c.json(getStepBatchPrefs(ws));
  } catch (e: any) {
    return c.json({ detail: e.message || String(e) }, 400);
  }
});

cadRoutes.put("/step-batch/prefs", async (c) => {
  try {
    const ws = getWorkspace(c);
    if (!ws) return c.json({ error: "workspace is required" }, 400);
    return c.json(saveStepBatchPrefs(ws, await c.req.json().catch(() => ({}))));
  } catch (e: any) {
    return c.json({ detail: e.message || String(e) }, 400);
  }
});

cadRoutes.post("/step-batch/preview", async (c) => {
  try {
    const ws = getWorkspace(c);
    if (!ws) return c.json({ error: "workspace is required" }, 400);
    return c.json(previewStepBatch(ws, await c.req.json().catch(() => ({}))));
  } catch (e: any) {
    return c.json({ detail: e.message || String(e) }, 400);
  }
});

cadRoutes.post("/step-batch/run", async (c) => {
  try {
    const ws = getWorkspace(c);
    if (!ws) return c.json({ error: "workspace is required" }, 400);
    return c.json(await runStepBatch(ws, await c.req.json().catch(() => ({}))));
  } catch (e: any) {
    return c.json({ detail: e.message || String(e) }, 400);
  }
});

cadRoutes.get("/sw-step/prefs", (c) => {
  try {
    const ws = getWorkspace(c);
    if (!ws) return c.json({ error: "workspace is required" }, 400);
    return c.json(getSwStepPrefs(ws));
  } catch (e: any) {
    return c.json({ detail: e.message || String(e) }, 400);
  }
});

cadRoutes.put("/sw-step/prefs", async (c) => {
  try {
    const ws = getWorkspace(c);
    if (!ws) return c.json({ error: "workspace is required" }, 400);
    return c.json(saveSwStepPrefs(ws, await c.req.json().catch(() => ({}))));
  } catch (e: any) {
    return c.json({ detail: e.message || String(e) }, 400);
  }
});

cadRoutes.post("/sw-step/preview", async (c) => {
  try {
    const ws = getWorkspace(c);
    if (!ws) return c.json({ error: "workspace is required" }, 400);
    return c.json(previewSwStepExport(ws, await c.req.json().catch(() => ({}))));
  } catch (e: any) {
    return c.json({ detail: e.message || String(e) }, 400);
  }
});

cadRoutes.post("/sw-step/run", async (c) => {
  try {
    const ws = getWorkspace(c);
    if (!ws) return c.json({ error: "workspace is required" }, 400);
    return c.json(await runSwStepExport(ws, await c.req.json().catch(() => ({}))));
  } catch (e: any) {
    return c.json({ detail: e.message || String(e) }, 400);
  }
});


// ── XLink fix + rename analysis native routes ────────────────────────────────

// xlink-fix native routes
cadRoutes.get("/xlink-fix/prefs", (c) => {
  try {
    const ws = getWorkspace(c);
    if (!ws) return c.json({ error: "workspace is required" }, 400);
    return c.json(getXlinkPrefs(ws));
  } catch (e: any) {
    return c.json({ detail: e.message || String(e) }, 400);
  }
});

cadRoutes.put("/xlink-fix/prefs", async (c) => {
  try {
    const ws = getWorkspace(c);
    if (!ws) return c.json({ error: "workspace is required" }, 400);
    return c.json(saveXlinkPrefs(ws, await c.req.json().catch(() => ({}))));
  } catch (e: any) {
    return c.json({ detail: e.message || String(e) }, 400);
  }
});

cadRoutes.post("/xlink-fix/analyze", async (c) => {
  try {
    const ws = getWorkspace(c);
    if (!ws) return c.json({ error: "workspace is required" }, 400);
    return c.json(analyzeXlinkFix(ws, await c.req.json().catch(() => ({}))));
  } catch (e: any) {
    return c.json({ detail: e.message || String(e) }, 400);
  }
});

cadRoutes.post("/xlink-fix/run", async (c) => {
  try {
    const ws = getWorkspace(c);
    if (!ws) return c.json({ error: "workspace is required" }, 400);
    return c.json(runXlinkFix(ws, await c.req.json().catch(() => ({}))));
  } catch (e: any) {
    return c.json({ detail: e.message || String(e) }, 400);
  }
});

cadRoutes.post("/xlink-fix/apply-override", async (c) => {
  try {
    const ws = getWorkspace(c);
    if (!ws) return c.json({ error: "workspace is required" }, 400);
    return c.json(applyXlinkFixOverride(ws, await c.req.json().catch(() => ({}))));
  } catch (e: any) {
    return c.json({ detail: e.message || String(e) }, 400);
  }
});

cadRoutes.get("/xlink-fix/candidates", (c) => {
  try {
    const ws = getWorkspace(c);
    if (!ws) return c.json({ error: "workspace is required" }, 400);
    return c.json(listXlinkFixCandidates(ws, {
      basename: c.req.query("basename") || "",
      part_number: c.req.query("part_number") || "",
      part_version: c.req.query("part_version") || "",
      exclude_repo_rel: c.req.query("exclude_repo_rel") || "",
    }));
  } catch (e: any) {
    return c.json({ detail: e.message || String(e) }, 400);
  }
});

// rename-analysis
cadRoutes.get("/rename/logs", (c) => {
  try {
    return c.json(listRenameLogs(getWorkspace(c), { limit: Number(c.req.query("limit") || 50), rel: c.req.query("rel") || "" }));
  } catch (e: any) {
    return c.json({ detail: e.message || String(e) }, 400);
  }
});
cadRoutes.post("/rename/analyze", async (c) => {
  try {
    return c.json(analyzeRenameReferences(getWorkspace(c), await c.req.json().catch(() => ({}))));
  } catch (e: any) {
    return c.json({ detail: e.message || String(e) }, 400);
  }
});
cadRoutes.post("/rename/apply", async (c) => {
  try {
    return c.json(applyRenameCorrections(getWorkspace(c), await c.req.json().catch(() => ({}))));
  } catch (e: any) {
    return c.json({ detail: e.message || String(e) }, 400);
  }
});
cadRoutes.get("/rename/load", (c) => {
  try {
    return c.json(loadRenameAnalysis(getWorkspace(c), Number(c.req.query("rename_log_id") || 0)));
  } catch (e: any) {
    return c.json({ detail: e.message || String(e) }, 400);
  }
});
cadRoutes.post("/rename/export-report", async (c) => {
  try {
    return c.json(exportRenameReport(getWorkspace(c), await c.req.json().catch(() => ({}))));
  } catch (e: any) {
    return c.json({ detail: e.message || String(e) }, 400);
  }
});

// ── Part dedup native routes ──────────────────────────────────────────────────

cadRoutes.get("/part-dedup/prefs", async (c) => {
  try {
    const ws = getWorkspace(c);
    if (!ws) return c.json({ error: "workspace is required" }, 400);
    return c.json(getPartDedupPrefs(ws));
  } catch (e: any) {
    return c.json({ detail: e.message || String(e) }, 400);
  }
});

cadRoutes.put("/part-dedup/prefs", async (c) => {
  try {
    const ws = getWorkspace(c);
    if (!ws) return c.json({ error: "workspace is required" }, 400);
    const body = await c.req.json().catch(() => ({}));
    return c.json(savePartDedupPrefs(ws, body));
  } catch (e: any) {
    return c.json({ detail: e.message || String(e) }, 400);
  }
});

cadRoutes.post("/part-dedup/scan", async (c) => {
  try {
    const ws = getWorkspace(c);
    if (!ws) return c.json({ error: "workspace is required" }, 400);
    const body = await c.req.json().catch(() => ({}));
    return c.json(scanPartDedup(ws, body));
  } catch (e: any) {
    return c.json({ detail: e.message || String(e) }, 400);
  }
});

cadRoutes.post("/part-dedup/export-csv", async (c) => {
  try {
    const ws = getWorkspace(c);
    if (!ws) return c.json({ error: "workspace is required" }, 400);
    const body = await c.req.json().catch(() => ({}));
    return c.json(exportPartDedupCsv(ws, body));
  } catch (e: any) {
    return c.json({ detail: e.message || String(e) }, 400);
  }
});
