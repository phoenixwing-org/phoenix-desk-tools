import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pnwCreateDb } from "@phoenix-wing/db-node";
import { afterEach, describe, expect, it } from "vitest";
import {
  updateCadIndexEntryAfterBomWrite,
  updateCadIndexEntryAfterRename,
} from "./cadIndexMutationService.js";
import { loadCadIndexStatus } from "./cadIndexStatusService.js";
import { phoenixDatabasePath } from "./phoenixDatabaseService.js";
import { refreshBomXrefForHost } from "./pnwBomXrefService.js";

const tempRoots: string[] = [];

function makeWorkspace(): string {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "cad-index-boundary-"));
  tempRoots.push(workspace);
  return workspace;
}

function createIndex(workspace: string): ReturnType<typeof pnwCreateDb> {
  const db = pnwCreateDb(phoenixDatabasePath(workspace));
  db.exec(`
    CREATE TABLE phoenix_cad_scan (
      id INTEGER PRIMARY KEY,
      scanned_at TEXT,
      status TEXT,
      started_at TEXT,
      finished_at TEXT
    );
    CREATE TABLE phoenix_cad_file_asset (
      id INTEGER PRIMARY KEY,
      repo_rel_path TEXT NOT NULL UNIQUE,
      filename TEXT NOT NULL,
      file_status TEXT NOT NULL DEFAULT 'present',
      updated_at TEXT
    );
  `);
  return db;
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("Auto CAD index boundary services", () => {
  it("reads status without creating a missing index", () => {
    const workspace = makeWorkspace();
    const filename = phoenixDatabasePath(workspace);

    expect(loadCadIndexStatus(workspace)).toEqual({ indexed: false, lastScanAt: "", totalEntries: 0 });
    expect(fs.existsSync(filename)).toBe(false);
  });

  it("reports the latest completed Auto CAD scan", () => {
    const workspace = makeWorkspace();
    const db = createIndex(workspace);
    db.run("INSERT INTO phoenix_cad_file_asset(id, repo_rel_path, filename) VALUES (1, './parts/A.FCStd', 'A.FCStd')");
    db.run(
      "INSERT INTO phoenix_cad_scan(id, scanned_at, status, finished_at) VALUES (1, ?, 'done', ?)",
      ["2026-09-04T01:00:00Z", "2026-09-04T01:01:00Z"],
    );
    db.close();

    expect(loadCadIndexStatus(workspace)).toEqual({
      indexed: true,
      lastScanAt: "2026-09-04T01:01:00Z",
      totalEntries: 1,
    });
  });

  it("updates only the matching asset and refuses an indexed path conflict", () => {
    const workspace = makeWorkspace();
    const db = createIndex(workspace);
    db.run("INSERT INTO phoenix_cad_file_asset(id, repo_rel_path, filename) VALUES (1, './parts/A.FCStd', 'A.FCStd')");
    db.run("INSERT INTO phoenix_cad_file_asset(id, repo_rel_path, filename) VALUES (2, './parts/B.FCStd', 'B.FCStd')");
    db.close();

    expect(updateCadIndexEntryAfterRename(workspace, "parts/A.FCStd", "parts/B.FCStd")).toBe(false);
    expect(updateCadIndexEntryAfterRename(workspace, "parts/A.FCStd", "parts/C.FCStd")).toBe(true);

    const verify = pnwCreateDb(phoenixDatabasePath(workspace));
    expect(verify.get("SELECT repo_rel_path, filename FROM phoenix_cad_file_asset WHERE id = 1")).toEqual({
      repo_rel_path: "./parts/C.FCStd",
      filename: "C.FCStd",
    });
    expect(verify.get("SELECT repo_rel_path, filename FROM phoenix_cad_file_asset WHERE id = 2")).toEqual({
      repo_rel_path: "./parts/B.FCStd",
      filename: "B.FCStd",
    });
    verify.close();
  });

  it("updates only the existing asset and incoming xref snapshot after a BOM write", () => {
    const workspace = makeWorkspace();
    const db = createIndex(workspace);
    db.exec(`
      ALTER TABLE phoenix_cad_file_asset ADD COLUMN part_number TEXT;
      ALTER TABLE phoenix_cad_file_asset ADD COLUMN part_version TEXT;
      ALTER TABLE phoenix_cad_file_asset ADD COLUMN type_code TEXT;
      ALTER TABLE phoenix_cad_file_asset ADD COLUMN model_series TEXT;
      ALTER TABLE phoenix_cad_file_asset ADD COLUMN part_name TEXT;
      ALTER TABLE phoenix_cad_file_asset ADD COLUMN label TEXT;
      CREATE TABLE phoenix_cad_part_key (
        id INTEGER PRIMARY KEY,
        part_number TEXT NOT NULL,
        part_version TEXT NOT NULL,
        part_name TEXT
      );
      CREATE TABLE phoenix_cad_bom_xref (
        id INTEGER PRIMARY KEY,
        target_file_asset_id INTEGER,
        target_part_number TEXT NOT NULL DEFAULT '',
        target_part_version TEXT NOT NULL DEFAULT '',
        target_type_code TEXT NOT NULL DEFAULT '',
        target_model_series TEXT NOT NULL DEFAULT '',
        target_part_name TEXT NOT NULL DEFAULT '',
        target_asset_label TEXT NOT NULL DEFAULT '',
        rule_label TEXT NOT NULL DEFAULT ''
      );
    `);
    db.run(
      `INSERT INTO phoenix_cad_file_asset(
         id, repo_rel_path, filename, part_number, part_version, part_name
       ) VALUES (1, './parts/A.FCStd', 'A.FCStd', '100', '001', 'Old')`,
    );
    db.run("INSERT INTO phoenix_cad_part_key(id, part_number, part_version, part_name) VALUES (7, '100', '001', 'Manual')");
    db.run("INSERT INTO phoenix_cad_bom_xref(id, target_file_asset_id, target_part_number, target_part_version) VALUES (9, 1, '100', '001')");
    db.close();

    expect(updateCadIndexEntryAfterBomWrite(workspace, "parts/A.FCStd", {
      PartNumber: "8103",
      PartVersion: "002",
      TypeCode: "h",
      ModelSeries: "px",
      PartName: "滑轨点检",
      label: "8103.002-滑轨点检",
    })).toBe(true);
    expect(updateCadIndexEntryAfterBomWrite(workspace, "parts/Missing.FCStd", {})).toBe(false);

    const verify = pnwCreateDb(phoenixDatabasePath(workspace));
    expect(verify.get(
      `SELECT part_number, part_version, type_code, model_series, part_name, label
       FROM phoenix_cad_file_asset WHERE id = 1`,
    )).toEqual({
      part_number: "8103",
      part_version: "002",
      type_code: "H",
      model_series: "PX",
      part_name: "滑轨点检",
      label: "8103.002-滑轨点检",
    });
    expect(verify.get(
      `SELECT target_part_number, target_part_version, target_type_code,
              target_model_series, target_part_name, target_asset_label, rule_label
       FROM phoenix_cad_bom_xref WHERE id = 9`,
    )).toEqual({
      target_part_number: "8103",
      target_part_version: "002",
      target_type_code: "H",
      target_model_series: "PX",
      target_part_name: "滑轨点检",
      target_asset_label: "8103.002-滑轨点检",
      rule_label: "8103.002-滑轨点检",
    });
    expect(verify.get("SELECT part_number, part_version, part_name FROM phoenix_cad_part_key WHERE id = 7"))
      .toEqual({ part_number: "100", part_version: "001", part_name: "Manual" });
    verify.close();
  });

  it("does not invent a completed scan for an incomplete legacy index", () => {
    const workspace = makeWorkspace();
    fs.mkdirSync(path.join(workspace, "parts"), { recursive: true });
    fs.writeFileSync(path.join(workspace, "parts", "A.FCStd"), "fixture");
    const db = pnwCreateDb(phoenixDatabasePath(workspace));
    db.exec(`
      CREATE TABLE phoenix_cad_file_asset (
        id INTEGER PRIMARY KEY,
        repo_rel_path TEXT NOT NULL UNIQUE,
        filename TEXT NOT NULL,
        file_status TEXT NOT NULL DEFAULT 'present'
      );
      INSERT INTO phoenix_cad_file_asset(id, repo_rel_path, filename)
      VALUES (1, './parts/A.FCStd', 'A.FCStd');
    `);
    db.close();

    expect(refreshBomXrefForHost(workspace, "parts/A.FCStd")).toMatchObject({ hosts_refreshed: 0 });
    const verify = pnwCreateDb(phoenixDatabasePath(workspace));
    expect(verify.get("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'phoenix_cad_scan'"))
      .toBeUndefined();
    expect(verify.get("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'phoenix_cad_bom_xref'"))
      .toBeUndefined();
    verify.close();
  });
});
