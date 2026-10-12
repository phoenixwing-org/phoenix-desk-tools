import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { pnwCreateDb } from "@phoenix-wing/db-node";
import { PNW_WORKSPACE_SCHEMA_V13_DDL } from "@phoenix-wing/workspace-schema";
import { pnwBuildCadWorkspaceIndex, type PnwCadIndexRecord } from "@phoenix-wing/cad-core";
import { PNW_CAD_INDEX_WRITE_PROTOCOL, pnwReadCadIndexRevisionV1, pnwWriteCadWorkspaceIndexV1 } from "@phoenix-wing/cad-contracts";
import { writePartialCadWorkspaceIndex, type CadPartialIndexWriteOptions } from "./cadIndexPartialWriter.js";
import { readCadIndexFreshness } from "./cadIndexFreshness.js";

const cleanups: Array<() => void> = [];
afterEach(() => { for (const cleanup of cleanups.splice(0).reverse()) cleanup(); });
function database() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "desk-partial-writer-"));
  cleanups.push(() => fs.rmSync(root, { recursive: true, force: true }));
  const filename = path.join(root, "index.sqlite"), db = pnwCreateDb(filename);
  cleanups.push(() => db.close());
  db.exec("PRAGMA foreign_keys=ON"); db.exec(PNW_WORKSPACE_SCHEMA_V13_DDL);
  db.run("INSERT INTO phoenix_meta(key,value) VALUES ('schema_version','13')");
  return { root, db, filename };
}
const GOOD = "11.002-S-Pin.FCStd", BAD = "12.003-H-Cover.FCStd";
function record(relativePath: string, files: string[] = [], parseError?: string): PnwCadIndexRecord {
  return { relativePath, filename: path.posix.basename(relativePath), documentKind: "Part",
    sizeBytes: 100, modifiedAtMs: 1000, objectCount: parseError ? 0 : 1,
    xlinks: files.map(file => ({ file, label: "" })), ...(parseError ? { parseError } : {}) };
}
const failedPlan = () => pnwBuildCadWorkspaceIndex([record("Root.ASSY.FCStd", [GOOD]), record(GOOD), record(BAD, [], "Synthetic invalid XML")]);
function options(db: ReturnType<typeof pnwCreateDb>, patch: Partial<CadPartialIndexWriteOptions> = {}): CadPartialIndexWriteOptions {
  return { scanUuid: `partial-${pnwReadCadIndexRevisionV1(db) + 1}`, scanRoot: "synthetic-workspace",
    scannedAt: "2026-01-01T00:00:00.000Z", expectedScanId: pnwReadCadIndexRevisionV1(db), inventoryComplete: true,
    assertCurrent() {}, ...patch };
}
function full(db: ReturnType<typeof pnwCreateDb>, records: PnwCadIndexRecord[]) {
  const value = options(db);
  return pnwWriteCadWorkspaceIndexV1(db, pnwBuildCadWorkspaceIndex(records), { ...value, scope: "workspace", complete: true, assertCurrent: value.assertCurrent! });
}
function snapshot(db: ReturnType<typeof pnwCreateDb>) {
  return ["phoenix_cad_scan", "phoenix_cad_file_asset", "phoenix_cad_part_key", "phoenix_cad_part_file_link",
    "phoenix_cad_bom_xref", "phoenix_cad_bom_line", "phoenix_cad_xref_flat", "phoenix_cad_bom_tree_occurrence"]
    .map(table => db.all(`SELECT * FROM ${table} ORDER BY id`));
}

