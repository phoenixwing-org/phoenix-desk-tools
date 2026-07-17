import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { pnwCreateDb } from "@phoenix-wing/db-node";
import {
  analyzeXlinkFix,
  applyXlinkFixOverride,
  getXlinkPrefs,
  listXlinkFixCandidates,
  runXlinkFix,
  saveXlinkPrefs,
} from "./pnwXlinkFixService.js";

const tempRoots: string[] = [];

function makeTempRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pnw-xlink-fix-"));
  tempRoots.push(root);
  return root;
}

function writeFixtureFile(root: string, rel: string) {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, "test fixture\n", "utf8");
}

function createXlinkFixture(workspace: string) {
  for (const rel of [
    "asm/Root.ASSY.FCStd",
    "asm/Sub.ASSY.FCStd",
    "parts/Bolt.FCStd",
    "parts/100004.001-Nut.FCStd",
  ]) {
    writeFixtureFile(workspace, rel);
  }

  const db = pnwCreateDb(path.join(workspace, ".phoenix", "phoenix-workspace.sqlite"));
  db.exec(`
    CREATE TABLE phoenix_cad_file_asset (
      id INTEGER PRIMARY KEY,
      repo_rel_path TEXT NOT NULL UNIQUE,
      filename TEXT NOT NULL,
      asset_kind TEXT,
      part_number TEXT,
      part_version TEXT,
      type_code TEXT,
      model_series TEXT,
      part_name TEXT,
      label TEXT,
      file_status TEXT NOT NULL DEFAULT 'present'
    );

    CREATE TABLE phoenix_cad_bom_xref (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      scan_id INTEGER NOT NULL,
      host_file_asset_id INTEGER NOT NULL,
      host_repo_rel_path TEXT NOT NULL,
      ref_kind TEXT NOT NULL DEFAULT 'xlink_file_attr',
      locator TEXT NOT NULL DEFAULT 'Document.xml',
      xlink_file_attr TEXT NOT NULL,
      link_label TEXT NOT NULL DEFAULT '',
      rule_label TEXT NOT NULL DEFAULT '',
      target_basename TEXT NOT NULL,
      target_file_asset_id INTEGER,
      target_repo_rel_path TEXT,
      target_part_number TEXT NOT NULL DEFAULT '',
      target_part_version TEXT NOT NULL DEFAULT '',
      target_type_code TEXT NOT NULL DEFAULT '',
      target_model_series TEXT NOT NULL DEFAULT '',
      target_part_name TEXT NOT NULL DEFAULT '',
      target_asset_label TEXT NOT NULL DEFAULT '',
      resolve_status TEXT NOT NULL DEFAULT 'missing',
      detail_json TEXT,
      last_seen_at TEXT NOT NULL
    );
  `);

  const assetSql = `
    INSERT INTO phoenix_cad_file_asset (
      id, repo_rel_path, filename, asset_kind, part_number, part_version,
      type_code, model_series, part_name, label, file_status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;
  db.run(assetSql, [1, "./asm/Root.ASSY.FCStd", "Root.ASSY.FCStd", "fcstd", "100001", "001", "A", "ROOT", "Root", "Root", "present"]);
  db.run(assetSql, [2, "./asm/Sub.ASSY.FCStd", "Sub.ASSY.FCStd", "fcstd", "100002", "001", "A", "SUB", "Sub", "Sub", "present"]);
  db.run(assetSql, [3, "./parts/Bolt.FCStd", "Bolt.FCStd", "fcstd", "100003", "001", "H", "", "Bolt", "Bolt", "present"]);
  db.run(assetSql, [4, "./parts/100004.001-Nut.FCStd", "100004.001-Nut.FCStd", "fcstd", "100004", "001", "H", "", "Nut", "Nut", "present"]);

  const edgeSql = `
    INSERT INTO phoenix_cad_bom_xref (
      scan_id, host_file_asset_id, host_repo_rel_path, xlink_file_attr,
      target_basename, target_file_asset_id, target_repo_rel_path,
      target_part_number, target_part_version, target_type_code,
      target_model_series, target_part_name, target_asset_label,
      resolve_status, last_seen_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;
  const now = "2026-07-10T10:00:00";
  db.run(edgeSql, [1, 1, "./asm/Root.ASSY.FCStd", "../legacy/Sub.ASSY.FCStd", "Sub.ASSY.FCStd", 2, "./asm/Sub.ASSY.FCStd", "100002", "001", "A", "SUB", "Sub", "Sub", "resolved", now]);
  db.run(edgeSql, [1, 2, "./asm/Sub.ASSY.FCStd", "missing/Bolt.FCStd", "Bolt.FCStd", 3, "./parts/Bolt.FCStd", "100003", "001", "H", "", "Bolt", "Bolt", "resolved", now]);
  db.run(edgeSql, [1, 1, "./asm/Root.ASSY.FCStd", "Missing.FCStd", "Missing.FCStd", null, null, "", "", "", "", "", "", "missing", now]);
  db.run(edgeSql, [1, 1, "./asm/Root.ASSY.FCStd", "Sub.ASSY.FCStd", "Sub.ASSY.FCStd", 2, "./asm/Sub.ASSY.FCStd", "100002", "001", "A", "SUB", "Sub", "Sub", "resolved", now]);
  db.run(edgeSql, [1, 1, "./asm/Root.ASSY.FCStd", "100004.001-Nut.FCStd", "100004.001-Nut.FCStd", null, null, "100004", "001", "H", "", "Nut", "Nut", "missing", now]);
  db.close();
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("pnwXlinkFixService", () => {
  it("persists workspace prefs and lists present FCStd candidates", () => {
    const workspace = makeTempRoot();
    createXlinkFixture(workspace);

    expect(getXlinkPrefs(workspace)).toEqual({ batch_dir: ".", dry_run: true, all_in_dir: true });
    expect(saveXlinkPrefs(workspace, { batch_dir: "./asm", dry_run: false, all_in_dir: true })).toEqual({
      batch_dir: "./asm",
      dry_run: false,
      all_in_dir: true,
    });

    const payload = listXlinkFixCandidates(workspace, {
      basename: "legacy-name.FCStd",
      part_number: "100004",
      part_version: "001",
    });
    expect(payload).toMatchObject({ part_key: "100004.001", _native: "node" });
    expect(payload.files.map((file: any) => file.repo_rel_path)).toEqual(["./parts/100004.001-Nut.FCStd"]);

    const excluded = listXlinkFixCandidates(workspace, {
      basename: "legacy-name.FCStd",
      part_number: "100004",
      part_version: "001",
      exclude_repo_rel: "./parts/100004.001-Nut.FCStd",
    });
    expect(excluded.files).toEqual([]);
  });

  it("reports only broken XLinks and leaves currently resolvable paths alone", () => {
    const workspace = makeTempRoot();
    createXlinkFixture(workspace);

    const result = analyzeXlinkFix(workspace, { batch_dir: ".", all_in_dir: true });
    expect(result).toMatchObject({
      dry_run: true,
      index_pending: false,
      _native: "node",
      stats: {
        host_count: 2,
        hosts_with_issues: 2,
        issue_count: 4,
        fixable_count: 3,
        not_found_count: 1,
        total_changes: 3,
      },
    });
    expect(result.issue_rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ old_path: "../legacy/Sub.ASSY.FCStd", new_path: "Sub.ASSY.FCStd", status: "fixable" }),
      expect.objectContaining({ old_path: "missing/Bolt.FCStd", new_path: "../parts/Bolt.FCStd", status: "fixable" }),
      expect.objectContaining({ old_path: "100004.001-Nut.FCStd", new_path: "../parts/100004.001-Nut.FCStd", status: "fixable" }),
      expect.objectContaining({ old_path: "Missing.FCStd", new_path: "", status: "not_found" }),
    ]));
    expect(result.issue_rows.some((row) => row.old_path === "Sub.ASSY.FCStd")).toBe(false);
    expect(result).not.toHaveProperty("_stub");
    expect(result).not.toHaveProperty("_proxy");
  });

  it("returns index_pending without an index", () => {
    const workspace = makeTempRoot();
    const empty = analyzeXlinkFix(workspace, { all_in_dir: true });
    expect(empty).toMatchObject({ index_pending: true, issue_rows: [], _native: "node" });
  });

  it("analyzes and writes standalone Document.xml without touching non-XLink file attributes", () => {
    const workspace = makeTempRoot();
    createXlinkFixture(workspace);
    const documentPath = path.join(workspace, "unpacked", "Document.xml");
    fs.mkdirSync(path.dirname(documentPath), { recursive: true });
    fs.writeFileSync(
      documentPath,
      '<Document><Other file="missing/Bolt.FCStd"/><XLink file="missing/Bolt.FCStd"/><XLink file="Missing.FCStd"/></Document>',
      "utf8",
    );

    const analysis = analyzeXlinkFix(workspace, { batch_dir: "./unpacked", all_in_dir: false });
    expect(analysis).toMatchObject({
      dry_run: true,
      index_pending: false,
      stats: { host_count: 1, fixable_count: 1, not_found_count: 1 },
      issue_rows: expect.arrayContaining([
        expect.objectContaining({
          host_repo_rel: "./unpacked/Document.xml",
          old_path: "missing/Bolt.FCStd",
          new_path: "../parts/Bolt.FCStd",
        }),
      ]),
    });

    const written = runXlinkFix(workspace, { batch_dir: "./unpacked", all_in_dir: false, dry_run: false });
    expect(written).toMatchObject({ dry_run: false, total_changes: 1 });
    expect(fs.readFileSync(documentPath, "utf8")).toBe(
      '<Document><Other file="missing/Bolt.FCStd"/><XLink file="../parts/Bolt.FCStd"/><XLink file="Missing.FCStd"/></Document>',
    );

    expect(applyXlinkFixOverride(workspace, {
      host_repo_rel: "./unpacked/Document.xml",
      old_path: "Missing.FCStd",
      target_repo_rel: "./parts/100004.001-Nut.FCStd",
    })).toMatchObject({ patches: 1, unchanged: false, new_path: "../parts/100004.001-Nut.FCStd" });
    expect(fs.readFileSync(documentPath, "utf8")).toContain(
      '<XLink file="../parts/100004.001-Nut.FCStd"/>',
    );
  });
});
