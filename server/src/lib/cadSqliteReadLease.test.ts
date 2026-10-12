import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { execFileSync } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";
import { openCadSqliteReadDatabase } from "./cadSqliteReadLease.js";

const roots: string[] = [];
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "desk-cad-read-lease-")); roots.push(root);
  const filename = path.join(root, "synthetic.sqlite");
  const db = new DatabaseSync(filename);
  db.exec("CREATE TABLE sample (value TEXT); INSERT INTO sample VALUES ('baseline')"); db.close();
  return { root, filename, lock: `${fs.realpathSync(filename)}.lock` };
}
function nativeWrite(filename: string) {
  const source = `
import { DatabaseSync } from "node:sqlite";
const db = new DatabaseSync(${JSON.stringify(filename)});
try {
  db.exec("UPDATE sample SET value='committed'");
  process.stdout.write(JSON.stringify({ committed: true }));
} catch (error) { process.stdout.write(JSON.stringify({ committed: false, error: error.message })); }
finally { db.close(); }
`;
  return JSON.parse(execFileSync(process.execPath, ["--input-type=module", "--eval", source], { encoding: "utf8", timeout: 5000 }));
}
afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("CAD mixed-driver read lease", () => {
  it("creates only an owned temporary sidecar, rejects writes, and closes idempotently", () => {
    const data = fixture(), bytes = fs.readFileSync(data.filename);
    const db = openCadSqliteReadDatabase(data.filename);
    expect(() => db.assertLeaseOwner()).not.toThrow();
    expect(fs.statSync(data.lock).isDirectory()).toBe(true);
    expect(db.prepare("SELECT * FROM sample").get()).toMatchObject({ value: "baseline" });
    expect(() => db.exec("UPDATE sample SET value='forbidden'")).toThrow(/read.?only/i);
    db.close(); db.close();
    expect(() => db.assertLeaseOwner()).toThrow(/already closed/);
    expect(fs.existsSync(data.lock)).toBe(false);
    expect(fs.readFileSync(data.filename)).toEqual(bytes);
  });

  it("refuses an existing owner without deleting or modifying its lock", () => {
    const data = fixture(); fs.mkdirSync(data.lock);
    const owner = fs.statSync(data.lock);
    expect(() => openCadSqliteReadDatabase(data.filename)).toThrow(/busy/i);
    expect(fs.statSync(data.lock).ino).toBe(owner.ino);
  });

  it("releases its lease after SQLite rejects malformed content", () => {
    const data = fixture();
    fs.writeFileSync(data.filename, "not a SQLite database");
    expect(() => openCadSqliteReadDatabase(data.filename)).toThrow(/not a database/i);
    expect(fs.existsSync(data.lock)).toBe(false);
  });

  it("releases its lease when the native read-only open fails after the location check", () => {
    const data = fixture(), close = fs.closeSync;
    vi.spyOn(fs, "closeSync").mockImplementationOnce(descriptor => {
      close(descriptor);
      fs.unlinkSync(data.filename);
    });
    expect(() => openCadSqliteReadDatabase(data.filename)).toThrow(/unable to open/i);
    expect(fs.existsSync(data.lock)).toBe(false);
  });

  it.skipIf(process.platform === "win32")("refuses a FIFO swapped in at header open without blocking", () => {
    const data = fixture(), open = fs.openSync;
    vi.spyOn(fs, "openSync").mockImplementationOnce(((filename: fs.PathLike, flags: number) => {
      fs.renameSync(data.filename, path.join(data.root, "displaced.sqlite"));
      execFileSync("mkfifo", [data.filename], { timeout: 5000 });
      expect(flags & fs.constants.O_NONBLOCK).not.toBe(0);
      expect(flags & fs.constants.O_NOFOLLOW).not.toBe(0);
      return open(filename, flags);
    }) as typeof fs.openSync);
    expect(() => openCadSqliteReadDatabase(data.filename)).toThrow(/identity changed before header/);
    expect(fs.existsSync(data.lock)).toBe(false);
    expect(fs.lstatSync(data.filename).isFIFO()).toBe(true);
  });

  it("refuses database identity changes during lease acquisition and releases its own lock", () => {
    const data = fixture(), mkdir = fs.mkdirSync;
    vi.spyOn(fs, "mkdirSync").mockImplementation(((directory: fs.PathLike, options?: fs.MakeDirectoryOptions) => {
      const result = mkdir(directory, options);
      if (String(directory) === data.lock) {
        const displaced = path.join(data.root, "displaced.sqlite");
        fs.renameSync(data.filename, displaced); fs.copyFileSync(displaced, data.filename);
      }
      return result;
    }) as typeof fs.mkdirSync);
    expect(() => openCadSqliteReadDatabase(data.filename)).toThrow(/changed while acquiring/);
    expect(fs.existsSync(data.lock)).toBe(false);
  });

  it("releases its lease after query setup failure", () => {
    const data = fixture();
    vi.spyOn(DatabaseSync.prototype, "exec").mockImplementation(() => { throw new Error("synthetic setup failure"); });
    expect(() => openCadSqliteReadDatabase(data.filename)).toThrow("synthetic setup failure");
    expect(fs.existsSync(data.lock)).toBe(false);
  });

  it("retains its lease on close failure and permits a successful close retry", () => {
    const data = fixture(), db = openCadSqliteReadDatabase(data.filename);
    const close = vi.spyOn(DatabaseSync.prototype, "close").mockImplementationOnce(() => { throw new Error("synthetic close failure"); });
    expect(() => db.close()).toThrow("synthetic close failure");
    expect(fs.existsSync(data.lock)).toBe(true);
    close.mockRestore(); db.close();
    expect(fs.existsSync(data.lock)).toBe(false);
  });

  it("rejects lock identity replacement and leaves the replacement owner intact", () => {
    const data = fixture(), db = openCadSqliteReadDatabase(data.filename);
    const displaced = path.join(data.root, "displaced-owned-lock");
    fs.renameSync(data.lock, displaced); fs.mkdirSync(data.lock);
    const replacement = fs.statSync(data.lock);
    expect(() => db.assertLeaseOwner()).toThrow(/identity changed/i);
    expect(() => db.close()).toThrow(/identity changed/i);
    expect(fs.statSync(data.lock).ino).toBe(replacement.ino);
    // Only the original owner may restore its lock for a release retry.
    fs.rmdirSync(data.lock); fs.renameSync(displaced, data.lock); db.close();
  });

  it("reports both read setup and cleanup failure instead of hiding either", () => {
    const data = fixture();
    vi.spyOn(DatabaseSync.prototype, "exec").mockImplementation(() => { throw new Error("synthetic setup failure"); });
    const rmdir = vi.spyOn(fs, "rmdirSync").mockImplementation(() => { throw new Error("synthetic release failure"); });
    let failure: unknown;
    try { openCadSqliteReadDatabase(data.filename); } catch (error) { failure = error; }
    expect(failure).toBeInstanceOf(AggregateError);
    expect((failure as AggregateError).errors.map(error => error.message)).toEqual(["synthetic setup failure", "synthetic release failure"]);
    expect(fs.existsSync(data.lock)).toBe(true);
    rmdir.mockRestore();
  });

  it("rejects symlink databases, symlink lock owners, and native WAL layouts", () => {
    const data = fixture(), alias = path.join(data.root, "alias.sqlite");
    fs.symlinkSync(data.filename, alias);
    expect(() => openCadSqliteReadDatabase(alias)).toThrow(/unsafe/);
    fs.symlinkSync(data.root, data.lock);
    expect(() => openCadSqliteReadDatabase(data.filename)).toThrow(/busy/);
    expect(fs.lstatSync(data.lock).isSymbolicLink()).toBe(true);
    fs.unlinkSync(data.lock);
    const native = new DatabaseSync(data.filename); native.exec("PRAGMA journal_mode=WAL"); native.close();
    const files = fs.readdirSync(data.root), bytes = fs.readFileSync(data.filename);
    expect(() => openCadSqliteReadDatabase(data.filename)).toThrow(/journal layout|WAL layout/);
    expect(fs.existsSync(data.lock)).toBe(false);
    expect(fs.readdirSync(data.root)).toEqual(files);
    expect(fs.readFileSync(data.filename)).toEqual(bytes);
  });

  it("also holds SQLite OS read locks against an independent native rollback writer", () => {
    const data = fixture(), db = openCadSqliteReadDatabase(data.filename);
    expect(db.prepare("SELECT * FROM sample").get()).toMatchObject({ value: "baseline" });
    expect(nativeWrite(data.filename)).toMatchObject({ committed: false, error: expect.stringMatching(/locked|busy/i) });
    expect(db.prepare("SELECT * FROM sample").get()).toMatchObject({ value: "baseline" });
    db.close(); expect(nativeWrite(data.filename)).toEqual({ committed: true });
  });

  it("proves native-only WAL snapshots separately without claiming WASM/WAL support", () => {
    const data = fixture(), db = new DatabaseSync(data.filename);
    try {
      db.exec("PRAGMA journal_mode=WAL; PRAGMA cache_size=1; BEGIN");
      expect(db.prepare("SELECT * FROM sample").get()).toMatchObject({ value: "baseline" });
      expect(nativeWrite(data.filename)).toEqual({ committed: true });
      expect(db.prepare("SELECT * FROM sample").get()).toMatchObject({ value: "baseline" });
      db.exec("COMMIT");
      expect(db.prepare("SELECT * FROM sample").get()).toMatchObject({ value: "committed" });
    } finally { db.close(); }
    expect(() => openCadSqliteReadDatabase(data.filename)).toThrow(/journal layout|WAL layout/);
  });
});
