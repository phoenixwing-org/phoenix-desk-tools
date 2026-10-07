import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { pnwCreateDb } from "@phoenix-wing/db-node";
import { inspectCadIndex } from "./cadIndexStatusService.js";
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
it("distinguishes schema mismatch and unreadable data without fixing either", () => {
  const root = workspace(); const file = ensurePhoenixDatabase(root);
  const db = pnwCreateDb(file); db.run("UPDATE phoenix_meta SET value='0' WHERE key='schema_version'"); db.close();
  expect(inspectCadIndex(root).state).toBe("incompatible");
  fs.writeFileSync(file, "not sqlite");
  expect(inspectCadIndex(root).state).toBe("unreadable");
  expect(fs.readFileSync(file, "utf8")).toBe("not sqlite");
});
it("reads completed, incomplete and missing-entry states without modifying the index", async () => {
  const root = workspace(); const file = ensurePhoenixDatabase(root);
  expect(inspectCadIndex(root).state).toBe("empty");
  let db = pnwCreateDb(file);
  db.run("INSERT INTO phoenix_cad_file_asset(repo_rel_path,filename,updated_at) VALUES ('parts/A.FCStd','A.FCStd','2026-10-03')");
  db.run("INSERT INTO phoenix_cad_scan(scanned_at,scan_root,stats_json,status) VALUES ('2026-10-03','parts','{}','done')");
  db.close();
  const before = fs.readFileSync(file);
  expect(inspectCadIndex(root)).toMatchObject({ state: "ready", totalEntries: 1, missingEntries: 0, lastScanAt: "2026-10-03", latestScan: { root: "parts", status: "done" } });
  const res = await cadRoutes.request(`/index/status?workspace=${encodeURIComponent(root)}`);
  expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject({ state: "ready" });
  expect(fs.readFileSync(phoenixDatabasePath(root))).toEqual(before);
  db = pnwCreateDb(file);
  db.run("INSERT INTO phoenix_cad_scan(scanned_at,scan_root,stats_json,status) VALUES ('2026-10-04','parts','{}','failed')"); db.close();
  expect(inspectCadIndex(root)).toMatchObject({ state: "attention", lastScanAt: "2026-10-03", latestScan: { status: "failed" } });
  db = pnwCreateDb(file);
  db.run("DELETE FROM phoenix_cad_scan WHERE status='failed'");
  db.run("UPDATE phoenix_cad_file_asset SET file_status='missing'"); db.close();
  expect(inspectCadIndex(root)).toMatchObject({ state: "attention", missingEntries: 1 });
});
