import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { pnwCreateDb } from "@phoenix-wing/db-node";
import schemaFixture from "@phoenix-wing/workspace-schema/fixtures/workspace-schema-compatibility-v1.json" with { type: "json" };
import {
  PNW_WORKSPACE_SCHEMA_VERSION,
  pnwClassifyWorkspaceSchemaVersion,
} from "@phoenix-wing/workspace-schema";
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
  it("直接消费 Registry schema fixture 并对未知版本 fail-closed", () => {
    expect(PNW_WORKSPACE_SCHEMA_VERSION).toBe(schemaFixture.current_version);
    for (const item of schemaFixture.cases) {
      const classification = pnwClassifyWorkspaceSchemaVersion(item.actual_version);
      expect(classification).toBe(item.classification);
      expect(classification === "current").toBe(item.may_write);
    }
  });

  it("migrates a legacy WAL database before the WASM adapter opens it", () => {
    const workspace = makeWorkspace();
    const filename = path.join(workspace, ".phoenix", "phoenix-workspace.sqlite");
    fs.mkdirSync(path.dirname(filename), { recursive: true });
    const nativeDb = new DatabaseSync(filename);
    try {
      nativeDb.exec("CREATE TABLE legacy_value (value TEXT); PRAGMA journal_mode = WAL");
    } finally {
      nativeDb.close();
    }

    expect(fs.readFileSync(filename)[18]).toBe(2);
    expect(ensurePhoenixDatabase(workspace)).toBe(filename);
    expect(fs.readFileSync(filename)[18]).toBe(1);

    const db = pnwCreateDb(filename);
    try {
      expect(db.get<{ value: string }>("SELECT name AS value FROM sqlite_master WHERE name = 'legacy_value'"))
        .toEqual({ value: "legacy_value" });
    } finally {
      db.close();
    }
  });

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
