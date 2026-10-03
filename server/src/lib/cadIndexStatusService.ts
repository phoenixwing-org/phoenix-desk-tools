import fs from "node:fs";
import { pnwCreateDb } from "@phoenix-wing/db-node";
import { phoenixDatabasePath } from "./phoenixDatabaseService.js";

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
