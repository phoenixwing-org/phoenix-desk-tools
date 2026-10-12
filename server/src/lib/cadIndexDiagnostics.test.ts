import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, expect, it } from "vitest";
import { pnwCreateDb } from "@phoenix-wing/db-node";
import { inspectCadIndex, loadCadIndexStatus } from "./cadIndexStatusService.js";
import { ensurePhoenixDatabase, phoenixDatabasePath } from "./phoenixDatabaseService.js";
import { cadRoutes } from "../routes/cad.js";

const roots: string[] = [];
function workspace() { const root = fs.mkdtempSync(path.join(os.tmpdir(), "desk-index-status-")); roots.push(root); return root; }
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
it("reports a missing index without creating directories or accepting an empty workspace", () => {
  const root = workspace();
  expect(inspectCadIndex(root).state).toBe("missing");
  expect(fs.readdirSync(root)).toEqual([]);
  expect(() => inspectCadIndex("")).toThrow("工作空间");
});
it("excludes preserved ignored and hidden-directory rows from normal counts without modifying old data", () => {
  const root = workspace(); const file = ensurePhoenixDatabase(root);
  const db = pnwCreateDb(file);
  for (const [relative, status] of [
    ["models/Formal.FCStd", "present"], ["models/.Visible.FCStd", "present"],
    ["models/ManualIgnored.FCStd", "ignored"], ["./.snapshot/Old.FCStd", "present"],
    ["models/.archive/Missing.FCStd", "missing"], ["models\\.archive\\Old.FCStd", "present"],
    ["node_modules/Retained.FCStd", "missing"],
  ]) db.run("INSERT INTO phoenix_cad_file_asset(repo_rel_path,filename,file_status,updated_at) VALUES (?,?,?,'old')", [relative, path.basename(relative), status]);
  db.run("INSERT INTO phoenix_cad_scan(scanned_at,scan_root,stats_json,status) VALUES ('2026-10-03','','{}','done')"); db.close();
  const before = fs.readFileSync(file);
  expect(inspectCadIndex(root)).toMatchObject({ state: "ready", totalEntries: 2, missingEntries: 0 });
  expect(loadCadIndexStatus(root)).toMatchObject({ indexed: true, totalEntries: 2 });
  expect(fs.readFileSync(file)).toEqual(before);
});
it("distinguishes schema mismatch and unreadable data without fixing either", () => {
  const root = workspace(); const file = ensurePhoenixDatabase(root);
  const db = pnwCreateDb(file); db.run("UPDATE phoenix_meta SET value='0' WHERE key='schema_version'"); db.close();
  expect(inspectCadIndex(root).state).toBe("incompatible");
  fs.writeFileSync(file, "not sqlite");
  expect(inspectCadIndex(root).state).toBe("unreadable");
  expect(fs.readFileSync(file, "utf8")).toBe("not sqlite");
});
it("reports a busy host lease as unreadable while basic status explicitly refuses instead of returning zero", () => {
  const root = workspace(), file = ensurePhoenixDatabase(root), before = fs.readFileSync(file);
  const lock = `${fs.realpathSync(file)}.lock`; fs.mkdirSync(lock); const owner = fs.statSync(lock);
  expect(inspectCadIndex(root)).toMatchObject({ state: "unreadable", schemaVersion: null });
  expect(inspectCadIndex(root).message).toMatch(/busy|lock/i);
  expect(() => loadCadIndexStatus(root)).toThrow(/busy|lock/i);
  expect(fs.statSync(lock).ino).toBe(owner.ino); expect(fs.readFileSync(file)).toEqual(before);
});
it("refuses unsupported WAL diagnostics and status without converting or changing the database family", () => {
  const root = workspace(), file = ensurePhoenixDatabase(root), db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode=WAL"); db.close();
  const before = fs.readFileSync(file), files = fs.readdirSync(path.dirname(file)).sort();
  expect(inspectCadIndex(root)).toMatchObject({ state: "unreadable", schemaVersion: null });
  expect(inspectCadIndex(root).message).toMatch(/WAL|journal/i);
  expect(() => loadCadIndexStatus(root)).toThrow(/WAL|journal/i);
  expect(fs.readFileSync(file)).toEqual(before); expect(fs.readdirSync(path.dirname(file)).sort()).toEqual(files);
});
it("does not turn corrupt data or an unknown SQL failure into a successful empty basic status", () => {
  const root = workspace(), file = ensurePhoenixDatabase(root), db = new DatabaseSync(file);
  db.exec("DROP TABLE phoenix_cad_scan"); db.close();
  expect(inspectCadIndex(root)).toMatchObject({ state: "incompatible", schemaVersion: 13 });
  expect(() => loadCadIndexStatus(root)).toThrow("phoenix_cad_scan");
  fs.writeFileSync(file, "independent corrupt database fixture");
  expect(inspectCadIndex(root).state).toBe("unreadable");
  expect(() => loadCadIndexStatus(root)).toThrow("索引状态读取失败");
  expect(fs.readFileSync(file, "utf8")).toBe("independent corrupt database fixture");
  expect(fs.existsSync(`${file}.lock`)).toBe(false);
});
it("health exposes index problems without synchronizing projections or changing bytes", async () => {
  const root = workspace(); const file = ensurePhoenixDatabase(root);
  const db = pnwCreateDb(file);
  db.run("UPDATE phoenix_meta SET value='0' WHERE key='schema_version'"); db.close();
  const before = fs.readFileSync(file);
  const files = fs.readdirSync(path.dirname(file)).sort();
  const response = await cadRoutes.request(`/health?workspace=${encodeURIComponent(root)}`);
  expect(await response.json()).toMatchObject({ ok: true, native: { available: false }, index: { state: "incompatible" } });
  expect(fs.readFileSync(file)).toEqual(before);
  expect(fs.readdirSync(path.dirname(file)).sort()).toEqual(files);
});
it("reports a partial-refresh stale marker without treating it as a completed scan", () => {
  const root = workspace(); const file = ensurePhoenixDatabase(root);
  const db = pnwCreateDb(file);
  db.run("INSERT INTO phoenix_cad_scan(scanned_at,scan_root,stats_json,status) VALUES ('2026-10-03','','{}','done')");
  db.run("INSERT INTO phoenix_cad_scan(scanned_at,scan_root,stats_json,status) VALUES ('2026-10-04','','{}','stale')"); db.close();
  expect(inspectCadIndex(root)).toMatchObject({ state: "attention", lastScanAt: "2026-10-03", latestScan: { id: 2, status: "stale" } });
  expect(inspectCadIndex(root).message).toContain("递归 BOM");
});
it("restores a partial scan's failure metadata without claiming a complete BOM or changing the database", async () => {
  const root = workspace(); const file = ensurePhoenixDatabase(root);
  const db = pnwCreateDb(file);
  db.run("INSERT INTO phoenix_cad_file_asset(repo_rel_path,filename,updated_at) VALUES ('synthetic/Example.FCStd','Example.FCStd','old')");
  db.run("INSERT INTO phoenix_cad_scan(scanned_at,scan_root,stats_json,status) VALUES ('old-complete','','{}','done')");
  db.run("INSERT INTO phoenix_cad_scan(scanned_at,scan_root,stats_json,status) VALUES ('new-partial','synthetic',?,'partial')",
    [JSON.stringify({ complete: false, failed_count: 2, failures: [
      { rel: "synthetic/Unreadable.FCStd", message: "Synthetic XML error" },
      { rel: "synthetic/Unsupported.FCStd", message: "Synthetic link-array error" },
    ] })]);
  db.close();
  const before = fs.readFileSync(file);
  const expected = {
    state: "attention", totalEntries: 1, missingEntries: 0, failedEntries: 2,
    lastScanAt: "old-complete", latestScan: { id: 2, status: "partial", at: "new-partial" },
    failures: [{ rel: "synthetic/Unreadable.FCStd", message: "Synthetic XML error" },
      { rel: "synthetic/Unsupported.FCStd", message: "Synthetic link-array error" }],
  };
  expect(inspectCadIndex(root)).toMatchObject(expected);
  expect(inspectCadIndex(root).message).toContain("索引部分可用");
  expect(inspectCadIndex(root).message).toContain("图册可用，BOM 不完整");
  const response = await cadRoutes.request(`/index/status?workspace=${encodeURIComponent(root)}`);
  expect(await response.json()).toMatchObject(expected);
  expect(loadCadIndexStatus(root)).toMatchObject({ indexed: true, totalEntries: 1 });
  expect(fs.readFileSync(file)).toEqual(before);
});
it("bounds partial failure detail to 100 entries while retaining the full count", () => {
  const root = workspace(); const file = ensurePhoenixDatabase(root);
  const db = pnwCreateDb(file);
  const failures = Array.from({ length: 105 }, (_, index) => ({ rel: `synthetic/Entry${index}.FCStd`, message: `Synthetic error ${index}` }));
  db.run("INSERT INTO phoenix_cad_scan(scanned_at,scan_root,stats_json,status) VALUES ('partial','',?,'partial')",
    [JSON.stringify({ complete: false, failed_count: 105, failures })]);
  db.close();
  const result = inspectCadIndex(root);
  expect(result).toMatchObject({ state: "attention", failedEntries: 105, lastScanAt: "", latestScan: { status: "partial" } });
  expect(result.failures).toHaveLength(100);
  expect(result.failures.at(-1)).toEqual(failures[99]);
});
it("keeps partial status usable with older or missing failure-detail fields", () => {
  const root = workspace(); const file = ensurePhoenixDatabase(root);
  const db = pnwCreateDb(file);
  db.run("INSERT INTO phoenix_cad_file_asset(repo_rel_path,filename,updated_at) VALUES ('synthetic/Example.FCStd','Example.FCStd','old')");
  db.run("INSERT INTO phoenix_cad_scan(scanned_at,scan_root,stats_json,status) VALUES ('partial','','{}','partial')"); db.close();
  expect(inspectCadIndex(root)).toMatchObject({ state: "attention", failedEntries: 0, failures: [], lastScanAt: "", latestScan: { status: "partial" } });
  expect(loadCadIndexStatus(root)).toMatchObject({ indexed: true, totalEntries: 1, lastScanAt: "" });
});
it("refuses an index symlink outside the workspace without reading its schema", () => {
  const root = workspace(); const other = workspace(); const file = ensurePhoenixDatabase(other);
  fs.mkdirSync(path.join(root, ".phoenix"));
  fs.symlinkSync(file, phoenixDatabasePath(root));
  expect(inspectCadIndex(root)).toMatchObject({ state: "unreadable", schemaVersion: null });
});
it("reads completed, incomplete and missing-entry states without modifying the index", async () => {
  const root = workspace(); const file = ensurePhoenixDatabase(root);
  expect(inspectCadIndex(root).state).toBe("empty");
  let db = pnwCreateDb(file);
  db.run("INSERT INTO phoenix_cad_file_asset(repo_rel_path,filename,updated_at) VALUES ('parts/A.FCStd','A.FCStd','2026-10-03')");
  db.run("INSERT INTO phoenix_cad_scan(scanned_at,scan_root,stats_json,status) VALUES ('2026-10-03','parts','{}','done')");
  db.close();
  const before = fs.readFileSync(file);
  expect(inspectCadIndex(root)).toMatchObject({ state: "ready", totalEntries: 1, missingEntries: 0, lastScanAt: "2026-10-03", latestScan: { id: 1, root: "parts", status: "done" } });
  const res = await cadRoutes.request(`/index/status?workspace=${encodeURIComponent(root)}`);
  expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject({ state: "ready", latestScan: { id: 1 } });
  expect(fs.readFileSync(phoenixDatabasePath(root))).toEqual(before);
  db = pnwCreateDb(file);
  db.run("INSERT INTO phoenix_cad_scan(scanned_at,scan_root,stats_json,status) VALUES ('2026-10-04','parts','{}','failed')"); db.close();
  expect(inspectCadIndex(root)).toMatchObject({ state: "attention", lastScanAt: "2026-10-03", latestScan: { status: "failed" } });
  db = pnwCreateDb(file);
  db.run("DELETE FROM phoenix_cad_scan WHERE status='failed'");
  db.run("UPDATE phoenix_cad_file_asset SET file_status='missing'"); db.close();
  expect(inspectCadIndex(root)).toMatchObject({ state: "attention", missingEntries: 1 });
});
