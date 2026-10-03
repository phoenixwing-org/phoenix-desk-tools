import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { afterEach, describe, expect, it } from "vitest";
import { pnwCreateDb } from "@phoenix-wing/db-node";
import { refreshBomXrefForHost } from "./pnwBomXrefService.js";
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
  const empty = '<Document><ObjectData></ObjectData></Document>';
  writeFcstd(workspace, "parts/OldPart.FCStd", empty);
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
    CREATE TABLE phoenix_cad_scan (id INTEGER PRIMARY KEY);
    INSERT INTO phoenix_cad_scan(id) VALUES (1);

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
  for (const root of tempRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("pnwRenameService", () => {
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
});
