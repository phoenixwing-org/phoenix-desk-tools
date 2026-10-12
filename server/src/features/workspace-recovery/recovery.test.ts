import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { execFileSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pnwCreateDb } from "@phoenix-wing/db-node";
import { PNW_WORKSPACE_SCHEMA_V13_DDL } from "@phoenix-wing/workspace-schema";
import { createHash } from "node:crypto";
import { createWorkspaceRecoveryBackup, createWorkspaceRecoveryEngine, inspectWorkspaceRecoveryBackup,
  restoreWorkspaceRecoveryBackup, WORKSPACE_BACKUP_MANIFEST, WORKSPACE_RESTORE_MARKER, WORKSPACE_RECOVERY_LIMITS,
  type WorkspaceRecoveryManifest } from "./recovery.js";

let root: string;
const DB = ".phoenix/phoenix-workspace.sqlite", BOX = ".phoenix/outbox";
beforeEach(() => { root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "desk-independent-recovery-"))); });
afterEach(() => { vi.restoreAllMocks(); fs.rmSync(root, { recursive: true, force: true }); });
function fixture(version: string | null = "77") {
  const workspace = path.join(root, "source"); fs.mkdirSync(path.join(workspace, BOX), { recursive: true });
  const database = path.join(workspace, DB), db = new DatabaseSync(database);
  try {
    db.exec("PRAGMA journal_mode=DELETE; CREATE TABLE custom_record(id INTEGER PRIMARY KEY, manual_note TEXT, opaque BLOB); CREATE INDEX custom_note_index ON custom_record(manual_note); CREATE TABLE audit_note(value TEXT); CREATE TRIGGER retain_custom_trigger AFTER UPDATE ON custom_record BEGIN INSERT INTO audit_note(value) VALUES ('independent trigger'); END;");
    db.prepare("INSERT INTO custom_record(id,manual_note,opaque) VALUES (1,?,?)").run("independent human field", new Uint8Array([0, 255, 17]));
    if (version !== null) { db.exec("CREATE TABLE phoenix_meta(key TEXT PRIMARY KEY,value TEXT)"); db.prepare("INSERT INTO phoenix_meta VALUES ('schema_version',?)").run(version); }
  } finally { db.close(); }
  fs.mkdirSync(path.join(workspace, BOX, "nested/empty"), { recursive: true });
  fs.writeFileSync(path.join(workspace, BOX, "opaque.bin"), new Uint8Array([0, 11, 255, 7]));
  fs.writeFileSync(path.join(workspace, BOX, ".hidden.txt"), "independent hidden payload");
  fs.writeFileSync(path.join(workspace, BOX, "nested/pending.json"), '{"opaque":"retained without interpretation"}');
  fs.writeFileSync(path.join(workspace, "NotIncluded.FCStd"), "not part of a database/outbox recovery package");
  return { workspace, database, bytes: fs.readFileSync(database), destinationDirectory: path.join(root, "backup"), backupDirectory: path.join(root, "backup"), destinationWorkspace: path.join(root, "restored") };
}
function rewriteManifest(directory: string, change: (data: WorkspaceRecoveryManifest) => void) {
  const filename = path.join(directory, WORKSPACE_BACKUP_MANIFEST), data = JSON.parse(fs.readFileSync(filename, "utf8")) as WorkspaceRecoveryManifest;
  change(data); fs.writeFileSync(filename, `${JSON.stringify(data)}\n`);
}
async function backup() { const file = fixture(); await createWorkspaceRecoveryBackup(file); return file; }
function observeMarkerWrite(marker: string, onWrite: (temporary: string) => void) {
  const open = fs.openSync.bind(fs), write = fs.writeSync.bind(fs); let markerFd: number | undefined, temporary = "", invoked = false;
  vi.spyOn(fs, "openSync").mockImplementation(((...args: Parameters<typeof fs.openSync>) => {
    const fd = open(...args); if (path.basename(String(args[0])).startsWith(".phoenix-recovery-marker-")) { markerFd = fd; temporary = String(args[0]); } return fd;
  }) as typeof fs.openSync);
  vi.spyOn(fs, "writeSync").mockImplementation(((...args: Parameters<typeof fs.writeSync>) => {
    const result = Reflect.apply(write, fs, args);
    if (args[0] === markerFd && !invoked) { invoked = true; onWrite(temporary); }
    return result;
  }) as typeof fs.writeSync);
  return () => markerFd;
}
function replaceLease(filename: string) {
  fs.renameSync(`${filename}.lock`, `${filename}.saved-lock`);
  fs.mkdirSync(`${filename}.lock`); fs.writeFileSync(`${filename}.lock/owner`, "independent replacement owner");
}
const temporaryMarkers = () => fs.readdirSync(root).filter(name => name.startsWith(".phoenix-recovery-marker-"));

