import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { strToU8, zipSync } from "fflate";
import { afterEach, describe, expect, it } from "vitest";
import { pnwCreateDb } from "phoenix-wing/db/pnwDbAdapter";
import {
  fileDetailXrefs,
  loadAssemblyBomCatalog,
  loadBomXrefPayload,
  loadTargetUsageStats,
  patchBomLinkLabels,
  queryXrefCountsForRel,
  rebuildBomXrefsFromLastScan,
  refreshBomXrefForHost,
  searchBomXrefEdges,
  searchIncomingRefs,
  searchOutgoingRefs,
} from "./pnwBomXrefService.js";

const tempRoots: string[] = [];

function makeTempRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pnw-bom-xref-"));
  tempRoots.push(root);
  return root;
}

function writeFcstd(workspace: string, rel: string, documentXml: string) {
  const target = path.join(workspace, rel);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, zipSync({ "Document.xml": strToU8(documentXml) }));
}

const ROOT_XML = `<?xml version="1.0"?><Document><ObjectData>
<Object name="SubLink"><Properties><Property name="Label" type="App::PropertyString"><String value="Old Sub"/></Property></Properties><XLink file="Sub.ASSY.FCStd"/></Object>
<Object name="MissingLink"><Properties><Property name="Label" type="App::PropertyString"><String value="Missing"/></Property></Properties><XLink file="Missing.FCStd"/></Object>
</ObjectData></Document>`;

const SUB_XML = `<?xml version="1.0"?><Document><ObjectData>
<Object name="BoltLink"><Properties><Property name="Label" type="App::PropertyString"><String value="Old Bolt"/></Property></Properties><XLink file="../parts/Bolt.FCStd"/></Object>
</ObjectData></Document>`;

const EMPTY_XML = `<?xml version="1.0"?><Document><ObjectData></ObjectData></Document>`;

