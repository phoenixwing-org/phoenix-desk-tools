import fs from "node:fs";
import path from "node:path";
import { phoenixDatabasePath } from "./phoenixDatabaseService.js";
import { PNW_WORKSPACE_SCHEMA_VERSION } from "@phoenix-wing/workspace-schema";
import { cadPathExcludedFromDiscovery } from "./cadIndexScanScope.js";
import { openCadSqliteReadDatabase } from "./cadSqliteReadLease.js";

export type CadIndexDiagnostics = {
  state: "missing" | "incompatible" | "unreadable" | "empty" | "attention" | "ready";
  message: string;
  schemaVersion: number | null;
  expectedSchemaVersion: number;
  totalEntries: number;
  missingEntries: number;
  failedEntries: number;
  failures: Array<{ rel: string; message: string }>;
  lastScanAt: string;
  latestScan: { id: number; status: string; root: string; at: string } | null;
};

export function missingCadIndexDiagnostics(): CadIndexDiagnostics {
  return {
    state: "missing", message: "尚无工作空间索引，可点击「更新索引」进行完整扫描。",
    schemaVersion: null, expectedSchemaVersion: PNW_WORKSPACE_SCHEMA_VERSION,
    totalEntries: 0, missingEntries: 0, failedEntries: 0, failures: [], lastScanAt: "", latestScan: null,
  };
}

type CadIndexReadDatabase = Pick<ReturnType<typeof openCadSqliteReadDatabase>, "prepare">;

/** Caller owns one shared host lease and read transaction for diagnostics and data. */
export function inspectCadIndexFromDatabase(db: CadIndexReadDatabase): CadIndexDiagnostics {
  const result = missingCadIndexDiagnostics();
  try {
    const tables = new Set((db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]).map(row => row.name));
    const raw = tables.has("phoenix_meta") ? (db.prepare("SELECT value FROM phoenix_meta WHERE key='schema_version'").get() as { value: string } | undefined)?.value : undefined;
    result.schemaVersion = raw && Number.isInteger(Number(raw)) ? Number(raw) : null;
    if (result.schemaVersion !== PNW_WORKSPACE_SCHEMA_VERSION || !tables.has("phoenix_cad_file_asset") || !tables.has("phoenix_cad_scan")) {
      return { ...result, state: "incompatible", message: "Schema 不兼容或缺少 CAD 表；请先备份并核对工作空间版本。不会自动升级或重建数据库。" };
    }
    const counts = visibleCadIndexCounts(db);
    result.totalEntries = counts.total;
    result.missingEntries = counts.missing;
    const latest = db.prepare("SELECT id, status, stats_json, scan_root AS root, COALESCE(finished_at, scanned_at, started_at, '') AS at FROM phoenix_cad_scan ORDER BY id DESC LIMIT 1").get() as { id: number; status: string; stats_json: string; root: string; at: string } | undefined;
    result.latestScan = latest ? { id: latest.id, status: latest.status, root: latest.root, at: latest.at } : null;
    result.lastScanAt = (db.prepare("SELECT COALESCE(finished_at, scanned_at, started_at, '') AS at FROM phoenix_cad_scan WHERE status='done' ORDER BY id DESC LIMIT 1").get() as { at: string } | undefined)?.at || "";
    if (latest?.status === "partial") {
      const failures = scanFailures(latest.stats_json);
      return { ...result, ...failures, state: "attention", message: `索引部分可用：${failures.failedEntries} 个文件未成功读取；图册可用，BOM 不完整。请核对失败清单，修正后重新更新索引。` };
    }
    if (latest?.status === "cleared") return { ...result, state: "empty", message: "旧索引已清理，请点击「更新索引」重建；零件资料与磁盘文件未删除。" };
    if (latest?.status === "stale") return { ...result, state: "attention", message: "文件或引用已局部更新，递归 BOM 快照待完整扫描；请点击「更新索引」。" };
    if ((latest && latest.status !== "done") || result.missingEntries > 0) {
      return { ...result, state: "attention", message: "最近扫描未成功完成或索引记录含缺失文件，请核对扫描状态与修正范围。" };
    }
    if (!result.totalEntries || !result.lastScanAt) {
      return { ...result, state: "empty", message: "尚无完整 CAD 扫描结果，请点击「更新索引」。" };
    }
    return { ...result, state: "ready", message: "已有可读取索引；这里只核对索引记录，不代表磁盘文件已同步。" };
  } catch (error) {
    return { ...result, state: "unreadable", message: `索引读取失败：${error instanceof Error ? error.message : String(error)}` };
  }
}

