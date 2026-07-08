/** cad-rust: CAD 模块
 *
 * 原生实现（Rust rusqlite → SQLite），不依赖 Python。
 * 若 Rust CLI 不可用，降级到 Python FastAPI 代理。
 *
 * pnwCadDb 查询层 → server/src/lib/pnwCadDb.ts（未来拆到 phoenix-wing）
 * Rust CLI        → server/fcstd-query/
 */

import { Hono } from "hono";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  pnwQueryParts, pnwQueryFcstdMap, pnwQueryBomHosts, pnwQueryBomFile,
  pnwQueryXrefIncoming, pnwQueryXrefOutgoing, pnwQueryXrefCounts,
  pnwQueryBomTree,
} from "../lib/pnwCadDb.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Python fallback ────────────────────────────────────

const PYTHON_PORT = Number(process.env.PHOENIX_API_PORT || 8765);
const PYTHON_API = `http://127.0.0.1:${PYTHON_PORT}`;
let pythonAvailable = false;

export async function checkPython(): Promise<boolean> {
  try {
    const res = await fetch(`${PYTHON_API}/api/config/app`, { signal: AbortSignal.timeout(3000) });
    pythonAvailable = res.ok;
    if (pythonAvailable) console.log(`[cad-rust] Python API OK :${PYTHON_PORT}`);
    else console.warn(`[cad-rust] Python API ${res.status} :${PYTHON_PORT}`);
  } catch {
    pythonAvailable = false;
    console.warn(`[cad-rust] Python API 未运行 (可选) — 旧功能走 stub`);
  }
  return pythonAvailable;
}

async function proxyToPython(path: string): Promise<Response | null> {
  if (!pythonAvailable) return null;
  try { return await fetch(`${PYTHON_API}${path}`, { signal: AbortSignal.timeout(15000) }); }
  catch { return null; }
}

/** Python 不可用时返回空 JSON */
async function stubOrProxy(c: any, path: string) {
  const res = await proxyToPython(path);
  if (!res) return c.json({ entries: [], items: [], hosts: [], files: [], results: {}, _stub: true, _stub: true });
  return c.json({ ...await res.json(), _proxy: "python" });
}

function getWorkspace(c: any): string {
  const q = c.req.query("workspace") || "";
  if (q) return q;
  try {
    const p = path.join(os.homedir(), ".phoenix", "launcher-prefs.json");
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, "utf-8")).workspace || "";
  } catch { /* ignore */ }
  return "";
}

// ── helpers ────────────────────────────────────────────

/** Rust 优先，失败降级 Python。native=true 表示来自 Rust。 */
async function nativeOrProxy(
  c: any,
  queryFn: (ws: string) => Promise<any>,
  proxyPath: string,
): Promise<Response> {
  const ws = getWorkspace(c);
  if (ws) {
    try {
      const data = await queryFn(ws);
      // data 可能是数组或 {items: [...]}，统一包装避免 spread 数组索引问题
      const items = Array.isArray(data) ? data : (data.items ?? []);
      return c.json({ items, hosts: items, count: items.length, _native: "rust" });
    } catch (e: any) {
      console.warn(`[cad-rust] Rust query failed, fallback to Python: ${e.message}`);
    }
  }
  const res = await proxyToPython(proxyPath);
  if (!res) return c.json({ entries: [], items: [], hosts: [], _stub: true, error: "后端不可用" });
  const pyData = await res.json();
  return c.json({ ...pyData, _proxy: "python" });
}

// ── Hono app ────────────────────────────────────────────

export const cadRoutes = new Hono();

/** GET /api/cad/health */
cadRoutes.get("/health", async (c) => {
  let rustOk = false;
  try {
    const ws = getWorkspace(c);
    if (ws) { await pnwQueryParts(ws, { limit: 1 }); rustOk = true; }
  } catch {}
  return c.json({ ok: true, module: "cad-rust",
    rust: { available: rustOk },
    python: { available: pythonAvailable, port: PYTHON_PORT },
  });
});

/** GET /api/cad/bom/file */
cadRoutes.get("/bom/file", async (c) => {
  const ws = getWorkspace(c);
  const rel = c.req.query("rel");
  if (!rel) return c.json({ error: "需要 rel 参数" }, 400);

  // Rust 原生
  if (ws) {
    try {
      const asset = await pnwQueryBomFile(ws, rel);
      if (asset) {
        return c.json({
          rel, workspace: ws,
          filename: asset.filename, assetKind: asset.asset_kind,
          partNumber: asset.part_number, partVersion: asset.part_version,
          partName: asset.part_name, label: asset.label,
          _native: "rust",
        });
      }
      return c.json({ error: "文件未在 CAD 索引中", rel }, 404);
    } catch (e: any) {
      console.warn(`[cad-rust] bom/file Rust failed: ${e.message}`);
    }
  }

  // Python fallback
  const res = await proxyToPython(`/api/bom?rel=${encodeURIComponent(rel)}`);
  if (!res) return c.json({ entries: [], items: [], hosts: [], _stub: true, error: "后端不可用" });
  if (!res.ok) return c.json({ _stub: true });
  const preview = await res.json();
  const fields = preview.fields || {};
  return c.json({
    rel, workspace: ws,
    filename: preview.rel_path?.split("/").pop() || preview.rel_path,
    assetKind: null, partNumber: fields.part_number, partVersion: fields.part_version,
    partName: fields.part_name, label: fields.Label, _proxy: "python",
  });
});

