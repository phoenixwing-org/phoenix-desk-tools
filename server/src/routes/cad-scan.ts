/** CAD 索引扫描路由 — 调用 pnwFcstdMapService */

import { Hono } from "hono";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runFcstdMapScan, loadFcstdMapPayload, searchFcstdMapEntries } from "../lib/pnwFcstdMapService.js";

function getWorkspace(c: any): string {
  const q = c.req.query("workspace") || "";
  if (q) return q;
  try {
    const p = path.join(os.homedir(), ".phoenix", "launcher-prefs.json");
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, "utf-8")).workspace || "";
  } catch { }
  return "";
}

export const cadScanRoutes = new Hono();

// 对应 Python: POST /api/fcstd-map/scan → run_fcstd_map_scan()
// 对应 Python: GET /api/fcstd-map/entries → search_fcstd_map_entries()
cadScanRoutes.get("/fcstd-map/entries", (c) => {
  const ws = getWorkspace(c);
  if (!ws) return c.json({ entries: [], total: 0, offset: 0, limit: 100, _stub: true });
  return c.json(searchFcstdMapEntries(ws, {
    offset: Number(c.req.query("offset")) || 0,
    limit: Number(c.req.query("limit")) || 100,
    kind: c.req.query("kind") || undefined,
    search: c.req.query("search") || undefined,
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

cadScanRoutes.post("/fcstd-map/scan/start", (c) => c.json({ scan_id: "native", phase: "done" }));
cadScanRoutes.post("/fcstd-map/purge-missing", (c) => c.json({ _stub: true }));
cadScanRoutes.get("/fcstd-map/scan/progress", (c) => {
  const ws = getWorkspace(c);
  try {
    const { pnwQueryScanRecent } = require("../lib/pnwCadDb.js");
    const scans = pnwQueryScanRecent(ws, 10);
    return c.json({ scan_id: "native", phase: "done", step: 3, status: "finished", cancelled: false, walk: { total: 0, processed: 0, percent: 100 }, bom: { total: 0, processed: 0, skipped: 0, failed: 0, current_file: "", percent: 100, errors: [] }, xref: { total: 0, processed: 0, skipped: 0, failed: 0, current_file: "", percent: 100, errors: [] }, _native: "rust" });
  } catch { return c.json({ scan_id: "native", phase: "done", step: 3, status: "finished", cancelled: false, walk: { percent: 100 }, bom: { percent: 100 }, xref: { percent: 100 } }); }
});
cadScanRoutes.post("/fcstd-map/scan/cancel", (c) => c.json({ cancelled: true }));
cadScanRoutes.get("/fcstd-map/scan/history", (c) => c.json({ items: [], _native: "rust" }));
cadScanRoutes.get("/fcstd-map/scan/resume", (c) => c.json({ _native: "rust" }));
cadScanRoutes.post("/fcstd-map/export-json", (c) => c.json({ path: "", _native: "rust" }));

// Worksets
cadScanRoutes.get("/worksets", (c) => c.json({ worksets: [], _native: "rust" }));
cadScanRoutes.put("/worksets", (c) => c.json({ _native: "rust" }));

// XLink fix — 调 Rust fcstd-xlink CLI
cadScanRoutes.post("/xlink-fix/run", async (c) => {
  const ws = getWorkspace(c);
  const body = await c.req.json();
  const { replacements = {} } = body;
  const kvArgs = Object.entries(replacements).map(([k, v]) => `${k}=${v}`);
  if (!kvArgs.length) return c.json({ fixed: 0, _stub: true });
  try {
    const { execFileSync } = await import("node:child_process");
    const XLINK = path.resolve(__dirname, "../../fcstd-xlink/target/debug/fcstd-xlink");
    // For each host file, apply replacements
    let total = 0;
    for (const hostRel of (body.hosts || [])) {
      const absPath = path.join(ws, hostRel.replace(/^\.\//, ""));
      if (!fs.existsSync(absPath)) continue;
      const out = execFileSync(XLINK, ["patch", absPath, ...kvArgs], { timeout: 15000, encoding: "utf8" });
      const r = JSON.parse(out);
      total += r.count || 0;
    }
    return c.json({ fixed: total, _native: "rust" });
  } catch (e: any) {
    return c.json({ fixed: 0, _stub: true, error: e.message });
  }
});

cadScanRoutes.post("/xlink-fix/analyze", (c) => c.json({ hosts: [], summary: {}, _stub: true }));
