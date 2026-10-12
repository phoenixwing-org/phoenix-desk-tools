import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { strToU8, zipSync } from "fflate";
import { afterEach, describe, expect, it, vi } from "vitest";
import { pnwCreateDb } from "@phoenix-wing/db-node";
import { pnwBuildCadWorkspaceIndex, pnwInferBomDocumentKinds, type PnwCadIndexRecord } from "@phoenix-wing/cad-core";
import { pnwWriteCadWorkspaceIndexV1 } from "@phoenix-wing/cad-contracts";
import { PNW_WORKSPACE_SCHEMA_V13_DDL } from "@phoenix-wing/workspace-schema";
import { searchCadIndex } from "../features/cad-index-search/service.js";
import { scanCadWorkspaceIndex } from "./cadIndexScanService.js";
import { phoenixDatabasePath } from "./phoenixDatabaseService.js";
import { queryXrefCountsForRel, refreshBomXrefForHost, searchOutgoingRefs } from "./pnwBomXrefService.js";

// Carry semantics from fixed Auto CAD 96b6a846b49fc0f29fc1f3da017cb055cedafafc.
// Fixtures are independently constructed. This tests actual Desk entry points,
// not a test-only projection pretending to implement the old frozen DTO.
const roots: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});
function workspace(prefix = "cad-carry-") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix)); roots.push(root); return root;
}
function writeModel(root: string, rel: string, xml = "<Document/>") {
  const filename = path.join(root, rel); fs.mkdirSync(path.dirname(filename), { recursive: true });
  fs.writeFileSync(filename, zipSync({ "Document.xml": strToU8(xml) }));
}
function linkDocument(links: Array<{ file: string; label?: string }>) {
  return `<Document><ObjectData>${links.map((link, i) => `<Object name="Link${i}"><Properties>
    ${link.label ? `<Property name="Label"><String value="${link.label}"/></Property>` : ""}
    <Property name="LinkedObject" type="App::PropertyXLink"><XLink file="${link.file}" name="Body"/></Property>
    </Properties></Object>`).join("")}</ObjectData></Document>`;
}
function seedPrefs(root: string) {
  const db = pnwCreateDb(phoenixDatabasePath(root));
  try {
    db.run("INSERT INTO phoenix_workspace_pref(section,value_json,updated_at) VALUES ('cad.xlink_fix',?,?)", [
      JSON.stringify({ batch_dir: ".", dry_run: false, all_in_dir: false, sentinel: "keep" }), "before",
    ]);
  } finally { db.close(); }
  fs.writeFileSync(path.join(root, ".phoenix", "phoenix-workspace-prefs.json"), '{"sentinel":"keep original bytes"}\n');
}
function snapshot(root: string, models: string[]) {
  const dir = path.join(root, ".phoenix");
  return {
    files: models.map(rel => [rel, fs.readFileSync(path.join(root, rel))]),
    index: fs.readFileSync(phoenixDatabasePath(root)),
    prefs: fs.readFileSync(path.join(dir, "phoenix-workspace-prefs.json")),
    indexFiles: fs.readdirSync(dir).sort(),
  };
}

