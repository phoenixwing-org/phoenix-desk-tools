import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PNW_WORKSPACE_SCHEMA_V13_DDL } from "@phoenix-wing/workspace-schema";
import { phoenixDatabasePath } from "./phoenixDatabaseService.js";
import { inspectCadIndex, loadCadIndexStatus } from "./cadIndexStatusService.js";
import { searchCadIndex } from "../features/cad-index-search/service.js";
import * as readLease from "./cadSqliteReadLease.js";

const roots: string[] = [];
function fixture() {
  // Independent schema-only fixtures: no model contents or private project graph.
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "desk-status-generation-"))); roots.push(root);
  const filename = phoenixDatabasePath(root); fs.mkdirSync(path.dirname(filename));
  const db = new DatabaseSync(filename);
  try {
    db.exec(PNW_WORKSPACE_SCHEMA_V13_DDL);
    db.prepare("INSERT INTO phoenix_meta(key,value) VALUES ('schema_version','13')").run();
    db.prepare("INSERT INTO phoenix_cad_file_asset(repo_rel_path,filename,label,updated_at) VALUES ('shapes/First.FCStd','First.FCStd','generation-one','one')").run();
    db.prepare("INSERT INTO phoenix_cad_scan(scanned_at,scan_root,stats_json,status) VALUES ('generation-one','shapes','{}','done')").run();
  } finally { db.close(); }
  return { root, filename, before: fs.readFileSync(filename) };
}

function attemptNextGeneration(filename: string): { committed: boolean; error?: string } {
  const loader = fileURLToPath(new URL("../../../scripts/register-local-wing.mjs", import.meta.url));
  const args = process.env.PHOENIX_WING_MODE === "local" ? ["--import", loader] : [];
  const source = `
import { pnwCreateDb } from "@phoenix-wing/db-node";
let db;
try {
  db = pnwCreateDb(${JSON.stringify(filename)});
  db.exec("BEGIN IMMEDIATE");
  db.run("UPDATE phoenix_cad_file_asset SET label='generation-two'");
  db.run("INSERT INTO phoenix_cad_file_asset(repo_rel_path,filename,label,updated_at) VALUES ('shapes/Second.FCStd','Second.FCStd','generation-two','two')");
  db.run("INSERT INTO phoenix_cad_scan(scanned_at,scan_root,stats_json,status) VALUES ('generation-two','shapes','{}','done')");
  db.exec("COMMIT");
  process.stdout.write(JSON.stringify({ committed: true }));
} catch (error) {
  if (db?.inTransaction) db.exec("ROLLBACK");
  process.stdout.write(JSON.stringify({ committed: false, error: String(error.message || error) }));
} finally { db?.close(); }
`;
  return JSON.parse(execFileSync(process.execPath, [...args, "--input-type=module", "--eval", source], {
    cwd: fileURLToPath(new URL("../../", import.meta.url)), env: process.env, encoding: "utf8", timeout: 5000,
  }));
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("native CAD diagnostic and search single-generation reads", () => {
  it.each(["diagnostics", "basic status", "search"] as const)("keeps %s in one lease and refuses an interleaved real WASM commit", kind => {
    const data = fixture(), prepare = DatabaseSync.prototype.prepare;
    let attempt: ReturnType<typeof attemptNextGeneration> | undefined;
    const open = vi.spyOn(readLease, "openCadSqliteReadDatabase");
    vi.spyOn(DatabaseSync.prototype, "prepare").mockImplementation(function (this: DatabaseSync, sql: string) {
      const statement = prepare.call(this, sql);
      if (sql.startsWith("SELECT repo_rel_path,file_status FROM phoenix_cad_file_asset")) {
        const all = statement.all.bind(statement);
        // A native statement finishes before the writer attempts to change scan
        // metadata; the next query advances by this hook, never an elapsed sleep.
        statement.all = (() => {
          const rows = all(); attempt = attemptNextGeneration(data.filename); return rows;
        }) as typeof statement.all;
      }
      return statement;
    });
    if (kind === "diagnostics") {
      expect(inspectCadIndex(data.root)).toMatchObject({ state: "ready", totalEntries: 1,
        lastScanAt: "generation-one", latestScan: { id: 1, at: "generation-one" } });
    } else if (kind === "basic status") {
      expect(loadCadIndexStatus(data.root)).toEqual({ indexed: true, totalEntries: 1, lastScanAt: "generation-one" });
    } else {
      expect(searchCadIndex(data.root)).toMatchObject({ rows: [{ label: "generation-one" }],
        diagnostics: { state: "ready", totalEntries: 1, lastScanAt: "generation-one", latestScan: { id: 1 } } });
    }
    expect(open).toHaveBeenCalledTimes(1);
    expect(attempt).toMatchObject({ committed: false }); expect(attempt?.error).toMatch(/busy|lock/i);
    expect(fs.readFileSync(data.filename)).toEqual(data.before);
    expect(fs.readdirSync(data.root)).toEqual([".phoenix"]);
    expect(fs.readdirSync(path.dirname(data.filename))).toEqual([path.basename(data.filename)]);
  });
});