function createBomXrefFixture(workspace: string) {
  writeFcstd(workspace, "asm/Root.ASSY.FCStd", ROOT_XML);
  writeFcstd(workspace, "asm/Sub.ASSY.FCStd", SUB_XML);
  writeFcstd(workspace, "parts/Bolt.FCStd", EMPTY_XML);
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
  db.run("INSERT INTO phoenix_meta(key, value) VALUES (?, ?)", [
    "last_bom_xref_stats",
    JSON.stringify({ target_resolved: 2, target_missing: 1 }),
  ]);

  const assetSql = `
    INSERT INTO phoenix_cad_file_asset (
      id, repo_rel_path, filename, asset_kind, part_number, part_version,
      type_code, model_series, part_name, label, file_status, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;
  db.run(assetSql, [1, "./asm/Root.ASSY.FCStd", "Root.ASSY.FCStd", "fcstd", "100001", "001", "A", "ROOT", "Root Assembly", "Root Assembly", "present", now]);
  db.run(assetSql, [2, "./asm/Sub.ASSY.FCStd", "Sub.ASSY.FCStd", "fcstd", "100002", "001", "A", "SUB", "Sub Assembly", "Sub Assembly", "present", now]);
  db.run(assetSql, [3, "./parts/Bolt.FCStd", "Bolt.FCStd", "fcstd", "100003", "001", "H", "", "Bolt", "Bolt", "present", now]);

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
  db.run(edgeSql, [1, 1, "./asm/Root.ASSY.FCStd", "xlink_file_attr", "Document.xml", "Sub.ASSY.FCStd", "Old Sub", "100002.001-Sub Assembly", "Sub.ASSY.FCStd", 2, "./asm/Sub.ASSY.FCStd", "100002", "001", "A", "SUB", "Sub Assembly", "Sub Assembly", "resolved", JSON.stringify({ object: "SubLink" }), now]);
  db.run(edgeSql, [1, 2, "./asm/Sub.ASSY.FCStd", "xlink_file_attr", "Document.xml", "../parts/Bolt.FCStd", "Old Bolt", "100003.001-Bolt", "Bolt.FCStd", 3, "./parts/Bolt.FCStd", "100003", "001", "H", "", "Bolt", "Bolt", "resolved", JSON.stringify({ object: "BoltLink" }), now]);
  db.run(edgeSql, [1, 1, "./asm/Root.ASSY.FCStd", "xlink_file_attr", "Document.xml", "Missing.FCStd", "", "", "Missing.FCStd", null, null, "", "", "", "", "", "", "missing", null, now]);
  db.close();
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("pnwBomXrefService", () => {
  it("queries BOM xref read-side data from the workspace SQLite index", () => {
    const workspace = makeTempRoot();
    createBomXrefFixture(workspace);

    const meta = loadBomXrefPayload(workspace);
    expect(meta.edge_count).toBe(3);
    expect(meta.host_count).toBe(2);
    expect(meta.last_bom_xref_at).toBe("2026-07-10T10:00:00");
    expect(meta.index_pending).toBe(false);
    expect(meta.target_resolved).toBe(2);

    expect(queryXrefCountsForRel(workspace, "asm/Sub.ASSY.FCStd")).toMatchObject({
      outgoing_count: 1,
      direct_incoming_count: 1,
      index_pending: false,
    });

    const outgoing = searchOutgoingRefs(workspace, "asm/Root.ASSY.FCStd");
    expect(outgoing.count).toBe(2);
    expect(outgoing.label_mismatch_count).toBe(1);
    expect(outgoing.refs[0]).toMatchObject({
      host_repo_rel_path: "./asm/Root.ASSY.FCStd",
      target_basename: "Missing.FCStd",
      resolve_status: "missing",
    });

    const incoming = searchIncomingRefs(workspace, {
      rel: "parts/Bolt.FCStd",
      transitive: true,
    });
    expect(incoming.count).toBe(2);
    expect(incoming.direct_count).toBe(1);
    expect(incoming.refs).toHaveLength(1);
    expect(incoming.hosts.map((h: any) => h.host_repo_rel_path)).toEqual([
      "./asm/Sub.ASSY.FCStd",
      "./asm/Root.ASSY.FCStd",
    ]);
    expect(incoming.hosts[1]).toMatchObject({
      depth: 1,
      usage_kind: "indirect",
      via_chain: ["./asm/Sub.ASSY.FCStd"],
    });

    const usage = loadTargetUsageStats(workspace, "parts/Bolt.FCStd");
    expect(usage).toMatchObject({
      target_repo_rel_path: "./parts/Bolt.FCStd",
      direct_incoming_host_count: 1,
      bom_occurrence_count: 1,
      bom_root_count: 1,
    });
    expect(usage.occurrences[0].host_repo_rel_path).toBe("./asm/Sub.ASSY.FCStd");

    const catalog = loadAssemblyBomCatalog(workspace);
    expect(catalog.count).toBe(2);
    expect(catalog.hosts.map((h: any) => h.host_repo_rel_path)).toEqual([
      "./asm/Root.ASSY.FCStd",
      "./asm/Sub.ASSY.FCStd",
    ]);
    expect(catalog.hosts[1]).toMatchObject({
      incoming_host_count: 1,
      file_role: "assembly",
    });

    const edges = searchBomXrefEdges(workspace, { search: "Bolt" });
    expect(edges.total).toBe(1);
    expect(edges.refs[0]).toMatchObject({
      host_repo_rel_path: "./asm/Sub.ASSY.FCStd",
      target_repo_rel_path: "./parts/Bolt.FCStd",
      label_mismatch: true,
    });

    const detail = fileDetailXrefs(workspace, "parts/Bolt.FCStd", { transitive: true });
    expect(detail.incoming).toMatchObject({ count: 2, direct_count: 1 });
    expect(detail.outgoing).toMatchObject({ count: 0, label_mismatch_count: 0 });

    const patched = patchBomLinkLabels(workspace, [
      {
        host_repo_rel: "asm/Sub.ASSY.FCStd",
        xlink_file_attr: "../parts/Bolt.FCStd",
        link_label: "Bolt",
      },
    ]);
    expect(patched).toMatchObject({
      label_patches: 1,
      applied_hosts: ["./asm/Sub.ASSY.FCStd"],
      failed: [],
    });
    expect(searchOutgoingRefs(workspace, "asm/Sub.ASSY.FCStd").label_mismatch_count).toBe(0);

    expect(rebuildBomXrefsFromLastScan(workspace)).toMatchObject({
      edge_count: 3,
      host_files_scanned: 3,
      hosts_with_xlink: 2,
      target_resolved: 2,
      target_missing: 1,
    });
    expect(searchOutgoingRefs(workspace, "asm/Sub.ASSY.FCStd").refs[0]).toMatchObject({
      xlink_file_attr: "../parts/Bolt.FCStd",
      link_label: "Bolt",
      rule_label: "Bolt",
    });
  });

  it("re-reads host files, follows recursive FCStd links, and removes deleted edges", () => {
    const workspace = makeTempRoot();
    createBomXrefFixture(workspace);
    rebuildBomXrefsFromLastScan(workspace);

    const recursive = refreshBomXrefForHost(workspace, "asm/Root.ASSY.FCStd", {
      recursive: true,
      maxHosts: 10,
    });
    expect(recursive.hosts).toEqual([
      "./asm/Root.ASSY.FCStd",
      "./asm/Sub.ASSY.FCStd",
      "./parts/Bolt.FCStd",
    ]);
    expect(recursive).toMatchObject({ hosts_refreshed: 3, outgoing_count: 2 });

    writeFcstd(workspace, "asm/Sub.ASSY.FCStd", EMPTY_XML);
    const refreshed = refreshBomXrefForHost(workspace, "asm/Sub.ASSY.FCStd", { recursive: false });
    expect(refreshed).toMatchObject({
      hosts_refreshed: 1,
      updated_hosts: 0,
      edge_count: 0,
      outgoing_count: 0,
    });
    expect(searchOutgoingRefs(workspace, "asm/Sub.ASSY.FCStd").refs).toEqual([]);
    expect(searchIncomingRefs(workspace, { rel: "parts/Bolt.FCStd" }).count).toBe(0);
  });

  it("returns index_pending payloads when the xref table is unavailable", () => {
    const workspace = makeTempRoot();
    const payload = loadBomXrefPayload(workspace);
    expect(payload).toMatchObject({
      edge_count: 0,
      host_count: 0,
      index_pending: true,
    });
    expect(searchOutgoingRefs(workspace, "asm/Root.ASSY.FCStd")).toMatchObject({
      count: 0,
      refs: [],
      index_pending: true,
    });
  });
});
