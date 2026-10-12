import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { strToU8, zipSync } from "fflate";
import { afterEach, describe, expect, it } from "vitest";
import { pnwCreateDb } from "@phoenix-wing/db-node";
import { cadDirectoryExcludedFromDiscovery, cadPathExcludedFromDiscovery, cadPathHasHiddenDirectory } from "./cadIndexScanScope.js";
import { visitFcstdBatch } from "./fcstdBatchFiles.js";
import { scanCadWorkspaceIndex } from "./cadIndexScanService.js";
import { inspectCadIndex, loadCadIndexStatus } from "./cadIndexStatusService.js";
import { phoenixDatabasePath } from "./phoenixDatabaseService.js";

// Independent metadata-only fixtures; no project inventory or model geometry.
const roots: string[] = [];
const emptyArchive = zipSync({ "Document.xml": strToU8("<Document/>") });
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
function workspace() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "desk-index-scope-")));
  roots.push(root); return root;
}
function withDb<T>(root: string, read: (db: ReturnType<typeof pnwCreateDb>) => T): T {
  const db = pnwCreateDb(phoenixDatabasePath(root));
  try { return read(db); } finally { db.close(); }
}
function writeFile(root: string, relative: string, bytes: Uint8Array | string = emptyArchive) {
  const filename = path.join(root, relative.replace(/\\/g, "/").replace(/^\.\//, ""));
  fs.mkdirSync(path.dirname(filename), { recursive: true }); fs.writeFileSync(filename, bytes);
}
function snapshot(root: string) {
  return withDb(root, db => Object.fromEntries([
    "phoenix_cad_scan", "phoenix_cad_file_asset", "phoenix_cad_part_key", "phoenix_cad_part_file_link",
    "phoenix_cad_bom_xref", "phoenix_cad_bom_line", "phoenix_cad_xref_flat", "phoenix_cad_bom_tree_occurrence",
    "phoenix_cad_bom_assembly_cache", "phoenix_audit_change_event", "phoenix_audit_rename_log", "phoenix_workspace_pref",
  ].map(table => [table, db.all(`SELECT * FROM ${table} ORDER BY rowid`)])));
}
async function pollutedFixture() {
  const root = workspace();
  writeFile(root, "models/Root.ASSY.FCStd", zipSync({ "Document.xml": strToU8('<Document><XLink file="Leaf.FCStd" label="Synthetic instance"/></Document>') }));
  writeFile(root, "models/Leaf.FCStd");
  for (let index = 0; index < 8; index++) writeFile(root, `models/Model-${index}.FCStd`);
  const initial = await scanCadWorkspaceIndex(root);
  const hidden = Array.from({ length: 61 }, (_, index) => index === 0 ? "./.snapshot/Leaf.FCStd"
    : index === 1 ? "models/.snapshot/Retained-1.FCStd"
      : index === 2 ? "nested\\.archive\\Retained-2.FCStd" : `.snapshot/Retained-${index}.FCStd`);
  for (const relative of hidden) writeFile(root, relative, "not a ZIP; hidden sentinel must not be read");
  withDb(root, db => {
    for (const relative of hidden) db.run(`INSERT INTO phoenix_cad_file_asset
      (repo_rel_path,filename,asset_kind,part_number,part_version,part_name,label,file_status,last_seen_at,bom_json,updated_at)
      VALUES (?,?, 'fcstd','SYNTHETIC-HIDDEN','V1','Saved metadata','Saved label','present','old-seen','{"retain":true}','old-updated')`,
    [relative, relative.replace(/\\/g, "/").split("/").at(-1)!]);
    const hiddenId = db.get<{ id: number }>("SELECT id FROM phoenix_cad_file_asset WHERE repo_rel_path=?", [hidden[0]])!.id;
    const leafId = db.get<{ id: number }>("SELECT id FROM phoenix_cad_file_asset WHERE repo_rel_path='models/Leaf.FCStd'")!.id;
    db.run(`INSERT INTO phoenix_cad_part_key(part_number,part_version,type_code,model_series,part_name,label,notes,status,created_at,updated_at)
      VALUES ('SYNTHETIC-MANUAL','V9','manual-type','manual-series','Manual name','Manual label','Manual notes','inactive','manual-created','manual-updated')`);
    const partId = db.get<{ id: number }>("SELECT id FROM phoenix_cad_part_key WHERE part_number='SYNTHETIC-MANUAL'")!.id;
    db.run(`INSERT INTO phoenix_cad_part_file_link(part_key_id,file_asset_id,file_role,notes,link_status,linked_at)
      VALUES (?,?,'drawing','Manual association','ignored','manual-linked')`, [partId, hiddenId]);
    db.run("INSERT INTO phoenix_workspace_pref(section,value_json,updated_at) VALUES ('synthetic','{\"keep\":true}','manual-updated')");
    db.run("INSERT INTO phoenix_audit_change_event(kind,created_at,note) VALUES ('synthetic','manual-created','Keep audit')");
    db.run(`INSERT INTO phoenix_audit_rename_log(event_id,file_asset_id,old_repo_rel_path,new_repo_rel_path,old_filename,new_filename,old_basename,new_basename)
      VALUES (1,?,'previous.FCStd',?,'previous.FCStd','Leaf.FCStd','previous','Leaf')`, [hiddenId, hidden[0]]);
    db.run(`INSERT INTO phoenix_cad_bom_xref(scan_id,host_file_asset_id,host_repo_rel_path,xlink_file_attr,target_basename,target_file_asset_id,target_repo_rel_path,last_seen_at)
      VALUES (?,?,?,'Leaf.FCStd','Leaf.FCStd',?,'models/Leaf.FCStd','old-seen')`, [initial.scanId, hiddenId, hidden[0], leafId]);
    // A legacy path-based row whose host is not one of the normal scan hosts.
    db.run(`INSERT INTO phoenix_cad_bom_xref(scan_id,host_file_asset_id,host_repo_rel_path,xlink_file_attr,target_basename,target_file_asset_id,target_repo_rel_path,last_seen_at)
      VALUES (?,?,'legacy/Root.FCStd','hidden-leaf.FCStd','Leaf.FCStd',?,?,'old-seen')`, [initial.scanId, leafId, hiddenId, hidden[0]]);
    db.run(`INSERT INTO phoenix_cad_xref_flat(scan_id,host_rel,target_rel,link_label,built_at)
      VALUES (?,'legacy/Root.FCStd',?,'old','old-seen')`, [initial.scanId, hidden[0]]);
    db.run(`INSERT INTO phoenix_cad_bom_line(scan_id,assembly_rel,part_rel,bom_path,built_at)
      VALUES (?,'legacy/Root.FCStd',?,'old path','old-seen')`, [initial.scanId, hidden[0]]);
    db.run(`INSERT INTO phoenix_cad_bom_tree_occurrence(root_host_repo_rel_path,tree_path,depth,host_repo_rel_path,target_repo_rel_path,xlink_file_attr,built_at)
      VALUES ('legacy/Root.FCStd','0',1,'legacy/Root.FCStd',?,'hidden-leaf.FCStd','old-seen')`, [hidden[0]]);
    for (const cacheRoot of [hidden[0], "legacy/Root.FCStd"]) db.run(`INSERT INTO phoenix_cad_bom_assembly_cache(host_repo_rel_path,mode,tree_json,built_at)
      VALUES (?,'full','{"stale":true}','old-seen')`, [cacheRoot]);
  });
  return { root, hidden };
}

describe("default CAD index scan scope", () => {
  it("excludes dot-prefixed directories at every depth but keeps dot-prefixed files", () => {
    for (const name of [".snapshot", ".git", ".nested", "node_modules", "__pycache__"]) expect(cadDirectoryExcludedFromDiscovery(name)).toBe(true);
    for (const name of [".", "..", "models", "cache", "snapshot"]) expect(cadDirectoryExcludedFromDiscovery(name)).toBe(false);
    for (const relative of [".snapshot/A.FCStd", "models/.snapshot/A.FCStd", "./models/.nested/A.FCStd", "models\\.archive\\A.FCStd"]) {
      expect(cadPathExcludedFromDiscovery(relative)).toBe(true);
      expect(cadPathHasHiddenDirectory(relative)).toBe(true);
    }
    for (const relative of [".A.FCStd", "./models/.A.FCStd", "models/A.FCStd"]) expect(cadPathExcludedFromDiscovery(relative)).toBe(false);
  });

  it("does not read hidden input and rejects a hidden directory as an explicit scan scope", async () => {
    const root = workspace();
    writeFile(root, "models/.Visible.FCStd");
    writeFile(root, "models/.archive/unreadable.FCStd", "not a ZIP");
    writeFile(root, ".snapshot/unreadable.FCStd", "not a ZIP");
    const discovered: string[] = [];
    expect(await visitFcstdBatch(root, ".", relative => { discovered.push(relative); })).toMatchObject({ scanned: 1, errors: [] });
    expect(discovered).toEqual(["models/.Visible.FCStd"]);
    await expect(visitFcstdBatch(root, "models/.archive", () => {})).rejects.toThrow("默认扫描范围");
  });

  it("marks old hidden assets ignored atomically, removes derived pollution and retains every manual record", async () => {
    const { root, hidden } = await pollutedFixture();
    const before = snapshot(root);
    const hiddenBefore = before.phoenix_cad_file_asset.filter(row => hidden.includes(String(row.repo_rel_path)));
    const bytes = hidden.map(relative => fs.readFileSync(path.join(root, relative.replace(/\\/g, "/"))));
    const result = await scanCadWorkspaceIndex(root);
    expect(result).toMatchObject({ files: 10, parsedFiles: 10, references: 1, bomLines: 1 });
    const after = snapshot(root);
    const hiddenAfter = after.phoenix_cad_file_asset.filter(row => hidden.includes(String(row.repo_rel_path)));
    expect(hiddenAfter).toHaveLength(61);
    hiddenAfter.forEach((row, index) => {
      const { file_status: _oldStatus, updated_at: _oldUpdated, ...oldFields } = hiddenBefore[index];
      const { file_status, updated_at: _updated, ...fields } = row;
      expect(file_status).toBe("ignored"); expect(fields).toEqual(oldFields);
    });
    for (const table of ["phoenix_cad_part_key", "phoenix_cad_part_file_link", "phoenix_audit_change_event", "phoenix_audit_rename_log", "phoenix_workspace_pref"]) {
      expect(after[table]).toEqual(before[table]);
    }
    expect(after.phoenix_cad_bom_xref).toHaveLength(1);
    expect(after.phoenix_cad_bom_xref[0]).toMatchObject({ host_repo_rel_path: "models/Root.ASSY.FCStd", target_repo_rel_path: "models/Leaf.FCStd", resolve_status: "resolved" });
    expect(after.phoenix_cad_bom_line).toHaveLength(1);
    expect(after.phoenix_cad_xref_flat).toHaveLength(1);
    expect(after.phoenix_cad_bom_tree_occurrence).toHaveLength(1);
    expect(after.phoenix_cad_bom_assembly_cache).toEqual([]);
    expect(inspectCadIndex(root)).toMatchObject({ state: "ready", totalEntries: 10, missingEntries: 0 });
    expect(loadCadIndexStatus(root)).toMatchObject({ indexed: true, totalEntries: 10 });
    hidden.forEach((relative, index) => expect(fs.readFileSync(path.join(root, relative.replace(/\\/g, "/")))).toEqual(bytes[index]));
  });

  it("rolls back the entire scan when the scope repair fails at COMMIT", async () => {
    const { root } = await pollutedFixture();
    withDb(root, db => db.exec(`CREATE TRIGGER deny_scope_repair BEFORE UPDATE OF file_status ON phoenix_cad_file_asset
      WHEN NEW.file_status='ignored' BEGIN SELECT RAISE(ABORT,'injected scope repair failure'); END`));
    const before = snapshot(root);
    await expect(scanCadWorkspaceIndex(root)).rejects.toThrow("injected scope repair failure");
    expect(snapshot(root)).toEqual(before);
  });
});