describe("explicit partial CAD parse writer", () => {
  it("stores good files and an error placeholder while leaving BOM explicitly incomplete", () => {
    const { db, root } = database();
    const result = writePartialCadWorkspaceIndex(db, failedPlan(), options(db));
    expect(result).toMatchObject({ scanId: 1, files: 3, parsedFiles: 2, references: 1, bomLines: 1,
      partial: true, failed_count: 1, failures: [{ rel: BAD, message: "Synthetic invalid XML" }] });
    const scan = db.get<{ status: string; stats_json: string }>("SELECT * FROM phoenix_cad_scan");
    expect(scan?.status).toBe("partial");
    expect(JSON.parse(scan!.stats_json)).toMatchObject({ complete: false, inventory_complete: true, bom_complete: false,
      failed_count: 1, parsed_files: 2, failures: result.failures });
    expect(db.get("SELECT file_status,part_name FROM phoenix_cad_file_asset WHERE repo_rel_path=?", [BAD]))
      .toEqual({ file_status: "error", part_name: "Cover" });
    expect(db.get("SELECT file_status FROM phoenix_cad_file_asset WHERE repo_rel_path=?", [GOOD])).toEqual({ file_status: "present" });
    expect(db.all("SELECT * FROM phoenix_cad_bom_line")).toHaveLength(1);
    expect(readCadIndexFreshness(db, root)).toMatchObject({ index_state: "incomplete", bom_index_state: "incomplete" });
    expect(db.get("PRAGMA foreign_key_check")).toBeUndefined();
  });

  it("preserves failed asset IDs, saved CAD fields, manual PartKeys and role associations", () => {
    const { db } = database();
    full(db, [record(GOOD), { ...record(BAD, [GOOD]), embeddedFields: { PartName: "Saved cover", label: "Saved model label", ModelSeries: "Saved series" } }]);
    db.run("UPDATE phoenix_cad_part_key SET part_name='Manual part name',notes='Keep notes',status='inactive'");
    db.run("UPDATE phoenix_cad_part_file_link SET file_role='drawing',link_status='ignored',notes='Manual association'");
    const identities = db.all("SELECT id,repo_rel_path,part_name,label,model_series FROM phoenix_cad_file_asset ORDER BY id");
    const parts = db.all("SELECT * FROM phoenix_cad_part_key"), links = db.all("SELECT * FROM phoenix_cad_part_file_link");
    expect(db.all("SELECT * FROM phoenix_cad_bom_xref")).toHaveLength(1);
    writePartialCadWorkspaceIndex(db, pnwBuildCadWorkspaceIndex([record(GOOD), record(BAD, [], "Cannot parse")]), options(db));
    expect(db.all("SELECT id,repo_rel_path,part_name,label,model_series FROM phoenix_cad_file_asset ORDER BY id")).toEqual(identities);
    expect(db.all("SELECT * FROM phoenix_cad_part_key")).toEqual(parts);
    expect(db.all("SELECT * FROM phoenix_cad_part_file_link")).toEqual(links);
    expect(db.all("SELECT * FROM phoenix_cad_bom_xref")).toEqual([]);
    expect(db.all("SELECT * FROM phoenix_cad_bom_line")).toEqual([]);
    expect(db.get("SELECT file_status FROM phoenix_cad_file_asset WHERE repo_rel_path=?", [BAD])).toEqual({ file_status: "error" });
  });

  it("uses filename-only inference for new failed files and creates no false PartKey truth", () => {
    const { db } = database();
    const plan = pnwBuildCadWorkspaceIndex([{ ...record(BAD, [], "Cannot parse"), embeddedFields: { PartName: "Untrusted partial property" } }]);
    writePartialCadWorkspaceIndex(db, plan, options(db));
    expect(db.get("SELECT part_name FROM phoenix_cad_file_asset")).toEqual({ part_name: "Cover" });
    expect(db.all("SELECT * FROM phoenix_cad_part_key")).toEqual([]);
    expect(db.all("SELECT * FROM phoenix_cad_part_file_link")).toEqual([]);
  });

  it("preserves legacy identities, marks absent files missing and does not touch excluded or non-CAD assets", () => {
    const { db } = database();
    db.run("INSERT INTO phoenix_cad_file_asset(repo_rel_path,filename,updated_at) VALUES (?,?,?)", [`./${BAD}`, BAD, "before"]);
    db.run("INSERT INTO phoenix_cad_file_asset(repo_rel_path,filename,file_status,updated_at) VALUES ('Elsewhere.FCStd','Elsewhere.FCStd','present','before')");
    db.run("INSERT INTO phoenix_cad_file_asset(repo_rel_path,filename,file_status,updated_at) VALUES ('manual.step','manual.step','present','before')");
    db.run("INSERT INTO phoenix_cad_file_asset(repo_rel_path,filename,file_status,updated_at) VALUES ('node_modules/Synthetic.FCStd','Synthetic.FCStd','present','before')");
    writePartialCadWorkspaceIndex(db, failedPlan(), options(db));
    expect(db.get("SELECT id,repo_rel_path,file_status FROM phoenix_cad_file_asset WHERE id=1")).toEqual({ id: 1, repo_rel_path: `./${BAD}`, file_status: "error" });
    expect(db.get("SELECT file_status FROM phoenix_cad_file_asset WHERE repo_rel_path='Elsewhere.FCStd'")).toEqual({ file_status: "missing" });
    for (const rel of ["manual.step", "node_modules/Synthetic.FCStd"]) expect(db.get("SELECT file_status,updated_at FROM phoenix_cad_file_asset WHERE repo_rel_path=?", [rel]))
      .toEqual({ file_status: "present", updated_at: "before" });
  });

  it("retains an incoming reference to a failed file while recording its parse uncertainty", () => {
    const { db } = database();
    full(db, [{ ...record(BAD), embeddedFields: { PartNumber: "42", PartVersion: "Z", PartName: "Saved cover" } }]);
    const plan = pnwBuildCadWorkspaceIndex([record("Root.ASSY.FCStd", [BAD]), record(BAD, [], "Cannot parse")]);
    expect(plan.bomLines[0].partKey).toBe("12.003");
    for (let attempt = 0; attempt < 2; attempt++) {
      writePartialCadWorkspaceIndex(db, plan, options(db));
      const row = db.get<{ detail_json: string; target_part_name: string; target_file_asset_id: number }>("SELECT * FROM phoenix_cad_bom_xref");
      expect(row?.target_part_name).toBe("Saved cover");
      expect(row?.target_file_asset_id).toBe(1);
      expect(JSON.parse(row!.detail_json)).toMatchObject({ complete: false, target_parse_error: true });
      expect(db.get("SELECT target_part_number,target_part_version FROM phoenix_cad_bom_xref")).toEqual({ target_part_number: "42", target_part_version: "Z" });
      expect(db.get("SELECT part_key FROM phoenix_cad_bom_line")).toEqual({ part_key: "42.Z" });
    }
  });

  it("does not invent a manufacturing key from a newly failed file's display fallback, including repeated scans", () => {
    const { db } = database();
    const plan = pnwBuildCadWorkspaceIndex([record("Root.ASSY.FCStd", [BAD]), record(BAD, [], "Cannot parse")]);
    expect(plan.bomLines[0].partKey).toBe("12.003");
    for (let attempt = 0; attempt < 2; attempt++) {
      writePartialCadWorkspaceIndex(db, plan, options(db));
      expect(db.get("SELECT part_number,part_version,part_name FROM phoenix_cad_file_asset WHERE repo_rel_path=?", [BAD]))
        .toEqual({ part_number: "12", part_version: "003", part_name: "Cover" });
      expect(db.get("SELECT target_part_number,target_part_version,target_part_name FROM phoenix_cad_bom_xref"))
        .toEqual({ target_part_number: "", target_part_version: "", target_part_name: "Cover" });
      expect(db.get("SELECT part_key FROM phoenix_cad_bom_line")).toEqual({ part_key: "" });
      const metadata = JSON.parse(db.get<{ bom_json: string }>("SELECT bom_json FROM phoenix_cad_file_asset WHERE repo_rel_path=?", [BAD])!.bom_json);
      expect(metadata.saved_part_key).toBeNull();
      expect(db.all("SELECT * FROM phoenix_cad_part_key")).toEqual([]);
    }
  });

  it.each([
    ["mismatched saved key", { protocol: PNW_CAD_INDEX_WRITE_PROTOCOL, version: 1, parse_error: "Earlier failure", saved_part_key: "99.Q" }],
    ["unknown marker protocol", { protocol: "unknown-index-protocol", version: 1, parse_error: "Earlier failure", saved_part_key: "42.Z" }],
    ["unknown marker version", { protocol: PNW_CAD_INDEX_WRITE_PROTOCOL, version: 2, parse_error: "Earlier failure", saved_part_key: "42.Z" }],
    ["old parse error without a provenance marker", { protocol: PNW_CAD_INDEX_WRITE_PROTOCOL, version: 1, parse_error: "Earlier failure" }],
  ])("does not trust %s as a saved manufacturing identity", (_, metadata) => {
    const { db } = database();
    full(db, [{ ...record(BAD), embeddedFields: { PartNumber: "42", PartVersion: "Z", PartName: "Saved cover" } }]);
    db.run("UPDATE phoenix_cad_file_asset SET file_status='error',bom_json=? WHERE repo_rel_path=?", [JSON.stringify(metadata), BAD]);
    const plan = pnwBuildCadWorkspaceIndex([record("Root.ASSY.FCStd", [BAD]), record(BAD, [], "Cannot parse")]);
    writePartialCadWorkspaceIndex(db, plan, options(db));
    expect(db.get("SELECT part_number,part_version FROM phoenix_cad_file_asset WHERE repo_rel_path=?", [BAD]))
      .toEqual({ part_number: "42", part_version: "Z" });
    expect(db.get("SELECT target_part_number,target_part_version FROM phoenix_cad_bom_xref"))
      .toEqual({ target_part_number: "", target_part_version: "" });
    expect(db.get("SELECT part_key FROM phoenix_cad_bom_line")).toEqual({ part_key: "" });
  });

  it("rolls back every table for SQL failures and late snapshot cancellation", () => {
    const { db } = database(); full(db, [record(GOOD)]); const before = snapshot(db);
    let guards = 0;
    expect(() => writePartialCadWorkspaceIndex(db, failedPlan(), options(db, { assertCurrent() { if (++guards === 3) throw new Error("Snapshot changed"); } })))
      .toThrow("Snapshot changed");
    expect(snapshot(db)).toEqual(before);
    db.exec("CREATE TRIGGER reject_partial_bom BEFORE INSERT ON phoenix_cad_bom_line BEGIN SELECT RAISE(ABORT,'Synthetic SQL failure'); END");
    expect(() => writePartialCadWorkspaceIndex(db, failedPlan(), options(db))).toThrow(/Synthetic SQL failure/);
    expect(snapshot(db)).toEqual(before);
  });

  it("requires complete inventory, genuine failures, Schema v13 and an unchanged revision", () => {
    const { db } = database(); full(db, [record(GOOD)]); const before = snapshot(db), stale = options(db);
    expect(() => writePartialCadWorkspaceIndex(db, failedPlan(), { ...stale, inventoryComplete: false } as unknown as CadPartialIndexWriteOptions))
      .toThrow(/complete stable file inventory/);
    expect(() => writePartialCadWorkspaceIndex(db, pnwBuildCadWorkspaceIndex([record(GOOD)]), stale)).toThrow(/explicit per-file/);
    expect(snapshot(db)).toEqual(before);
    full(db, [record(GOOD)]); const latest = snapshot(db);
    expect(() => writePartialCadWorkspaceIndex(db, failedPlan(), stale)).toThrow(/changed during discovery/);
    expect(snapshot(db)).toEqual(latest);
    db.run("UPDATE phoenix_meta SET value='12' WHERE key='schema_version'");
    expect(() => writePartialCadWorkspaceIndex(db, failedPlan(), options(db))).toThrow(/Schema v13/);
    expect(db.get("SELECT value FROM phoenix_meta WHERE key='schema_version'")).toEqual({ value: "12" });
  });

  it("does not roll back another active writer and rejects duplicate legacy identities", () => {
    const { db, filename } = database();
    const other = pnwCreateDb(filename); cleanups.push(() => other.close());
    other.exec("BEGIN IMMEDIATE");
    try { expect(() => writePartialCadWorkspaceIndex(db, failedPlan(), options(db))).toThrow(); }
    finally { other.exec("ROLLBACK"); }
    db.exec("INSERT INTO phoenix_cad_file_asset(repo_rel_path,filename,updated_at) VALUES ('a.FCStd','a.FCStd','before'),('./a.FCStd','a.FCStd','before')");
    expect(() => writePartialCadWorkspaceIndex(db, failedPlan(), options(db))).toThrow(/Duplicate legacy CAD paths/);
    expect(pnwReadCadIndexRevisionV1(db)).toBe(0);
  });

  it("allows a later genuine full scan to repair the error asset and establish done", () => {
    const { db } = database();
    writePartialCadWorkspaceIndex(db, failedPlan(), options(db));
    const identities = db.all("SELECT id,repo_rel_path FROM phoenix_cad_file_asset ORDER BY id");
    const result = full(db, [record("Root.ASSY.FCStd", [GOOD]), record(GOOD), record(BAD)]);
    expect(result.scanId).toBe(2);
    expect(db.get("SELECT status FROM phoenix_cad_scan ORDER BY id DESC LIMIT 1")).toEqual({ status: "done" });
    expect(db.all("SELECT id,repo_rel_path FROM phoenix_cad_file_asset ORDER BY id")).toEqual(identities);
    expect(db.get("SELECT file_status FROM phoenix_cad_file_asset WHERE repo_rel_path=?", [BAD])).toEqual({ file_status: "present" });
    expect(db.get<{ bom_json: string }>("SELECT bom_json FROM phoenix_cad_file_asset WHERE repo_rel_path=?", [BAD])?.bom_json).not.toContain("parse_error");
  });
});
