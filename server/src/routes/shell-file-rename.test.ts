import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { afterEach, describe, expect, it, vi } from "vitest";
import { pnwCreateDb } from "@phoenix-wing/db-node";
import { refreshBomXrefForHost } from "../lib/pnwBomXrefService.js";

const tempRoots: string[] = [];
const originalHome = process.env.HOME;
const originalUserProfile = process.env.USERPROFILE;

function makeTempRoot(name: string) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), name));
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
  writeFcstd(workspace, "parts/OldPart.FCStd", '<Document><ObjectData></ObjectData></Document>');
  writeFcstd(
    workspace,
    "asm/Assembly.FCStd",
    '<Document><ObjectData><Object name="PartLink"><Property name="Label" type="App::PropertyString"><String value="Old label"/></Property><XLink file="../parts/OldPart.FCStd"/></Object></ObjectData></Document>',
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
  db.close();
  refreshBomXrefForHost(workspace, "asm/Assembly.FCStd", { recursive: true, maxHosts: 10 });
}

function configureTempPrefs(home: string, workspace: string) {
  const prefsDir = path.join(home, ".phoenix");
  fs.mkdirSync(prefsDir, { recursive: true });
  fs.writeFileSync(
    path.join(prefsDir, "launcher-prefs.json"),
    JSON.stringify({ recent_workspaces: [workspace], freecad_dir: "", workspace }, null, 2),
    "utf8",
  );
}

async function importRoutes(home: string, workspace: string) {
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  configureTempPrefs(home, workspace);
  vi.resetModules();
  const shell = await import("./shell.js");
  const cad = await import("./cad.js");
  return { shellRoutes: shell.shellRoutes, cadRoutes: cad.cadRoutes };
}

afterEach(() => {
  process.env.HOME = originalHome;
  process.env.USERPROFILE = originalUserProfile;
  vi.resetModules();
  for (const root of tempRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("file rename routes", () => {
  it("renames a file, scans indexed FCStd XLinks, and persists path/label writes", async () => {
    const home = makeTempRoot("shell-file-rename-home-");
    const workspace = makeTempRoot("shell-file-rename-ws-");
    createRenameFixture(workspace);

    const { shellRoutes, cadRoutes } = await importRoutes(home, workspace);
    const contextRes = await shellRoutes.request("/api/file-rename/context?rel=parts%2FOldPart.FCStd");
    expect(contextRes.status).toBe(200);
    const context = await contextRes.json();
    expect(context).toMatchObject({
      rel_path: "parts/OldPart.FCStd",
      _native: "node",
      preview: {
        rel_path: "parts/OldPart.FCStd",
        is_fcstd: true,
        fields: { filename: "OldPart.FCStd" },
        file_size_bytes: expect.any(Number),
      },
    });
    expect(context).not.toHaveProperty("_stub");

    const renameRes = await shellRoutes.request("/api/file-rename/rename?rel=parts%2FOldPart.FCStd", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ filename: "NewPart.FCStd" }),
    });
    expect(renameRes.status).toBe(200);
    const renamed = await renameRes.json();
    expect(renamed.rel_path).toBe("parts/NewPart.FCStd");
    expect(fs.existsSync(path.join(workspace, "parts/NewPart.FCStd"))).toBe(true);

    const logsRes = await cadRoutes.request("/rename/logs?limit=10");
    const logs = await logsRes.json();
    expect(logs.entries[0].new_filename).toBe("NewPart.FCStd");

    const scanRes = await cadRoutes.request("/rename/analyze", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ rename_log_id: renamed.rename_log_id }),
    });
    expect(scanRes.status).toBe(200);
    const scan = await scanRes.json();
    expect(scan.hit_count).toBe(1);
    expect(scan.hosts[0]).toMatchObject({
      host_repo_rel_path: "asm/Assembly.FCStd",
      hits: [expect.objectContaining({ proposed_text: "../parts/NewPart.FCStd" })],
    });

    const applyRes = await cadRoutes.request("/rename/apply", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ rename_log_id: renamed.rename_log_id, host_repo_rel_paths: ["asm/Assembly.FCStd"] }),
    });
    expect(applyRes.status).toBe(200);
    const applied = await applyRes.json();
    expect(applied.xlink_patches).toBe(1);
    expect(readFcstdXml(workspace, "asm/Assembly.FCStd")).toContain('file="../parts/NewPart.FCStd"');

    const labelRes = await cadRoutes.request("/rename/apply", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        rename_log_id: renamed.rename_log_id,
        host_repo_rel_paths: ["asm/Assembly.FCStd"],
        labels_only: true,
        label_scope: "incoming",
      }),
    });
    expect(labelRes.status).toBe(200);
    await expect(labelRes.json()).resolves.toMatchObject({ label_patches: 1, failed: [] });
    expect(readFcstdXml(workspace, "asm/Assembly.FCStd")).toContain('value="New Part"');

    const loadRes = await cadRoutes.request(`/rename/load?rename_log_id=${renamed.rename_log_id}`);
    expect(loadRes.status).toBe(200);
    const loaded = await loadRes.json();
    expect(loaded.rename_log.old_filename).toBe("OldPart.FCStd");
  });
});
