import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { strToU8, zipSync } from "fflate";
import { afterEach, describe, expect, it, vi } from "vitest";
import { pnwCreateDb } from "@phoenix-wing/db-node";
import {
  fileDetailXrefs,
  patchBomLinkLabels,
  queryXrefCountsForRel,
  refreshBomXrefForHost,
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

    CREATE TABLE phoenix_cad_scan (id INTEGER PRIMARY KEY, scan_uuid TEXT, scanned_at TEXT, scan_root TEXT,
      stats_json TEXT, status TEXT, phase TEXT, started_at TEXT, finished_at TEXT);
    INSERT INTO phoenix_cad_scan(id,status) VALUES (1,'done');

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
      bom_json TEXT,
      updated_at TEXT
    );

    CREATE TABLE phoenix_cad_bom_line (id INTEGER PRIMARY KEY, assembly_rel TEXT, part_rel TEXT, quantity INTEGER);
    INSERT INTO phoenix_cad_bom_line VALUES (1,'./asm/Root.ASSY.FCStd','./asm/Sub.ASSY.FCStd',1),
      (2,'./asm/Root.ASSY.FCStd','./parts/Bolt.FCStd',1),
      (3,'./asm/Root.ASSY.FCStd','Missing.FCStd',1),
      (4,'./asm/Sub.ASSY.FCStd','./parts/Bolt.FCStd',1);

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
  for (const row of db.all<{ id: number; repo_rel_path: string }>("SELECT id,repo_rel_path FROM phoenix_cad_file_asset")) {
    const stat = fs.statSync(path.join(workspace, row.repo_rel_path));
    db.run("UPDATE phoenix_cad_file_asset SET bom_json=? WHERE id=?", [JSON.stringify({ size_bytes: stat.size, mtime_ms: Math.trunc(stat.mtimeMs) }), row.id]);
  }
  db.close();
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// Metadata-only independent scenes; object names, counts and labels are generic.
const labelProperty = (value: string) => `<Property name="Label" type="App::PropertyString"><String value="${value}"/></Property>`;
const namedObject = (name: string, value: string | null, properties = "") => `<Object name="${name}"><Properties>${value === null ? "" : labelProperty(value)}${properties}</Properties></Object>`;
const namedLink = (file: string, name = "PartNode") => `<Property name="LinkedObject" type="App::PropertyXLink"><XLink file="${file}" name="${name}"/></Property>`;
const namedGroup = (names: string[]) => `<Property name="Group" type="App::PropertyLinkList"><LinkList>${names.map(name => `<Link value="${name}"/>`).join("")}</LinkList></Property>`;
const namedDocument = (...objects: string[]) => `<Document><ObjectData>${objects.join("")}</ObjectData></Document>`;
function namedLabelFixture(labels = ["Generic part.001", "Generic part.002"], targetLabel = "Generic part") {
  const workspace = makeTempRoot(); createBomXrefFixture(workspace);
  const host = namedDocument(namedObject("Root", "Generic assembly", namedGroup(["First", "Second"])),
    // Serialization order must not determine sibling instance numbering.
    namedObject("Second", labels[1], namedLink("Sub.ASSY.FCStd")),
    namedObject("First", labels[0], namedLink("Sub.ASSY.FCStd")));
  writeFcstd(workspace, "asm/Root.ASSY.FCStd", host);
  writeFcstd(workspace, "asm/Sub.ASSY.FCStd", namedDocument(namedObject("FileRoot", "Different file-level name"), namedObject("PartNode", targetLabel)));
  const db = pnwCreateDb(path.join(workspace, ".phoenix", "phoenix-workspace.sqlite"));
  db.run("DELETE FROM phoenix_cad_bom_xref WHERE xlink_file_attr='Missing.FCStd'"); db.close();
  return { workspace, host };
}
const checkedOutgoing = (workspace: string, rel: string, opts: { limit?: number } = {}) =>
  searchOutgoingRefs(workspace, rel, { ...opts, labelCheck: "saved_current_host" });

