import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { strToU8, zipSync } from "fflate";
import { afterEach, describe, expect, it } from "vitest";
import { pnwCreateDb } from "phoenix-wing/db/pnwDbAdapter";
import { searchOutgoingRefs } from "./pnwBomXrefService.js";
import {
  exportFcstdMapToJson,
  listFcstdMapScanHistory,
  loadFcstdMapPayload,
  loadFcstdMapPrefs,
  purgeMissingFcstdMapEntries,
  runFcstdMapScanWithProgress,
  saveFcstdMapPrefs,
  searchFcstdMapEntries,
  updateFcstdMapEntryRename,
} from "./pnwFcstdMapService.js";

const tempRoots: string[] = [];

function makeTempRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pnw-fcstd-map-"));
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

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("pnwFcstdMapService", () => {
  it("scans, persists, searches, purges missing entries, exports JSON, and records scan history", () => {
    const workspace = makeTempRoot();
    writeFile(workspace, "parts/800001.001-H.FCStd", "not a real fcstd zip\n");
    writeFile(workspace, "docs/readme.md", "# doc\n");

    expect(loadFcstdMapPayload(workspace).exists).toBe(false);
    expect(saveFcstdMapPrefs(workspace, { force_update_part_name: true })).toEqual({ force_update_part_name: true });
    expect(loadFcstdMapPrefs(workspace).force_update_part_name).toBe(true);

    const phases: string[] = [];
    const scanned = runFcstdMapScanWithProgress(workspace, (phase) => phases.push(phase));
    expect(phases).toContain("walk");
    expect(phases).toContain("bom");
    expect(phases).toContain("done");
    expect(scanned.exists).toBe(true);
    expect(scanned.stats.total_entries).toBe(2);
    expect(scanned.stats.present).toBe(2);
    expect(scanned.stats.fcstd_file_count).toBe(1);

    const loaded = loadFcstdMapPayload(workspace);
    expect(loaded.database_path_display).toContain("phoenix-workspace.sqlite");
    expect(loaded.stats.total_entries).toBe(2);

    const fcstdPage = searchFcstdMapEntries(workspace, { kind: "fcstd", limit: 10 });
    expect(fcstdPage.total).toBe(1);
    expect(fcstdPage.entries[0].repo_rel_path).toBe("./parts/800001.001-H.FCStd");

    fs.rmSync(path.join(workspace, "docs/readme.md"));
    const missingPage = searchFcstdMapEntries(workspace, { status: "missing", limit: 10 });
    expect(missingPage.total).toBe(1);
    expect(missingPage.entries[0].repo_rel_path).toBe("./docs/readme.md");

    const purged = purgeMissingFcstdMapEntries(workspace);
    expect(purged.purge_deleted).toBe(1);
    expect(purged.stats.total_entries).toBe(1);
    expect(searchFcstdMapEntries(workspace, { status: "missing" }).total).toBe(0);

    const exported = exportFcstdMapToJson(workspace);
    expect(exported.path_display).toContain("fcstd_map.json");
    expect(fs.existsSync(exported.path)).toBe(true);
    const exportedPayload = JSON.parse(fs.readFileSync(exported.path, "utf8"));
    expect(exportedPayload.entries).toHaveLength(1);
    expect(exportedPayload.entries[0].asset_kind).toBe("fcstd");

    const history = listFcstdMapScanHistory(workspace, 10);
    expect(history).toHaveLength(1);
    expect(history[0].status).toBe("done");
    expect(history[0].stats.present).toBe(2);
  });

  it("filters a workset scope without marking rows outside that scope missing", () => {
    const workspace = makeTempRoot();
    writeFile(workspace, "parts/a.FCStd", "a\n");
    writeFile(workspace, "parts/nested/b.FCStd", "b\n");
    writeFile(workspace, "outside/c.FCStd", "c\n");
    runFcstdMapScanWithProgress(workspace, () => {});

    const scoped = runFcstdMapScanWithProgress(workspace, () => {}, {
      scope: {
        worksetId: "scope-a",
        worksetName: "Scoped CAD",
        dirs: ["parts"],
        files: [],
      },
    });
    expect(scoped.scan_stats).toMatchObject({ present: 2, cad_file_count: 2, fcstd_file_count: 2 });
    expect(scoped.scan_scope).toMatchObject({ scope_workset_id: "scope-a", scope_workset_name: "Scoped CAD" });
    expect(scoped.stats.present).toBe(3);

    const db = pnwCreateDb(path.join(workspace, ".phoenix", "phoenix-workspace.sqlite"));
    try {
      expect(db.get<{ file_status: string }>(
        "SELECT file_status FROM phoenix_cad_file_asset WHERE repo_rel_path = ?",
        "./outside/c.FCStd",
      )?.file_status).toBe("present");
    } finally {
      db.close();
    }
    const history = listFcstdMapScanHistory(workspace, 2);
    expect(history[0].stats).toMatchObject({ present: 2, scope_workset_id: "scope-a", scope_workset_name: "Scoped CAD" });
  });

  it("rebuilds BOM XRef edges as scan Step C", () => {
    const workspace = makeTempRoot();
    writeFcstd(
      workspace,
      "asm/Root.ASSY.FCStd",
      `<?xml version="1.0"?><Document><ObjectData><Object name="BoltLink"><Properties><Property name="Label" type="App::PropertyString"><String value="Bolt instance"/></Property></Properties><XLink file="../parts/Bolt.FCStd"/></Object></ObjectData></Document>`,
    );
    writeFcstd(workspace, "parts/Bolt.FCStd", `<?xml version="1.0"?><Document><ObjectData></ObjectData></Document>`);

    const phases: string[] = [];
    const scanned = runFcstdMapScanWithProgress(workspace, (phase) => phases.push(phase));
    expect(phases).toContain("xref");
    expect(scanned.xref_stats).toMatchObject({
      edge_count: 1,
      host_count: 1,
      target_resolved: 1,
      index_pending: false,
    });
    expect(searchOutgoingRefs(workspace, "asm/Root.ASSY.FCStd").refs[0]).toMatchObject({
      xlink_file_attr: "../parts/Bolt.FCStd",
      link_label: "Bolt instance",
      target_repo_rel_path: "./parts/Bolt.FCStd",
      resolve_status: "resolved",
    });
  });

  it("reclaims a stale target row and keeps rename/XRef state coherent after the disk move", () => {
    const workspace = makeTempRoot();
    writeFcstd(
      workspace,
      "asm/Root.ASSY.FCStd",
      `<?xml version="1.0"?><Document><ObjectData><Object name="PartLink"><XLink file="../parts/Old.FCStd"/></Object></ObjectData></Document>`,
    );
    writeFcstd(workspace, "parts/Old.FCStd", `<?xml version="1.0"?><Document><ObjectData/></Document>`);
    runFcstdMapScanWithProgress(workspace, () => {});

    const database = path.join(workspace, ".phoenix", "phoenix-workspace.sqlite");
    const db = pnwCreateDb(database);
    let oldId = 0;
    let staleId = 0;
    try {
      oldId = db.get<{ id: number }>(
        "SELECT id FROM phoenix_cad_file_asset WHERE repo_rel_path = './parts/Old.FCStd'",
      )!.id;
      db.run(
        `INSERT INTO phoenix_cad_file_asset (
           repo_rel_path, filename, asset_kind, file_status, last_seen_at, updated_at
         ) VALUES ('./parts/New.FCStd', 'New.FCStd', 'fcstd', 'missing', '', datetime('now'))`,
      );
      staleId = db.get<{ id: number }>(
        "SELECT id FROM phoenix_cad_file_asset WHERE repo_rel_path = './parts/New.FCStd'",
      )!.id;
    } finally {
      db.close();
    }

    fs.renameSync(path.join(workspace, "parts", "Old.FCStd"), path.join(workspace, "parts", "New.FCStd"));
    expect(updateFcstdMapEntryRename(workspace, "parts/Old.FCStd", "parts/New.FCStd")).toBe(true);

    const check = pnwCreateDb(database);
    try {
      expect(check.get<{ id: number; file_status: string }>(
        "SELECT id, file_status FROM phoenix_cad_file_asset WHERE repo_rel_path = './parts/New.FCStd'",
      )).toEqual({ id: oldId, file_status: "present" });
      expect(check.get("SELECT id FROM phoenix_cad_file_asset WHERE id = ?", [staleId])).toBeUndefined();
      expect(check.get<{
        target_file_asset_id: number;
        target_repo_rel_path: string;
        target_basename: string;
        resolve_status: string;
      }>(
        "SELECT target_file_asset_id, target_repo_rel_path, target_basename, resolve_status FROM phoenix_cad_bom_xref LIMIT 1",
      )).toEqual({
        target_file_asset_id: oldId,
        target_repo_rel_path: "./parts/New.FCStd",
        target_basename: "New.FCStd",
        resolve_status: "missing",
      });
    } finally {
      check.close();
    }
  });

  it("writes history into a migration-era Python scan table with required scan_root", () => {
    const workspace = makeTempRoot();
    const db = pnwCreateDb(path.join(workspace, ".phoenix", "phoenix-workspace.sqlite"));
    try {
      db.exec(`
        CREATE TABLE phoenix_cad_scan (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          scan_uuid TEXT UNIQUE,
          scanned_at TEXT NOT NULL,
          scan_root TEXT NOT NULL,
          stats_json TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'done',
          phase TEXT DEFAULT '',
          progress_json TEXT,
          started_at TEXT,
          finished_at TEXT
        )
      `);
    } finally {
      db.close();
    }
    writeFile(workspace, "docs/readme.md", "legacy schema\n");

    expect(() => runFcstdMapScanWithProgress(workspace, () => {})).not.toThrow();
    const check = pnwCreateDb(path.join(workspace, ".phoenix", "phoenix-workspace.sqlite"));
    try {
      expect(check.get<{ scan_root: string }>("SELECT scan_root FROM phoenix_cad_scan ORDER BY id DESC LIMIT 1")?.scan_root).toBe(".");
    } finally {
      check.close();
    }
  });
});
