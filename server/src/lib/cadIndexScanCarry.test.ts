import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { strToU8, zipSync } from "fflate";
import { afterEach, describe, expect, it } from "vitest";
import { pnwCreateDb } from "@phoenix-wing/db-node";
import { PNW_CAD_INDEX_EXCLUDED_DIRECTORIES } from "@phoenix-wing/cad-core";
import { scanCadWorkspaceIndex } from "./cadIndexScanService.js";
import { phoenixDatabasePath } from "./phoenixDatabaseService.js";

// Independent metadata-only samples: no model geometry or copied project inventory.
const roots: string[] = [];
const emptyArchive = zipSync({ "Document.xml": strToU8("<Document/>") });
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});
function workspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "desk-cad-scan-carry-"));
  roots.push(root);
  return root;
}
function withDb<T>(root: string, callback: (db: ReturnType<typeof pnwCreateDb>) => T): T {
  const db = pnwCreateDb(phoenixDatabasePath(root));
  try { return callback(db); } finally { db.close(); }
}
function writeMetadata(root: string, name: string) {
  const xml = `<Document><Objects><Object name="Body" type="PartDesign::Body"/></Objects><ObjectData><Object name="Body"><Properties Count="6">
    <Property name="PartNumber"><String value="SYNTHETIC-PART"/></Property>
    <Property name="PartVersion"><String value="V1"/></Property>
    <Property name="PartName"><String value="${name}"/></Property>
    <Property name="TypeCode"><String value="saved-type"/></Property>
    <Property name="ModelSeries"><String value="saved-series"/></Property>
    <Property name="Label"><String value="Saved label"/></Property>
    </Properties></Object></ObjectData></Document>`;
  fs.writeFileSync(path.join(root, "Metadata.FCStd"), zipSync({ "Document.xml": strToU8(xml) }));
}
function indexRows(root: string) {
  return withDb(root, db => ({
    scans: db.all("SELECT * FROM phoenix_cad_scan ORDER BY id"),
    assets: db.all("SELECT * FROM phoenix_cad_file_asset ORDER BY id"),
    parts: db.all("SELECT * FROM phoenix_cad_part_key ORDER BY id"),
    links: db.all("SELECT * FROM phoenix_cad_part_file_link ORDER BY id"),
    xrefs: db.all("SELECT * FROM phoenix_cad_bom_xref ORDER BY id"),
    boms: db.all("SELECT * FROM phoenix_cad_bom_line ORDER BY id"),
  }));
}
function populate(root: string, count: number) {
  for (let index = 0; index < count; index++) {
    fs.writeFileSync(path.join(root, `Synthetic-${String(index).padStart(4, "0")}.FCStd`), emptyArchive);
  }
}

