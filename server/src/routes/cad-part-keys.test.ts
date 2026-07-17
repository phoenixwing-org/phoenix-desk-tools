import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { pnwCreateDb } from "@phoenix-wing/db-node";

const tempRoots: string[] = [];
const originalHome = process.env.HOME;
const originalUserProfile = process.env.USERPROFILE;

function makeTempRoot(name: string) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), name));
  tempRoots.push(root);
  return root;
}

function configurePrefs(home: string, workspace: string) {
  const prefsDir = path.join(home, ".phoenix");
  fs.mkdirSync(prefsDir, { recursive: true });
  fs.writeFileSync(
    path.join(prefsDir, "launcher-prefs.json"),
    JSON.stringify({ recent_workspaces: [workspace], freecad_dir: "", workspace }, null, 2),
    "utf8",
  );
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

async function importCadRoutes(home: string, workspace: string) {
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  configurePrefs(home, workspace);
  vi.resetModules();
  return import("./cad.js");
}

afterEach(() => {
  process.env.HOME = originalHome;
  process.env.USERPROFILE = originalUserProfile;
  vi.resetModules();
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("cad PartKey routes", () => {
  it("serves Part catalog/detail/infer/patch and assembly tree through native SQLite routes", async () => {
    const home = makeTempRoot("cad-part-home-");
    const workspace = makeTempRoot("cad-part-ws-");
    createPartFixture(workspace);

    const { cadRoutes } = await importCadRoutes(home, workspace);

    const listRes = await cadRoutes.request("/parts");
    expect(listRes.status).toBe(200);
    const list = await listRes.json();
    expect(list).toMatchObject({ exists: true, stats: { total_keys: 3, total_files: 3 }, _native: "node" });
    expect(list.entries[0]).toMatchObject({ part_key: "100001.001", PartName: "Root Assembly" });
    expect(list.items[0]).toMatchObject({ part_number: "100001", part_name: "Root Assembly" });
    expect(list).not.toHaveProperty("_stub");
    expect(list).not.toHaveProperty("_proxy");

    const detailRes = await cadRoutes.request("/parts/100003/001");
    expect(detailRes.status).toBe(200);
    const detail = await detailRes.json();
    expect(detail).toMatchObject({ part_key: "100003.001", file_count: 1, PartName: "Bolt" });
    expect(detail.files[0]).toMatchObject({ id: 3, file_role: "part", file_status: "present" });

    const inferRes = await cadRoutes.request(`/parts/infer?rel=${encodeURIComponent("parts/100003.001-H-Bolt.FCStd")}`);
    expect(inferRes.status).toBe(200);
    await expect(inferRes.json()).resolves.toMatchObject({
      part_number: "100003",
      part_version: "001",
      source: "filename+index",
      in_catalog: true,
    });

    const patchRes = await cadRoutes.request("/parts/100003/001", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ PartName: "Cap Screw", status: "obsolete" }),
    });
    expect(patchRes.status).toBe(200);
    await expect(patchRes.json()).resolves.toMatchObject({
      PartName: "Cap Screw",
      status: "obsolete",
      files: [{ PartName: "Cap Screw" }],
    });

    const filePatchRes = await cadRoutes.request("/parts/100003/001/files/3", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ file_role: "fastener", link_notes: "preferred", link_status: "obsolete" }),
    });
    expect(filePatchRes.status).toBe(200);
    const filePatched = await filePatchRes.json();
    expect(filePatched.files[0]).toMatchObject({
      file_role: "fastener",
      link_notes: "preferred",
      link_status: "obsolete",
    });

    const treeRes = await cadRoutes.request(`/bom/xref/assembly-tree?host_rel=${encodeURIComponent("asm/100001.001-A-Root.ASSY.FCStd")}&full=true`);
    expect(treeRes.status).toBe(200);
    const tree = await treeRes.json();
    expect(tree).toMatchObject({ mode: "full", node_count: 2 });
    expect(tree.nodes[0].children[0]).toMatchObject({ part_key: "100003.001" });

    const legacyTreeRes = await cadRoutes.request(`/bom/tree?rel=${encodeURIComponent("asm/100001.001-A-Root.ASSY.FCStd")}`);
    expect(legacyTreeRes.status).toBe(200);
    const legacyTree = await legacyTreeRes.json();
    expect(legacyTree.items).toHaveLength(2);
    expect(legacyTree.items[1]).toMatchObject({ depth: 1, part_key: "100003.001" });

    const partTreeRes = await cadRoutes.request(`/parts/100001/001/assembly-tree?host_rel=${encodeURIComponent("asm/100001.001-A-Root.ASSY.FCStd")}&full=true`);
    expect(partTreeRes.status).toBe(200);
    await expect(partTreeRes.json()).resolves.toMatchObject({ node_count: 2 });
  });
});
