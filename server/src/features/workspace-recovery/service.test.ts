import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createWorkspaceRecoveryService, workspaceRecoveryFailure, WorkspaceRecoveryRequestError } from "./service.js";
import { createWorkspaceRecoveryBackup, createWorkspaceRecoveryEngine, inspectWorkspaceRecoveryBackup,
  restoreWorkspaceRecoveryBackup, WORKSPACE_BACKUP_MANIFEST, WORKSPACE_RESTORE_MARKER, type WorkspaceRecoveryManifest } from "./recovery.js";

let root: string;
const DB = ".phoenix/phoenix-workspace.sqlite";
beforeEach(() => { root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "desk-recovery-service-"))); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); fs.rmSync(root, { recursive: true, force: true }); });
function fixture() {
  const workspace = path.join(root, "workspace"), backupDirectory = path.join(root, "package"), target = path.join(root, "restored");
  fs.mkdirSync(path.join(workspace, ".phoenix/outbox/empty"), { recursive: true });
  const db = new DatabaseSync(path.join(workspace, DB));
  try { db.exec("CREATE TABLE independent_manual(note TEXT,opaque BLOB); INSERT INTO independent_manual VALUES ('independent manual field',X'00FF17'); CREATE TABLE phoenix_meta(key TEXT,value TEXT); INSERT INTO phoenix_meta VALUES ('schema_version','13');"); }
  finally { db.close(); }
  fs.writeFileSync(path.join(workspace, ".phoenix/outbox/opaque.bin"), new Uint8Array([0, 3, 255]));
  return { workspace, backupDirectory, target, bytes: fs.readFileSync(path.join(workspace, DB)) };
}
async function prepared() { const file = fixture(); await createWorkspaceRecoveryBackup({ workspace: file.workspace, destinationDirectory: file.backupDirectory }); return file; }
function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }
function service(workspace: string, overrides: Parameters<typeof createWorkspaceRecoveryService>[0] = {}) { return createWorkspaceRecoveryService({ currentWorkspace: () => workspace, ...overrides }); }
const marker = (directory: string) => fs.existsSync(path.join(directory, WORKSPACE_RESTORE_MARKER));

