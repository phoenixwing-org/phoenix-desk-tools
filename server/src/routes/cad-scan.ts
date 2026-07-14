/** CAD 索引扫描路由 — 调用 pnwFcstdMapService */

import { Hono } from "hono";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  exportFcstdMapToJson,
  listFcstdMapScanHistory,
  loadFcstdMapPayload,
  loadFcstdMapPrefs,
  purgeMissingFcstdMapEntries,
  runFcstdMapScan,
  runFcstdMapScanAsyncWithProgress,
  saveFcstdMapPrefs,
  searchFcstdMapEntries,
} from "../lib/pnwFcstdMapService.js";
import { resolveFileWorksetScope } from "../lib/fileWorksetService.js";
import { runtimeUserDataDir } from "../lib/appRuntimePaths.js";

function getWorkspace(c: any): string {
  const q = c.req.query("workspace") || "";
  if (q) return q;
  try {
    const p = path.join(runtimeUserDataDir(), "launcher-prefs.json");
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, "utf-8")).workspace || "";
  } catch { }
  return "";
}

export const cadScanRoutes = new Hono();

type PhaseName = "walk" | "bom" | "xref";
type ScanProgressPayload = {
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
};

const scanProgress = new Map<string, ScanProgressPayload>();

function phasePercent(current: number, total: number): number {
  if (total <= 0) return current > 0 ? 100 : 0;
  return Math.max(0, Math.min(100, Math.round((current / total) * 100)));
}

function newProgress(scanId: string): ScanProgressPayload {
  return {
    scan_id: scanId,
    phase: "walk",
    step: 0,
    status: "running",
    cancelled: false,
    error: "",
    total_cad_files: 0,
    total_fcstd_files: 0,
    walk: { total: 0, processed: 0, percent: 0 },
    bom: { total: 0, processed: 0, skipped: 0, failed: 0, current_file: "", percent: 0, errors: [] },
    xref: { total: 0, processed: 0, skipped: 0, failed: 0, current_file: "", percent: 0, errors: [] },
  };
}

function updateProgress(scanId: string, phase: string, current: number, total: number, currentFile = ""): void {
  const p = scanProgress.get(scanId);
  if (!p || p.cancelled) return;
  const key: PhaseName = phase === "bom" ? "bom" : phase === "xref" || phase === "done" ? "xref" : "walk";
  p.phase = phase;
  p.step = key === "walk" ? 0 : key === "bom" ? 1 : 2;
  const bucket = p[key] as any;
  bucket.total = total;
  bucket.processed = current;
  bucket.percent = phasePercent(current, total);
  if (currentFile) bucket.current_file = currentFile;
  if (phase === "done") {
    p.status = "done";
    p.walk.percent = 100;
    p.bom.percent = 100;
    p.xref.total = 1;
    p.xref.processed = 1;
    p.xref.percent = 100;
  }
}

function finishProgress(scanId: string, payload: any): void {
  const p = scanProgress.get(scanId);
  if (!p) return;
  p.cancelled = p.cancelled || Boolean(payload?.cancelled);
  p.status = p.cancelled ? "cancelled" : "done";
  p.phase = p.status === "cancelled" ? "cancelled" : "done";
  p.step = 2;
  const stats = payload?.scan_stats || payload?.stats || {};
  p.total_cad_files = stats.cad_file_count || stats.present || 0;
  p.total_fcstd_files = stats.fcstd_file_count || 0;
  p.walk.percent = 100;
  p.bom.percent = 100;
  p.xref.total = 1;
  p.xref.processed = 1;
  p.xref.percent = 100;
}

function doneProgressFromPayload(scanId: string, payload: any): ScanProgressPayload {
  const p = newProgress(scanId);
  p.phase = "done";
  p.status = "done";
  p.step = 2;
  p.total_cad_files = payload?.stats?.cad_file_count || payload?.stats?.present || 0;
  p.total_fcstd_files = payload?.stats?.fcstd_file_count || 0;
  p.walk = { total: p.total_cad_files, processed: p.total_cad_files, percent: 100 };
  p.bom = { total: p.total_fcstd_files, processed: p.total_fcstd_files, skipped: 0, failed: 0, current_file: "", percent: 100, errors: [] };
  p.xref = { total: 1, processed: 1, skipped: 0, failed: 0, current_file: "", percent: 100, errors: [] };
  return p;
}

// 对应 Python: POST /api/fcstd-map/scan → run_fcstd_map_scan()
// 对应 Python: GET /api/fcstd-map/entries → search_fcstd_map_entries()
cadScanRoutes.get("/fcstd-map/entries", (c) => {
  const ws = getWorkspace(c);
  if (!ws) return c.json({ error: "workspace is required" }, 400);
  return c.json(searchFcstdMapEntries(ws, {
    offset: Number(c.req.query("offset")) || 0,
    limit: Number(c.req.query("limit")) || 100,
    kind: c.req.query("kind") || undefined,
    search: c.req.query("search") || undefined,
    status: c.req.query("status") || undefined,
  }));
});

