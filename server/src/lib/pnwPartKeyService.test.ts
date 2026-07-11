import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { pnwCreateDb } from "phoenix-wing/db/pnwDbAdapter";
import {
  inferPartKeyFromWorkspaceRel,
  loadPartAssemblyTreePayload,
  loadPartKeyDetailPayload,
  loadPartKeysPayload,
  patchPartFileLink,
  patchPartKey,
} from "./pnwPartKeyService.js";

const tempRoots: string[] = [];

function makeTempRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pnw-part-key-"));
  tempRoots.push(root);
  return root;
}

function createPartFixture(workspace: string) {
  const db = pnwCreateDb(path.join(workspace, ".phoenix", "phoenix-workspace.sqlite"));
  db.exec(`
    CREATE TABLE phoenix_meta (
      key TEXT PRIMARY KEY NOT NULL,
      value TEXT NOT NULL
    );

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
      file_status TEXT NOT NULL DEFAULT 'present',
      last_seen_at TEXT,
      updated_at TEXT
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

  const now = "2026-07-10T10:00:00";
  db.run("INSERT INTO phoenix_meta(key, value) VALUES (?, ?)", ["last_bom_xref_at", now]);
  const assetSql = `
    INSERT INTO phoenix_cad_file_asset (
      id, repo_rel_path, filename, asset_kind, part_number, part_version,
      type_code, model_series, part_name, label, file_status, last_seen_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;
  db.run(assetSql, [1, "./asm/100001.001-A-Root.ASSY.FCStd", "100001.001-A-Root.ASSY.FCStd", "fcstd", "100001", "001", "A", "ROOT", "Root Assembly", "100001.001-Root Assembly", "present", now, now]);
  db.run(assetSql, [2, "./asm/100002.001-A-Sub.ASSY.FCStd", "100002.001-A-Sub.ASSY.FCStd", "fcstd", "100002", "001", "A", "SUB", "Sub Assembly", "100002.001-Sub Assembly", "present", now, now]);
  db.run(assetSql, [3, "./parts/100003.001-H-Bolt.FCStd", "100003.001-H-Bolt.FCStd", "fcstd", "100003", "001", "H", "", "Bolt", "100003.001-Bolt", "present", now, now]);
  db.run(assetSql, [4, "./archive/100003.001-H-Bolt.FCStd", "100003.001-H-Bolt.FCStd", "fcstd", "100003", "001", "H", "", "Bolt", "100003.001-Bolt", "missing", now, now]);

  const edgeSql = `
    INSERT INTO phoenix_cad_bom_xref (
      scan_id, host_file_asset_id, host_repo_rel_path, ref_kind, locator,
      xlink_file_attr, link_label, rule_label, target_basename,
      target_file_asset_id, target_repo_rel_path, target_part_number,
      target_part_version, target_type_code, target_model_series,
      target_part_name, target_asset_label, resolve_status, detail_json,
      last_seen_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;
  db.run(edgeSql, [1, 1, "./asm/100001.001-A-Root.ASSY.FCStd", "xlink_file_attr", "Document.xml", "100002.001-A-Sub.ASSY.FCStd", "Sub", "100002.001-Sub Assembly", "100002.001-A-Sub.ASSY.FCStd", 2, "./asm/100002.001-A-Sub.ASSY.FCStd", "100002", "001", "A", "SUB", "Sub Assembly", "100002.001-Sub Assembly", "resolved", null, now]);
  db.run(edgeSql, [1, 2, "./asm/100002.001-A-Sub.ASSY.FCStd", "xlink_file_attr", "Document.xml", "../parts/100003.001-H-Bolt.FCStd", "Bolt", "100003.001-Bolt", "100003.001-H-Bolt.FCStd", 3, "./parts/100003.001-H-Bolt.FCStd", "100003", "001", "H", "", "Bolt", "100003.001-Bolt", "resolved", null, now]);
  db.close();
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("pnwPartKeyService", () => {
  it("syncs part keys from file assets, serves details, patches metadata/link state, infers keys, and loads assembly trees", () => {
    const workspace = makeTempRoot();
    createPartFixture(workspace);

    const catalog = loadPartKeysPayload(workspace);
    expect(catalog).toMatchObject({
      exists: true,
      stats: { total_keys: 3, total_files: 4, obsolete_keys: 0 },
      _native: "node",
    });
    expect(catalog.entries.map((entry: any) => entry.part_key)).toEqual(["100001.001", "100002.001", "100003.001"]);
    expect(catalog.items[0]).toMatchObject({ part_number: "100001", part_name: "Root Assembly" });

    const detail = loadPartKeyDetailPayload(workspace, "100003", "001");
    expect(detail).toMatchObject({
      part_key: "100003.001",
      file_count: 2,
      present_count: 1,
      missing_count: 1,
      PartName: "Bolt",
    });
    expect(detail.files.map((file: any) => file.file_status)).toEqual(["present", "missing"]);

    expect(inferPartKeyFromWorkspaceRel(workspace, "parts/100003.001-H-Bolt.FCStd")).toMatchObject({
      part_number: "100003",
      part_version: "001",
      source: "filename+index",
      in_catalog: true,
    });

    const patched = patchPartKey(workspace, "100003", "001", {
      PartName: "Cap Screw",
      label: "100003.001-Cap Screw",
      status: "obsolete",
    });
    expect(patched).toMatchObject({
      PartName: "Cap Screw",
      label: "100003.001-Cap Screw",
      status: "obsolete",
    });
    expect(patched.files[0]).toMatchObject({ PartName: "Cap Screw", label: "100003.001-Cap Screw" });
    expect(loadPartKeysPayload(workspace).stats.obsolete_keys).toBe(1);

    const linkPatched = patchPartFileLink(workspace, "100003", "001", 3, {
      file_role: "fastener",
      link_notes: "preferred",
      link_status: "obsolete",
    });
    expect(linkPatched.files[0]).toMatchObject({
      id: 3,
      file_role: "fastener",
      link_notes: "preferred",
      link_status: "obsolete",
    });

    const tree = loadPartAssemblyTreePayload(workspace, "100001", "001", "asm/100001.001-A-Root.ASSY.FCStd", { full: true });
    expect(tree).toMatchObject({
      host_repo_rel_path: "./asm/100001.001-A-Root.ASSY.FCStd",
      mode: "full",
      node_count: 2,
    });
    expect(tree.nodes[0]).toMatchObject({
      repo_rel_path: "./asm/100002.001-A-Sub.ASSY.FCStd",
      part_key: "100002.001",
      file_role: "assembly",
    });
    expect(tree.nodes[0].children[0]).toMatchObject({
      repo_rel_path: "./parts/100003.001-H-Bolt.FCStd",
      part_key: "100003.001",
    });
  });
});
