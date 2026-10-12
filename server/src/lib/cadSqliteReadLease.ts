import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";

function rejectWalHeader(filename: string, expected: fs.Stats) {
  const descriptor = fs.openSync(filename,
    fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  let readFailed = false;
  let readError: unknown;
  try {
    const opened = fs.fstatSync(descriptor);
    if (!opened.isFile() || opened.dev !== expected.dev || opened.ino !== expected.ino) {
      throw new Error("CAD index database identity changed before header read");
    }
    const header = Buffer.alloc(20);
    const length = fs.readSync(descriptor, header, 0, header.length, 0);
    // Native read-only opening a WAL database can itself create -wal/-shm.
    // Refuse the persistent header format before opening a SQLite connection.
    if (length === header.length && (header[18] === 2 || header[19] === 2)) {
      throw new Error("CAD index WAL layout is unsupported for mixed native/WASM reads");
    }
  } catch (error) { readFailed = true; readError = error; throw error; }
  finally {
    try { fs.closeSync(descriptor); }
    catch (error) {
      if (readFailed) throw new AggregateError([readError, error], "CAD index header read and descriptor close both failed");
      throw error;
    }
  }
}

/**
 * Host boundary ported from frozen Auto CAD sqliteHostLease (96b6a846).
 * node-sqlite3-wasm xLock uses mkdir(`<database>.lock`), not SQLite OS locks.
 * Native readers hold that same primitive AND a native read transaction.
 * This is business read-only, but creates a temporary sidecar directory.
 * Do not reclaim existing locks: they may belong to another process.
 */
export function openCadSqliteReadDatabase(filename: string) {
  const location = () => {
    if (fs.lstatSync(filename).isSymbolicLink() || fs.lstatSync(path.dirname(filename)).isSymbolicLink()) {
      throw new Error("CAD index database path is unsafe");
    }
    const canonical = fs.realpathSync(filename);
    const identity = fs.statSync(canonical);
    if (!identity.isFile()) throw new Error("CAD index database is not a regular file");
    return { canonical, identity };
  };
  const before = location();
  const lock = `${before.canonical}.lock`;
  try { fs.mkdirSync(lock, { mode: 0o700 }); }
  catch (error) { throw new Error("CAD index database busy: another host owns the lock or the lock directory is not writable; no lock was removed", { cause: error }); }
  const owner = fs.lstatSync(lock);
  let released = false;
  const assertOwner = () => {
    const current = fs.lstatSync(lock);
    if (current.isSymbolicLink() || !current.isDirectory() || current.ino !== owner.ino || current.dev !== owner.dev) {
      throw new Error("CAD index database lock identity changed; refusing another owner's lock");
    }
  };
  const release = () => {
    if (released) return;
    assertOwner();
    fs.rmdirSync(lock);
    released = true;
  };
  let native: DatabaseSync | undefined;
  let closed = false;
  const close = () => {
    // If native close fails, retain the lease until a successful retry. Releasing
    // it while the connection might still be alive would permit a WASM writer.
    if (native && !closed) { native.close(); closed = true; }
    release();
  };
  try {
    const after = location();
    if (after.canonical !== before.canonical || after.identity.ino !== before.identity.ino || after.identity.dev !== before.identity.dev) {
      throw new Error("CAD index database changed while acquiring its read lease");
    }
    // The WASM VFS has no shared-memory/WAL coordination. Do not imply that a
    // native-only WAL snapshot also certifies mixed native/WASM operation.
    if (fs.existsSync(`${before.canonical}-wal`) || fs.existsSync(`${before.canonical}-shm`)) {
      throw new Error("CAD index WAL layout is unsupported for mixed native/WASM reads");
    }
    rejectWalHeader(before.canonical, before.identity);
    native = new DatabaseSync(before.canonical, { readOnly: true });
    const opened = location();
    if (opened.canonical !== before.canonical || opened.identity.ino !== before.identity.ino || opened.identity.dev !== before.identity.dev) {
      throw new Error("CAD index database changed while opening");
    }
    native.exec("PRAGMA query_only=ON; BEGIN");
    // Force the native read snapshot before checking runtime layout. Native
    // writers use OS locks; the sidecar alone cannot coordinate those writers.
    native.prepare("SELECT name FROM sqlite_master LIMIT 1").get();
    const journal = native.prepare("PRAGMA journal_mode").get() as { journal_mode?: string } | undefined;
    if (journal?.journal_mode !== "delete") throw new Error("CAD index journal layout is unsupported for mixed native/WASM reads");
    assertOwner();
    return {
      assertLeaseOwner() {
        if (closed || released) throw new Error("CAD index read lease is already closed");
        assertOwner();
      },
      prepare(sql: string) { return native!.prepare(sql); },
      exec(sql: string) { native!.exec(sql); },
      function: native.function.bind(native),
      close,
    };
  } catch (error) {
    try { close(); }
    catch (cleanupError) { throw new AggregateError([error, cleanupError], "CAD index read failed and close/lease cleanup also failed"); }
    throw error;
  }
}