// ── 零件号（Rust 原生）─────────────────────────────────

cadRoutes.get("/parts", async (c) =>
  nativeOrProxy(c,
    (ws) => pnwQueryParts(ws, { search: c.req.query("q") || undefined }),
    `/api/part-keys?q=${encodeURIComponent(c.req.query("q") || "")}`,
  ),
);

cadRoutes.get("/parts/:pn/:pv", async (c) => {
  const { pn, pv } = c.req.param();
  const res = await proxyToPython(`/api/part-keys/${encodeURIComponent(pn)}/${encodeURIComponent(pv)}`);
  if (!res) return c.json({ entries: [], items: [], hosts: [], files: [], results: {}, _stub: true, _stub: true });
  return c.json({ ...await res.json(), _proxy: "python" });
});

cadRoutes.patch("/parts/:pn/:pv", async (c) => {
  const { pn, pv } = c.req.param();
  const body = await c.req.json();
  const res = await fetch(`${PYTHON_API}/api/part-keys/${encodeURIComponent(pn)}/${encodeURIComponent(pv)}`, {
    method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  if (!res.ok) return c.json({ _stub: true });
  return c.json({ ...await res.json(), _proxy: "python" });
});

cadRoutes.get("/parts/infer", async (c) => {
  const rel = c.req.query("rel") || "";
  const res = await proxyToPython(`/api/part-key-infer?rel=${encodeURIComponent(rel)}`);
  if (!res) return c.json({ entries: [], items: [], hosts: [], files: [], results: {}, _stub: true, _stub: true });
  return c.json({ ...await res.json(), _proxy: "python" });
});

cadRoutes.get("/parts/:pn/:pv/assembly-tree", async (c) => {
  const { pn, pv } = c.req.param();
  const qs = new URL(c.req.url).searchParams.toString();
  const path = `/api/part-keys/${encodeURIComponent(pn)}/${encodeURIComponent(pv)}/assembly-tree${qs ? `?${qs}` : ""}`;
  const res = await proxyToPython(path);
  if (!res) return c.json({ entries: [], items: [], hosts: [], files: [], results: {}, _stub: true, _stub: true });
  return c.json({ ...await res.json(), _proxy: "python" });
});

cadRoutes.patch("/parts/:pn/:pv/files/:fileId", async (c) => {
  const { pn, pv, fileId } = c.req.param();
  const body = await c.req.json();
  const res = await fetch(`${PYTHON_API}/api/part-keys/${encodeURIComponent(pn)}/${encodeURIComponent(pv)}/files/${fileId}`, {
    method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  if (!res.ok) return c.json({ _stub: true });
  return c.json({ ...await res.json(), _proxy: "python" });
});

cadRoutes.get("/fcstd-map/prefs", async (c) => { const res = await proxyToPython("/api/fcstd-map/prefs"); if (!res) return c.json({ entries: [], items: [], hosts: [], files: [], results: {}, _stub: true, _stub: true }); return c.json({ ...await res.json(), _proxy: "python" }); });
cadRoutes.put("/fcstd-map/prefs", async (c) => { const body = await c.req.json(); const res = await fetch(`${PYTHON_API}/api/fcstd-map/prefs`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); if (!res.ok) return c.json({ _stub: true, error: `Python API 错误` }); return c.json({ ...await res.json(), _proxy: "python" }); });
cadRoutes.post("/fcstd-map/scan", async (c) => { const body = await c.req.json(); const res = await fetch(`${PYTHON_API}/api/fcstd-map/scan`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); if (!res.ok) return c.json({ _stub: true, error: `Python API 错误` }); return c.json({ ...await res.json(), _proxy: "python" }); });
cadRoutes.post("/fcstd-map/purge-missing", async (c) => { const body = await c.req.json(); const res = await fetch(`${PYTHON_API}/api/fcstd-map/purge-missing`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); if (!res.ok) return c.json({ _stub: true, error: `Python API 错误` }); return c.json({ ...await res.json(), _proxy: "python" }); });
cadRoutes.post("/fcstd-map/scan/start", async (c) => { const body = await c.req.json(); const res = await fetch(`${PYTHON_API}/api/fcstd-map/scan/start`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); if (!res.ok) return c.json({ _stub: true, error: `Python API 错误` }); return c.json({ ...await res.json(), _proxy: "python" }); });
cadRoutes.get("/fcstd-map/scan/progress", async (c) => { const qs = new URL(c.req.url).searchParams.toString(); const res = await proxyToPython(`/api/fcstd-map/scan/progress?${qs}`); if (!res) return c.json({ entries: [], items: [], hosts: [], files: [], results: {}, _stub: true, _stub: true }); return c.json({ ...await res.json(), _proxy: "python" }); });
cadRoutes.post("/fcstd-map/scan/cancel", async (c) => { const qs = new URL(c.req.url).searchParams.toString(); const res = await fetch(`${PYTHON_API}/api/fcstd-map/scan/cancel?${qs}`, { method: "POST" }); if (!res.ok) return c.json({ _stub: true, error: `Python API 错误` }); return c.json({ ...await res.json(), _proxy: "python" }); });
cadRoutes.get("/fcstd-map/scan/history", async (c) => { const qs = new URL(c.req.url).searchParams.toString(); const res = await proxyToPython(`/api/fcstd-map/scan/history?${qs}`); if (!res) return c.json({ entries: [], items: [], hosts: [], files: [], results: {}, _stub: true, _stub: true }); return c.json({ ...await res.json(), _proxy: "python" }); });
cadRoutes.get("/fcstd-map/scan/resume", async (c) => { const res = await proxyToPython("/api/fcstd-map/scan/resume"); if (!res) return c.json({ entries: [], items: [], hosts: [], files: [], results: {}, _stub: true, _stub: true }); return c.json({ ...await res.json(), _proxy: "python" }); });
cadRoutes.post("/fcstd-map/export-json", async (c) => { const body = await c.req.json(); const res = await fetch(`${PYTHON_API}/api/fcstd-map/export-json`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); if (!res.ok) return c.json({ _stub: true, error: `Python API 错误` }); return c.json({ ...await res.json(), _proxy: "python" }); });

// ── CAD 索引（Rust 原生）───────────────────────────────

cadRoutes.get("/fcstd-map/entries", async (c) =>
  nativeOrProxy(c,
    (ws) => pnwQueryFcstdMap(ws, {
      search: c.req.query("search") || undefined,
      kind: c.req.query("kind") || undefined,
      offset: Number(c.req.query("offset")) || 0,
      limit: Number(c.req.query("limit")) || 100,
    }),
    `/api/fcstd-map/entries?${new URLSearchParams({ ...Object.fromEntries(new URL(c.req.url).searchParams) })}`,
  ),
);

// ── BOM XRef（Rust 原生）───────────────────────────────

cadRoutes.get("/bom/xref/meta", async (c) =>
  nativeOrProxy(c, (ws) => pnwQueryBomHosts(ws), "/api/bom-xrefs/meta"),
);

// ── BOM XRef 详情（Rust 原生）─────────────────────────

cadRoutes.get("/bom/xref/incoming", async (c) =>
  nativeOrProxy(c,
    (ws) => pnwQueryXrefIncoming(ws, c.req.query("rel") || ""),
    `/api/bom-xrefs/incoming?rel=${encodeURIComponent(c.req.query("rel") || "")}&limit=500&transitive=true`,
  ),
);

cadRoutes.get("/bom/xref/outgoing", async (c) =>
  nativeOrProxy(c,
    (ws) => pnwQueryXrefOutgoing(ws, c.req.query("rel") || ""),
    `/api/bom-xrefs/outgoing?rel=${encodeURIComponent(c.req.query("rel") || "")}&limit=500`,
  ),
);

cadRoutes.get("/bom/xref/counts", async (c) =>
  nativeOrProxy(c,
    (ws) => pnwQueryXrefCounts(ws, c.req.query("rel") || ""),
    `/api/bom-xrefs/counts?rel=${encodeURIComponent(c.req.query("rel") || "")}`,
  ),
);

// BOM xref 补充路由（纯代理）
cadRoutes.get("/bom/xref/assembly-hosts", async (c) => {
  const qs = new URL(c.req.url).searchParams.toString();
  const res = await proxyToPython(`/api/bom-xrefs/assembly-hosts${qs ? `?${qs}` : ""}`);
  if (!res) return c.json({ entries: [], items: [], hosts: [], files: [], results: {}, _stub: true, _stub: true });
  return c.json({ ...await res.json(), _proxy: "python" });
});
cadRoutes.post("/bom/xref/refresh-host-index", async (c) => {
  const body = await c.req.json();
  const res = await fetch(`${PYTHON_API}/api/bom-xrefs/refresh-host-index`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) return c.json({ _stub: true });
  return c.json({ ...await res.json(), _proxy: "python" });
});
cadRoutes.post("/bom/xref/refresh-host-index/start", async (c) => {
  const body = await c.req.json();
  const res = await fetch(`${PYTHON_API}/api/bom-xrefs/refresh-host-index/start`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) return c.json({ _stub: true });
  return c.json({ ...await res.json(), _proxy: "python" });
});
cadRoutes.get("/bom/xref/refresh-host-index/progress", async (c) => {
  const qs = new URL(c.req.url).searchParams.toString();
  const res = await proxyToPython(`/api/bom-xrefs/refresh-host-index/progress${qs ? `?${qs}` : ""}`);
  if (!res) return c.json({ entries: [], items: [], hosts: [], files: [], results: {}, _stub: true, _stub: true });
  return c.json({ ...await res.json(), _proxy: "python" });
});
cadRoutes.post("/bom/xref/refresh-host-index/cancel", async (c) => {
  const qs = new URL(c.req.url).searchParams.toString();
  const res = await fetch(`${PYTHON_API}/api/bom-xrefs/refresh-host-index/cancel${qs ? `?${qs}` : ""}`, { method: "POST" });
  if (!res.ok) return c.json({ _stub: true });
  return c.json({ ...await res.json(), _proxy: "python" });
});

cadRoutes.get("/fcstd-map/prefs", async (c) => { const res = await proxyToPython("/api/fcstd-map/prefs"); if (!res) return c.json({ entries: [], items: [], hosts: [], files: [], results: {}, _stub: true, _stub: true }); return c.json({ ...await res.json(), _proxy: "python" }); });
cadRoutes.put("/fcstd-map/prefs", async (c) => { const body = await c.req.json(); const res = await fetch(`${PYTHON_API}/api/fcstd-map/prefs`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); if (!res.ok) return c.json({ _stub: true, error: `Python API 错误` }); return c.json({ ...await res.json(), _proxy: "python" }); });
cadRoutes.post("/fcstd-map/scan", async (c) => { const body = await c.req.json(); const res = await fetch(`${PYTHON_API}/api/fcstd-map/scan`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); if (!res.ok) return c.json({ _stub: true, error: `Python API 错误` }); return c.json({ ...await res.json(), _proxy: "python" }); });
cadRoutes.post("/fcstd-map/purge-missing", async (c) => { const body = await c.req.json(); const res = await fetch(`${PYTHON_API}/api/fcstd-map/purge-missing`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); if (!res.ok) return c.json({ _stub: true, error: `Python API 错误` }); return c.json({ ...await res.json(), _proxy: "python" }); });
cadRoutes.post("/fcstd-map/scan/start", async (c) => { const body = await c.req.json(); const res = await fetch(`${PYTHON_API}/api/fcstd-map/scan/start`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); if (!res.ok) return c.json({ _stub: true, error: `Python API 错误` }); return c.json({ ...await res.json(), _proxy: "python" }); });
cadRoutes.get("/fcstd-map/scan/progress", async (c) => { const qs = new URL(c.req.url).searchParams.toString(); const res = await proxyToPython(`/api/fcstd-map/scan/progress?${qs}`); if (!res) return c.json({ entries: [], items: [], hosts: [], files: [], results: {}, _stub: true, _stub: true }); return c.json({ ...await res.json(), _proxy: "python" }); });
cadRoutes.post("/fcstd-map/scan/cancel", async (c) => { const qs = new URL(c.req.url).searchParams.toString(); const res = await fetch(`${PYTHON_API}/api/fcstd-map/scan/cancel?${qs}`, { method: "POST" }); if (!res.ok) return c.json({ _stub: true, error: `Python API 错误` }); return c.json({ ...await res.json(), _proxy: "python" }); });
cadRoutes.get("/fcstd-map/scan/history", async (c) => { const qs = new URL(c.req.url).searchParams.toString(); const res = await proxyToPython(`/api/fcstd-map/scan/history?${qs}`); if (!res) return c.json({ entries: [], items: [], hosts: [], files: [], results: {}, _stub: true, _stub: true }); return c.json({ ...await res.json(), _proxy: "python" }); });
cadRoutes.get("/fcstd-map/scan/resume", async (c) => { const res = await proxyToPython("/api/fcstd-map/scan/resume"); if (!res) return c.json({ entries: [], items: [], hosts: [], files: [], results: {}, _stub: true, _stub: true }); return c.json({ ...await res.json(), _proxy: "python" }); });
cadRoutes.post("/fcstd-map/export-json", async (c) => { const body = await c.req.json(); const res = await fetch(`${PYTHON_API}/api/fcstd-map/export-json`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); if (!res.ok) return c.json({ _stub: true, error: `Python API 错误` }); return c.json({ ...await res.json(), _proxy: "python" }); });

// ── BOM 属性回写代理 (file_detail 页面) ──────────────

cadRoutes.get("/bom/prefs", async (c) => { const res = await proxyToPython("/api/bom/prefs"); if (!res) return c.json({ entries: [], items: [], hosts: [], files: [], results: {}, _stub: true, _stub: true }); return c.json({ ...await res.json(), _proxy: "python" }); });
cadRoutes.put("/bom/file", async (c) => { /* handled below */ });
cadRoutes.post("/bom/recommend-field", async (c) => { const body = await c.req.json(); const qs = new URL(c.req.url).searchParams.toString(); const res = await fetch(`${PYTHON_API}/api/bom/recommend-field?${qs}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); if (!res.ok) return c.json({ _stub: true, error: `Python API 错误` }); return c.json({ ...await res.json(), _proxy: "python" }); });
cadRoutes.post("/bom/recommend-all-fields", async (c) => { const body = await c.req.json(); const qs = new URL(c.req.url).searchParams.toString(); const res = await fetch(`${PYTHON_API}/api/bom/recommend-all-fields?${qs}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); if (!res.ok) return c.json({ _stub: true, error: `Python API 错误` }); return c.json({ ...await res.json(), _proxy: "python" }); });
cadRoutes.post("/bom/fill-recommended-values", async (c) => { const body = await c.req.json(); const qs = new URL(c.req.url).searchParams.toString(); const res = await fetch(`${PYTHON_API}/api/bom/fill-recommended-values?${qs}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); if (!res.ok) return c.json({ _stub: true, error: `Python API 错误` }); return c.json({ ...await res.json(), _proxy: "python" }); });
cadRoutes.post("/bom/fill-from-embedded", async (c) => { const body = await c.req.json(); const qs = new URL(c.req.url).searchParams.toString(); const res = await fetch(`${PYTHON_API}/api/bom/fill-from-embedded?${qs}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); if (!res.ok) return c.json({ _stub: true, error: `Python API 错误` }); return c.json({ ...await res.json(), _proxy: "python" }); });
cadRoutes.post("/bom/fill-from-filename", async (c) => { const body = await c.req.json(); const qs = new URL(c.req.url).searchParams.toString(); const res = await fetch(`${PYTHON_API}/api/bom/fill-from-filename?${qs}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); if (!res.ok) return c.json({ _stub: true, error: `Python API 错误` }); return c.json({ ...await res.json(), _proxy: "python" }); });
cadRoutes.post("/bom/apply-label-formula", async (c) => { const body = await c.req.json(); const qs = new URL(c.req.url).searchParams.toString(); const res = await fetch(`${PYTHON_API}/api/bom/apply-label-formula?${qs}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); if (!res.ok) return c.json({ _stub: true, error: `Python API 错误` }); return c.json({ ...await res.json(), _proxy: "python" }); });
cadRoutes.get("/bom/document-kinds", async (c) => { const qs = new URL(c.req.url).searchParams.toString(); const res = await proxyToPython(`/api/bom/document-kinds?${qs}`); if (!res) return c.json({ entries: [], items: [], hosts: [], files: [], results: {}, _stub: true, _stub: true }); return c.json({ ...await res.json(), _proxy: "python" }); });
cadRoutes.post("/bom/rename", async (c) => { const body = await c.req.json(); const res = await fetch(`${PYTHON_API}/api/bom/rename`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); if (!res.ok) return c.json({ _stub: true, error: `Python API 错误` }); return c.json({ ...await res.json(), _proxy: "python" }); });

// ── BOM 展开树（Rust 原生）────────────────────────────

cadRoutes.get("/bom/tree", async (c) =>
  nativeOrProxy(c,
    (ws) => pnwQueryBomTree(ws, c.req.query("rel") || ""),
    `/api/bom-xrefs/assembly-tree?rel=${encodeURIComponent(c.req.query("rel") || "")}`,
  ),
);

// ── 以下暂用 Python 代理 ──────────────────────────────

cadRoutes.get("/fcstd-map", async (c) => {
  const res = await proxyToPython("/api/fcstd-map");
  if (!res) return c.json({ entries: [], items: [], hosts: [], files: [], results: {}, _stub: true, _stub: true });
  return c.json({ ...await res.json(), _proxy: "python" });
});

/** PUT /api/cad/bom/file — BOM 属性回写（Rust fcstd-reader write） */
cadRoutes.put("/bom/file", async (c) => {
  const ws = getWorkspace(c);
  if (!ws) return c.json({ error: "需要 workspace 参数" }, 400);
  const body = await c.req.json();
  const rel = body.rel;
  if (!rel) return c.json({ error: "需要 rel" }, 400);

  const values: Record<string, string> = {};
  for (const k of ["PartNumber", "PartVersion", "PartName", "Label", "TypeCode", "ModelSeries"]) {
    if (body[k]) values[k] = body[k];
  }
  if (!Object.keys(values).length) return c.json({ error: "无有效字段" }, 400);

  // Call Rust CLI: fcstd-read write-bom
  const absPath = path.join(ws, rel);
  const kvArgs = Object.entries(values).map(([k, v]) => `${k}=${v}`);
  try {
    const result = await new Promise<any>((resolve, reject) => {
      const CLI = path.resolve(__dirname, "../../cli/target/debug/fcstd-read");
      execFile(CLI, ["write-bom", absPath, ...kvArgs], { timeout: 30_000 }, (err: any, stdout: string, stderr: string) => {
        if (err) { reject(new Error(stderr || err.message)); return; }
        try { resolve(JSON.parse(stdout)); } catch { resolve({ ok: true, raw: stdout }); }
      });
    });
    return c.json({ ...result, rel, _native: "rust" });
  } catch (e: any) {
    // Fallback to Python
    const res = await proxyToPython("/api/bom");
    if (!res) return c.json({ entries: [], items: [], hosts: [], _stub: true, error: e.message });
    return c.json({ ...await res.json(), _proxy: "python" });
  }
});

// ── STEP 批量 + SW→STEP（代理 Python，后续迁到 server/scripts/）──

cadRoutes.get("/step-batch/prefs", async (c) => {
  const res = await proxyToPython("/api/step-batch/prefs");
  if (!res) return c.json({ entries: [], items: [], hosts: [], files: [], results: {}, _stub: true, _stub: true });
  return c.json({ ...await res.json(), _proxy: "python" });
});

cadRoutes.put("/step-batch/prefs", async (c) => {
  const body = await c.req.json();
  const res = await fetch(`${PYTHON_API}/api/step-batch/prefs`, {
    method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  if (!res.ok) return c.json({ _stub: true });
  return c.json({ ...await res.json(), _proxy: "python" });
});

cadRoutes.post("/step-batch/preview", async (c) => {
  const body = await c.req.json();
  const res = await fetch(`${PYTHON_API}/api/step-batch/preview`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  if (!res.ok) return c.json({ _stub: true });
  return c.json({ ...await res.json(), _proxy: "python" });
});

cadRoutes.post("/step-batch/run", async (c) => {
  const body = await c.req.json();
  const res = await fetch(`${PYTHON_API}/api/step-batch/run`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  if (!res.ok) return c.json({ _stub: true });
  return c.json({ ...await res.json(), _proxy: "python" });
});

cadRoutes.get("/sw-step/prefs", async (c) => {
  const res = await proxyToPython("/api/sw-step-export/prefs");
  if (!res) return c.json({ entries: [], items: [], hosts: [], files: [], results: {}, _stub: true, _stub: true });
  return c.json({ ...await res.json(), _proxy: "python" });
});

cadRoutes.post("/sw-step/preview", async (c) => {
  const body = await c.req.json();
  const res = await fetch(`${PYTHON_API}/api/sw-step-export/preview`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  if (!res.ok) return c.json({ _stub: true });
  return c.json({ ...await res.json(), _proxy: "python" });
});

cadRoutes.post("/sw-step/run", async (c) => {
  const body = await c.req.json();
  const res = await fetch(`${PYTHON_API}/api/sw-step-export/run`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  if (!res.ok) return c.json({ _stub: true });
  return c.json({ ...await res.json(), _proxy: "python" });
});

cadRoutes.get("/fcstd-map/prefs", async (c) => { const res = await proxyToPython("/api/fcstd-map/prefs"); if (!res) return c.json({ entries: [], items: [], hosts: [], files: [], results: {}, _stub: true, _stub: true }); return c.json({ ...await res.json(), _proxy: "python" }); });
cadRoutes.put("/fcstd-map/prefs", async (c) => { const body = await c.req.json(); const res = await fetch(`${PYTHON_API}/api/fcstd-map/prefs`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); if (!res.ok) return c.json({ _stub: true, error: `Python API 错误` }); return c.json({ ...await res.json(), _proxy: "python" }); });
cadRoutes.post("/fcstd-map/scan", async (c) => { const body = await c.req.json(); const res = await fetch(`${PYTHON_API}/api/fcstd-map/scan`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); if (!res.ok) return c.json({ _stub: true, error: `Python API 错误` }); return c.json({ ...await res.json(), _proxy: "python" }); });
cadRoutes.post("/fcstd-map/purge-missing", async (c) => { const body = await c.req.json(); const res = await fetch(`${PYTHON_API}/api/fcstd-map/purge-missing`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); if (!res.ok) return c.json({ _stub: true, error: `Python API 错误` }); return c.json({ ...await res.json(), _proxy: "python" }); });
cadRoutes.post("/fcstd-map/scan/start", async (c) => { const body = await c.req.json(); const res = await fetch(`${PYTHON_API}/api/fcstd-map/scan/start`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); if (!res.ok) return c.json({ _stub: true, error: `Python API 错误` }); return c.json({ ...await res.json(), _proxy: "python" }); });
cadRoutes.get("/fcstd-map/scan/progress", async (c) => { const qs = new URL(c.req.url).searchParams.toString(); const res = await proxyToPython(`/api/fcstd-map/scan/progress?${qs}`); if (!res) return c.json({ entries: [], items: [], hosts: [], files: [], results: {}, _stub: true, _stub: true }); return c.json({ ...await res.json(), _proxy: "python" }); });
cadRoutes.post("/fcstd-map/scan/cancel", async (c) => { const qs = new URL(c.req.url).searchParams.toString(); const res = await fetch(`${PYTHON_API}/api/fcstd-map/scan/cancel?${qs}`, { method: "POST" }); if (!res.ok) return c.json({ _stub: true, error: `Python API 错误` }); return c.json({ ...await res.json(), _proxy: "python" }); });
cadRoutes.get("/fcstd-map/scan/history", async (c) => { const qs = new URL(c.req.url).searchParams.toString(); const res = await proxyToPython(`/api/fcstd-map/scan/history?${qs}`); if (!res) return c.json({ entries: [], items: [], hosts: [], files: [], results: {}, _stub: true, _stub: true }); return c.json({ ...await res.json(), _proxy: "python" }); });
cadRoutes.get("/fcstd-map/scan/resume", async (c) => { const res = await proxyToPython("/api/fcstd-map/scan/resume"); if (!res) return c.json({ entries: [], items: [], hosts: [], files: [], results: {}, _stub: true, _stub: true }); return c.json({ ...await res.json(), _proxy: "python" }); });
cadRoutes.post("/fcstd-map/export-json", async (c) => { const body = await c.req.json(); const res = await fetch(`${PYTHON_API}/api/fcstd-map/export-json`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); if (!res.ok) return c.json({ _stub: true, error: `Python API 错误` }); return c.json({ ...await res.json(), _proxy: "python" }); });

// ── XLink 路径修正 + 改名分析（代理 Python）───────────

// xlink-fix
cadRoutes.get("/xlink-fix/prefs", async (c) => { const res = await proxyToPython("/api/xlink-fix/prefs"); if (!res) return c.json({ entries: [], items: [], hosts: [], files: [], results: {}, _stub: true, _stub: true }); return c.json({ ...await res.json(), _proxy: "python" }); });
cadRoutes.put("/xlink-fix/prefs", async (c) => { const body = await c.req.json(); const res = await fetch(`${PYTHON_API}/api/xlink-fix/prefs`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); if (!res.ok) return c.json({ _stub: true, error: `Python API 错误` }); return c.json({ ...await res.json(), _proxy: "python" }); });
cadRoutes.post("/xlink-fix/analyze", async (c) => { const body = await c.req.json(); const res = await fetch(`${PYTHON_API}/api/xlink-fix/analyze`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); if (!res.ok) return c.json({ _stub: true, error: `Python API 错误` }); return c.json({ ...await res.json(), _proxy: "python" }); });
cadRoutes.post("/xlink-fix/run", async (c) => { const body = await c.req.json(); const res = await fetch(`${PYTHON_API}/api/xlink-fix/run`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); if (!res.ok) return c.json({ _stub: true, error: `Python API 错误` }); return c.json({ ...await res.json(), _proxy: "python" }); });
cadRoutes.post("/xlink-fix/apply-override", async (c) => { const body = await c.req.json(); const res = await fetch(`${PYTHON_API}/api/xlink-fix/apply-override`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); if (!res.ok) return c.json({ _stub: true, error: `Python API 错误` }); return c.json({ ...await res.json(), _proxy: "python" }); });
cadRoutes.get("/xlink-fix/candidates", async (c) => { const qs = new URL(c.req.url).searchParams.toString(); const res = await proxyToPython(`/api/xlink-fix/candidates?${qs}`); if (!res) return c.json({ entries: [], items: [], hosts: [], files: [], results: {}, _stub: true, _stub: true }); return c.json({ ...await res.json(), _proxy: "python" }); });

// rename-analysis
cadRoutes.get("/rename/logs", async (c) => { const qs = new URL(c.req.url).searchParams.toString(); const res = await proxyToPython(`/api/rename-analysis/logs?${qs}`); if (!res) return c.json({ entries: [], items: [], hosts: [], files: [], results: {}, _stub: true, _stub: true }); return c.json({ ...await res.json(), _proxy: "python" }); });
cadRoutes.post("/rename/analyze", async (c) => { const body = await c.req.json(); const res = await fetch(`${PYTHON_API}/api/rename-analysis/analyze`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); if (!res.ok) return c.json({ _stub: true, error: `Python API 错误` }); return c.json({ ...await res.json(), _proxy: "python" }); });
cadRoutes.post("/rename/apply", async (c) => { const body = await c.req.json(); const res = await fetch(`${PYTHON_API}/api/rename-analysis/apply`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); if (!res.ok) return c.json({ _stub: true, error: `Python API 错误` }); return c.json({ ...await res.json(), _proxy: "python" }); });
cadRoutes.get("/rename/load", async (c) => { const qs = new URL(c.req.url).searchParams.toString(); const res = await proxyToPython(`/api/rename-analysis/load?${qs}`); if (!res) return c.json({ entries: [], items: [], hosts: [], files: [], results: {}, _stub: true, _stub: true }); return c.json({ ...await res.json(), _proxy: "python" }); });
cadRoutes.post("/rename/export-report", async (c) => { const body = await c.req.json(); const res = await fetch(`${PYTHON_API}/api/rename-analysis/export-report`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); if (!res.ok) return c.json({ _stub: true, error: `Python API 错误` }); return c.json({ ...await res.json(), _proxy: "python" }); });

// ── 编号查重（代理 Python）────────────────────────────

cadRoutes.get("/part-dedup/prefs", async (c) => {
  const res = await proxyToPython("/api/part-dedup/prefs");
  if (!res) return c.json({ entries: [], items: [], hosts: [], files: [], results: {}, _stub: true, _stub: true });
  return c.json({ ...await res.json(), _proxy: "python" });
});

cadRoutes.put("/part-dedup/prefs", async (c) => {
  const body = await c.req.json();
  const res = await fetch(`${PYTHON_API}/api/part-dedup/prefs`, {
    method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  if (!res.ok) return c.json({ _stub: true });
  return c.json({ ...await res.json(), _proxy: "python" });
});

cadRoutes.post("/part-dedup/scan", async (c) => {
  const body = await c.req.json();
  const res = await fetch(`${PYTHON_API}/api/part-dedup/scan`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  if (!res.ok) return c.json({ _stub: true });
  return c.json({ ...await res.json(), _proxy: "python" });
});

cadRoutes.post("/part-dedup/export-csv", async (c) => {
  const body = await c.req.json();
  const res = await fetch(`${PYTHON_API}/api/part-dedup/export-csv`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  if (!res.ok) return c.json({ _stub: true });
  return c.json({ ...await res.json(), _proxy: "python" });
});

cadRoutes.get("/fcstd-map/prefs", async (c) => { const res = await proxyToPython("/api/fcstd-map/prefs"); if (!res) return c.json({ entries: [], items: [], hosts: [], files: [], results: {}, _stub: true, _stub: true }); return c.json({ ...await res.json(), _proxy: "python" }); });
cadRoutes.put("/fcstd-map/prefs", async (c) => { const body = await c.req.json(); const res = await fetch(`${PYTHON_API}/api/fcstd-map/prefs`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); if (!res.ok) return c.json({ _stub: true, error: `Python API 错误` }); return c.json({ ...await res.json(), _proxy: "python" }); });
cadRoutes.post("/fcstd-map/scan", async (c) => { const body = await c.req.json(); const res = await fetch(`${PYTHON_API}/api/fcstd-map/scan`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); if (!res.ok) return c.json({ _stub: true, error: `Python API 错误` }); return c.json({ ...await res.json(), _proxy: "python" }); });
cadRoutes.post("/fcstd-map/purge-missing", async (c) => { const body = await c.req.json(); const res = await fetch(`${PYTHON_API}/api/fcstd-map/purge-missing`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); if (!res.ok) return c.json({ _stub: true, error: `Python API 错误` }); return c.json({ ...await res.json(), _proxy: "python" }); });
cadRoutes.post("/fcstd-map/scan/start", async (c) => { const body = await c.req.json(); const res = await fetch(`${PYTHON_API}/api/fcstd-map/scan/start`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); if (!res.ok) return c.json({ _stub: true, error: `Python API 错误` }); return c.json({ ...await res.json(), _proxy: "python" }); });
cadRoutes.get("/fcstd-map/scan/progress", async (c) => { const qs = new URL(c.req.url).searchParams.toString(); const res = await proxyToPython(`/api/fcstd-map/scan/progress?${qs}`); if (!res) return c.json({ entries: [], items: [], hosts: [], files: [], results: {}, _stub: true, _stub: true }); return c.json({ ...await res.json(), _proxy: "python" }); });
cadRoutes.post("/fcstd-map/scan/cancel", async (c) => { const qs = new URL(c.req.url).searchParams.toString(); const res = await fetch(`${PYTHON_API}/api/fcstd-map/scan/cancel?${qs}`, { method: "POST" }); if (!res.ok) return c.json({ _stub: true, error: `Python API 错误` }); return c.json({ ...await res.json(), _proxy: "python" }); });
cadRoutes.get("/fcstd-map/scan/history", async (c) => { const qs = new URL(c.req.url).searchParams.toString(); const res = await proxyToPython(`/api/fcstd-map/scan/history?${qs}`); if (!res) return c.json({ entries: [], items: [], hosts: [], files: [], results: {}, _stub: true, _stub: true }); return c.json({ ...await res.json(), _proxy: "python" }); });
cadRoutes.get("/fcstd-map/scan/resume", async (c) => { const res = await proxyToPython("/api/fcstd-map/scan/resume"); if (!res) return c.json({ entries: [], items: [], hosts: [], files: [], results: {}, _stub: true, _stub: true }); return c.json({ ...await res.json(), _proxy: "python" }); });
cadRoutes.post("/fcstd-map/export-json", async (c) => { const body = await c.req.json(); const res = await fetch(`${PYTHON_API}/api/fcstd-map/export-json`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); if (!res.ok) return c.json({ _stub: true, error: `Python API 错误` }); return c.json({ ...await res.json(), _proxy: "python" }); });

// ── 扫描进度 + 工作集（代理 Python）───────────────────

cadRoutes.get("/scan/progress", async (c) => {
  const res = await proxyToPython("/api/scan/progress");
  if (!res) return c.json({ entries: [], items: [], hosts: [], files: [], results: {}, _stub: true, _stub: true });
  return c.json({ ...await res.json(), _proxy: "python" });
});

cadRoutes.get("/scan/recent", async (c) => {
  const res = await proxyToPython("/api/scan/recent");
  if (!res) return c.json({ entries: [], items: [], hosts: [], files: [], results: {}, _stub: true, _stub: true });
  return c.json({ ...await res.json(), _proxy: "python" });
});

cadRoutes.get("/worksets", async (c) => {
  const res = await proxyToPython("/api/worksets");
  if (!res) return c.json({ entries: [], items: [], hosts: [], files: [], results: {}, _stub: true, _stub: true });
  return c.json({ ...await res.json(), _proxy: "python" });
});

cadRoutes.get("/bom/batch", async (c) => c.json({ error: "batch 暂未实现" }, 501));