describe("bounded raw database and opaque outbox recovery", () => {
  it("accepts a server-bound hash of the exact canonical manifest bytes", async () => {
    const file = await backup(), expectedManifestSha256 = createHash("sha256").update(fs.readFileSync(path.join(file.backupDirectory, WORKSPACE_BACKUP_MANIFEST))).digest("hex");
    await expect(restoreWorkspaceRecoveryBackup({ ...file, expectedManifestSha256 })).resolves.toMatchObject({ workspace: file.destinationWorkspace });
    expect(fs.readFileSync(path.join(file.destinationWorkspace, DB))).toEqual(file.bytes);
  });
  it.each(["0".repeat(64), "sha256:invalid"])("rejects a mismatched server-bound fingerprint before target creation: %s", async expectedManifestSha256 => {
    const file = await backup(); await expect(restoreWorkspaceRecoveryBackup({ ...file, expectedManifestSha256 })).rejects.toMatchObject({ code: "source_changed" });
    expect(fs.existsSync(file.destinationWorkspace)).toBe(false);
  });
  it.each(["backup", "restore"] as const)("honors the final server lifecycle hook for %s immediately before marker publication", async mode => {
    const file = mode === "restore" ? await backup() : fixture(); let lastBoundary = false;
    // Invalidate only after the complete temporary marker has been written.
    // The earlier pre-copy/pre-marker activity checks have already passed.
    observeMarkerWrite(mode === "backup" ? WORKSPACE_BACKUP_MANIFEST : WORKSPACE_RESTORE_MARKER, () => { lastBoundary = true; });
    const engine = createWorkspaceRecoveryEngine();
    const assertActive = () => { if (lastBoundary) throw new Error("independent inactive lifecycle"); };
    const running = mode === "backup" ? engine.createWorkspaceRecoveryBackup({ ...file, assertActive }) : engine.restoreWorkspaceRecoveryBackup({ ...file, assertActive });
    const directory = mode === "backup" ? file.backupDirectory : file.destinationWorkspace;
    await expect(running).rejects.toMatchObject({ incompleteDirectory: directory });
    expect(lastBoundary).toBe(true); expect(temporaryMarkers()).toEqual([]);
    expect(fs.existsSync(path.join(directory, mode === "backup" ? WORKSPACE_BACKUP_MANIFEST : WORKSPACE_RESTORE_MARKER))).toBe(false);
  });
  it("round trips the actual Wing v13 DDL created through its WASM writer without rebuilding any bytes", async () => {
    const file = fixture(null); fs.unlinkSync(file.database);
    const db = pnwCreateDb(file.database);
    try {
      db.exec(PNW_WORKSPACE_SCHEMA_V13_DDL); db.run("INSERT INTO phoenix_meta(key,value) VALUES ('schema_version','13')");
      db.exec("CREATE TABLE independent_manual(note TEXT, opaque BLOB)");
      db.run("INSERT INTO independent_manual(note,opaque) VALUES (?,?)", ["independent manual field", new Uint8Array([0, 255, 3])]);
    } finally { db.close(); }
    const bytes = fs.readFileSync(file.database);
    const receipt = await createWorkspaceRecoveryBackup(file); expect(receipt.databaseSchemaVersion).toBe(13);
    expect((await inspectWorkspaceRecoveryBackup(file.backupDirectory)).databaseSchemaVersion).toBe(13);
    await restoreWorkspaceRecoveryBackup(file);
    expect(fs.readFileSync(path.join(file.backupDirectory, DB))).toEqual(bytes);
    expect(fs.readFileSync(path.join(file.destinationWorkspace, DB))).toEqual(bytes);
    const restored = new DatabaseSync(path.join(file.destinationWorkspace, DB), { readOnly: true });
    try { expect(restored.prepare("SELECT note,hex(opaque) AS opaque FROM independent_manual").get()).toEqual({ note: "independent manual field", opaque: "00FF03" }); }
    finally { restored.close(); }
  });
  it("round trips future schema, unknown tables/indexes/triggers/manual fields and every opaque/hidden/empty outbox item", async () => {
    const file = fixture(), sourceBefore = fs.statSync(file.database);
    const receipt = await createWorkspaceRecoveryBackup(file), manifest = await inspectWorkspaceRecoveryBackup(file.destinationDirectory);
    expect(receipt).toMatchObject({ backupDirectory: file.destinationDirectory, databaseSchemaVersion: 77, fileCount: 4, warnings: [] });
    expect(manifest.directories).toEqual([".phoenix", BOX, `${BOX}/nested`, `${BOX}/nested/empty`]);
    expect(manifest.files.every(entry => /^[a-f0-9]{64}$/.test(entry.sha256))).toBe(true);
    expect(JSON.stringify(manifest)).not.toContain(root); expect(JSON.stringify(manifest)).not.toContain("source");
    expect(fs.readFileSync(path.join(file.destinationDirectory, DB))).toEqual(file.bytes);
    const restored = await restoreWorkspaceRecoveryBackup(file); expect(restored).toMatchObject({ workspace: file.destinationWorkspace, fileCount: 4, warnings: [] });
    expect(fs.readFileSync(path.join(file.destinationWorkspace, DB))).toEqual(file.bytes);
    for (const entry of manifest.files) {
      expect(fs.readFileSync(path.join(file.destinationWorkspace, entry.path))).toEqual(fs.readFileSync(path.join(file.workspace, entry.path)));
      expect(fs.statSync(path.join(file.destinationWorkspace, entry.path)).mode & 0o777).toBe(0o600);
    }
    expect(fs.statSync(file.destinationWorkspace).mode & 0o777).toBe(0o700);
    expect(fs.existsSync(path.join(file.destinationWorkspace, WORKSPACE_RESTORE_MARKER))).toBe(true);
    expect(fs.readdirSync(path.join(file.destinationWorkspace, BOX, "nested/empty"))).toEqual([]);
    expect(fs.existsSync(path.join(file.destinationWorkspace, "NotIncluded.FCStd"))).toBe(false);
    expect(fs.statSync(file.database).mtimeMs).toBe(sourceBefore.mtimeMs); expect(fs.readFileSync(file.database)).toEqual(file.bytes);
    const db = new DatabaseSync(path.join(file.destinationWorkspace, DB));
    try {
      expect(db.prepare("SELECT manual_note FROM custom_record").get()).toEqual({ manual_note: "independent human field" });
      expect(db.prepare("SELECT name FROM sqlite_master WHERE name IN ('custom_note_index','retain_custom_trigger') ORDER BY name").all())
        .toEqual([{ name: "custom_note_index" }, { name: "retain_custom_trigger" }]);
      db.exec("UPDATE custom_record SET manual_note='changed after restore' WHERE id=1");
      expect(db.prepare("SELECT value FROM audit_note").get()).toEqual({ value: "independent trigger" });
    } finally { db.close(); }
  });
  it("retains a valid SQLite database with no known meta schema without inventing a version", async () => {
    const file = fixture(null); expect((await createWorkspaceRecoveryBackup(file)).databaseSchemaVersion).toBeNull();
    expect((await inspectWorkspaceRecoveryBackup(file.destinationDirectory)).databaseSchemaVersion).toBeNull();
  });
  it.each(["missing", "legacy", "empty", "not-sqlite"])("rejects %s database without initialization", async kind => {
    const file = fixture(); fs.unlinkSync(file.database);
    if (kind === "legacy") fs.writeFileSync(path.join(file.workspace, ".phoenix/auto-cad.sqlite"), file.bytes);
    if (kind === "empty") fs.writeFileSync(file.database, "");
    if (kind === "not-sqlite") fs.writeFileSync(file.database, "x".repeat(100));
    await expect(createWorkspaceRecoveryBackup(file)).rejects.toMatchObject({ code: kind === "empty" || kind === "not-sqlite" ? "integrity_error" : "missing_database" });
    expect(fs.existsSync(file.destinationDirectory)).toBe(false);
  });
  it.each(["wal-header", "wal-sidecar", "shm-sidecar"])("rejects %s without normalizing layout or creating missing sidecars", async kind => {
    const file = fixture();
    if (kind === "wal-header") { const db = new DatabaseSync(file.database); db.exec("PRAGMA journal_mode=WAL"); db.close(); }
    else fs.writeFileSync(`${file.database}${kind === "wal-sidecar" ? "-wal" : "-shm"}`, "independent sidecar");
    const before = fs.readdirSync(path.dirname(file.database)).sort(), bytes = fs.readFileSync(file.database);
    await expect(createWorkspaceRecoveryBackup(file)).rejects.toMatchObject({ code: "unsupported_journal" });
    expect(fs.readdirSync(path.dirname(file.database)).sort()).toEqual(before); expect(fs.readFileSync(file.database)).toEqual(bytes);
  });
  it("holds the real shared WASM/native read boundary through completion", async () => {
    const file = fixture(); let checked = false;
    const engine = createWorkspaceRecoveryEngine({ beforeCompletion() {
      expect(fs.statSync(`${file.database}.lock`).isDirectory()).toBe(true);
      const native = new DatabaseSync(file.database);
      try { expect(() => native.exec("PRAGMA busy_timeout=0; BEGIN IMMEDIATE; UPDATE custom_record SET manual_note='blocked'; COMMIT")).toThrow(/locked|busy/i); }
      finally { if (native.isTransaction) native.exec("ROLLBACK"); native.close(); }
      const wasm = pnwCreateDb(file.database);
      try { expect(() => wasm.exec("BEGIN IMMEDIATE; UPDATE custom_record SET manual_note='blocked'")).toThrow(/locked|busy/i); }
      finally { if (wasm.inTransaction) wasm.exec("ROLLBACK"); wasm.close(); }
      checked = true;
    } });
    await engine.createWorkspaceRecoveryBackup(file); expect(checked).toBe(true); expect(fs.existsSync(`${file.database}.lock`)).toBe(false);
  });
  it("does not steal or clean a pre-existing foreign lease", async () => {
    const file = fixture(); fs.mkdirSync(`${file.database}.lock`); fs.writeFileSync(`${file.database}.lock/owner`, "independent owner");
    await expect(createWorkspaceRecoveryBackup(file)).rejects.toMatchObject({ code: "busy" });
    expect(fs.readFileSync(`${file.database}.lock/owner`, "utf8")).toBe("independent owner");
  });
  it.each(["backup", "restore"])("refuses lost %s source/package lease and preserves the replacement owner", async operation => {
    const file = operation === "restore" ? await backup() : fixture();
    const database = operation === "backup" ? file.database : path.join(file.backupDirectory, DB);
    const engine = createWorkspaceRecoveryEngine({ beforeCompletion() { replaceLease(database); } });
    const destination = operation === "backup" ? file.destinationDirectory : file.destinationWorkspace;
    await expect(operation === "backup" ? engine.createWorkspaceRecoveryBackup(file) : engine.restoreWorkspaceRecoveryBackup(file))
      .rejects.toMatchObject({ code: "source_changed", incompleteDirectory: destination });
    expect(fs.readFileSync(`${database}.lock/owner`, "utf8")).toBe("independent replacement owner");
    expect(fs.existsSync(path.join(destination, operation === "backup" ? WORKSPACE_BACKUP_MANIFEST : WORKSPACE_RESTORE_MARKER))).toBe(false);
  });
  it.each(["backup", "restore"])("never replaces an existing %s destination", async operation => {
    const file = await backup(), destination = operation === "backup" ? file.destinationDirectory : file.destinationWorkspace;
    if (operation === "restore") fs.mkdirSync(destination);
    fs.writeFileSync(path.join(destination, "competitor.txt"), "independent competitor");
    await expect(operation === "backup" ? createWorkspaceRecoveryBackup(file) : restoreWorkspaceRecoveryBackup(file)).rejects.toMatchObject({ code: "conflict" });
    expect(fs.readFileSync(path.join(destination, "competitor.txt"), "utf8")).toBe("independent competitor");
  });
  it.each(["backup", "restore"])("detects concurrent unknown empty directory in %s target before marking complete", async operation => {
    const file = operation === "restore" ? await backup() : fixture();
    const engine = createWorkspaceRecoveryEngine({ beforeCompletion(kind, destination) { if (kind === operation) fs.mkdirSync(path.join(destination, BOX, "unknown-empty")); } });
    const destination = operation === "backup" ? file.destinationDirectory : file.destinationWorkspace;
    await expect(operation === "backup" ? engine.createWorkspaceRecoveryBackup(file) : engine.restoreWorkspaceRecoveryBackup(file))
      .rejects.toMatchObject({ code: "source_changed", incompleteDirectory: destination });
    expect(fs.existsSync(path.join(destination, operation === "backup" ? WORKSPACE_BACKUP_MANIFEST : WORKSPACE_RESTORE_MARKER))).toBe(false);
    expect(fs.statSync(path.join(destination, BOX, "unknown-empty")).isDirectory()).toBe(true);
  });
  it.each(["bytes", "new", "removed", "replaced-dir"])("rejects %s outbox changes and retains explicit incomplete destination", async kind => {
    const file = fixture(), engine = createWorkspaceRecoveryEngine({ beforeCompletion() {
      if (kind === "bytes") fs.writeFileSync(path.join(file.workspace, BOX, "opaque.bin"), new Uint8Array([1, 12, 254, 6]));
      if (kind === "new") fs.writeFileSync(path.join(file.workspace, BOX, "added.txt"), "added");
      if (kind === "removed") fs.unlinkSync(path.join(file.workspace, BOX, ".hidden.txt"));
      if (kind === "replaced-dir") { fs.renameSync(path.join(file.workspace, BOX, "nested/empty"), path.join(file.workspace, BOX, "moved-empty")); fs.mkdirSync(path.join(file.workspace, BOX, "nested/empty")); }
    } });
    await expect(engine.createWorkspaceRecoveryBackup(file)).rejects.toMatchObject({ code: "source_changed", incompleteDirectory: file.destinationDirectory });
    await expect(inspectWorkspaceRecoveryBackup(file.destinationDirectory)).rejects.toMatchObject({ code: "incomplete_backup" });
    expect(fs.existsSync(`${file.database}.lock`)).toBe(false);
  });
  it.each(["backup", "restore"])("honors cancellation before completing %s and preserves an incomplete target", async operation => {
    const file = operation === "restore" ? await backup() : fixture(), controller = new AbortController();
    const engine = createWorkspaceRecoveryEngine({ beforeCompletion() { controller.abort(); } });
    await expect(operation === "backup" ? engine.createWorkspaceRecoveryBackup({ ...file, signal: controller.signal }) : engine.restoreWorkspaceRecoveryBackup({ ...file, signal: controller.signal }))
      .rejects.toMatchObject({ code: "cancelled", incompleteDirectory: operation === "backup" ? file.destinationDirectory : file.destinationWorkspace });
  });
  it("honors initial and in-progress inspection cancellation without writing a marker", async () => {
    const file = await backup(), first = new AbortController(); first.abort();
    await expect(inspectWorkspaceRecoveryBackup(file.destinationDirectory, first.signal)).rejects.toMatchObject({ code: "cancelled" });
    const controller = new AbortController(), read = fs.readSync.bind(fs); let reads = 0;
    vi.spyOn(fs, "readSync").mockImplementation(((...args: Parameters<typeof fs.readSync>) => {
      const result = Reflect.apply(read, fs, args); if (++reads === 4) controller.abort(); return result;
    }) as typeof fs.readSync);
    await expect(inspectWorkspaceRecoveryBackup(file.destinationDirectory, controller.signal)).rejects.toMatchObject({ code: "cancelled" });
    expect(fs.existsSync(path.join(file.destinationDirectory, WORKSPACE_RESTORE_MARKER))).toBe(false);
  });
  it.each(["tamper", "extra", "escape", "symlink", "partial-json", "foreign-lock"])("rejects %s package before creating a restore destination", async kind => {
    const file = await backup();
    if (kind === "tamper") fs.writeFileSync(path.join(file.destinationDirectory, BOX, "opaque.bin"), new Uint8Array([4, 3, 2, 1]));
    if (kind === "extra") fs.writeFileSync(path.join(file.destinationDirectory, "unlisted.txt"), "unlisted");
    if (kind === "escape") rewriteManifest(file.destinationDirectory, data => { data.files[1].path = "../escape"; });
    if (kind === "symlink") { fs.unlinkSync(path.join(file.destinationDirectory, BOX, "opaque.bin")); fs.symlinkSync(".hidden.txt", path.join(file.destinationDirectory, BOX, "opaque.bin")); }
    if (kind === "partial-json") fs.writeFileSync(path.join(file.destinationDirectory, WORKSPACE_BACKUP_MANIFEST), '{"state":"complete"');
    if (kind === "foreign-lock") fs.mkdirSync(`${path.join(file.destinationDirectory, DB)}.lock`);
    await expect(restoreWorkspaceRecoveryBackup(file)).rejects.toBeInstanceOf(Error); expect(fs.existsSync(file.destinationWorkspace)).toBe(false);
  });
  it("rejects relative, alias, overlapping targets and absent custom parent", async () => {
    const file = fixture();
    await expect(createWorkspaceRecoveryBackup({ ...file, destinationDirectory: "relative" })).rejects.toMatchObject({ code: "invalid_arguments" });
    await expect(createWorkspaceRecoveryBackup({ ...file, destinationDirectory: path.join(file.workspace, "nested-backup") })).rejects.toMatchObject({ code: "invalid_arguments" });
    await expect(createWorkspaceRecoveryBackup({ ...file, destinationDirectory: path.join(root, "absent/new-backup") })).rejects.toMatchObject({ code: "io_error" });
    fs.symlinkSync(file.workspace, path.join(root, "alias"));
    await expect(createWorkspaceRecoveryBackup({ ...file, workspace: path.join(root, "alias") })).rejects.toMatchObject({ code: "unsafe_path" });
  });
  it.each(["opaque:stream", "CON", "nul.data", "COM1.txt", "LPT9", "trailing.", "trailing "])
    ("rejects nonportable opaque source filename %s before creating a package", async name => {
      const file = fixture(); fs.writeFileSync(path.join(file.workspace, BOX, name), "independent lexical rejection");
      await expect(createWorkspaceRecoveryBackup(file)).rejects.toMatchObject({ code: "invalid_backup" });
      expect(fs.existsSync(file.destinationDirectory)).toBe(false);
    });
  it.each(["opaque:stream", "CON", "nul.data", "COM1.txt", "LPT9", "trailing.", "trailing "])
    ("rejects nonportable manifest path segment %s before creating a restore target", async name => {
      const file = await backup(); rewriteManifest(file.backupDirectory, data => { data.files[1].path = `${BOX}/${name}`; });
      await expect(restoreWorkspaceRecoveryBackup(file)).rejects.toMatchObject({ code: "invalid_backup" });
      expect(fs.existsSync(file.destinationWorkspace)).toBe(false);
    });
  it.each(["symlink", "fifo"])("rejects %s source outbox entries without opening special content", async kind => {
    const file = fixture(), special = path.join(file.workspace, BOX, "special");
    if (kind === "symlink") fs.symlinkSync("opaque.bin", special); else execFileSync("mkfifo", [special]);
    await expect(createWorkspaceRecoveryBackup(file)).rejects.toMatchObject({ code: "unsafe_path" }); expect(fs.existsSync(file.destinationDirectory)).toBe(false);
  });
  it.each(["database", "outbox", "manifest"])("rejects oversized %s before allocating its full content", async kind => {
    const file = kind === "manifest" ? await backup() : fixture();
    const filename = kind === "database" ? file.database : kind === "outbox" ? path.join(file.workspace, BOX, "opaque.bin") : path.join(file.destinationDirectory, WORKSPACE_BACKUP_MANIFEST);
    const fd = fs.openSync(filename, "r+"); fs.ftruncateSync(fd, (kind === "database" ? WORKSPACE_RECOVERY_LIMITS.databaseBytes : kind === "outbox" ? WORKSPACE_RECOVERY_LIMITS.outboxBytes : WORKSPACE_RECOVERY_LIMITS.manifestBytes) + 1); fs.closeSync(fd);
    await expect(kind === "manifest" ? inspectWorkspaceRecoveryBackup(file.destinationDirectory) : createWorkspaceRecoveryBackup(file)).rejects.toMatchObject({ code: "resource_limit" });
  });
  it("accepts the complete legal depth-three manifest", async () => {
    const file = await backup(); expect((await inspectWorkspaceRecoveryBackup(file.backupDirectory)).files).toHaveLength(4);
  });
  it("verifies a synthetic exact-cap payload with its one real owned administrative lease exempted from the entry budget", async () => {
    // Only the database/manifest/empty backing file are real. The namespace is
    // independently constructed through bounded iterator/stat/read adapters;
    // this does not create or copy 8,191 filesystem entries.
    const file = await backup(), packageRoot = file.backupDirectory;
    const empty = path.join(root, "synthetic-empty"); fs.writeFileSync(empty, "");
    const actualLstat = fs.lstatSync.bind(fs), actualFstat = fs.fstatSync.bind(fs), actualOpen = fs.openSync.bind(fs);
    const actualClose = fs.closeSync.bind(fs), actualDirectory = fs.opendirSync.bind(fs);
    const directoryStat = fs.statSync(path.join(packageRoot, BOX)), fileStat = fs.statSync(empty);
    const fileTemplate = fs.readdirSync(packageRoot, { withFileTypes: true }).find(entry => entry.isFile())!;
    const dirTemplate = fs.readdirSync(packageRoot, { withFileTypes: true }).find(entry => entry.isDirectory())!;
    const virtualStats = new Map<string, fs.Stats>(), virtualFd = new Map<number, fs.Stats>();
    const directories = [".phoenix", BOX], files: WorkspaceRecoveryManifest["files"] = [{ path: DB, size: fs.statSync(path.join(packageRoot, DB)).size,
      sha256: createHash("sha256").update(fs.readFileSync(path.join(packageRoot, DB))).digest("hex") }];
    let inode = 1_000_000;
    const entry = (name: string, directory: boolean): fs.Dirent => Object.assign(Object.create(Object.getPrototypeOf(directory ? dirTemplate : fileTemplate)), directory ? dirTemplate : fileTemplate, { name });
    const boxEntries: fs.Dirent[] = [];
    for (let i = 0; i < 4093; i++) {
      const rel = `${BOX}/directory-${i}`; directories.push(rel); boxEntries.push(entry(`directory-${i}`, true));
      virtualStats.set(path.join(packageRoot, rel), Object.assign(Object.create(Object.getPrototypeOf(directoryStat)), directoryStat, { ino: ++inode }));
    }
    for (let i = 0; i < 4095; i++) {
      const rel = `${BOX}/empty-${i}`; files.push({ path: rel, size: 0, sha256: createHash("sha256").digest("hex") }); boxEntries.push(entry(`empty-${i}`, false));
      virtualStats.set(path.join(packageRoot, rel), Object.assign(Object.create(Object.getPrototypeOf(fileStat)), fileStat, { ino: ++inode }));
    }
    directories.sort(); files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
    const document: WorkspaceRecoveryManifest = { format: "phoenix-workspace-recovery", version: 1, state: "complete", databaseSchemaVersion: 77,
      fileCount: files.length, totalBytes: files.reduce((sum, file) => sum + file.size, 0), directories, files };
    fs.writeFileSync(path.join(packageRoot, WORKSPACE_BACKUP_MANIFEST), `${JSON.stringify(document)}\n`);
    vi.spyOn(fs, "lstatSync").mockImplementation(((...args: Parameters<typeof fs.lstatSync>) => virtualStats.get(String(args[0])) ?? Reflect.apply(actualLstat, fs, args)) as typeof fs.lstatSync);
    vi.spyOn(fs, "fstatSync").mockImplementation(((...args: Parameters<typeof fs.fstatSync>) => virtualFd.get(args[0]) ?? Reflect.apply(actualFstat, fs, args)) as typeof fs.fstatSync);
    vi.spyOn(fs, "openSync").mockImplementation(((...args: Parameters<typeof fs.openSync>) => {
      const stat = virtualStats.get(String(args[0])); if (!stat?.isFile()) return actualOpen(...args);
      const fd = actualOpen(empty, fs.constants.O_RDONLY); virtualFd.set(fd, stat); return fd;
    }) as typeof fs.openSync);
    vi.spyOn(fs, "closeSync").mockImplementation(fd => { virtualFd.delete(fd); actualClose(fd); });
    let reads = 0;
    vi.spyOn(fs, "opendirSync").mockImplementation(((...args: Parameters<typeof fs.opendirSync>) => {
      const location = String(args[0]); let entries: fs.Dirent[];
      if (location === packageRoot) entries = [entry(".phoenix", true), entry(WORKSPACE_BACKUP_MANIFEST, false)];
      else if (location === path.join(packageRoot, ".phoenix")) entries = [entry("phoenix-workspace.sqlite", false), entry("outbox", true),
        ...(fs.existsSync(`${path.join(packageRoot, DB)}.lock`) ? [entry("phoenix-workspace.sqlite.lock", true)] : [])];
      else if (location === path.join(packageRoot, BOX)) entries = boxEntries;
      else if (virtualStats.get(location)?.isDirectory()) entries = [];
      else return actualDirectory(...args);
      let cursor = 0; return { readSync() { reads++; return entries[cursor++] ?? null; }, closeSync() {} } as fs.Dir;
    }) as typeof fs.opendirSync);
    expect((await inspectWorkspaceRecoveryBackup(packageRoot)).fileCount).toBe(4096);
    expect(reads).toBeGreaterThan(WORKSPACE_RECOVERY_LIMITS.entries);
    expect(fs.existsSync(`${path.join(packageRoot, DB)}.lock`)).toBe(false);
  });
  it.each(["depth", "items", "raw-string"])("bounds manifest %s before JSON parsing or a restore target is created", async kind => {
    const file = await backup();
    const bytes = kind === "depth" ? '{"nested":[[[[0]]]]}' : kind === "items" ? `{"items":[${"0,".repeat(50_000)}0]}` : `{"raw":"${"x".repeat(32_769)}"}`;
    fs.writeFileSync(path.join(file.backupDirectory, WORKSPACE_BACKUP_MANIFEST), bytes);
    const parser = vi.spyOn(JSON, "parse");
    await expect(restoreWorkspaceRecoveryBackup(file)).rejects.toMatchObject({ code: "resource_limit" });
    expect(parser).not.toHaveBeenCalled(); expect(fs.existsSync(file.destinationWorkspace)).toBe(false);
  });
  it.each(["replacement", "corruption", "cancel"])("does not publish after final marker %s", async kind => {
    const file = fixture(), marker = path.join(file.destinationDirectory, WORKSPACE_BACKUP_MANIFEST), controller = new AbortController();
    observeMarkerWrite(marker, temporary => {
      if (kind === "replacement") fs.writeFileSync(marker, "competitor marker");
      if (kind === "corruption") { const fd = fs.openSync(temporary, "r+"); fs.writeSync(fd, "X", 0, "utf8"); fs.closeSync(fd); }
      if (kind === "cancel") controller.abort();
    });
    await expect(createWorkspaceRecoveryBackup({ ...file, signal: controller.signal })).rejects.toMatchObject({ code: kind === "cancel" ? "cancelled" : "source_changed", incompleteDirectory: file.destinationDirectory });
    if (kind === "replacement") expect(fs.readFileSync(marker, "utf8")).toBe("competitor marker");
    else expect(fs.existsSync(marker)).toBe(false);
  });
  it("rejects replacement of the restore marker parent during its final write", async () => {
    const file = await backup(), marker = path.join(file.destinationWorkspace, WORKSPACE_RESTORE_MARKER);
    observeMarkerWrite(marker, () => { fs.renameSync(path.join(file.destinationWorkspace, ".phoenix"), path.join(file.destinationWorkspace, "moved-phi")); fs.mkdirSync(path.join(file.destinationWorkspace, ".phoenix")); });
    await expect(restoreWorkspaceRecoveryBackup(file)).rejects.toMatchObject({ code: "source_changed", incompleteDirectory: file.destinationWorkspace });
    expect(fs.existsSync(marker)).toBe(false); expect(fs.statSync(path.join(file.destinationWorkspace, "moved-phi")).isDirectory()).toBe(true);
  });
  it.each(["backup", "restore"])("checks %s lease ownership again after marker bytes are prepared", async operation => {
    const file = operation === "restore" ? await backup() : fixture(), destination = operation === "backup" ? file.destinationDirectory : file.destinationWorkspace;
    const database = operation === "backup" ? file.database : path.join(file.backupDirectory, DB);
    const marker = path.join(destination, operation === "backup" ? WORKSPACE_BACKUP_MANIFEST : WORKSPACE_RESTORE_MARKER);
    observeMarkerWrite(marker, () => { replaceLease(database); });
    await expect(operation === "backup" ? createWorkspaceRecoveryBackup(file) : restoreWorkspaceRecoveryBackup(file))
      .rejects.toMatchObject({ code: "source_changed", incompleteDirectory: destination });
    expect(fs.readFileSync(`${database}.lock/owner`, "utf8")).toBe("independent replacement owner");
    expect(fs.existsSync(marker)).toBe(false); expect(temporaryMarkers()).toEqual([]);
  });
  it.each(["bytes", "empty-directory"])("detects source %s mutation during final marker preparation", async kind => {
    const file = fixture(), marker = path.join(file.destinationDirectory, WORKSPACE_BACKUP_MANIFEST);
    observeMarkerWrite(marker, () => {
      if (kind === "bytes") fs.writeFileSync(path.join(file.workspace, BOX, "opaque.bin"), new Uint8Array([8, 8, 8, 8]));
      else fs.mkdirSync(path.join(file.workspace, BOX, "last-moment-empty"));
    });
    await expect(createWorkspaceRecoveryBackup(file)).rejects.toMatchObject({ code: "source_changed", incompleteDirectory: file.destinationDirectory });
    expect(fs.existsSync(marker)).toBe(false); expect(temporaryMarkers()).toEqual([]);
  });
  it.each(["backup", "restore"])("atomically refuses a competing final %s marker without replacing it", async operation => {
    const file = operation === "restore" ? await backup() : fixture(), destination = operation === "backup" ? file.destinationDirectory : file.destinationWorkspace;
    const marker = path.join(destination, operation === "backup" ? WORKSPACE_BACKUP_MANIFEST : WORKSPACE_RESTORE_MARKER), link = fs.linkSync.bind(fs);
    vi.spyOn(fs, "linkSync").mockImplementation((source, target) => { if (String(target) === marker) fs.writeFileSync(marker, "late independent competitor", { flag: "wx" }); link(source, target); });
    await expect(operation === "backup" ? createWorkspaceRecoveryBackup(file) : restoreWorkspaceRecoveryBackup(file))
      .rejects.toMatchObject({ code: "conflict", incompleteDirectory: destination });
    expect(fs.readFileSync(marker, "utf8")).toBe("late independent competitor"); expect(temporaryMarkers()).toEqual([]);
  });
  it("keeps cancellation primary while still cleaning its own temporary marker after descriptor close failure", async () => {
    const file = fixture(), marker = path.join(file.destinationDirectory, WORKSPACE_BACKUP_MANIFEST), controller = new AbortController();
    const close = fs.closeSync.bind(fs); let failedClose = false;
    const markerFd = observeMarkerWrite(marker, () => controller.abort());
    vi.spyOn(fs, "closeSync").mockImplementation(fd => { close(fd); if (fd === markerFd() && !failedClose) { failedClose = true; throw new Error("independent close failure"); } });
    await expect(createWorkspaceRecoveryBackup({ ...file, signal: controller.signal })).rejects.toMatchObject({ code: "cancelled", incompleteDirectory: file.destinationDirectory });
    expect(fs.existsSync(marker)).toBe(false); expect(temporaryMarkers()).toEqual([]); expect(failedClose).toBe(true);
  });
  it("does not publish if the prepared marker cannot be synced", async () => {
    const file = fixture(), open = fs.openSync.bind(fs), sync = fs.fsyncSync.bind(fs); let markerFd: number | undefined;
    vi.spyOn(fs, "openSync").mockImplementation(((...args: Parameters<typeof fs.openSync>) => { const fd = open(...args); if (path.basename(String(args[0])).startsWith(".phoenix-recovery-marker-")) markerFd = fd; return fd; }) as typeof fs.openSync);
    vi.spyOn(fs, "fsyncSync").mockImplementation(fd => { if (fd === markerFd) throw new Error("independent preparation fsync failure"); sync(fd); });
    await expect(createWorkspaceRecoveryBackup(file)).rejects.toMatchObject({ code: "io_error", incompleteDirectory: file.destinationDirectory });
    expect(fs.existsSync(path.join(file.destinationDirectory, WORKSPACE_BACKUP_MANIFEST))).toBe(false); expect(temporaryMarkers()).toEqual([]);
  });
  it.each(["close", "cleanup"])("returns a completed receipt with warning after post-publication marker %s failure", async kind => {
    const file = fixture(), open = fs.openSync.bind(fs), close = fs.closeSync.bind(fs), unlink = fs.unlinkSync.bind(fs); let markerFd: number | undefined;
    vi.spyOn(fs, "openSync").mockImplementation(((...args: Parameters<typeof fs.openSync>) => { const fd = open(...args); if (path.basename(String(args[0])).startsWith(".phoenix-recovery-marker-")) markerFd = fd; return fd; }) as typeof fs.openSync);
    vi.spyOn(fs, "closeSync").mockImplementation(fd => { close(fd); if (kind === "close" && fd === markerFd) { markerFd = undefined; throw new Error("independent completed close failure"); } });
    vi.spyOn(fs, "unlinkSync").mockImplementation(filename => { if (kind === "cleanup" && path.basename(String(filename)).startsWith(".phoenix-recovery-marker-")) throw new Error("independent completed cleanup failure"); unlink(filename); });
    const result = await createWorkspaceRecoveryBackup(file); expect(result.warnings.join(" ")).toMatch(/已写入|已发布/);
    expect((await inspectWorkspaceRecoveryBackup(file.backupDirectory)).fileCount).toBe(4);
  });
  it("reports marker fsync failure as a published warning rather than claiming no backup", async () => {
    const file = fixture(), open = fs.openSync.bind(fs), sync = fs.fsyncSync.bind(fs); let markerFd: number | undefined, markerSyncs = 0;
    vi.spyOn(fs, "openSync").mockImplementation(((...args: Parameters<typeof fs.openSync>) => { const fd = open(...args); if (path.basename(String(args[0])).startsWith(".phoenix-recovery-marker-")) markerFd = fd; return fd; }) as typeof fs.openSync);
    vi.spyOn(fs, "fsyncSync").mockImplementation(fd => { if (fd === markerFd && ++markerSyncs === 2) throw new Error("independent fsync failure"); sync(fd); });
    const result = await createWorkspaceRecoveryBackup(file); expect(result.warnings.join(" ")).toContain("已写入");
    expect((await inspectWorkspaceRecoveryBackup(file.destinationDirectory)).fileCount).toBe(4);
  });
});