describe("reference label checks share assembly object and sibling rules", () => {
  it("does not warn for correct numbered instances on explicit checks, including a limited result list; incoming remains cached", () => {
    const { workspace } = namedLabelFixture();
    const files = ["asm/Root.ASSY.FCStd", "asm/Sub.ASSY.FCStd", "parts/Bolt.FCStd", ".phoenix/phoenix-workspace.sqlite"];
    const before = files.map(rel => fs.readFileSync(path.join(workspace, rel)));
    const outgoing = checkedOutgoing(workspace, "asm/Root.ASSY.FCStd");
    expect(outgoing.label_mismatch_count).toBe(0);
    expect(outgoing.refs.find((ref: any) => ref.target_basename === "Sub.ASSY.FCStd")).toMatchObject({
      link_label: "Generic part.002", rule_label: "Generic part.002", label_check_status: "matched", label_mismatch: false,
    });
    const limited = checkedOutgoing(workspace, "asm/Root.ASSY.FCStd", { limit: 1 });
    expect(limited.label_mismatch_count).toBe(0);
    expect(limited.refs[0]).toMatchObject({ label_check_status: "matched", rule_label: "Generic part.002" });
    const detail = fileDetailXrefs(workspace, "asm/Root.ASSY.FCStd", { labelCheck: "saved_current_host" });
    expect(detail.outgoing.refs[0]).toMatchObject({ label_check_status: "matched", label_mismatch: false });
    const incoming = searchIncomingRefs(workspace, { rel: "asm/Sub.ASSY.FCStd", transitive: false });
    expect(incoming.refs[0]).toMatchObject({ label_check_status: "unknown", label_mismatch: false });
    files.forEach((rel, index) => expect(fs.readFileSync(path.join(workspace, rel))).toEqual(before[index]));
  });

  it.each([["Wrong body.001", "Generic part.002"], ["Generic part.002", "Generic part.002"]])("still warns for a proven incorrect label/body or ordinal [case %#]", (first, second) => {
    const labels = [first, second];
    const { workspace } = namedLabelFixture(labels);
    const result = checkedOutgoing(workspace, "asm/Root.ASSY.FCStd");
    expect(result.label_mismatch_count).toBe(1);
    expect(result.refs.find((ref: any) => ref.target_basename === "Sub.ASSY.FCStd")).toMatchObject({
      link_label: labels[0], rule_label: "Generic part.001", label_check_status: "mismatch", label_mismatch: true,
    });
  });

  it("does not strip a suffix that is part of the target's own label", () => {
    const { workspace } = namedLabelFixture(["Generic part.001.001", "Generic part.001.002"], "Generic part.001");
    expect(checkedOutgoing(workspace, "asm/Root.ASSY.FCStd").label_mismatch_count).toBe(0);
    writeFcstd(workspace, "asm/Sub.ASSY.FCStd", namedDocument(namedObject("PartNode", "Generic part.002")));
    expect(checkedOutgoing(workspace, "asm/Root.ASSY.FCStd").label_mismatch_count).toBe(1);
  });

  it("uses independent numbering per Group instead of numbering every reference to the same file together", () => {
    const { workspace } = namedLabelFixture();
    writeFcstd(workspace, "asm/Root.ASSY.FCStd", namedDocument(
      namedObject("Root", "Generic assembly", namedGroup(["Left", "Right"])),
      namedObject("Left", "Left", namedGroup(["First"])), namedObject("Right", "Right", namedGroup(["Second"])),
      namedObject("First", "Generic part", namedLink("Sub.ASSY.FCStd")), namedObject("Second", "Generic part", namedLink("Sub.ASSY.FCStd"))));
    expect(checkedOutgoing(workspace, "asm/Root.ASSY.FCStd").refs.find((ref: any) => ref.target_basename === "Sub.ASSY.FCStd"))
      .toMatchObject({ label_check_status: "matched", label_mismatch: false });
  });

  it.each(["missing target", "missing object", "missing object name", "missing label", "unreadable sibling", "local sibling", "cyclic Group", "missing Group member", "cyclic projection", "nameless projection", "multiple projection targets", "indexed target changed"])("leaves %s neutral instead of falling back to the file rule", mode => {
    const { workspace, host } = namedLabelFixture();
    if (mode === "missing target") fs.unlinkSync(path.join(workspace, "asm/Sub.ASSY.FCStd"));
    if (mode === "missing object") writeFcstd(workspace, "asm/Sub.ASSY.FCStd", namedDocument(namedObject("OtherNode", "Generic part")));
    if (mode === "missing object name") writeFcstd(workspace, "asm/Root.ASSY.FCStd", host.replaceAll('name="PartNode"', 'name=""'));
    if (mode === "missing label") writeFcstd(workspace, "asm/Root.ASSY.FCStd", host.replace(namedObject("First", "Generic part.001", namedLink("Sub.ASSY.FCStd")), namedObject("First", null, namedLink("Sub.ASSY.FCStd"))));
    if (mode === "unreadable sibling") writeFcstd(workspace, "asm/Root.ASSY.FCStd", host.replace(namedObject("Second", "Generic part.002", namedLink("Sub.ASSY.FCStd")), namedObject("Second", "Generic part.002", namedLink("missing-projection.FCStd"))));
    if (mode === "local sibling") writeFcstd(workspace, "asm/Root.ASSY.FCStd", host.replace(namedObject("Second", "Generic part.002", namedLink("Sub.ASSY.FCStd")), namedObject("Second", "Generic part.002", namedLink("", "First"))));
    if (mode === "cyclic Group") writeFcstd(workspace, "asm/Root.ASSY.FCStd", host.replace(namedGroup(["First", "Second"]), namedGroup(["First", "Second", "Root"])));
    if (mode === "missing Group member") writeFcstd(workspace, "asm/Root.ASSY.FCStd", host.replace(namedGroup(["First", "Second"]), namedGroup(["First", "Second", "Absent"])));
    if (["cyclic projection", "nameless projection", "multiple projection targets"].includes(mode)) {
      const property = mode === "cyclic projection" ? namedLink("Sub.ASSY.FCStd")
        : mode === "nameless projection" ? namedLink("Sub.ASSY.FCStd", "")
        : '<Property name="LinkedObject" type="App::PropertyXLink"><XLink file="Sub.ASSY.FCStd" name="A"/><XLink file="Sub.ASSY.FCStd" name="B"/></Property>';
      writeFcstd(workspace, "asm/Sub.ASSY.FCStd", namedDocument(namedObject("PartNode", "Misleading projection label", property)));
    }
    if (mode === "indexed target changed") {
      const db = pnwCreateDb(path.join(workspace, ".phoenix", "phoenix-workspace.sqlite"));
      db.run("UPDATE phoenix_cad_bom_xref SET target_repo_rel_path='./parts/Bolt.FCStd' WHERE xlink_file_attr='Sub.ASSY.FCStd'"); db.close();
    }
    const result = checkedOutgoing(workspace, "asm/Root.ASSY.FCStd");
    expect(result.label_mismatch_count).toBe(0);
    expect(result.refs.find((ref: any) => ref.target_basename === "Sub.ASSY.FCStd"))
      .toMatchObject({ label_check_status: "unknown", label_mismatch: false });
  });

  it("never opens CAD for default outgoing, incoming or detail projections, even with fully named label mismatches", () => {
    const { workspace } = namedLabelFixture(["Wrong.001", "Wrong.002"]), attempted: string[] = [];
    const forbid = (filename: unknown) => {
      if (/\.fcstd$/i.test(String(filename))) { attempted.push(String(filename)); throw new Error("Cached projection attempted a CAD content read"); }
    };
    const sync = fs.readFileSync, asyncRead = fs.promises.readFile, stream = fs.createReadStream, open = fs.openSync;
    vi.spyOn(fs, "readFileSync").mockImplementation(((file: any, ...args: any[]) => { forbid(file); return (sync as any)(file, ...args); }) as typeof fs.readFileSync);
    vi.spyOn(fs.promises, "readFile").mockImplementation(((file: any, ...args: any[]) => { forbid(file); return (asyncRead as any)(file, ...args); }) as typeof fs.promises.readFile);
    vi.spyOn(fs, "createReadStream").mockImplementation(((file: any, ...args: any[]) => { forbid(file); return (stream as any)(file, ...args); }) as typeof fs.createReadStream);
    vi.spyOn(fs, "openSync").mockImplementation(((file: any, ...args: any[]) => { forbid(file); return (open as any)(file, ...args); }) as typeof fs.openSync);
    const outgoing = searchOutgoingRefs(workspace, "asm/Root.ASSY.FCStd");
    const incoming = searchIncomingRefs(workspace, { rel: "asm/Sub.ASSY.FCStd" });
    const detail = fileDetailXrefs(workspace, "asm/Root.ASSY.FCStd");
    for (const refs of [outgoing.refs, incoming.refs, detail.outgoing.refs]) {
      expect(refs.length).toBeGreaterThan(0);
      expect(refs.every((ref: any) => ref.label_check_status === "unknown" && ref.label_mismatch === false)).toBe(true);
    }
    expect(outgoing.label_mismatch_count).toBe(0); expect(detail.outgoing.label_mismatch_count).toBe(0);
    expect(attempted).toEqual([]);
  });

  it("does explicit saved-label reads only after the actual native DB close and lease release", () => {
    const { workspace } = namedLabelFixture(), close = DatabaseSync.prototype.close, read = fs.readFileSync;
    let nativeClosed = false;
    vi.spyOn(DatabaseSync.prototype, "close").mockImplementation(function (this: DatabaseSync) { close.call(this); nativeClosed = true; });
    const observations: Array<{ nativeClosed: boolean; locked: boolean }> = [];
    vi.spyOn(fs, "readFileSync").mockImplementation(((file: any, ...args: any[]) => {
      if (/\.fcstd$/i.test(String(file))) observations.push({ nativeClosed, locked: fs.existsSync(path.join(workspace, ".phoenix/phoenix-workspace.sqlite.lock")) });
      return (read as any)(file, ...args);
    }) as typeof fs.readFileSync);
    expect(checkedOutgoing(workspace, "asm/Root.ASSY.FCStd").refs[0].label_check_status).toBe("matched");
    nativeClosed = false;
    expect(fileDetailXrefs(workspace, "asm/Root.ASSY.FCStd", { labelCheck: "saved_current_host" }).outgoing.refs[0].label_check_status).toBe("matched");
    expect(observations.length).toBeGreaterThanOrEqual(4);
    expect(observations.every(row => row.nativeClosed && !row.locked)).toBe(true);
  });

  it("does not read saved labels when DB close fails, nor hide the close error", () => {
    const { workspace } = namedLabelFixture(), close = DatabaseSync.prototype.close, read = fs.readFileSync, attempted: string[] = [];
    vi.spyOn(DatabaseSync.prototype, "close").mockImplementationOnce(function (this: DatabaseSync) { close.call(this); throw new Error("synthetic native close failed"); });
    vi.spyOn(fs, "readFileSync").mockImplementation(((file: any, ...args: any[]) => {
      if (/\.fcstd$/i.test(String(file))) attempted.push(String(file));
      return (read as any)(file, ...args);
    }) as typeof fs.readFileSync);
    expect(() => checkedOutgoing(workspace, "asm/Root.ASSY.FCStd")).toThrow("synthetic native close failed");
    expect(attempted).toEqual([]);
  });

  it("never expands an explicit current-host detail check into incoming parent CAD reads", () => {
    const { workspace } = namedLabelFixture(), read = fs.readFileSync, cadReads: string[] = [];
    const canonical = fs.realpathSync(workspace);
    vi.spyOn(fs, "readFileSync").mockImplementation(((file: any, ...args: any[]) => {
      if (/\.fcstd$/i.test(String(file))) cadReads.push(path.relative(canonical, fs.realpathSync(String(file))));
      return (read as any)(file, ...args);
    }) as typeof fs.readFileSync);
    const detail = fileDetailXrefs(workspace, "asm/Sub.ASSY.FCStd", { labelCheck: "saved_current_host" });
    expect(detail.incoming.hosts).toEqual(expect.arrayContaining([expect.objectContaining({ host_repo_rel_path: "./asm/Root.ASSY.FCStd" })]));
    expect(cadReads).toEqual(["asm/Sub.ASSY.FCStd"]);
    cadReads.length = 0;
    fileDetailXrefs(workspace, "asm/Sub.ASSY.FCStd", { scope: "incoming", labelCheck: "saved_current_host" });
    expect(cadReads).toEqual([]);
  });
});

