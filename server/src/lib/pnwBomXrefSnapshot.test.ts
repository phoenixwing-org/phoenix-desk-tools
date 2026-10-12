import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { DatabaseSync } from "node:sqlite";
import { strToU8, zipSync } from "fflate";
import { afterEach, describe, expect, it, vi } from "vitest";
import { pnwCreateDb } from "@phoenix-wing/db-node";
import { scanCadWorkspaceIndex } from "./cadIndexScanService.js";
import { phoenixDatabasePath } from "./phoenixDatabaseService.js";
import { assertCadBomSnapshotFresh, readCadIndexFreshness } from "./cadIndexFreshness.js";
import { fileDetailXrefs, queryXrefCountsForRel, refreshBomXrefForHost, refreshBomXrefForHostAsync, searchIncomingRefs, searchOutgoingRefs, loadAssemblyTreeFromXrefs } from "./pnwBomXrefService.js";

const roots: string[] = [];
afterEach(() => { vi.restoreAllMocks(); for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
function write(root: string, rel: string, xml: string) {
  const target = path.join(root, rel); fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, zipSync({ "Document.xml": strToU8(xml) }));
}
function links(...files: string[]) {
  return `<Document><ObjectData>${files.map((file, index) => `<Object name="Link${index}"><Properties>
    <Property name="LinkedObject" type="App::PropertyXLink"><XLink file="${file}" name="Body"/></Property>
    </Properties></Object>`).join("")}</ObjectData></Document>`;
}
async function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cad-bom-snapshot-")); roots.push(root);
  write(root, "asm/Root.ASSY.FCStd", links("Sub.ASSY.FCStd", "Sub.ASSY.FCStd"));
  write(root, "asm/Sub.ASSY.FCStd", links("../parts/Leaf.FCStd", "../parts/Leaf.FCStd", "../parts/Leaf.FCStd"));
  write(root, "parts/Leaf.FCStd", "<Document/>");
  await scanCadWorkspaceIndex(root);
  return root;
}
function withDb<T>(root: string, callback: (db: ReturnType<typeof pnwCreateDb>) => T): T {
  const db = pnwCreateDb(phoenixDatabasePath(root)); try { return callback(db); } finally { db.close(); }
}
function rows(root: string) {
  return withDb(root, db => ({ scans: db.all("SELECT * FROM phoenix_cad_scan ORDER BY id"),
    assets: db.all("SELECT * FROM phoenix_cad_file_asset ORDER BY id"),
    xrefs: db.all("SELECT * FROM phoenix_cad_bom_xref ORDER BY id"),
    boms: db.all("SELECT * FROM phoenix_cad_bom_line ORDER BY id"),
    tree: db.all("SELECT * FROM phoenix_cad_bom_tree_occurrence ORDER BY id"),
    parts: db.all("SELECT * FROM phoenix_cad_part_key ORDER BY id"),
    manualLinks: db.all("SELECT * FROM phoenix_cad_part_file_link ORDER BY id") }));
}