describe("host-bound workspace recovery sessions", () => {
  it("returns only bounded inspection metadata and restores byte-exact data with a server-bound fingerprint", async () => {
    const file = await prepared(), api = service(file.workspace), result = await api.inspect(file.workspace, file.backupDirectory);
    expect(Object.keys(result).sort()).toEqual(["inspection_id", "expires_at", "backup_directory", "manifest_sha256", "file_count", "total_bytes", "directory_count", "database_schema_version"].sort());
    expect(result.inspection_id).toMatch(/^[a-f0-9-]{36}$/); expect(result.expires_at).toMatch(/Z$/);
    expect(result.manifest_sha256).toBe(createHash("sha256").update(fs.readFileSync(path.join(file.backupDirectory, WORKSPACE_BACKUP_MANIFEST))).digest("hex"));
    expect(result).toMatchObject({ file_count: 2, directory_count: 3, database_schema_version: 13 });
    expect(await api.restore(file.workspace, result.inspection_id, file.target, true)).toMatchObject({ receipt: { workspace: file.target, fileCount: 2, warnings: [] } });
    expect(fs.readFileSync(path.join(file.target, DB))).toEqual(file.bytes);
    await expect(api.restore(file.workspace, result.inspection_id, path.join(root, "retry"), true)).rejects.toMatchObject({ status: 410 });
  });
  it("does not access a body-selected noncurrent directory before rejecting it", async () => {
    const file = fixture(), inspect = vi.fn(inspectWorkspaceRecoveryBackup), backup = vi.fn(createWorkspaceRecoveryBackup), api = service(file.workspace, { inspect, backup });
    const foreign = path.join(root, "does-not-exist");
    await expect(api.inspect(foreign, foreign)).rejects.toMatchObject({ status: 409, code: "workspace_conflict" });
    await expect(api.backup(foreign, path.join(root, "new"), true)).rejects.toMatchObject({ status: 409 });
    expect(inspect).not.toHaveBeenCalled(); expect(backup).not.toHaveBeenCalled(); expect(fs.existsSync(foreign)).toBe(false);
  });
  it("reads the default host workspace from isolated preferences without initializing anything", async () => {
    const file = await prepared(), prefs = path.join(root, "host-data"); fs.mkdirSync(prefs); fs.writeFileSync(path.join(prefs, "launcher-prefs.json"), JSON.stringify({ workspace: file.workspace }));
    vi.stubEnv("PHOENIX_USER_DATA_DIR", prefs); const api = createWorkspaceRecoveryService();
    expect((await api.inspect(file.workspace, file.backupDirectory)).file_count).toBe(2);
    expect(fs.readdirSync(prefs)).toEqual(["launcher-prefs.json"]);
  });
  it("requires explicit confirmation before starting any write", async () => {
    const file = fixture(), backup = vi.fn(createWorkspaceRecoveryBackup), api = service(file.workspace, { backup });
    await expect(api.backup(file.workspace, path.join(root, "new"), false)).rejects.toMatchObject({ status: 400 }); expect(backup).not.toHaveBeenCalled();
  });
  it("rejects unknown, fabricated and restarted handles without invoking restore", async () => {
    const file = await prepared(), api = service(file.workspace), result = await api.inspect(file.workspace, file.backupDirectory), restarted = service(file.workspace);
    await expect(restarted.restore(file.workspace, result.inspection_id, file.target, true)).rejects.toMatchObject({ status: 410 });
    await expect(api.restore(file.workspace, "fake", file.target, true)).rejects.toMatchObject({ status: 400 }); expect(fs.existsSync(file.target)).toBe(false);
  });
  it("rejects a handle from another workspace and permits mapping-only release after a host switch", async () => {
    const file = await prepared(), other = path.join(root, "other"); fs.mkdirSync(other); let selected = file.workspace;
    const api = service(file.workspace, { currentWorkspace: () => selected }), info = await api.inspect(file.workspace, file.backupDirectory); selected = other;
    await expect(api.restore(other, info.inspection_id, file.target, true)).rejects.toMatchObject({ status: 409 });
    fs.renameSync(file.workspace, `${file.workspace}-moved`);
    expect(api.release(file.workspace, info.inspection_id)).toEqual({ released: true });
  });
  it("bounds cached and reserved inspections to four", async () => {
    const file = await prepared(), api = service(file.workspace), results = [];
    for (let i = 0; i < 4; i++) results.push(await api.inspect(file.workspace, file.backupDirectory));
    await expect(api.inspect(file.workspace, file.backupDirectory)).rejects.toMatchObject({ status: 409, code: "inspection_limit" });
    api.release(file.workspace, results[0].inspection_id); expect((await api.inspect(file.workspace, file.backupDirectory)).file_count).toBe(2);
  });
  it("rejects parallel work immediately rather than queueing it", async () => {
    const file = await prepared(), entered = deferred(), resume = deferred();
    const api = service(file.workspace, { inspect: async (...args) => { entered.resolve(); await resume.promise; return inspectWorkspaceRecoveryBackup(...args); } });
    const first = api.inspect(file.workspace, file.backupDirectory); await entered.promise;
    await expect(api.inspect(file.workspace, file.backupDirectory)).rejects.toMatchObject({ code: "busy", status: 409 });
    await expect(api.backup(file.workspace, path.join(root, "another"), true)).rejects.toMatchObject({ code: "busy", status: 409 }); resume.resolve(); await first;
  });
  it("expires inspection handles after ten minutes and frees capacity", async () => {
    const file = await prepared(); let now = 1000; const api = service(file.workspace, { now: () => now }), info = await api.inspect(file.workspace, file.backupDirectory);
    now += 600_000; await expect(api.restore(file.workspace, info.inspection_id, file.target, true)).rejects.toMatchObject({ status: 410 });
    expect((await api.inspect(file.workspace, file.backupDirectory)).file_count).toBe(2); expect(fs.existsSync(file.target)).toBe(false);
  });
  it("does not retain a completed inspect request signal as the later restore cancellation source", async () => {
    const file = await prepared(), controller = new AbortController(), api = service(file.workspace), info = await api.inspect(file.workspace, file.backupDirectory, controller.signal);
    controller.abort(); expect((await api.restore(file.workspace, info.inspection_id, file.target, true)).receipt.workspace).toBe(file.target);
  });
  it.each(["same", "child", "parent"])("rejects a %s current-workspace restore target before consuming a valid handle", async kind => {
    const file = await prepared(), api = service(file.workspace), info = await api.inspect(file.workspace, file.backupDirectory);
    const destination = kind === "same" ? file.workspace : kind === "child" ? path.join(file.workspace, "new") : root;
    await expect(api.restore(file.workspace, info.inspection_id, destination, true)).rejects.toMatchObject({ code: "workspace_conflict" });
    expect(api.release(file.workspace, info.inspection_id)).toEqual({ released: true });
  });
  it("consumes a restore attempt even when a target conflict fails", async () => {
    const file = await prepared(), api = service(file.workspace), info = await api.inspect(file.workspace, file.backupDirectory); fs.mkdirSync(file.target);
    await expect(api.restore(file.workspace, info.inspection_id, file.target, true)).rejects.toMatchObject({ status: 409 });
    await expect(api.restore(file.workspace, info.inspection_id, path.join(root, "another"), true)).rejects.toMatchObject({ status: 410 });
  });
  it("rejects an independently valid but changed package fingerprint before making a target", async () => {
    const file = await prepared(), api = service(file.workspace), info = await api.inspect(file.workspace, file.backupDirectory);
    const name = path.join(file.backupDirectory, WORKSPACE_BACKUP_MANIFEST), data = JSON.parse(fs.readFileSync(name, "utf8")) as WorkspaceRecoveryManifest;
    const payload = data.files.find(item => item.path.endsWith("opaque.bin"))!; const bytes = new Uint8Array([1, 7, 8]); fs.writeFileSync(path.join(file.backupDirectory, payload.path), bytes);
    payload.sha256 = createHash("sha256").update(bytes).digest("hex"); fs.writeFileSync(name, `${JSON.stringify(data)}\n`);
    await expect(inspectWorkspaceRecoveryBackup(file.backupDirectory)).resolves.toMatchObject({ fileCount: 2 });
    await expect(api.restore(file.workspace, info.inspection_id, file.target, true)).rejects.toMatchObject({ code: "source_changed", status: 409 }); expect(fs.existsSync(file.target)).toBe(false);
  });
  it("binds the inspection to the original workspace inode rather than only its pathname", async () => {
    const file = await prepared(), api = service(file.workspace), info = await api.inspect(file.workspace, file.backupDirectory);
    fs.renameSync(file.workspace, `${file.workspace}-old`); fs.mkdirSync(file.workspace);
    await expect(api.restore(file.workspace, info.inspection_id, file.target, true)).rejects.toMatchObject({ code: "workspace_conflict" }); expect(fs.existsSync(file.target)).toBe(false);
  });
  it("rejects a replaced package directory identity before restoring", async () => {
    const file = await prepared(), api = service(file.workspace), info = await api.inspect(file.workspace, file.backupDirectory);
    fs.renameSync(file.backupDirectory, `${file.backupDirectory}-old`); fs.mkdirSync(file.backupDirectory);
    await expect(api.restore(file.workspace, info.inspection_id, file.target, true)).rejects.toMatchObject({ code: "source_changed" }); expect(fs.existsSync(file.target)).toBe(false);
  });
  it.each(["release", "expire", "dispose", "abort", "switch"])("stops the completion marker when %s happens during an awaited restore", async event => {
    const file = await prepared(), entered = deferred(), resume = deferred(), controller = new AbortController(); let now = 1000, selected = file.workspace;
    const other = path.join(root, "other"); fs.mkdirSync(other);
    const engine = createWorkspaceRecoveryEngine({ beforeCompletion: async kind => { if (kind === "restore") { entered.resolve(); await resume.promise; } } });
    const api = service(file.workspace, { restore: engine.restoreWorkspaceRecoveryBackup, now: () => now, currentWorkspace: () => selected }), info = await api.inspect(file.workspace, file.backupDirectory);
    const running = api.restore(file.workspace, info.inspection_id, file.target, true, controller.signal); const rejected = expect(running).rejects.toMatchObject({ code: event === "expire" ? "expired" : event === "switch" ? "workspace_conflict" : "cancelled", incompleteDirectory: file.target });
    await entered.promise;
    if (event === "release") api.release(file.workspace, info.inspection_id); else if (event === "expire") now += 600_000; else if (event === "dispose") api.dispose(); else if (event === "abort") controller.abort(); else selected = other;
    resume.resolve(); await rejected; expect(marker(file.target)).toBe(false); expect(fs.existsSync(file.target)).toBe(true);
  });
  it("keeps a published receipt even if disposal happens after the engine has published", async () => {
    const file = await prepared(); let api: ReturnType<typeof service>;
    api = service(file.workspace, { restore: async options => { const receipt = await restoreWorkspaceRecoveryBackup(options); api.dispose(); return receipt; } });
    const info = await api.inspect(file.workspace, file.backupDirectory);
    expect((await api.restore(file.workspace, info.inspection_id, file.target, true)).receipt.workspace).toBe(file.target); expect(marker(file.target)).toBe(true);
  });
  it("passes backup host-switch cancellation through the engine and leaves an explicit incomplete target", async () => {
    const file = fixture(), other = path.join(root, "other"); fs.mkdirSync(other); let selected = file.workspace;
    const engine = createWorkspaceRecoveryEngine({ beforeCompletion: () => { selected = other; } }), api = service(file.workspace, { currentWorkspace: () => selected, backup: engine.createWorkspaceRecoveryBackup });
    await expect(api.backup(file.workspace, file.backupDirectory, true)).rejects.toMatchObject({ code: "workspace_conflict", incompleteDirectory: file.backupDirectory });
    expect(fs.existsSync(path.join(file.backupDirectory, WORKSPACE_BACKUP_MANIFEST))).toBe(false);
  });
  it("preserves bounded causes and incomplete-directory diagnostics without exposing stacks", () => {
    const failure = workspaceRecoveryFailure(new AggregateError(Array.from({ length: 20 }, () => new Error("x".repeat(2000))), "independent failure"));
    expect(failure.causes!.length).toBeLessThanOrEqual(8); expect(failure.causes!.every(text => text.length <= 512)).toBe(true); expect(JSON.stringify(failure.causes)).not.toContain("at ");
    const typed = new WorkspaceRecoveryRequestError("cancelled", 400, "cancelled", undefined, path.join(root, "incomplete")); expect(workspaceRecoveryFailure(typed)).toBe(typed);
  });
});
