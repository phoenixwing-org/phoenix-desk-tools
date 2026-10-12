import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Hono } from "hono";

let root: string, workspace: string, prefs: string, database: string, originalDatabase: Buffer, app: Hono;
const DB = ".phoenix/phoenix-workspace.sqlite";
const BOX = ".phoenix/outbox";
const MANIFEST = "phoenix-workspace-backup.v1.json";

beforeEach(async () => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "desk-mounted-recovery-")));
  workspace = path.join(root, "active-workspace");
  fs.mkdirSync(path.join(workspace, BOX, "empty"), { recursive: true });
  database = path.join(workspace, DB);
  const db = new DatabaseSync(database);
  try {
    db.exec("PRAGMA journal_mode=DELETE; CREATE TABLE phoenix_meta(key TEXT PRIMARY KEY,value TEXT); INSERT INTO phoenix_meta VALUES ('schema_version','13'); CREATE TABLE independent_manual(note TEXT, payload BLOB); INSERT INTO independent_manual VALUES ('independent note', X'00ff12'); CREATE INDEX independent_note_index ON independent_manual(note)");
  } finally { db.close(); }
  originalDatabase = fs.readFileSync(database);
  fs.writeFileSync(path.join(workspace, BOX, ".opaque.bin"), Buffer.from([0, 255, 12]));
  const userData = path.join(root, "runtime-data"); fs.mkdirSync(userData);
  prefs = path.join(userData, "launcher-prefs.json");
  fs.writeFileSync(prefs, JSON.stringify({ version: 2, recent_workspaces: [], freecad_dir: "", workspace }));
  vi.stubEnv("PHOENIX_USER_DATA_DIR", userData);
  vi.stubEnv("PHOENIX_LEGACY_USER_DATA_DIR", userData);
  vi.resetModules();
  const { createPhoenixServerApp } = await import("./serverApp.js");
  app = createPhoenixServerApp();
});
afterEach(() => {
  vi.unstubAllEnvs(); vi.resetModules();
  if (root) fs.rmSync(root, { recursive: true, force: true });
});
function post(action: string, body: unknown, origin = "http://localhost:49373") {
  return app.request(`/api/workspace-recovery/${action}`, { method: "POST",
    headers: { "content-type": "application/json", Origin: origin }, body: JSON.stringify(body) });
}
async function backupAndInspect() {
  const backup = path.join(root, "backup");
  const response = await post("backup", { workspace, target_directory: backup, confirmed: true });
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ receipt: { backupDirectory: backup, fileCount: 2, warnings: [] } });
  const checked = await post("inspect", { workspace, backup_directory: backup });
  expect(checked.status).toBe(200); expect(checked.headers.get("cache-control")).toBe("no-store");
  const inspection = await checked.json() as { inspection_id: string; manifest_sha256: string; file_count: number };
  expect(inspection.inspection_id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  expect(inspection.manifest_sha256).toMatch(/^[0-9a-f]{64}$/); expect(inspection.file_count).toBe(2);
  return { backup, inspection };
}