describe("M1 full-scan carry: manual records, coverage and explicit count boundary", () => {
  it.each(["active", "ignored"])("keeps every manual Part field and the %s association after a full rescan", async linkStatus => {
    const root = workspace();
    writeMetadata(root, "First saved name");
    await scanCadWorkspaceIndex(root);
    withDb(root, db => {
      db.run(`UPDATE phoenix_cad_part_key SET type_code='manual-type',model_series='manual-series',
        part_name='Manual catalog name',label='Manual catalog label',notes='Keep manual notes',
        status='manual-status',created_at='manual-created',updated_at='manual-updated'`);
      db.run(`UPDATE phoenix_cad_part_file_link SET file_role='manual-role',notes='Keep association notes',
        link_status=?,linked_at='manual-linked'`, [linkStatus]);
    });
    const before = indexRows(root);
    expect(before.parts).toHaveLength(1);
    expect(before.links).toHaveLength(1);
    writeMetadata(root, "Changed saved name");
    const bytes = fs.readFileSync(path.join(root, "Metadata.FCStd"));
    const result = await scanCadWorkspaceIndex(root);
    const after = indexRows(root);
    expect(result).toMatchObject({ files: 1, parsedFiles: 1 });
    expect(result.scanId).toBeGreaterThan(Number((before.scans[0] as { id: number }).id));
    expect(after.parts).toEqual(before.parts);
    expect(after.links).toEqual(before.links);
    expect(after.assets[0]).toMatchObject({ part_name: "Changed saved name", file_status: "present" });
    expect(after.assets[0]).toHaveProperty("id", (before.assets[0] as { id: number }).id);
    expect(fs.readFileSync(path.join(root, "Metadata.FCStd"))).toEqual(bytes);
  });

  it("retains previously indexed assets under each of the five shared excluded directories", async () => {
    const root = workspace();
    fs.writeFileSync(path.join(root, "Included.FCStd"), emptyArchive);
    await scanCadWorkspaceIndex(root);
    expect([...PNW_CAD_INDEX_EXCLUDED_DIRECTORIES]).toEqual([".git", ".phoenix", "node_modules", ".venv", "__pycache__"]);
    const excludedPaths = PNW_CAD_INDEX_EXCLUDED_DIRECTORIES.map(directory => `${directory}/Retained.FCStd`);
    withDb(root, db => {
      for (const [index, rel] of excludedPaths.entries()) {
        fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
        // Not even a ZIP: a successful complete scan must not read this excluded input.
        fs.writeFileSync(path.join(root, rel), "excluded synthetic sentinel");
        db.run(`INSERT INTO phoenix_cad_file_asset
          (repo_rel_path,filename,asset_kind,part_number,part_version,part_name,label,file_status,last_seen_at,bom_json,updated_at)
          VALUES (?,'Retained.FCStd','fcstd','SYNTHETIC-EXCLUDED','V1','Retained metadata','Retained label',?,'old-seen','{"retained":true}','old-updated')`,
        [rel, index % 2 === 0 ? "present" : "missing"]);
      }
    });
    const before = indexRows(root).assets.filter(row => excludedPaths.includes((row as { repo_rel_path: string }).repo_rel_path));
    expect(before).toHaveLength(5);
    const result = await scanCadWorkspaceIndex(root);
    expect(result).toMatchObject({ files: 1, parsedFiles: 1 });
    const after = indexRows(root).assets.filter(row => excludedPaths.includes((row as { repo_rel_path: string }).repo_rel_path));
    expect(after).toEqual(before);
    for (const rel of excludedPaths) expect(fs.readFileSync(path.join(root, rel), "utf8")).toBe("excluded synthetic sentinel");
  });

  // Auto CAD 96b6a846 extension.ts rejects findFiles length >= 5000. Desk's
  // existing visitor deliberately rejects only > 5000; freeze that host difference.
  it.each([4999, 5000])("completes a real %i-file scan without adopting the legacy >=5000 rejection", async count => {
    const root = workspace();
    populate(root, count);
    const result = await scanCadWorkspaceIndex(root);
    expect(result).toMatchObject({ files: count, parsedFiles: count, references: 0, bomLines: 0 });
    withDb(root, db => {
      expect(db.get("SELECT COUNT(*) AS count FROM phoenix_cad_file_asset WHERE file_status='present'")).toEqual({ count });
      expect(db.get("SELECT status,phase FROM phoenix_cad_scan WHERE id=?", [result.scanId])).toEqual({ status: "done", phase: "ts-light-index" });
    });
  }, 30_000);

  it("refuses the 5001st real file before committing and preserves the completed old index", async () => {
    const root = workspace();
    writeMetadata(root, "Existing saved name");
    await scanCadWorkspaceIndex(root);
    const before = indexRows(root);
    populate(root, 5000); // Existing Metadata.FCStd makes the discovered total 5001.
    await expect(scanCadWorkspaceIndex(root)).rejects.toThrow(/超过 5000 个 FCStd/);
    expect(indexRows(root)).toEqual(before);
  }, 30_000);
});