describe("Desk Auto CAD A01/A06 carry semantics", () => {
  it("full-scans mixed suffix cases, filters non-model paths and returns sorted filename descriptions", async () => {
    const root = workspace();
    const models = ["z_parts/840.006-S-Washer.fcstd", "a_assemblies/730.004-H-LAB-Cage.aSsY.FCSTD", "m_drawings/730.004-H-LAB-Cage.Drawing.fCsTd"];
    // Input creation order is deliberately not result order, as in the frozen
    // workspaceScan case. The current index's path ordering is not re-sorted.
    for (const rel of models) writeModel(root, rel);
    fs.writeFileSync(path.join(root, "README.md"), "not a model");
    fs.writeFileSync(path.join(root, "model.FCStd.bak"), "not a model");
    await scanCadWorkspaceIndex(root);
    seedPrefs(root); const before = snapshot(root, models);
    expect(searchCadIndex(root).rows).toEqual([
      { repo_rel_path: models[1], filename: "730.004-H-LAB-Cage.aSsY.FCSTD", asset_kind: "assembly", part_number: "730", part_version: "004", part_name: "Cage", label: "730.004-Cage" },
      { repo_rel_path: models[2], filename: "730.004-H-LAB-Cage.Drawing.fCsTd", asset_kind: "drawing", part_number: "730", part_version: "004", part_name: "Cage", label: "730.004-Cage" },
      { repo_rel_path: models[0], filename: "840.006-S-Washer.fcstd", asset_kind: "part", part_number: "840", part_version: "006", part_name: "Washer", label: "840.006-Washer" },
    ]);
    expect(snapshot(root, models)).toEqual(before);
  });

  it("carries real FCStd direct/ambiguous/missing/self diagnostics and Windows paths with ordered partial candidates", async () => {
    const root = workspace(); const host = "assembly/Root.ASSY.FCStd";
    const models = [host, "z_side/Pin.FCStd", "a_side/Pin.FCStd", "parts/Explicit.FCStd"];
    writeModel(root, host, linkDocument([
      { file: "..\\parts\\Explicit.FCStd", label: "Explicit instance" },
      { file: "Pin.FCStd" }, { file: "Absent.FCStd" }, { file: "Root.ASSY.FCStd" },
      { file: "readme.md" },
    ]));
    for (const rel of models.slice(1)) writeModel(root, rel);
    await scanCadWorkspaceIndex(root);
    seedPrefs(root); const before = snapshot(root, models);
    const full = searchOutgoingRefs(root, ".\\assembly\\Root.ASSY.FCStd");
    expect(full).toMatchObject({ count: 4, index_state: "ready" });
    expect(full.refs).toEqual(expect.arrayContaining([
      expect.objectContaining({ xlink_file_attr: "../parts/Explicit.FCStd", resolve_status: "resolved", target_repo_rel_path: "parts/Explicit.FCStd", link_label: "Explicit instance" }),
      expect.objectContaining({ xlink_file_attr: "Pin.FCStd", resolve_status: "ambiguous", target_repo_rel_path: null, target_file_asset_id: null, link_label: "Pin", rule_label: "Pin" }),
      expect.objectContaining({ xlink_file_attr: "Absent.FCStd", resolve_status: "missing", target_repo_rel_path: null, link_label: "Absent", rule_label: "Absent" }),
      expect.objectContaining({ xlink_file_attr: "Root.ASSY.FCStd", resolve_status: "self", target_repo_rel_path: host, link_label: "Root", rule_label: "Root" }),
    ]));
    // Like the old XML reader, the actual light scanner excludes non-FCStd
    // references; five-state public-index compatibility is tested below.
    expect(full.refs.some((ref: any) => ref.xlink_file_attr === "readme.md")).toBe(false);
    expect(snapshot(root, models)).toEqual(before);

    refreshBomXrefForHost(root, ".\\assembly\\Root.ASSY.FCStd", { recursive: false });
    const partial = searchOutgoingRefs(root, host);
    expect(partial).toMatchObject({ count: 4, index_state: "stale", bom_index_stale: true });
    expect(partial.refs.find((ref: any) => ref.resolve_status === "ambiguous")).toMatchObject({
      target_repo_rel_path: null, target_file_asset_id: null, rule_label: "Pin",
      detail: { candidates: ["./a_side/Pin.FCStd", "./z_side/Pin.FCStd"] },
    });
    expect(partial.refs.find((ref: any) => ref.resolve_status === "missing")).toMatchObject({ rule_label: "Absent" });
    // Partial refresh writes derived index rows, but neither source CAD nor
    // the user preferences. It is not called a read-only diagnostic action.
    expect(snapshot(root, models).files).toEqual(before.files);
    expect(snapshot(root, models).prefs).toEqual(before.prefs);
    const db = pnwCreateDb(phoenixDatabasePath(root));
    try {
      expect(db.get("SELECT value_json,updated_at FROM phoenix_workspace_pref WHERE section='cad.xlink_fix'"))
        .toEqual({ value_json: JSON.stringify({ batch_dir: ".", dry_run: false, all_in_dir: false, sentinel: "keep" }), updated_at: "before" });
    } finally { db.close(); }
  });

  it("reads all five statuses and fallback labels from a public shared-index producer without writing", () => {
    const root = workspace(); const host = "assembly/Root.FCStd";
    const models = [host, "z_side/Pin.FCStd", "a_side/Pin.FCStd", "parts/Explicit.FCStd"];
    for (const rel of models) writeModel(root, rel);
    const xlinks = [
      { file: "..\\parts\\Explicit.FCStd", label: "Explicit instance" },
      { file: "Pin.FCStd", label: null }, { file: "Absent.FCStd", label: null },
      { file: "Root.FCStd", label: null }, { file: "readme.md", label: null },
    ];
    // A valid shared producer can supply all five statuses. This deliberately
    // exercises public writer -> SQLite -> actual Desk reader, not the XML
    // scanner (which has the narrower FCStd-only projection tested above).
    const records: PnwCadIndexRecord[] = models.map(rel => {
      const stat = fs.statSync(path.join(root, rel));
      return { relativePath: rel, filename: path.basename(rel), documentKind: pnwInferBomDocumentKinds(rel).display,
        sizeBytes: stat.size, modifiedAtMs: stat.mtimeMs, objectCount: 0, xlinks: rel === host ? xlinks : [] };
    });
    const db = pnwCreateDb(phoenixDatabasePath(root));
    try {
      db.exec(PNW_WORKSPACE_SCHEMA_V13_DDL); db.run("INSERT INTO phoenix_meta(key,value) VALUES ('schema_version','13')");
      pnwWriteCadWorkspaceIndexV1(db, pnwBuildCadWorkspaceIndex(records), {
        scanUuid: randomUUID(), scannedAt: new Date().toISOString(), scanRoot: root,
        scope: "workspace", complete: true, expectedScanId: 0, assertCurrent() {},
      });
    } finally { db.close(); }
    seedPrefs(root); const before = snapshot(root, models);
    const result = searchOutgoingRefs(root, ".\\assembly\\Root.FCStd");
    expect(result).toMatchObject({ count: 5, index_state: "ready" });
    expect(result.refs.map((ref: any) => [ref.resolve_status, ref.link_label])).toEqual([
      ["missing", "Absent"], ["resolved", "Explicit instance"], ["ambiguous", "Pin"],
      ["self", "Root"], ["non_fcstd", "readme.md"],
    ]);
    expect(queryXrefCountsForRel(root, host)).toMatchObject({ outgoing_count: 5, outgoing: 2, incoming: 1, index_state: "ready" });
    expect(snapshot(root, models)).toEqual(before);
  });

  it("never reads an unsafe host outside the workspace and preserves index, model and preference bytes", async () => {
    const root = workspace(); const outside = workspace("cad-carry-outside-");
    const host = "assembly/Root.FCStd"; writeModel(root, host); writeModel(outside, "External.FCStd");
    await scanCadWorkspaceIndex(root); seedPrefs(root);
    const before = snapshot(root, [host]); const externalFile = path.join(outside, "External.FCStd");
    const externalBefore = fs.readFileSync(externalFile);
    const stat = vi.spyOn(fs, "statSync"); const read = vi.spyOn(fs, "readFileSync");
    const unsafe = `../${path.basename(outside)}/External.FCStd`;
    for (const rel of [unsafe, unsafe.replaceAll("/", "\\")]) {
      // Host adaptation: read queries return visibly missing data; the refresh
      // command rejects. Neither behavior may access or mutate the escape.
      expect(searchOutgoingRefs(root, rel)).toMatchObject({ count: 0, refs: [], index_state: "missing", index_pending: true, index_reason: "asset_missing" });
      expect(queryXrefCountsForRel(root, rel)).toMatchObject({ outgoing_count: 0, index_state: "missing", index_pending: true, index_reason: "asset_missing" });
      expect(() => refreshBomXrefForHost(root, rel)).toThrow(/Host FCStd file does not exist/);
    }
    expect(stat.mock.calls.some(([filename]) => String(filename) === externalFile)).toBe(false);
    expect(read.mock.calls.some(([filename]) => String(filename) === externalFile)).toBe(false);
    stat.mockRestore(); read.mockRestore();
    expect(snapshot(root, [host])).toEqual(before);
    expect(fs.readFileSync(externalFile)).toEqual(externalBefore);
  });
});