describe("BOM quantities and completed-snapshot boundaries", () => {
  it("does not double-count a cached drawing source using different path separators", async () => {
    const root = await fixture();
    write(root, "asm/Embedded.FCStd", `<Document><Objects><Object name="Box" type="Part::Box"/>
      <Object name="Model" type="App::Link"/><Object name="View" type="TechDraw::DrawViewPart"/></Objects><ObjectData>
      <Object name="Box"><Properties/></Object>
      <Object name="Model"><Properties><Property name="LinkedObject" type="App::PropertyXLink"><XLink file="../parts\\Leaf.FCStd" name="Body"/></Property></Properties></Object>
      <Object name="View"><Properties><Property name="XSource" type="App::PropertyXLinkList"><XLink file="../parts/Leaf.FCStd" name="Body"/></Property></Properties></Object>
      </ObjectData></Document>`);
    await scanCadWorkspaceIndex(root);
    const assertInstance = () => {
      const refs = searchOutgoingRefs(root, "asm/Embedded.FCStd").refs;
      expect(refs).toHaveLength(1);
      expect(refs[0].detail).toMatchObject({ basic_bom: true, quantity: 1 });
      expect(withDb(root, db => db.all("SELECT quantity FROM phoenix_cad_bom_line WHERE assembly_rel='asm/Embedded.FCStd'"))).toEqual([{ quantity: 1 }]);
    };
    assertInstance();
    refreshBomXrefForHost(root, "asm/Embedded.FCStd", { recursive: false });
    assertInstance();
    await refreshBomXrefForHostAsync(root, "asm/Embedded.FCStd", { recursive: false });
    assertInstance();
  });

  it("retains drawing dependencies in both full and partial refresh without inventing quantities", async () => {
    const root = await fixture();
    const drawing = `<Document><Objects><Object name="View" type="TechDraw::DrawProjGroupItem"/></Objects><ObjectData>
      <Object name="View"><Properties><Property name="XSource" type="App::PropertyXLinkList">
        <XLink file="../parts/Leaf.FCStd" name="Body"/><XLink file="../parts/Leaf.FCStd" name="Face"/>
      </Property></Properties></Object></ObjectData></Document>`;
    write(root, "drawings/Sheet.Drawing.FCStd", drawing);
    await scanCadWorkspaceIndex(root);
    const assertDependency = () => {
      const refs = searchOutgoingRefs(root, "drawings/Sheet.Drawing.FCStd").refs;
      expect(refs).toHaveLength(1);
      expect(refs[0].detail).toMatchObject({ basic_bom: false, reference_role: "drawing_source" });
      expect(refs[0].detail).not.toHaveProperty("quantity");
    };
    assertDependency();
    expect(withDb(root, db => db.all("SELECT * FROM phoenix_cad_bom_line WHERE assembly_rel='drawings/Sheet.Drawing.FCStd'"))).toEqual([]);
    refreshBomXrefForHost(root, "drawings/Sheet.Drawing.FCStd", { recursive: false });
    assertDependency();
    await refreshBomXrefForHostAsync(root, "drawings/Sheet.Drawing.FCStd", { recursive: false });
    assertDependency();
  });

  it("full scans retain 2x3 instances as recursive quantities 2 and 6", async () => {
    const root = await fixture();
    expect(withDb(root, db => db.all("SELECT part_rel,quantity FROM phoenix_cad_bom_line WHERE assembly_rel='asm/Root.ASSY.FCStd' ORDER BY depth")))
      .toEqual([{ part_rel: "asm/Sub.ASSY.FCStd", quantity: 2 }, { part_rel: "parts/Leaf.FCStd", quantity: 6 }]);
    expect(queryXrefCountsForRel(root, "./asm/Root.ASSY.FCStd")).toMatchObject({ outgoing_count: 1, outgoing: 1, flat_lines: 2, index_state: "ready", bom_index_state: "ready", index_pending: false });
    expect(searchOutgoingRefs(root, "asm/Sub.ASSY.FCStd").refs[0].detail.quantity).toBe(3);
    expect(withDb(root, db => assertCadBomSnapshotFresh(db, root))).toMatchObject({ bom_index_state: "ready" });
  });

  it("counts edges, target files, and actual BOM rows separately; null targets stay null", async () => {
    const root = await fixture();
    withDb(root, db => {
      const host = db.get<{ id: number }>("SELECT id FROM phoenix_cad_file_asset WHERE repo_rel_path='asm/Root.ASSY.FCStd'")!.id;
      const target = db.get<{ id: number }>("SELECT id FROM phoenix_cad_file_asset WHERE repo_rel_path='asm/Sub.ASSY.FCStd'")!.id;
      db.run(`INSERT INTO phoenix_cad_bom_xref(scan_id,host_file_asset_id,host_repo_rel_path,xlink_file_attr,target_basename,target_file_asset_id,target_repo_rel_path,resolve_status,last_seen_at)
        VALUES (1,?,'./asm/Root.ASSY.FCStd','./Sub.ASSY.FCStd','Sub.ASSY.FCStd',?,'./asm/Sub.ASSY.FCStd','resolved','now')`, [host, target]);
      for (const status of ["missing", "ambiguous"]) db.run(`INSERT INTO phoenix_cad_bom_xref(scan_id,host_file_asset_id,host_repo_rel_path,xlink_file_attr,target_basename,resolve_status,last_seen_at)
        VALUES (1,?,'asm/Root.ASSY.FCStd',?,? ,?,'now')`, [host, `${status}.FCStd`, `${status}.FCStd`, status]);
    });
    expect(queryXrefCountsForRel(root, "asm/Root.ASSY.FCStd")).toMatchObject({ outgoing_count: 4, outgoing: 1, flat_lines: 2 });
    const refs = searchOutgoingRefs(root, "asm/Root.ASSY.FCStd").refs;
    for (const status of ["missing", "ambiguous"]) expect(refs.find((row: any) => row.resolve_status === status)).toMatchObject({ target_repo_rel_path: null, target_file_asset_id: null });
  });

  it("matches incoming by exact path/asset identity, never another directory's suffix", async () => {
    const root = await fixture();
    write(root, "other/Leaf.FCStd", "<Document/>");
    write(root, "other/Host.FCStd", links("Leaf.FCStd"));
    write(root, "top/Unknown.FCStd", links("Leaf.FCStd", "Missing.FCStd", "Unknown.FCStd"));
    await scanCadWorkspaceIndex(root);
    const incoming = searchIncomingRefs(root, { rel: "./parts/Leaf.FCStd", transitive: false });
    expect(incoming.hosts.map((row: any) => row.host_repo_rel_path)).toEqual(["./asm/Sub.ASSY.FCStd"]);
    expect(queryXrefCountsForRel(root, "parts/Leaf.FCStd").incoming).toBe(1);
    expect(searchIncomingRefs(root, { rel: "other/Leaf.FCStd", transitive: false }).hosts.map((row: any) => row.host_repo_rel_path)).toEqual(["./other/Host.FCStd"]);
    const refs = searchOutgoingRefs(root, "top/Unknown.FCStd").refs;
    expect(refs.find((row: any) => row.resolve_status === "ambiguous")).toMatchObject({ target_repo_rel_path: null, target_file_asset_id: null });
    expect(refs.find((row: any) => row.resolve_status === "self")).toMatchObject({ target_repo_rel_path: "top/Unknown.FCStd" });
    expect(withDb(root, db => db.get<{ count: number }>("SELECT COUNT(*) AS count FROM phoenix_cad_bom_line WHERE cycle_detected=1")?.count)).toBeGreaterThan(0);
    const partial = refreshBomXrefForHost(root, "top/Unknown.FCStd", { recursive: true });
    expect(partial.hosts).toEqual(["./top/Unknown.FCStd"]);
    expect(searchOutgoingRefs(root, "top/Unknown.FCStd").refs.find((row: any) => row.resolve_status === "ambiguous"))
      .toMatchObject({ target_repo_rel_path: null, target_file_asset_id: null });
  });

  it("keeps recursive rows/manual data but marks the snapshot stale after partial refresh", async () => {
    const root = await fixture();
    withDb(root, db => {
      db.run("INSERT INTO phoenix_cad_part_key(part_number,part_version,part_name,notes,status,created_at,updated_at) VALUES ('900','001','Manual entry','keep these notes','active','before','before')");
      db.run("INSERT INTO phoenix_cad_part_file_link(part_key_id,file_asset_id,file_role,notes,link_status,linked_at) SELECT 1,id,'part','manual association','active','before' FROM phoenix_cad_file_asset WHERE repo_rel_path='parts/Leaf.FCStd'");
    });
    const before = rows(root);
    write(root, "asm/Root.ASSY.FCStd", links("Sub.ASSY.FCStd", "Sub.ASSY.FCStd", "Sub.ASSY.FCStd"));
    expect(queryXrefCountsForRel(root, "asm/Root.ASSY.FCStd")).toMatchObject({ index_stale: true, index_reason: "file_changed" });
    refreshBomXrefForHost(root, "asm/Root.ASSY.FCStd", { recursive: false });
    const after = rows(root);
    expect(after.boms).toEqual(before.boms); expect(after.assets).toEqual(before.assets);
    expect(after.parts).toEqual(before.parts); expect(after.manualLinks).toEqual(before.manualLinks);
    expect(after.scans.at(-1)).toMatchObject({ status: "stale", phase: "xref-partial-refresh" });
    expect(after.scans).toHaveLength(before.scans.length + 1);
    expect(searchOutgoingRefs(root, "asm/Root.ASSY.FCStd").refs[0].detail.quantity).toBe(3);
    expect(queryXrefCountsForRel(root, "asm/Root.ASSY.FCStd")).toMatchObject({ index_stale: true, bom_index_stale: true, index_reason: "partial_refresh", flat_lines: 2 });
    expect(loadAssemblyTreeFromXrefs(root, "asm/Root.ASSY.FCStd", { full: true })).toMatchObject({ bom_index_stale: true });
    expect(() => withDb(root, db => assertCadBomSnapshotFresh(db, root))).toThrow(/complete workspace scan required/);
    await scanCadWorkspaceIndex(root);
    expect(queryXrefCountsForRel(root, "asm/Root.ASSY.FCStd")).toMatchObject({ index_state: "ready", bom_index_state: "ready" });
    expect(withDb(root, db => db.all("SELECT quantity FROM phoenix_cad_bom_line WHERE assembly_rel='asm/Root.ASSY.FCStd' ORDER BY depth"))).toEqual([{ quantity: 3 }, { quantity: 9 }]);
    expect(rows(root).parts).toEqual(before.parts); expect(rows(root).manualLinks).toEqual(before.manualLinks);
  });

  it("rolls back xref/tree/stale revision together on insertion failure", async () => {
    const root = await fixture();
    withDb(root, db => db.exec("CREATE TRIGGER fail_xref_insert BEFORE INSERT ON phoenix_cad_bom_xref BEGIN SELECT RAISE(ABORT,'synthetic write failure'); END"));
    const before = rows(root);
    expect(() => refreshBomXrefForHost(root, "asm/Root.ASSY.FCStd", { recursive: false })).toThrow(/synthetic write failure/);
    expect(rows(root)).toEqual(before);
    expect(queryXrefCountsForRel(root, "asm/Root.ASSY.FCStd").index_state).toBe("ready");
  });

  it("does not erase data on bad ZIP, bad XML, cancellation, or a stale read snapshot", async () => {
    const root = await fixture(); const before = rows(root);
    await expect(refreshBomXrefForHostAsync(root, "asm/Root.ASSY.FCStd", { isCancelled: () => true })).resolves.toMatchObject({ cancelled: true });
    expect(rows(root)).toEqual(before);
    await expect(refreshBomXrefForHostAsync(root, "asm/Root.ASSY.FCStd", { recursive: false, onProgress(phase, count) {
      if (phase === "xref" && count === 1) fs.appendFileSync(path.join(root, "asm/Root.ASSY.FCStd"), "changed");
    } })).rejects.toThrow(/snapshot changed/);
    expect(rows(root)).toEqual(before);
    fs.writeFileSync(path.join(root, "asm/Root.ASSY.FCStd"), "not ZIP");
    expect(() => refreshBomXrefForHost(root, "asm/Root.ASSY.FCStd", { recursive: false })).toThrow(/zip/i);
    write(root, "asm/Root.ASSY.FCStd", "<Document><ObjectData>");
    expect(() => refreshBomXrefForHost(root, "asm/Root.ASSY.FCStd", { recursive: false })).toThrow(/不完整/);
    expect(rows(root)).toEqual(before);
  });

  it("invalidates a concurrent full scan revision without inventing a completion", async () => {
    const root = await fixture();
    await expect(scanCadWorkspaceIndex(root, { onProgress(progress) {
      if (progress.phase === "checking") refreshBomXrefForHost(root, "asm/Root.ASSY.FCStd", { recursive: false });
    } })).rejects.toThrow(/changed during discovery/);
    expect(rows(root).scans).toHaveLength(2);
    expect(rows(root).scans.at(-1)).toMatchObject({ status: "stale" });
  });

  it("distinguishes an unindexed or incomplete file and unknown metadata from a true empty result", async () => {
    const root = await fixture();
    expect(queryXrefCountsForRel(root, "parts/Leaf.FCStd")).toMatchObject({ outgoing_count: 0, outgoing: 0, flat_lines: 0, index_state: "ready" });
    expect(queryXrefCountsForRel(root, "Unindexed.FCStd")).toMatchObject({ index_pending: true, index_reason: "asset_missing" });
    withDb(root, db => db.run("UPDATE phoenix_cad_file_asset SET bom_json=NULL WHERE repo_rel_path='parts/Leaf.FCStd'"));
    expect(withDb(root, db => readCadIndexFreshness(db, root))).toMatchObject({ index_stale: true, index_reason: "snapshot_metadata_missing" });
    withDb(root, db => db.run("UPDATE phoenix_cad_scan SET status='failed' WHERE id=1"));
    expect(queryXrefCountsForRel(root, "parts/Leaf.FCStd")).toMatchObject({ index_pending: true, index_state: "incomplete" });
  });

  it("bounds detail freshness checks to the selected file; delivery still verifies all assets", async () => {
    const root = await fixture();
    const stat = vi.spyOn(fs, "statSync");
    expect(queryXrefCountsForRel(root, "parts/Leaf.FCStd")).toMatchObject({ freshness_scope: "file", index_state: "ready" });
    expect(stat.mock.calls.some(([file]) => String(file).endsWith("asm/Root.ASSY.FCStd"))).toBe(false);
    expect(stat.mock.calls.some(([file]) => String(file).endsWith("asm/Sub.ASSY.FCStd"))).toBe(false);
    stat.mockRestore();
    fs.appendFileSync(path.join(root, "asm/Sub.ASSY.FCStd"), "changed");
    expect(queryXrefCountsForRel(root, "parts/Leaf.FCStd").index_state).toBe("ready");
    expect(() => withDb(root, db => assertCadBomSnapshotFresh(db, root))).toThrow(/complete workspace scan required/);
  });

  it("does not report a missing BOM table as successfully indexed zero BOM rows", async () => {
    const root = await fixture();
    withDb(root, db => db.exec("DROP TABLE phoenix_cad_bom_line"));
    expect(queryXrefCountsForRel(root, "asm/Root.ASSY.FCStd")).toMatchObject({ outgoing_count: 1, flat_lines: 0, index_state: "ready", bom_index_pending: true, bom_index_state: "missing" });
    expect(() => withDb(root, db => assertCadBomSnapshotFresh(db, root))).toThrow(/complete workspace scan required/);
  });

  it("refuses symlink database paths without changing the referenced index", async () => {
    const root = await fixture(); const before = rows(root);
    const aliased = fs.mkdtempSync(path.join(os.tmpdir(), "cad-bom-symlink-")); roots.push(aliased);
    fs.mkdirSync(path.join(aliased, ".phoenix"));
    fs.symlinkSync(phoenixDatabasePath(root), phoenixDatabasePath(aliased));
    expect(() => queryXrefCountsForRel(aliased, "asm/Root.ASSY.FCStd")).toThrow(/unsafe/);
    expect(rows(root)).toEqual(before);
  });

  it("keeps combined detail in one snapshot when a writer attempts a new revision between read sides", async () => {
    const root = await fixture(), before = rows(root);
    const insertRevision = () => withDb(root, db => db.run("INSERT INTO phoenix_cad_scan(scanned_at,scan_root,stats_json,status,phase) VALUES ('now','workspace','{}','done','synthetic-concurrent-completion')"));
    const prepare = DatabaseSync.prototype.prepare, exec = DatabaseSync.prototype.exec;
    let begins = 0, attempts = 0, refusal: unknown;
    vi.spyOn(DatabaseSync.prototype, "exec").mockImplementation(function (this: DatabaseSync, sql: string) {
      if (/\bBEGIN\b/.test(sql)) begins++;
      return exec.call(this, sql);
    });
    vi.spyOn(DatabaseSync.prototype, "prepare").mockImplementation(function (this: DatabaseSync, sql: string) {
      // Outgoing and its freshness have already been read. A real second WASM
      // connection must not commit a new generation before incoming is read.
      if (/SELECT \* FROM phoenix_cad_bom_xref\s+WHERE \(\(target_repo_rel_path/.test(sql)) {
        attempts++;
        try { insertRevision(); } catch (error) { refusal = error; }
      }
      return prepare.call(this, sql);
    });
    expect(fileDetailXrefs(root, "parts/Leaf.FCStd")).toMatchObject({
      scan_id: 1, index_state: "ready", index_reason: "", bom_index_stale: false,
      outgoing: { count: 0, refs: [] }, incoming: { count: 2, direct_count: 1 },
    });
    expect(attempts).toBe(1);
    expect(refusal).toBeInstanceOf(Error);
    expect((refusal as Error).message).toMatch(/busy|locked/i);
    expect(begins).toBe(1);
    vi.restoreAllMocks();
    expect(rows(root)).toEqual(before);
    // The same update is valid after the reader releases its owned lease, and
    // the next request must see the whole new generation rather than old refs.
    insertRevision();
    expect(rows(root).scans).toHaveLength(2);
    expect(fileDetailXrefs(root, "parts/Leaf.FCStd")).toMatchObject({
      scan_id: 2, index_state: "ready", bom_index_stale: false,
      outgoing: { count: 0, refs: [] }, incoming: { count: 2, direct_count: 1 },
    });
  });

  it("full scans all 40 actual targets and correctly resolves raw > and one-decoded entity paths", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "cad-bom-forty-")); roots.push(root);
    const targets = Array.from({ length: 38 }, (_, index) => `../parts/Target-${index}.FCStd`);
    for (const target of targets) write(root, target.replace("../", ""), "<Document/>");
    write(root, "parts/A>B.FCStd", "<Document/>"); write(root, "parts/A&amp;B.FCStd", "<Document/>");
    write(root, "asm/Root.ASSY.FCStd", links(...targets, "../parts/A>B.FCStd", "../parts/A&#38;amp;B.FCStd"));
    const result = await scanCadWorkspaceIndex(root);
    expect(result).toMatchObject({ files: 41, references: 40, bomLines: 40 });
    expect(queryXrefCountsForRel(root, "asm/Root.ASSY.FCStd")).toMatchObject({ outgoing_count: 40, outgoing: 40, flat_lines: 40 });
    const refs = searchOutgoingRefs(root, "asm/Root.ASSY.FCStd").refs;
    expect(refs.find((ref: any) => ref.xlink_file_attr === "../parts/A>B.FCStd")).toMatchObject({ resolve_status: "resolved", target_repo_rel_path: "parts/A>B.FCStd" });
    expect(refs.find((ref: any) => ref.xlink_file_attr === "../parts/A&amp;B.FCStd")).toMatchObject({ resolve_status: "resolved", target_repo_rel_path: "parts/A&amp;B.FCStd" });
    refreshBomXrefForHost(root, "asm/Root.ASSY.FCStd", { recursive: false });
    expect(queryXrefCountsForRel(root, "asm/Root.ASSY.FCStd")).toMatchObject({ outgoing_count: 40, outgoing: 40, flat_lines: 40, bom_index_stale: true });
  });

  it("refuses oversized ZIP/XML and declared inflation without committing partial state", async () => {
    const root = await fixture(); const before = rows(root); const host = path.join(root, "asm/Root.ASSY.FCStd");
    fs.truncateSync(host, 64 * 1024 * 1024 + 1);
    expect(() => refreshBomXrefForHost(root, "asm/Root.ASSY.FCStd", { recursive: false })).toThrow(/64 MiB/);
    expect(rows(root)).toEqual(before);
    write(root, "asm/Root.ASSY.FCStd", `<Document><!--${"x".repeat(16 * 1024 * 1024)}--></Document>`);
    expect(() => refreshBomXrefForHost(root, "asm/Root.ASSY.FCStd", { recursive: false })).toThrow(/解压大小/);
    expect(rows(root)).toEqual(before);
    const bomb = zipSync({ "Document.xml": strToU8("<Document/>"), "LargePayload.bin": new Uint8Array([0]) }, { level: 0 });
    const view = new DataView(bomb.buffer, bomb.byteOffset, bomb.byteLength);
    for (let offset = 0; offset <= bomb.length - 46; offset++) {
      if (view.getUint32(offset, true) === 0x02014b50 && String.fromCharCode(...bomb.subarray(offset + 46, offset + 46 + view.getUint16(offset + 28, true))) === "LargePayload.bin") {
        view.setUint32(offset + 24, 256 * 1024 * 1024 + 1, true); break;
      }
    }
    fs.writeFileSync(host, bomb);
    expect(() => refreshBomXrefForHost(root, "asm/Root.ASSY.FCStd", { recursive: false })).toThrow(/解压大小/);
    expect(rows(root)).toEqual(before);
  });

  it("refuses external file and parent-directory symlinks without updating old data", async () => {
    const root = await fixture(); const before = rows(root);
    const external = fs.mkdtempSync(path.join(os.tmpdir(), "cad-bom-outside-")); roots.push(external);
    write(external, "External.FCStd", links("ShouldNotRead.FCStd"));
    const host = path.join(root, "asm/Root.ASSY.FCStd");
    fs.renameSync(host, `${host}.original`); fs.symlinkSync(path.join(external, "External.FCStd"), host);
    expect(() => refreshBomXrefForHost(root, "asm/Root.ASSY.FCStd", { recursive: false })).toThrow(/符号链接/);
    expect(rows(root)).toEqual(before);
    fs.renameSync(path.join(root, "asm"), path.join(root, "original-asm")); fs.symlinkSync(external, path.join(root, "asm"));
    expect(() => refreshBomXrefForHost(root, "asm/External.FCStd", { recursive: false })).toThrow(/符号链接/);
    expect(rows(root)).toEqual(before);
  });

  it("rejects unsupported multi-target arrays in full scan and partial refresh instead of guessing quantities", async () => {
    const root = await fixture(); const before = rows(root);
    write(root, "asm/Root.ASSY.FCStd", `<Document><ObjectData><Object name="Array"><Properties><Property name="LinkedObject" type="App::PropertyXLinkList"><XLink file="Sub.ASSY.FCStd" name="A"/><XLink file="Sub.ASSY.FCStd" name="B"/></Property></Properties></Object></ObjectData></Document>`);
    expect(() => refreshBomXrefForHost(root, "asm/Root.ASSY.FCStd", { recursive: false })).toThrow(/multi-target.*unsupported/);
    await expect(scanCadWorkspaceIndex(root, { continueOnParseError: false })).rejects.toThrow(/multi-target.*unsupported/);
    expect(rows(root)).toEqual(before);
  });
});
