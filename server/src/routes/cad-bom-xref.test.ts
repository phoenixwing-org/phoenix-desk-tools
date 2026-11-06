import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { strToU8, zipSync } from "fflate";
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

async function waitForProgress(cadRoutes: any, scanId: string, terminal = new Set(["done", "error", "cancelled"])) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const response = await cadRoutes.request(`/bom/xref/refresh-host-index/progress?scan_id=${encodeURIComponent(scanId)}`);
    const progress = await response.json();
    if (terminal.has(progress.status)) return progress;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`BOM xref task did not finish: ${scanId}`);
}

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
  db.close();
}

async function importRoutes(home: string, workspace: string) {
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  configurePrefs(home, workspace);
  vi.resetModules();
  const cad = await import("./cad.js");
  const shell = await import("./shell.js");
  return { cadRoutes: cad.cadRoutes, shellRoutes: shell.shellRoutes };
}

afterEach(() => {
  vi.restoreAllMocks();
  process.env.HOME = originalHome;
  process.env.USERPROFILE = originalUserProfile;
  vi.resetModules();
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("cad BOM xref routes", () => {
  it("keeps ordinary xref HTTP reads cached and checks only the explicitly disk-refreshed host", async () => {
    const home = makeTempRoot("cad-label-boundary-home-"), workspace = makeTempRoot("cad-label-boundary-ws-");
    createBomXrefFixture(workspace);
    writeFcstd(workspace, "asm/Sub.ASSY.FCStd", `<Document><Objects><Object name="Assembly" type="App::Part"/><Object name="BoltLink" type="App::Link"/></Objects><ObjectData>
      <Object name="Assembly"><Properties><Property name="Group" type="App::PropertyLinkList"><LinkList count="1"><Link value="BoltLink"/></LinkList></Property></Properties></Object>
      <Object name="BoltLink"><Properties><Property name="Label" type="App::PropertyString"><String value="Independent part"/></Property><Property name="LinkedObject" type="App::PropertyXLink"><XLink file="../parts/Bolt.FCStd" name="Body"/></Property></Properties></Object>
      </ObjectData></Document>`);
    writeFcstd(workspace, "parts/Bolt.FCStd", `<Document><Objects><Object name="Body" type="Part::Feature"/></Objects><ObjectData><Object name="Body"><Properties><Property name="Label" type="App::PropertyString"><String value="Independent part"/></Property></Properties></Object></ObjectData></Document>`);
    const { cadRoutes, shellRoutes } = await importRoutes(home, workspace);
    const read = fs.readFileSync, open = fs.openSync, cadReads: string[] = [];
    const canonical = fs.realpathSync(workspace);
    let forbid = true;
    const observe = (filename: unknown) => {
      if (!/\.fcstd$/i.test(String(filename))) return;
      cadReads.push(path.relative(canonical, fs.realpathSync(String(filename))));
      if (forbid) throw new Error("Cached HTTP projection attempted a CAD read");
    };
    vi.spyOn(fs, "readFileSync").mockImplementation(((file: any, ...args: any[]) => { observe(file); return (read as any)(file, ...args); }) as typeof fs.readFileSync);
    vi.spyOn(fs, "openSync").mockImplementation(((file: any, ...args: any[]) => { observe(file); return (open as any)(file, ...args); }) as typeof fs.openSync);
    for (const url of ["/bom/xref/outgoing?rel=asm%2FSub.ASSY.FCStd&labelCheck=saved_current_host", "/bom/xref/incoming?rel=parts%2FBolt.FCStd"]) {
      const response = await cadRoutes.request(url), data = await response.json();
      expect(response.status).toBe(200); expect(data.refs.length).toBeGreaterThan(0);
      expect(data.refs.every((ref: any) => ref.label_check_status === "unknown" && !ref.label_mismatch)).toBe(true);
    }
    for (const suffix of ["", "&refresh_disk=false&labelCheck=saved_current_host"]) {
      const response = await shellRoutes.request(`/api/file-detail/xrefs?rel=asm%2FSub.ASSY.FCStd${suffix}`), data = await response.json();
      expect(response.status).toBe(200); expect(data.outgoing.refs[0]).toMatchObject({ label_check_status: "unknown", label_mismatch: false });
    }
    expect(cadReads).toEqual([]);
    forbid = false;
    const refreshed = await shellRoutes.request("/api/file-detail/xrefs?rel=asm%2FSub.ASSY.FCStd&refresh_disk=true"), live = await refreshed.json();
    expect(refreshed.status).toBe(200);
    expect(live.outgoing.refs[0]).toMatchObject({ label_check_status: "matched", label_mismatch: false, rule_label: "Independent part" });
    expect(live.incoming.hosts).toEqual(expect.arrayContaining([expect.objectContaining({ host_repo_rel_path: "./asm/Root.ASSY.FCStd" })]));
    expect(cadReads).toContain("asm/Sub.ASSY.FCStd"); expect(cadReads).toContain("parts/Bolt.FCStd");
    expect(cadReads).not.toContain("asm/Root.ASSY.FCStd");
    cadReads.length = 0; forbid = true;
    const cachedAgain = await shellRoutes.request("/api/file-detail/xrefs?rel=asm%2FSub.ASSY.FCStd&refresh_disk=false");
    expect((await cachedAgain.json()).outgoing.refs[0]).toMatchObject({ label_check_status: "unknown", label_mismatch: false });
    expect(cadReads).toEqual([]);
  });

  it("serves retained file-detail XRef reads and local host refreshes", async () => {
    const home = makeTempRoot("cad-bom-xref-home-");
    const workspace = makeTempRoot("cad-bom-xref-ws-");
    createBomXrefFixture(workspace);

    const { cadRoutes, shellRoutes } = await importRoutes(home, workspace);

    const incomingRes = await cadRoutes.request(`/bom/xref/incoming?rel=${encodeURIComponent("parts/Bolt.FCStd")}&transitive=true`);
    expect(incomingRes.status).toBe(200);
    const incoming = await incomingRes.json();
    expect(incoming.count).toBe(2);
    expect(incoming.direct_count).toBe(1);
    expect(incoming.hosts[1]).toMatchObject({ usage_kind: "indirect" });

    const outgoingRes = await cadRoutes.request(`/bom/xref/outgoing?rel=${encodeURIComponent("asm/Root.ASSY.FCStd")}`);
    expect(outgoingRes.status).toBe(200);
    const outgoing = await outgoingRes.json();
    expect(outgoing).toMatchObject({ count: 2, label_mismatch_count: 0 });
    expect(outgoing.refs.every((ref: any) => ref.label_check_status === "unknown")).toBe(true);

    const countsRes = await cadRoutes.request(`/bom/xref/counts?rel=${encodeURIComponent("asm/Sub.ASSY.FCStd")}`);
    expect(countsRes.status).toBe(200);
    await expect(countsRes.json()).resolves.toMatchObject({
      outgoing_count: 1,
      direct_incoming_count: 1,
    });

    for (const retiredRoute of [
      "/bom/xref/meta",
      "/bom/xref/usage-stats?rel=parts%2FBolt.FCStd",
      "/bom/xref/edges?search=Bolt",
      "/bom/xref/assembly-hosts",
    ]) {
      expect((await cadRoutes.request(retiredRoute)).status).toBe(404);
    }

    const detailRes = await shellRoutes.request(`/api/file-detail/xrefs?rel=${encodeURIComponent("parts/Bolt.FCStd")}&transitive=true`);
    expect(detailRes.status).toBe(200);
    const detail = await detailRes.json();
    expect(detail.incoming).toMatchObject({ count: 2, direct_count: 1 });
    expect(detail.outgoing).toMatchObject({ count: 0 });

    const patchRes = await cadRoutes.request("/bom/xref/patch-labels", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        patches: [
          {
            host_repo_rel: "asm/Sub.ASSY.FCStd",
            xlink_file_attr: "../parts/Bolt.FCStd",
            link_label: "Bolt",
          },
        ],
      }),
    });
    expect(patchRes.status).toBe(200);
    await expect(patchRes.json()).resolves.toMatchObject({
      label_patches: 1,
      applied_hosts: ["./asm/Sub.ASSY.FCStd"],
      failed: [],
    });

    expect((await cadRoutes.request("/bom/xref/rebuild", { method: "POST" })).status).toBe(404);

    const startRes = await cadRoutes.request("/bom/xref/refresh-host-index/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ host_repo_rel: "asm/Sub.ASSY.FCStd" }),
    });
    expect(startRes.status).toBe(200);
    const started = await startRes.json();
    expect(started.scan_id).toMatch(/^bom-xref-/);

    const progress = await waitForProgress(cadRoutes, started.scan_id);
    expect(progress).toMatchObject({
      scan_id: started.scan_id,
      status: "done",
      result: { edge_count: 1, hosts_refreshed: 2 },
    });
    expect(progress.walk.percent).toBe(100);
    expect(progress.xref.percent).toBe(100);

    const cancelStartRes = await cadRoutes.request("/bom/xref/refresh-host-index/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ host_repo_rel: "asm/Root.ASSY.FCStd", recursive: true }),
    });
    const cancelStarted = await cancelStartRes.json();
    const cancelRes = await cadRoutes.request(
      `/bom/xref/refresh-host-index/cancel?scan_id=${encodeURIComponent(cancelStarted.scan_id)}`,
      { method: "POST" },
    );
    await expect(cancelRes.json()).resolves.toEqual({ ok: true });
    const cancelled = await waitForProgress(cadRoutes, cancelStarted.scan_id);
    expect(cancelled).toMatchObject({ status: "cancelled", cancelled: true });

    const secondCancel = await cadRoutes.request(
      `/bom/xref/refresh-host-index/cancel?scan_id=${encodeURIComponent(cancelStarted.scan_id)}`,
      { method: "POST" },
    );
    await expect(secondCancel.json()).resolves.toEqual({ ok: false });

    writeFcstd(workspace, "asm/Sub.ASSY.FCStd", EMPTY_XML);
    const diskRefresh = await shellRoutes.request(
      `/api/file-detail/xrefs?rel=${encodeURIComponent("asm/Sub.ASSY.FCStd")}&scope=outgoing&refresh_disk=true`,
    );
    expect(diskRefresh.status).toBe(200);
    await expect(diskRefresh.json()).resolves.toMatchObject({
      outgoing: { count: 0, refs: [] },
    });
  }, 15_000);
});