describe("pnwBomXrefService", () => {
  it("queries BOM xref read-side data from the workspace SQLite index", () => {
    const workspace = makeTempRoot();
    createBomXrefFixture(workspace);

    expect(queryXrefCountsForRel(workspace, "asm/Sub.ASSY.FCStd")).toMatchObject({
      outgoing_count: 1,
      direct_incoming_count: 1,
      index_pending: false,
    });

    const outgoing = searchOutgoingRefs(workspace, "asm/Root.ASSY.FCStd");
    expect(outgoing.count).toBe(2);
    // Legacy file-only links do not identify a target object: remain neutral.
    expect(outgoing.label_mismatch_count).toBe(0);
    expect(outgoing.refs.every((ref: any) => ref.label_check_status === "unknown")).toBe(true);
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

    refreshBomXrefForHost(workspace, "asm/Root.ASSY.FCStd", { recursive: true, maxHosts: 10 });
    expect(searchOutgoingRefs(workspace, "asm/Sub.ASSY.FCStd").refs[0]).toMatchObject({
      xlink_file_attr: "../parts/Bolt.FCStd",
      link_label: "Bolt",
      rule_label: "Bolt",
    });
  });

  it("reads Auto CAD v0.2.0 indexes whose relative paths omit the ./ prefix", () => {
    const workspace = makeTempRoot();
    createBomXrefFixture(workspace);
    const db = pnwCreateDb(path.join(workspace, ".phoenix", "phoenix-workspace.sqlite"));
    db.exec(`
      UPDATE phoenix_cad_file_asset SET repo_rel_path = substr(repo_rel_path, 3);
      UPDATE phoenix_cad_bom_xref SET host_repo_rel_path = substr(host_repo_rel_path, 3);
      UPDATE phoenix_cad_bom_xref
      SET target_repo_rel_path = substr(target_repo_rel_path, 3)
      WHERE target_repo_rel_path LIKE './%';
      UPDATE phoenix_cad_bom_line SET assembly_rel = substr(assembly_rel,3);
    `);
    db.close();

    expect(queryXrefCountsForRel(workspace, "asm/Sub.ASSY.FCStd")).toMatchObject({
      outgoing_count: 1,
      direct_incoming_count: 1,
      index_pending: false,
    });
    expect(searchOutgoingRefs(workspace, "asm/Root.ASSY.FCStd").count).toBe(2);
    expect(searchIncomingRefs(workspace, { rel: "parts/Bolt.FCStd", transitive: true })).toMatchObject({
      count: 2,
      direct_count: 1,
    });
    expect(patchBomLinkLabels(workspace, [{
      host_repo_rel: "asm/Sub.ASSY.FCStd",
      xlink_file_attr: "../parts/Bolt.FCStd",
      link_label: "Bolt",
    }])).toMatchObject({ label_patches: 1, failed: [] });
  });

  it("re-reads host files, follows recursive FCStd links, and removes deleted edges", () => {
    const workspace = makeTempRoot();
    createBomXrefFixture(workspace);

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
    expect(queryXrefCountsForRel(workspace, "asm/Root.ASSY.FCStd")).toMatchObject({ index_pending: true });
    expect(searchOutgoingRefs(workspace, "asm/Root.ASSY.FCStd")).toMatchObject({
      count: 0,
      refs: [],
      index_pending: true,
    });
  });
});
