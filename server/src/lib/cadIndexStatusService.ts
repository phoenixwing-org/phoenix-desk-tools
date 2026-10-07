import fs from "node:fs";
import { pnwCreateDb } from "@phoenix-wing/db-node";
import { phoenixDatabasePath } from "./phoenixDatabaseService.js";
import { PNW_WORKSPACE_SCHEMA_VERSION } from "@phoenix-wing/workspace-schema";

export type CadIndexDiagnostics = {
  state: "missing" | "incompatible" | "unreadable" | "empty" | "attention" | "ready";
  message: string;
  schemaVersion: number | null;
  expectedSchemaVersion: number;
  totalEntries: number;
  missingEntries: number;
  lastScanAt: string;
  latestScan: { status: string; root: string; at: string } | null;
};

/** Host diagnostics only: no DDL, scan, migration, purge or journal normalization. */
export function inspectCadIndex(workspace: string): CadIndexDiagnostics {
  if (!workspace?.trim() || !fs.statSync(workspace).isDirectory()) throw new Error("请先打开工作空间");
  const result: CadIndexDiagnostics = {
    state: "missing", message: "尚无工作空间索引，可点击「更新索引」进行完整扫描。",
    schemaVersion: null, expectedSchemaVersion: PNW_WORKSPACE_SCHEMA_VERSION,
    totalEntries: 0, missingEntries: 0, lastScanAt: "", latestScan: null,
  };
  const filename = phoenixDatabasePath(workspace);
  if (!fs.existsSync(filename)) return result;
  let db: ReturnType<typeof pnwCreateDb> | undefined;
  try {
    db = pnwCreateDb(filename);
    db.exec("PRAGMA query_only = ON");
    const tables = new Set(db.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type='table'").map(row => row.name));
    const raw = tables.has("phoenix_meta") ? db.get<{ value: string }>("SELECT value FROM phoenix_meta WHERE key='schema_version'")?.value : undefined;
    result.schemaVersion = raw && Number.isInteger(Number(raw)) ? Number(raw) : null;
    if (result.schemaVersion !== PNW_WORKSPACE_SCHEMA_VERSION || !tables.has("phoenix_cad_file_asset") || !tables.has("phoenix_cad_scan")) {
      return { ...result, state: "incompatible", message: "Schema 不兼容或缺少 CAD 表，请在 KT Auto CAD 检查/升级；不会自动重建数据库。" };
    }
    const counts = db.get<{ total: number; missing: number }>("SELECT COUNT(*) AS total, SUM(CASE WHEN file_status='missing' THEN 1 ELSE 0 END) AS missing FROM phoenix_cad_file_asset");
    result.totalEntries = Number(counts?.total || 0);
    result.missingEntries = Number(counts?.missing || 0);
    const latest = db.get<{ status: string; root: string; at: string }>("SELECT status, scan_root AS root, COALESCE(finished_at, scanned_at, started_at, '') AS at FROM phoenix_cad_scan ORDER BY id DESC LIMIT 1");
    result.latestScan = latest ?? null;
    result.lastScanAt = db.get<{ at: string }>("SELECT COALESCE(finished_at, scanned_at, started_at, '') AS at FROM phoenix_cad_scan WHERE status='done' ORDER BY id DESC LIMIT 1")?.at || "";
    if (latest?.status === "cleared") return { ...result, state: "empty", message: "旧索引已清理，请点击「更新索引」重建；零件资料与磁盘文件未删除。" };
    if ((latest && latest.status !== "done") || result.missingEntries > 0) {
      return { ...result, state: "attention", message: "最近扫描未成功完成或索引记录含缺失文件，请核对扫描状态与修正范围。" };
    }
    if (!result.totalEntries || !result.lastScanAt) {
      return { ...result, state: "empty", message: "尚无完整 CAD 扫描结果，请点击「更新索引」。" };
    }
    return { ...result, state: "ready", message: "已有可读取索引；这里只核对索引记录，不代表磁盘文件已同步。" };
  } catch (error) {
    return { ...result, state: "unreadable", message: `索引读取失败：${error instanceof Error ? error.message : String(error)}` };
  } finally {
    db?.close();
  }
}

export type CadIndexStatus = {
  indexed: boolean;
  lastScanAt: string;
  totalEntries: number;
};

const EMPTY_STATUS: CadIndexStatus = {
  indexed: false,
  lastScanAt: "",
  totalEntries: 0,
};

/** Read the KT Auto CAD-owned Schema v13 index without creating or rescanning it. */
export function loadCadIndexStatus(workspace: string): CadIndexStatus {
  if (!workspace) return EMPTY_STATUS;
  const filename = phoenixDatabasePath(workspace);
  if (!fs.existsSync(filename)) return EMPTY_STATUS;
  const db = pnwCreateDb(filename);
  try {
    const totalEntries = Number(
      db.get<{ count: number }>("SELECT COUNT(*) AS count FROM phoenix_cad_file_asset")?.count ?? 0,
    );
    const scan = db.get<{ last_scan_at: string | null }>(
      `SELECT COALESCE(finished_at, scanned_at, started_at, '') AS last_scan_at
       FROM phoenix_cad_scan
       WHERE status = 'done'
       ORDER BY id DESC
       LIMIT 1`,
    );
    const lastScanAt = String(scan?.last_scan_at ?? "").trim();
    return { indexed: Boolean(lastScanAt) || totalEntries > 0, lastScanAt, totalEntries };
  } catch {
    return EMPTY_STATUS;
  } finally {
    db.close();
  }
}