describe("mounted current-workspace recovery API", () => {
  it("rejects unrelated browser origins before touching recovery paths", async () => {
    const target = path.join(root, "origin-rejected");
    const response = await post("backup", { workspace, target_directory: target, confirmed: true }, "https://unrelated.invalid");
    expect(response.status).toBe(403); expect(response.headers.get("access-control-allow-origin")).toBeNull();
    expect(fs.existsSync(target)).toBe(false); expect(fs.readFileSync(database)).toEqual(originalDatabase);
  });
  it("does not authorize an arbitrary workspace supplied by the request", async () => {
    const other = path.join(root, "unselected-workspace"); fs.mkdirSync(other);
    const target = path.join(root, "workspace-rejected");
    const response = await post("backup", { workspace: other, target_directory: target, confirmed: true });
    expect([400, 409]).toContain(response.status);
    expect(fs.existsSync(target)).toBe(false); expect(fs.readFileSync(database)).toEqual(originalDatabase);
    expect(fs.existsSync(path.join(other, ".phoenix"))).toBe(false);
  });
  it("requires exact confirmation and refuses injected proof before writes", async () => {
    const target = path.join(root, "confirmation-rejected");
    for (const body of [
      { workspace, target_directory: target, confirmed: false },
      { workspace, target_directory: target, confirmed: true, proof: "untrusted-client-proof" },
    ]) {
      expect((await post("backup", body)).status).toBe(400);
    }
    expect(fs.existsSync(target)).toBe(false); expect(fs.readFileSync(database)).toEqual(originalDatabase);
  });
  it("performs real backup, checks the package and restores only to a new isolated directory without activation", async () => {
    const beforePrefs = fs.readFileSync(prefs), { backup, inspection } = await backupAndInspect();
    expect(fs.readFileSync(path.join(backup, DB))).toEqual(originalDatabase);
    const target = path.join(root, "isolated-restore");
    const response = await post("restore", { workspace, inspection_id: inspection.inspection_id, target_directory: target, confirmed: true });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ receipt: { workspace: target, fileCount: 2, warnings: [] } });
    expect(fs.readFileSync(path.join(target, DB))).toEqual(originalDatabase);
    expect(fs.readFileSync(path.join(target, BOX, ".opaque.bin"))).toEqual(Buffer.from([0, 255, 12]));
    expect(fs.readdirSync(path.join(target, BOX, "empty"))).toEqual([]);
    expect(fs.readFileSync(database)).toEqual(originalDatabase); expect(fs.readFileSync(prefs)).toEqual(beforePrefs);
    const again = await post("restore", { workspace, inspection_id: inspection.inspection_id, target_directory: path.join(root, "second-restore"), confirmed: true });
    expect(again.status).not.toBe(200); expect(fs.existsSync(path.join(root, "second-restore"))).toBe(false);
  });
  it("binds the handle to the checked manifest and refuses replacement before destination creation", async () => {
    const { backup, inspection } = await backupAndInspect();
    const manifest = path.join(backup, MANIFEST), document = JSON.parse(fs.readFileSync(manifest, "utf8"));
    const changedBytes = Buffer.from([4, 3, 2]);
    fs.writeFileSync(path.join(backup, BOX, ".opaque.bin"), changedBytes);
    const declared = document.files.find((file: { path: string }) => file.path === `${BOX}/.opaque.bin`);
    declared.sha256 = createHash("sha256").update(changedBytes).digest("hex");
    fs.writeFileSync(manifest, `${JSON.stringify(document)}\n`);
    // The replacement is self-consistent and can be inspected on its own, but
    // must not be delivered under the old server-issued inspection identity.
    expect((await post("inspect", { workspace, backup_directory: backup })).status).toBe(200);
    const target = path.join(root, "changed-package-restore");
    const response = await post("restore", { workspace, inspection_id: inspection.inspection_id, target_directory: target, confirmed: true });
    expect(response.status).not.toBe(200); expect(fs.existsSync(target)).toBe(false);
    expect(fs.readFileSync(database)).toEqual(originalDatabase);
  });
  it("does not move an inspection into a newly selected workspace", async () => {
    const { inspection } = await backupAndInspect();
    const other = path.join(root, "newly-selected-workspace"); fs.mkdirSync(other);
    fs.writeFileSync(prefs, JSON.stringify({ version: 2, recent_workspaces: [], freecad_dir: "", workspace: other }));
    const beforePrefs = fs.readFileSync(prefs), target = path.join(root, "wrong-workspace-restore");
    const response = await post("restore", { workspace: other, inspection_id: inspection.inspection_id, target_directory: target, confirmed: true });
    expect([400, 409]).toContain(response.status); expect(fs.existsSync(target)).toBe(false);
    expect(fs.readFileSync(prefs)).toEqual(beforePrefs); expect(fs.readFileSync(database)).toEqual(originalDatabase);
  });
  it("keeps the old recreate endpoint refusing despite asserted confirmation or backup proof", async () => {
    const beforePrefs = fs.readFileSync(prefs);
    const response = await app.request("/api/phoenix/database/recreate", { method: "POST",
      headers: { "content-type": "application/json", Origin: "http://localhost:49373" },
      body: JSON.stringify({ confirmed: true, backup_verified: true, proof: "untrusted-client-proof" }) });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "PHOENIX_DATABASE_RECREATE_DISABLED" });
    expect(fs.readFileSync(database)).toEqual(originalDatabase); expect(fs.readFileSync(prefs)).toEqual(beforePrefs);
    expect(fs.readFileSync(path.join(workspace, BOX, ".opaque.bin"))).toEqual(Buffer.from([0, 255, 12]));
  });
});
