import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { pnwCreateDb } from "phoenix-wing/db/pnwDbAdapter";
import {
  ensurePhoenixDatabase,
  getPhoenixDatabaseStatus,
  PHOENIX_SCHEMA_VERSION,
  recreatePhoenixDatabase,
} from "./phoenixDatabaseService.js";

const tempRoots: string[] = [];

function makeWorkspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "phoenix-database-"));
  tempRoots.push(root);
  return root;
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("Phoenix workspace database", () => {
  it("creates the complete v13 schema and reports it as current", () => {
    const workspace = makeWorkspace();
    expect(getPhoenixDatabaseStatus(workspace)).toMatchObject({
      database_exists: false,
      needs_recreate: false,
      schema_version: null,
      expected_schema_version: PHOENIX_SCHEMA_VERSION,
    });

    const filename = ensurePhoenixDatabase(workspace);
    const db = pnwCreateDb(filename);
    try {
      const tables = new Set(db.all<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type = 'table'",
      ).map((row) => row.name));
      for (const table of [
        "phoenix_meta",
        "phoenix_cad_scan",
        "phoenix_cad_file_asset",
        "phoenix_cad_bom_xref",
        "phoenix_code_file_asset",
        "phoenix_workset",
        "phoenix_workspace_pref",
        "phoenix_ui_session",
      ]) {
        expect(tables.has(table), table).toBe(true);
      }
    } finally {
      db.close();
    }

    expect(getPhoenixDatabaseStatus(workspace)).toMatchObject({
      database_exists: true,
      needs_recreate: false,
      schema_version: 13,
      database_path_display: ".phoenix/phoenix-workspace.sqlite",
    });
  });

  it("detects legacy files and replaces only the known database families", () => {
    const workspace = makeWorkspace();
    const phoenixDir = path.join(workspace, ".phoenix");
    fs.mkdirSync(phoenixDir, { recursive: true });
    const legacy = path.join(phoenixDir, "cad-database.sqlite");
    const db = pnwCreateDb(legacy);
    try {
      db.exec("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
      db.run("INSERT INTO meta(key, value) VALUES (?, ?)", ["schema_version", "10"]);
    } finally {
      db.close();
    }
    const unrelated = path.join(phoenixDir, "keep-me.sqlite");
    fs.writeFileSync(unrelated, "keep");

    expect(getPhoenixDatabaseStatus(workspace)).toMatchObject({
      legacy_detected: true,
      needs_recreate: true,
      legacy_file_exists: true,
      old_tables_found: ["meta"],
    });

    const rebuilt = recreatePhoenixDatabase(workspace);
    expect(rebuilt).toMatchObject({
      status: "recreated",
      removed_files: ["cad-database.sqlite"],
      schema_version: 13,
    });
    expect(fs.existsSync(legacy)).toBe(false);
    expect(fs.readFileSync(unrelated, "utf8")).toBe("keep");
    expect(getPhoenixDatabaseStatus(workspace).needs_recreate).toBe(false);
  });

  it("flags a current-name database with a mismatched schema version", () => {
    const workspace = makeWorkspace();
    const filename = path.join(workspace, ".phoenix", "phoenix-workspace.sqlite");
    fs.mkdirSync(path.dirname(filename), { recursive: true });
    const db = pnwCreateDb(filename);
    try {
      db.exec("CREATE TABLE phoenix_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
      db.run("INSERT INTO phoenix_meta(key, value) VALUES (?, ?)", ["schema_version", "12"]);
    } finally {
      db.close();
    }
    expect(getPhoenixDatabaseStatus(workspace)).toMatchObject({
      legacy_detected: false,
      needs_recreate: true,
      reasons: ["schema_version_mismatch"],
      schema_version: 12,
    });
  });
});