/** Host diagnostics only: no DDL, scan, migration, purge or journal normalization. */
export function inspectCadIndex(workspace: string): CadIndexDiagnostics {
  if (!workspace?.trim() || !fs.statSync(workspace).isDirectory()) throw new Error("请先打开工作空间");
  const filename = phoenixDatabasePath(workspace);
  if (!fs.existsSync(filename)) return missingCadIndexDiagnostics();
  let db: ReturnType<typeof openCadSqliteReadDatabase> | undefined;
  try {
    db = openReadOnlyCadIndex(workspace, filename);
    return inspectCadIndexFromDatabase(db);
  } catch (error) {
    return { ...missingCadIndexDiagnostics(), state: "unreadable", message: `索引读取失败：${error instanceof Error ? error.message : String(error)}` };
  } finally { db?.close(); }
}

function scanFailures(raw: string): Pick<CadIndexDiagnostics, "failedEntries" | "failures"> {
  let stats: { failed_count?: unknown; failures?: unknown } = {};
  try { const parsed: unknown = JSON.parse(raw); if (parsed && typeof parsed === "object") stats = parsed; } catch { /* Older scans may not retain failure details. */ }
  const entries = Array.isArray(stats.failures) ? stats.failures : [];
  const failedEntries = typeof stats.failed_count === "number" && Number.isSafeInteger(stats.failed_count) && stats.failed_count >= 0
    ? stats.failed_count : entries.length;
  const failures = entries.filter((entry): entry is { rel: string; message: string } => Boolean(entry && typeof entry === "object"
    && typeof entry.rel === "string" && typeof entry.message === "string")).slice(0, 100)
    .map(entry => ({ rel: entry.rel, message: entry.message }));
  return { failedEntries, failures };
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

function openReadOnlyCadIndex(workspace: string, filename: string): ReturnType<typeof openCadSqliteReadDatabase> {
  const relative = path.relative(fs.realpathSync(workspace), fs.realpathSync(filename));
  if (path.isAbsolute(relative) || relative === ".." || relative.startsWith(`..${path.sep}`)) {
    throw new Error("索引路径超出工作空间，请核对 .phoenix 目录或文件链接。");
  }
  return openCadSqliteReadDatabase(filename);
}

function visibleCadIndexCounts(db: CadIndexReadDatabase): { total: number; missing: number } {
  // Only index metadata is read; preserved excluded identities are not normal coverage.
  const rows = db.prepare("SELECT repo_rel_path,file_status FROM phoenix_cad_file_asset WHERE file_status!='ignored'")
    .all() as { repo_rel_path: string; file_status: string }[];
  const included = rows.filter(row => !cadPathExcludedFromDiscovery(row.repo_rel_path));
  return { total: included.length, missing: included.filter(row => row.file_status === "missing").length };
}

/** Read the shared CAD index without creating, migrating or rescanning it. */
export function loadCadIndexStatus(workspace: string): CadIndexStatus {
  if (!workspace) return EMPTY_STATUS;
  const filename = phoenixDatabasePath(workspace);
  if (!fs.existsSync(filename)) return EMPTY_STATUS;
  let db: ReturnType<typeof openCadSqliteReadDatabase> | undefined;
  try {
    db = openReadOnlyCadIndex(workspace, filename);
    const totalEntries = visibleCadIndexCounts(db).total;
    const scan = db.prepare(
      `SELECT COALESCE(finished_at, scanned_at, started_at, '') AS last_scan_at
       FROM phoenix_cad_scan
       WHERE status = 'done'
       ORDER BY id DESC
       LIMIT 1`,
    ).get() as { last_scan_at: string | null } | undefined;
    const lastScanAt = String(scan?.last_scan_at ?? "").trim();
    return { indexed: Boolean(lastScanAt) || totalEntries > 0, lastScanAt, totalEntries };
  } catch (error) {
    // An absent index is empty; a busy, unsupported or unreadable index is not.
    throw new Error(`索引状态读取失败：${error instanceof Error ? error.message : String(error)}`, { cause: error });
  } finally {
    db?.close();
  }
}
