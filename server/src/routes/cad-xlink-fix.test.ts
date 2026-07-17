import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Hono } from "hono";
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

function writeFixtureFile(root: string, rel: string) {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, "test fixture\n", "utf8");
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

function createXlinkFixture(workspace: string) {
  writeFixtureFile(workspace, "asm/Root.ASSY.FCStd");
  writeFixtureFile(workspace, "asm/Sub.ASSY.FCStd");

  const db = pnwCreateDb(path.join(workspace, ".phoenix", "phoenix-workspace.sqlite"));
  db.exec(`
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
      file_status TEXT NOT NULL DEFAULT 'present'
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

  const assetSql = `
    INSERT INTO phoenix_cad_file_asset (
      id, repo_rel_path, filename, asset_kind, part_number, part_version,
      type_code, model_series, part_name, label, file_status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;
  db.run(assetSql, [1, "./asm/Root.ASSY.FCStd", "Root.ASSY.FCStd", "fcstd", "100001", "001", "A", "ROOT", "Root", "Root", "present"]);
  db.run(assetSql, [2, "./asm/Sub.ASSY.FCStd", "Sub.ASSY.FCStd", "fcstd", "100002", "001", "A", "SUB", "Sub", "Sub", "present"]);

  const edgeSql = `
    INSERT INTO phoenix_cad_bom_xref (
      scan_id, host_file_asset_id, host_repo_rel_path, xlink_file_attr,
      target_basename, target_file_asset_id, target_repo_rel_path,
      target_part_number, target_part_version, target_type_code,
      target_model_series, target_part_name, target_asset_label,
      resolve_status, last_seen_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;
  const now = "2026-07-10T10:00:00";
  db.run(edgeSql, [1, 1, "./asm/Root.ASSY.FCStd", "../legacy/Sub.ASSY.FCStd", "Sub.ASSY.FCStd", 2, "./asm/Sub.ASSY.FCStd", "100002", "001", "A", "SUB", "Sub", "Sub", "resolved", now]);
  db.run(edgeSql, [1, 1, "./asm/Root.ASSY.FCStd", "Missing.FCStd", "Missing.FCStd", null, null, "", "", "", "", "", "", "missing", now]);
  db.run(edgeSql, [1, 1, "./asm/Root.ASSY.FCStd", "Sub.ASSY.FCStd", "Sub.ASSY.FCStd", 2, "./asm/Sub.ASSY.FCStd", "100002", "001", "A", "SUB", "Sub", "Sub", "resolved", now]);
  db.close();
}

async function importRoutes(home: string, workspace: string) {
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  configurePrefs(home, workspace);
  vi.resetModules();
  const cad = await import("./cad.js");
  const scan = await import("./cad-scan.js");
  return { cadRoutes: cad.cadRoutes, cadScanRoutes: scan.cadScanRoutes };
}

afterEach(() => {
  process.env.HOME = originalHome;
  process.env.USERPROFILE = originalUserProfile;
  vi.resetModules();
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("cad XLink fix routes", () => {
  it("serves prefs, analysis, candidates, and unchanged override natively", async () => {
    const home = makeTempRoot("cad-xlink-home-");
    const workspace = makeTempRoot("cad-xlink-ws-");
    createXlinkFixture(workspace);
    const { cadRoutes } = await importRoutes(home, workspace);

    const prefsRes = await cadRoutes.request("/xlink-fix/prefs");
    expect(prefsRes.status).toBe(200);
    await expect(prefsRes.json()).resolves.toEqual({ batch_dir: ".", dry_run: true, all_in_dir: true });

    const saveRes = await cadRoutes.request("/xlink-fix/prefs", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ batch_dir: ".", dry_run: true, all_in_dir: true }),
    });
    expect(saveRes.status).toBe(200);

    const analyzeRes = await cadRoutes.request("/xlink-fix/analyze", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ batch_dir: ".", all_in_dir: true }),
    });
    expect(analyzeRes.status).toBe(200);
    const analysis = await analyzeRes.json();
    expect(analysis).toMatchObject({
      _native: "node",
      stats: { host_count: 1, issue_count: 2, fixable_count: 1, not_found_count: 1 },
    });
    expect(analysis).not.toHaveProperty("_stub");
    expect(analysis).not.toHaveProperty("_proxy");

    const candidatesRes = await cadRoutes.request("/xlink-fix/candidates?basename=Sub.ASSY.FCStd&exclude_repo_rel=./asm/Root.ASSY.FCStd");
    expect(candidatesRes.status).toBe(200);
    const candidates = await candidatesRes.json();
    expect(candidates.files).toEqual([expect.objectContaining({ repo_rel_path: "./asm/Sub.ASSY.FCStd" })]);

    const overrideRes = await cadRoutes.request("/xlink-fix/apply-override", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        host_repo_rel: "./asm/Root.ASSY.FCStd",
        old_path: "Sub.ASSY.FCStd",
        target_repo_rel: "./asm/Sub.ASSY.FCStd",
      }),
    });
    expect(overrideRes.status).toBe(200);
    await expect(overrideRes.json()).resolves.toMatchObject({ patches: 0, unchanged: true, _native: "node" });
  });

  it("keeps XLink routes single-owned while the earlier CAD scan mount passes through", async () => {
    const home = makeTempRoot("cad-xlink-shadow-home-");
    const workspace = makeTempRoot("cad-xlink-shadow-ws-");
    createXlinkFixture(workspace);
    const { cadRoutes, cadScanRoutes } = await importRoutes(home, workspace);
    const app = new Hono();
    app.route("/api/cad", cadScanRoutes);
    app.route("/api/cad", cadRoutes);
    expect(cadScanRoutes.routes.some((route) => route.path.startsWith("/xlink-fix/"))).toBe(false);

    for (const endpoint of ["analyze", "run"]) {
      const res = await app.request(`/api/cad/xlink-fix/${endpoint}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ batch_dir: ".", all_in_dir: true, dry_run: true }),
      });
      expect(res.status).toBe(200);
      const payload = await res.json();
      expect(payload).toMatchObject({ _native: "node", stats: { fixable_count: 1, not_found_count: 1 } });
      expect(payload).not.toHaveProperty("_stub");
      expect(payload).not.toHaveProperty("_proxy");
    }
  });
});