cadScanRoutes.post("/fcstd-map/scan", (c) => {
  const ws = getWorkspace(c);
  if (!ws) return c.json({ error: "未设置工作空间" }, 400);
  console.log(`[cad-scan] 开始扫描 ${ws}`);
  const t0 = Date.now();
  try {
    const payload = runFcstdMapScan(ws);
    console.log(`[cad-scan] 完成 ${Date.now() - t0}ms`);
    return c.json(payload);
  } catch (e: any) {
    return c.json({ error: e.message }, 500);
  }
});

// 对应 Python: GET /api/fcstd-map → load_fcstd_map_payload()
cadScanRoutes.get("/fcstd-map", (c) => {
  const ws = getWorkspace(c);
  if (!ws) return c.json({ error: "未设置工作空间" }, 400);
  return c.json(loadFcstdMapPayload(ws));
});

cadScanRoutes.get("/fcstd-map/prefs", (c) => {
  const ws = getWorkspace(c);
  if (!ws) return c.json({ force_update_part_name: false });
  return c.json(loadFcstdMapPrefs(ws));
});
cadScanRoutes.put("/fcstd-map/prefs", async (c) => {
  const ws = getWorkspace(c);
  if (!ws) return c.json({ error: "未设置工作空间" }, 400);
  const body = await c.req.json().catch(() => ({}));
  return c.json(saveFcstdMapPrefs(ws, body));
});
cadScanRoutes.post("/fcstd-map/scan/start", async (c) => {
  const ws = getWorkspace(c);
  if (!ws) return c.json({ error: "未设置工作空间" }, 400);
  const body = await c.req.json().catch(() => ({}));
  let scope: any;
  const worksetId = String(body.scope_workset_id || "").trim();
  if (worksetId) {
    try {
      const resolved = resolveFileWorksetScope(ws, worksetId);
      scope = {
        worksetId: resolved.id,
        worksetName: resolved.name,
        dirs: resolved.dirs,
        files: resolved.files,
      };
    } catch (error: any) {
      return c.json({ error: error?.message || String(error) }, 400);
    }
  }
  const scanId = `fcstd-${Date.now()}-${randomUUID().slice(0, 8)}`;
  scanProgress.set(scanId, newProgress(scanId));
  void runFcstdMapScanAsyncWithProgress(ws, (phase, current, total, currentFile) => {
      updateProgress(scanId, phase, current, total, currentFile);
    }, {
      scope,
      isCancelled: () => Boolean(scanProgress.get(scanId)?.cancelled),
    })
    .then((payload) => finishProgress(scanId, payload))
    .catch((error: any) => {
      const progress = scanProgress.get(scanId) || newProgress(scanId);
      progress.status = "error";
      progress.phase = "error";
      progress.error = error?.message || String(error);
      scanProgress.set(scanId, progress);
    });
  return c.json({
    scan_id: scanId,
    phase: "walk",
    scan_scope: scope
      ? {
          scope_workset_id: scope.worksetId,
          scope_workset_name: scope.worksetName,
          dirs: scope.dirs,
          files: scope.files,
        }
      : null,
  });
});
cadScanRoutes.post("/fcstd-map/purge-missing", (c) => {
  const ws = getWorkspace(c);
  if (!ws) return c.json({ error: "未设置工作空间" }, 400);
  return c.json(purgeMissingFcstdMapEntries(ws));
});
cadScanRoutes.get("/fcstd-map/scan/progress", (c) => {
  const ws = getWorkspace(c);
  const scanId = c.req.query("scan_id") || "native";
  const progress = scanProgress.get(scanId);
  if (progress) return c.json(progress);
  return c.json(doneProgressFromPayload(scanId, loadFcstdMapPayload(ws)));
});
cadScanRoutes.post("/fcstd-map/scan/cancel", (c) => {
  const scanId = c.req.query("scan_id") || "";
  const progress = scanId ? scanProgress.get(scanId) : undefined;
  const canCancel = Boolean(progress && progress.status === "running");
  if (canCancel && progress) {
    progress.cancelled = true;
    progress.status = "cancelled";
    progress.phase = "cancelled";
  }
  return c.json({ cancelled: canCancel });
});
cadScanRoutes.get("/fcstd-map/scan/history", (c) => {
  const ws = getWorkspace(c);
  return c.json({ scans: listFcstdMapScanHistory(ws, Number(c.req.query("limit")) || 20) });
});
cadScanRoutes.get("/fcstd-map/scan/resume", (c) => {
  const active = [...scanProgress.values()].find((p) => p.status === "running");
  if (!active) return c.json({ active: false, progress: null });
  return c.json({ active: true, scan_id: active.scan_id, source: "memory", progress: active });
});
cadScanRoutes.post("/fcstd-map/export-json", (c) => {
  const ws = getWorkspace(c);
  if (!ws) return c.json({ error: "未设置工作空间" }, 400);
  return c.json(exportFcstdMapToJson(ws));
});
