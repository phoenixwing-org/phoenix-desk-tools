import fs from "node:fs";
import path from "node:path";
import { pnwCreateDb } from "@phoenix-wing/db-node";
import { ensurePhoenixDatabase } from "./phoenixDatabaseService.js";

const SESSION_VERSION = 1;
const SESSION_SCOPE = "workbench";
const DB_BASENAME = "phoenix-workspace.sqlite";

export type WorkbenchSession = {
  version: number;
  active_tab_id: string;
  tabs: Array<Record<string, unknown>>;
};

export type WorkbenchSessionPayload = {
  version: number;
  session: WorkbenchSession | null;
  updated_at: string | null;
  database_path: string;
  database_path_display: string;
};

function assertWorkspace(workspace: string): string {
  const resolved = path.resolve(String(workspace || "").trim());
  try {
    if (fs.statSync(resolved).isDirectory()) return resolved;
  } catch {
    // Report the same route-level error for missing and non-directory paths.
  }
  throw new Error("Workspace is not configured");
}

function databasePath(workspace: string): string {
  return path.join(workspace, ".phoenix", DB_BASENAME);
}

function displayPath(workspace: string, filename: string): string {
  return path.relative(workspace, filename).replace(/\\/g, "/");
}

function basePayload(workspace: string): WorkbenchSessionPayload {
  const filename = databasePath(workspace);
  return {
    version: SESSION_VERSION,
    session: null,
    updated_at: null,
    database_path: filename,
    database_path_display: displayPath(workspace, filename),
  };
}

function normalizeSession(raw: unknown): WorkbenchSession {
  const body = raw && typeof raw === "object" && !Array.isArray(raw)
    ? raw as Record<string, unknown>
    : {};
  const tabs = Array.isArray(body.tabs)
    ? body.tabs.filter((tab): tab is Record<string, unknown> => Boolean(tab) && typeof tab === "object" && !Array.isArray(tab))
    : [];
  return {
    version: SESSION_VERSION,
    active_tab_id: String(body.active_tab_id ?? body.activeTabId ?? ""),
    tabs,
  };
}

export function loadWorkbenchSession(workspace: string): WorkbenchSessionPayload {
  const resolved = assertWorkspace(workspace);
  const payload = basePayload(resolved);
  if (!fs.existsSync(payload.database_path)) return payload;
  const db = pnwCreateDb(payload.database_path);
  try {
    const table = db.get(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
      ["phoenix_ui_session"],
    );
    if (!table) return payload;
    const row = db.get<{ payload_json: string; updated_at: string }>(
      "SELECT payload_json, updated_at FROM phoenix_ui_session WHERE scope = ?",
      [SESSION_SCOPE],
    );
    if (!row) return payload;
    payload.updated_at = String(row.updated_at || "") || null;
    try {
      const parsed = JSON.parse(String(row.payload_json || "null"));
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        payload.session = normalizeSession(parsed);
      }
    } catch {
      payload.session = null;
    }
    return payload;
  } finally {
    db.close();
  }
}

export function saveWorkbenchSession(workspace: string, raw: unknown): WorkbenchSessionPayload {
  const resolved = assertWorkspace(workspace);
  const filename = ensurePhoenixDatabase(resolved);
  const session = normalizeSession(raw);
  const updatedAt = new Date().toISOString();
  const db = pnwCreateDb(filename);
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS phoenix_ui_session (
        scope TEXT PRIMARY KEY NOT NULL,
        payload_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);
    db.run(
      `INSERT INTO phoenix_ui_session(scope, payload_json, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(scope) DO UPDATE SET
         payload_json = excluded.payload_json,
         updated_at = excluded.updated_at`,
      [SESSION_SCOPE, JSON.stringify(session), updatedAt],
    );
  } finally {
    db.close();
  }
  return {
    ...basePayload(resolved),
    session,
    updated_at: updatedAt,
  };
}
