import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { afterEach, describe, expect, it, vi } from "vitest";
import { pnwCreateDb } from "@phoenix-wing/db-node";
import { refreshBomXrefForHost } from "./pnwBomXrefService.js";
import * as xrefService from "./pnwBomXrefService.js";
import * as archiveReader from "./fcstdBatchFiles.js";
import {
  analyzeRenameReferences,
  applyRenameCorrections,
  executeDiskFileRename,
  listRenameLogs,
  loadRenameAnalysis,
} from "./pnwRenameService.js";

const tempRoots: string[] = [];

function makeTempRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pnw-rename-"));
  tempRoots.push(root);
  return root;
}

function writeFile(root: string, rel: string, text: string) {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, text, "utf8");
}

function writeFcstd(root: string, rel: string, documentXml: string) {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, zipSync({ "Document.xml": strToU8(documentXml) }));
}

function readFcstdXml(root: string, rel: string): string {
  const files = unzipSync(new Uint8Array(fs.readFileSync(path.join(root, rel))));
  return strFromU8(files["Document.xml"]);
}

function createRenameFixture(workspace: string) {
  // Independent, uniquely identified real root: a DB label alone must not
  // certify an old serializer's nameless XLink target.
  const target = '<Document><Objects><Object name="Body" type="PartDesign::Body"/></Objects><ObjectData><Object name="Body"><Properties><Property name="Label" type="App::PropertyString"><String value="New Part"/></Property></Properties></Object></ObjectData></Document>';
  writeFcstd(workspace, "parts/OldPart.FCStd", target);
  writeFcstd(
    workspace,
    "asm/Assembly.FCStd",
    '<Document><ObjectData><Object name="PartLink"><Property name="Label" type="App::PropertyString"><String value="Old label"/></Property><XLink file="../parts/OldPart.FCStd"/></Object></ObjectData></Document>',
  );
  writeFcstd(
    workspace,
    "upper/Top.FCStd",
    '<Document><ObjectData><Object name="AssemblyLink"><Property name="Label" type="App::PropertyString"><String value="Assembly"/></Property><XLink file="../asm/Assembly.FCStd"/></Object></ObjectData></Document>',
  );

  const db = pnwCreateDb(path.join(workspace, ".phoenix", "phoenix-workspace.sqlite"));
  db.exec(`
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
      last_seen_at TEXT,
      updated_at TEXT
    );
  `);
  const sql = `INSERT INTO phoenix_cad_file_asset (
    id, repo_rel_path, filename, asset_kind, part_number, part_version,
    type_code, model_series, part_name, label, file_status, last_seen_at, updated_at
  ) VALUES (?, ?, ?, 'fcstd', ?, ?, '', '', ?, ?, 'present', datetime('now'), datetime('now'))`;
  db.run(sql, [1, "./parts/OldPart.FCStd", "OldPart.FCStd", "100001", "001", "New Part", "New Part"]);
  db.run(sql, [2, "./asm/Assembly.FCStd", "Assembly.FCStd", "100002", "001", "Assembly", "Assembly"]);
  db.run(sql, [3, "./upper/Top.FCStd", "Top.FCStd", "100003", "001", "Top", "Top"]);
  db.close();
  refreshBomXrefForHost(workspace, "upper/Top.FCStd", { recursive: true, maxHosts: 10 });
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const root of tempRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("pnwRenameService", () => {
  it.each(["before_write", "after_write"])("reports target source drift separately from completed path correction (%s)", timing => {
    const root = makeTempRoot(); createRenameFixture(root);
    const renamed = executeDiskFileRename(root, "parts/OldPart.FCStd", { filename: "NewPart.FCStd" });
    const db = pnwCreateDb(path.join(root, ".phoenix/phoenix-workspace.sqlite"));
    try { db.run("UPDATE phoenix_cad_file_asset SET repo_rel_path = ?, filename = ? WHERE id = 1", ["./parts/NewPart.FCStd", "NewPart.FCStd"]); }
    finally { db.close(); }
    const args = { rename_log_id: renamed.rename_log_id, host_repo_rel_paths: ["asm/Assembly.FCStd"], transitive: false };
    expect(applyRenameCorrections(root, args)).toMatchObject({ xlink_patches: 1, failed: [] });
    const sourceChange = () => writeFcstd(root, "parts/NewPart.FCStd", readFcstdXml(root, "parts/NewPart.FCStd").replace('value="New Part"', 'value="external source change"'));
    if (timing === "before_write") {
      const actual = archiveReader.readFcstdBatchArchive; let sourceReads = 0;
      vi.spyOn(archiveReader, "readFcstdBatchArchive").mockImplementation((filename, all) => {
        // One read provides the recommendation; the second certifies it;
        // the third is the final source check immediately before the writer.
        if (filename.endsWith("/parts/NewPart.FCStd") && ++sourceReads === 3) sourceChange();
        return actual(filename, all);
      });
    } else {
      const actual = xrefService.patchBomLinkLabels;
      vi.spyOn(xrefService, "patchBomLinkLabels").mockImplementation((workspace, patches, options) => {
        const result = actual(workspace, patches, options); sourceChange(); return result;
      });
    }
    const result = applyRenameCorrections(root, { ...args, labels_only: true, label_scope: "incoming" });
    expect(result).toMatchObject({ xlink_patches: 0, label_patches: timing === "before_write" ? 0 : 1 });
    expect(result.failed).toEqual(expect.arrayContaining([expect.objectContaining({ host_repo_rel_path: "asm/Assembly.FCStd", error: expect.stringContaining("源模型在标签推荐后已变化") })]));
    expect(readFcstdXml(root, "asm/Assembly.FCStd")).toContain('file="../parts/NewPart.FCStd"');
    expect(readFcstdXml(root, "asm/Assembly.FCStd")).toContain(`value="${timing === "before_write" ? "Old label" : "New Part"}"`);
    expect(readFcstdXml(root, "parts/NewPart.FCStd")).toContain('value="external source change"');
    expect(listRenameLogs(root).entries).toHaveLength(1);
  });

  it("renames a file inside the workspace and records a rename log", () => {
    const workspace = makeTempRoot();
    writeFile(workspace, "src/OldName.FCStd", "payload");

    const result = executeDiskFileRename(workspace, "src/OldName.FCStd", { filename: "NewName.FCStd" });

    expect(result.rel_path).toBe("src/NewName.FCStd");
    expect(fs.existsSync(path.join(workspace, "src/OldName.FCStd"))).toBe(false);
    expect(fs.existsSync(path.join(workspace, "src/NewName.FCStd"))).toBe(true);
    expect(result.rename_log).toMatchObject({
      old_basename: "OldName.FCStd",
      new_basename: "NewName.FCStd",
      old_repo_rel_path: "src/OldName.FCStd",
      new_repo_rel_path: "src/NewName.FCStd",
    });
    expect(listRenameLogs(workspace).entries).toHaveLength(1);
  });

  it("rejects unsafe target filenames and existing targets", () => {
    const workspace = makeTempRoot();
    writeFile(workspace, "a.txt", "a");
    writeFile(workspace, "b.txt", "b");

    expect(() => executeDiskFileRename(workspace, "a.txt", { filename: "../c.txt" })).toThrow(/path separators|Target filename/);
    expect(() => executeDiskFileRename(workspace, "a.txt", { filename: "b.txt" })).toThrow(/already exists/);
  });

  it("scans direct/transitive FCStd XLinks and persists path and label corrections", () => {
    const workspace = makeTempRoot();
    createRenameFixture(workspace);
    const renamed = executeDiskFileRename(workspace, "parts/OldPart.FCStd", { filename: "NewPart.FCStd" });
    const db = pnwCreateDb(path.join(workspace, ".phoenix", "phoenix-workspace.sqlite"));
    db.run(
      "UPDATE phoenix_cad_file_asset SET repo_rel_path = './parts/NewPart.FCStd', filename = 'NewPart.FCStd' WHERE id = 1",
    );
    db.close();

    const scan = analyzeRenameReferences(workspace, { rename_log_id: renamed.rename_log_id });
    expect(scan).toMatchObject({
      host_count: 2,
      direct_host_count: 1,
      hit_count: 1,
      pending_hit_count: 1,
    });
    expect(scan.hosts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        host_repo_rel_path: "asm/Assembly.FCStd",
        usage_kind: "direct",
        hits: [expect.objectContaining({
          matched_text: "../parts/OldPart.FCStd",
          proposed_text: "../parts/NewPart.FCStd",
        })],
      }),
      expect.objectContaining({
        host_repo_rel_path: "upper/Top.FCStd",
        usage_kind: "indirect",
        via_chain: ["asm/Assembly.FCStd"],
      }),
    ]));

    const applied = applyRenameCorrections(workspace, {
      rename_log_id: renamed.rename_log_id,
      host_repo_rel_paths: ["upper/Top.FCStd"],
    });
    expect(applied).toMatchObject({
      applied_hosts: ["asm/Assembly.FCStd"],
      xlink_patches: 1,
      failed: [],
      scan: { pending_hit_count: 0 },
    });
    expect(readFcstdXml(workspace, "asm/Assembly.FCStd")).toContain('file="../parts/NewPart.FCStd"');

    const labels = applyRenameCorrections(workspace, {
      rename_log_id: renamed.rename_log_id,
      host_repo_rel_paths: ["asm/Assembly.FCStd"],
      labels_only: true,
      label_scope: "incoming",
    });
    expect(labels).toMatchObject({
      applied_hosts: ["asm/Assembly.FCStd"],
      xlink_patches: 0,
      label_patches: 1,
      failed: [],
    });
    expect(readFcstdXml(workspace, "asm/Assembly.FCStd")).toContain('value="New Part"');

    const loaded = loadRenameAnalysis(workspace, renamed.rename_log_id!);
    expect(loaded.rename_log.new_basename).toBe("NewPart.FCStd");
  });

  it("repairs incoming named subobjects and ordered siblings, without changing unrelated labels or weakening host_all", () => {
    const workspace = makeTempRoot(); createRenameFixture(workspace);
    const label = (value: string) => `<Property name="Label" type="App::PropertyString"><String value="${value}"/></Property>`;
    const link = (name: string, target: string, file = "../parts/OldPart.FCStd") => `<Object name="${name}"><Properties>${label("old")}<Property name="LinkedObject" type="App::PropertyXLink"><XLink file="${file}" name="${target}"/></Property></Properties></Object>`;
    writeFcstd(workspace, "parts/OldPart.FCStd", `<Document><Objects><Object name="Body" type="PartDesign::Body"/><Object name="Branch" type="PartDesign::Body"/></Objects><ObjectData><Object name="Body"><Properties>${label("Actual body")}</Properties></Object><Object name="Branch"><Properties>${label("Actual branch")}</Properties></Object></ObjectData></Document>`);
    writeFcstd(workspace, "asm/Assembly.FCStd", `<Document><Objects><Object name="Root" type="App::Part"/><Object name="Second" type="App::Link"/><Object name="BranchLink" type="App::Link"/><Object name="First" type="App::Link"/><Object name="Unrelated" type="App::Link"/></Objects><ObjectData><Object name="Root"><Properties>${label("Host")}<Property name="Group" type="App::PropertyLinkList"><LinkList><Link value="First"/><Link value="Second"/><Link value="BranchLink"/><Link value="Unrelated"/></LinkList></Property></Properties></Object>${link("Second", "Body")}${link("BranchLink", "Branch")}${link("First", "Body")}${link("Unrelated", "Missing", "../unrelated/Missing.FCStd")}</ObjectData></Document>`);
    refreshBomXrefForHost(workspace, "asm/Assembly.FCStd", { recursive: true });
    const sourceBefore = fs.readFileSync(path.join(workspace, "parts/OldPart.FCStd"));
    const upperBefore = fs.readFileSync(path.join(workspace, "upper/Top.FCStd"));
    const renamed = executeDiskFileRename(workspace, "parts/OldPart.FCStd", { filename: "NewPart.FCStd" });
    const db = pnwCreateDb(path.join(workspace, ".phoenix/phoenix-workspace.sqlite"));
    db.run("UPDATE phoenix_cad_file_asset SET repo_rel_path='./parts/NewPart.FCStd',filename='NewPart.FCStd' WHERE id=1"); db.close();
    const request = { rename_log_id: renamed.rename_log_id, host_repo_rel_paths: ["asm/Assembly.FCStd"] };
    expect(applyRenameCorrections(workspace, request).failed).toEqual([]);
    const repaired = applyRenameCorrections(workspace, { ...request, labels_only: true });
    expect(repaired).toMatchObject({ failed: [], label_patches: 3, xlink_patches: 0 });
    expect(repaired.label_changes.map((change: any) => [change.host_object_name, change.target_object_name, change.new_label])).toEqual([
      ["Second", "Body", "Actual body.002"], ["BranchLink", "Branch", "Actual branch"], ["First", "Body", "Actual body.001"],
    ]);
    const after = fs.readFileSync(path.join(workspace, "asm/Assembly.FCStd"));
    expect(readFcstdXml(workspace, "asm/Assembly.FCStd")).toContain(`${link("Unrelated", "Missing", "../unrelated/Missing.FCStd")}`);
    expect(fs.readFileSync(path.join(workspace, "parts/NewPart.FCStd"))).toEqual(sourceBefore);
    expect(fs.readFileSync(path.join(workspace, "upper/Top.FCStd"))).toEqual(upperBefore);
    expect(applyRenameCorrections(workspace, { ...request, labels_only: true })).toMatchObject({ failed: [], label_patches: 0 });
    expect(applyRenameCorrections(workspace, { ...request, labels_only: true, label_scope: "host_all" }).failed).toEqual(expect.arrayContaining([
      expect.objectContaining({ error: expect.stringContaining("多个目标对象") }),
    ]));
    expect(fs.readFileSync(path.join(workspace, "asm/Assembly.FCStd"))).toEqual(after);
  });

  it("re-reads a later selected host's projection sources after this request successfully updates an earlier host", () => {
    const workspace = makeTempRoot(); createRenameFixture(workspace);
    const label = (value: string) => `<Property name="Label" type="App::PropertyString"><String value="${value}"/></Property>`;
    const link = (name: string, file: string, target: string) => `<Object name="${name}"><Properties>${label("old")}<Property name="LinkedObject" type="App::PropertyXLink"><XLink file="${file}" name="${target}"/></Property></Properties></Object>`;
    const doc = (names: string[], objects: string) => `<Document><Objects><Object name="Root" type="App::Part"/>${names.map(name => `<Object name="${name}" type="App::Link"/>`).join("")}</Objects><ObjectData><Object name="Root"><Properties>${label("Host")}<Property name="Group" type="App::PropertyLinkList"><LinkList>${names.map(name => `<Link value="${name}"/>`).join("")}</LinkList></Property></Properties></Object>${objects}</ObjectData></Document>`;
    writeFcstd(workspace, "asm/Assembly.FCStd", doc(["First"], link("First", "../parts/OldPart.FCStd", "Body")));
    writeFcstd(workspace, "upper/Top.FCStd", doc(["Direct", "Projected"], link("Projected", "../asm/Assembly.FCStd", "First") + link("Direct", "../parts/OldPart.FCStd", "Body")));
    refreshBomXrefForHost(workspace, "upper/Top.FCStd", { recursive: true });
    const sourceBefore = fs.readFileSync(path.join(workspace, "parts/OldPart.FCStd"));
    const renamed = executeDiskFileRename(workspace, "parts/OldPart.FCStd", { filename: "NewPart.FCStd" });
    const db = pnwCreateDb(path.join(workspace, ".phoenix/phoenix-workspace.sqlite"));
    try { db.run("UPDATE phoenix_cad_file_asset SET repo_rel_path='./parts/NewPart.FCStd',filename='NewPart.FCStd' WHERE id=1"); }
    finally { db.close(); }
    const request = { rename_log_id: renamed.rename_log_id, host_repo_rel_paths: ["asm/Assembly.FCStd", "upper/Top.FCStd"], transitive: false };
    expect(applyRenameCorrections(workspace, request)).toMatchObject({ failed: [], xlink_patches: 2 });
    const result = applyRenameCorrections(workspace, { ...request, labels_only: true, label_scope: "incoming" });
    expect(result).toMatchObject({ failed: [], label_patches: 2, applied_hosts: ["asm/Assembly.FCStd", "upper/Top.FCStd"] });
    expect(readFcstdXml(workspace, "asm/Assembly.FCStd")).toContain('value="New Part"');
    expect(readFcstdXml(workspace, "upper/Top.FCStd")).toContain('value="New Part.001"');
    // The unrelated projection contributes to numbering, but is NOT selected
    // for this rename's incoming writes and keeps its original label/path.
    expect(readFcstdXml(workspace, "upper/Top.FCStd")).toContain(link("Projected", "../asm/Assembly.FCStd", "First"));
    const tree = xrefService.createAssemblyTreeReader(workspace, "upper/Top.FCStd")("upper/Top.FCStd");
    expect(tree.nodes.flatMap((node: any) => node.xref_instances || []).map((instance: any) => [instance.host_object_name, instance.rule_label])).toEqual([
      ["Direct", "New Part.001"], ["Projected", "New Part.002"],
    ]);
    expect(result.label_changes.map(change => change.host_object_name)).toEqual(["First", "Direct"]);
    expect(fs.readFileSync(path.join(workspace, "parts/NewPart.FCStd"))).toEqual(sourceBefore);
    expect(applyRenameCorrections(workspace, { ...request, labels_only: true })).toMatchObject({ failed: [], label_patches: 0 });
    expect(listRenameLogs(workspace).entries).toHaveLength(1);
  });
});
