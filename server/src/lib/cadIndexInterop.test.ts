import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { strToU8, zipSync } from "fflate";
import { pnwCreateDb } from "@phoenix-wing/db-node";
import { scanCadWorkspaceIndex } from "./cadIndexScanService.js";
import { phoenixDatabasePath } from "./phoenixDatabaseService.js";
import { inspectCadIndex } from "./cadIndexStatusService.js";
import { CadIndexSearchError, searchCadIndex } from "../features/cad-index-search/service.js";
import { fileDetailXrefs, queryXrefCountsForRel, searchIncomingRefs, searchOutgoingRefs } from "./pnwBomXrefService.js";

const PART = "100.001-S-Synthetic.FCStd";
const HOST = "200.001-A-Synthetic.ASSY.FCStd";
const BASELINE_AT = "2026-01-01T00:00:00.000Z";
const COMMITTED_AT = "2026-01-02T00:00:00.000Z";
const roots: string[] = [];
const children = new Set<ChildProcess>();

// A real second process imports the same public adapter as the test. It neither
// reimplements a lease nor touches models. Messages, not elapsed time, advance it.
const WRITER = `
import fs from "node:fs";
import { pnwCreateDb } from "@phoenix-wing/db-node";
let db, filename;
process.on("message", message => {
  try {
    let value;
    if (message.command === "open") {
      filename = message.filename;
      db = pnwCreateDb(filename);
      value = { pid: process.pid, driver: import.meta.resolve("@phoenix-wing/db-node") };
    } else if (message.command === "hold") {
      if (message.spill) db.exec("PRAGMA cache_size=1; PRAGMA cache_spill=ON");
      db.exec(message.exclusive ? "BEGIN EXCLUSIVE" : "BEGIN IMMEDIATE");
      const marker = message.marker + (message.spill ? ":" + "x".repeat(96 * 1024) : "");
      db.run("UPDATE phoenix_cad_file_asset SET part_name=?, label=?", [marker, marker]);
      db.run("UPDATE phoenix_cad_bom_xref SET target_part_name=?, target_asset_label=?, rule_label=?", [marker, marker, marker]);
      db.run("UPDATE phoenix_cad_scan SET finished_at=? WHERE id=(SELECT MAX(id) FROM phoenix_cad_scan)", [message.at]);
      const journal = filename + "-journal";
      value = { transaction: db.inTransaction, lease: fs.existsSync(filename + ".lock"),
        journalHeader: fs.existsSync(journal) ? fs.readFileSync(journal).subarray(0, 8).toString("hex") : "" };
    } else if (message.command === "release") {
      db.exec(message.commit ? "COMMIT" : "ROLLBACK");
      value = { transaction: db.inTransaction };
      db.close(); db = undefined;
    } else if (message.command === "stop") {
      if (db) { if (db.inTransaction) db.exec("ROLLBACK"); db.close(); }
      process.send({ id: message.id, value: true }, () => process.disconnect());
      return;
    } else throw new Error("Unexpected interop command");
    process.send({ id: message.id, value });
  } catch (error) {
    process.send({ id: message.id, error: error instanceof Error ? error.message : String(error) });
  }
});
process.send({ id: 0, value: true });
`;

function commitBetweenReads(filename: string) {
  const loader = fileURLToPath(new URL("../../../scripts/register-local-wing.mjs", import.meta.url));
  const args = process.env.PHOENIX_WING_MODE === "local" ? ["--import", loader] : [];
  const source = `
import { pnwCreateDb } from "@phoenix-wing/db-node";
let db;
try {
  db = pnwCreateDb(${JSON.stringify(filename)});
  db.exec("BEGIN IMMEDIATE");
  db.run("UPDATE phoenix_cad_file_asset SET part_name='interleaved',label='interleaved'");
  db.run("UPDATE phoenix_cad_bom_xref SET target_part_name='interleaved',target_asset_label='interleaved',rule_label='interleaved'");
  const scan = db.get("SELECT * FROM phoenix_cad_scan WHERE id=1");
  const columns = Object.keys(scan).filter(key => key !== "id");
  scan.finished_at = ${JSON.stringify(COMMITTED_AT)};
  scan.scan_uuid = "synthetic-interleaved-scan";
  db.run("INSERT INTO phoenix_cad_scan (" + columns.join(",") + ") VALUES (" + columns.map(() => "?").join(",") + ")", columns.map(key => scan[key]));
  db.exec("COMMIT");
  process.stdout.write(JSON.stringify({ committed: true }));
} catch (error) {
  if (db?.inTransaction) db.exec("ROLLBACK");
  process.stdout.write(JSON.stringify({ committed: false, error: String(error.message || error) }));
} finally { db?.close(); }
`;
  return JSON.parse(execFileSync(process.execPath, [...args, "--input-type=module", "--eval", source], {
    cwd: fileURLToPath(new URL("../../", import.meta.url)), env: process.env, encoding: "utf8", timeout: 5000,
  }));
}

type Pending = { resolve: (value: any) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> };
async function writer(filename: string) {
  const loader = fileURLToPath(new URL("../../../scripts/register-local-wing.mjs", import.meta.url));
  const args = process.env.PHOENIX_WING_MODE === "local" ? ["--import", loader] : [];
  const child = spawn(process.execPath, [...args, "--input-type=module", "--eval", WRITER], {
    cwd: fileURLToPath(new URL("../../", import.meta.url)), env: process.env,
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  children.add(child);
  const pending = new Map<number, Pending>();
  let id = 0;
  let stderr = "";
  child.stderr?.on("data", chunk => { stderr = (stderr + String(chunk)).slice(-2000); });
  const wait = (requestId: number) => new Promise<any>((resolve, reject) => {
    // A watchdog only bounds failures; it never advances a transaction phase.
    const timer = setTimeout(() => { pending.delete(requestId); reject(new Error(`Interop IPC watchdog: ${stderr}`)); }, 5000);
    pending.set(requestId, { resolve, reject, timer });
  });
  child.on("message", (message: any) => {
    const item = pending.get(message.id);
    if (!item) return;
    pending.delete(message.id); clearTimeout(item.timer);
    if (message.error) item.reject(new Error(message.error)); else item.resolve(message.value);
  });
  const fail = (error: Error) => {
    for (const item of pending.values()) { clearTimeout(item.timer); item.reject(error); }
    pending.clear();
  };
  child.on("error", fail);
  child.on("exit", code => { children.delete(child); fail(new Error(`Interop child exited (${code}): ${stderr}`)); });
  await wait(0);
  const command = async (command: string, data: Record<string, unknown> = {}) => {
    const requestId = ++id, response = wait(requestId);
    child.send({ id: requestId, command, ...data }, error => { if (error) fail(error); });
    return response;
  };
  const opened = await command("open", { filename });
  expect(opened.pid).not.toBe(process.pid);
  expect(opened.driver).toContain(process.env.PHOENIX_WING_MODE === "local" ? "/packages/db-node/dist/" : "/@phoenix-wing/db-node/dist/");
  return { command, child };
}

async function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "desk-cad-interop-")); roots.push(root);
  fs.writeFileSync(path.join(root, PART), zipSync({ "Document.xml": strToU8(`<Document><Objects><Object name="Body" type="PartDesign::Body"/></Objects><ObjectData><Object name="Body"><Properties><Property name="PartName"><String value="Synthetic part"/></Property></Properties></Object></ObjectData></Document>`) }));
  fs.writeFileSync(path.join(root, HOST), zipSync({ "Document.xml": strToU8(`<Document><XLink file="${PART}" label="Synthetic instance"/></Document>`) }));
  expect(await scanCadWorkspaceIndex(root)).toMatchObject({ files: 2, parsedFiles: 2, scanId: 1 });
  const filename = phoenixDatabasePath(root), db = pnwCreateDb(filename);
  try {
    db.exec("BEGIN IMMEDIATE");
    db.run("UPDATE phoenix_cad_file_asset SET part_name='baseline',label='baseline'");
    db.run("UPDATE phoenix_cad_bom_xref SET target_part_name='baseline',target_asset_label='baseline',rule_label='baseline'");
    db.run("UPDATE phoenix_cad_scan SET finished_at=?", [BASELINE_AT]);
    db.run("UPDATE phoenix_cad_part_key SET part_name='Operator annotation',notes='Keep manual part notes'");
    db.run("UPDATE phoenix_cad_part_file_link SET notes='Keep manual association notes'");
    db.exec("COMMIT");
  } finally { db.close(); }
  const models = new Map([PART, HOST].map(rel => [rel, fs.readFileSync(path.join(root, rel))]));
  const manual = manualRows(filename);
  expect(manual.parts.length).toBeGreaterThan(0);
  expect(manual.links.length).toBeGreaterThan(0);
  return { root, filename, models, manual };
}

function manualRows(filename: string) {
  const db = new DatabaseSync(filename, { readOnly: true });
  try {
    return { parts: db.prepare("SELECT id,part_name,notes FROM phoenix_cad_part_key ORDER BY id").all(),
      links: db.prepare("SELECT id,part_key_id,file_asset_id,notes FROM phoenix_cad_part_file_link ORDER BY id").all() };
  } finally { db.close(); }
}
function capture<T>(read: () => T): { ok: true; value: T } | { ok: false; error: unknown } {
  try { return { ok: true, value: read() }; } catch (error) { return { ok: false, error }; }
}
function assertSqliteRefusal(error: unknown) {
  expect(error).toBeInstanceOf(Error);
  expect((error as Error).message).toMatch(/locked|busy|readonly|read.only|journal|disk I\/O|malformed|not a database|unable to open/i);
}
function assertSnapshot(root: string, marker: string, at: string, allowRefusal: boolean) {
  const status = inspectCadIndex(root);
  if (status.state === "unreadable" && allowRefusal) assertSqliteRefusal(new Error(status.message));
  else expect(status).toMatchObject({ state: "ready", totalEntries: 2, missingEntries: 0, lastScanAt: at });
  const search = capture(() => searchCadIndex(root));
  if (!search.ok) {
    expect(allowRefusal).toBe(true); expect(search.error).toBeInstanceOf(CadIndexSearchError);
    expect(search.error).toMatchObject({ code: "index_unreadable", status: 503 });
  } else {
    expect(search.value.diagnostics).toMatchObject({ state: "ready", totalEntries: 2, lastScanAt: at });
    expect(search.value.rows).toHaveLength(2);
    expect(search.value.rows.map(row => row.part_name)).toEqual([marker, marker]);
    expect(search.value.rows.map(row => row.label)).toEqual([marker, marker]);
  }
  const outgoing = capture(() => searchOutgoingRefs(root, HOST));
  if (!outgoing.ok) { expect(allowRefusal).toBe(true); assertSqliteRefusal(outgoing.error); }
  else {
    expect(outgoing.value, "A locked/recovering index must not become empty xref success").toMatchObject({ count: 1, index_state: "ready", scan_id: 1 });
    expect(outgoing.value.refs[0]).toMatchObject({ target_part_name: marker, target_asset_label: marker, rule_label: marker });
  }
  const incoming = capture(() => searchIncomingRefs(root, { rel: PART }));
  if (!incoming.ok) { expect(allowRefusal).toBe(true); assertSqliteRefusal(incoming.error); }
  else {
    expect(incoming.value).toMatchObject({ count: 1, direct_count: 1, index_state: "ready", scan_id: 1 });
    expect(incoming.value.refs[0]).toMatchObject({ target_part_name: marker, target_asset_label: marker, rule_label: marker });
  }
  const counts = capture(() => queryXrefCountsForRel(root, HOST));
  if (!counts.ok) { expect(allowRefusal).toBe(true); assertSqliteRefusal(counts.error); }
  else expect(counts.value).toMatchObject({ outgoing_count: 1, index_state: "ready", scan_id: 1 });
}

function forbidModelReads() {
  const sync = fs.readFileSync, asyncRead = fs.promises.readFile, stream = fs.createReadStream;
  const forbidden: string[] = [];
  const guard = (file: unknown) => {
    if (/\.fcstd$/i.test(String(file))) { forbidden.push(String(file)); throw new Error("Read-only index API attempted a model content read"); }
  };
  vi.spyOn(fs, "readFileSync").mockImplementation(((file: any, ...args: any[]) => { guard(file); return (sync as any)(file, ...args); }) as typeof fs.readFileSync);
  vi.spyOn(fs.promises, "readFile").mockImplementation(((file: any, ...args: any[]) => { guard(file); return (asyncRead as any)(file, ...args); }) as typeof fs.promises.readFile);
  vi.spyOn(fs, "createReadStream").mockImplementation(((file: any, ...args: any[]) => { guard(file); return (stream as any)(file, ...args); }) as typeof fs.createReadStream);
  return forbidden;
}
function fileDigests(filename: string) {
  return [filename, `${filename}-journal`].map(file => fs.existsSync(file)
    ? createHash("sha256").update(fs.readFileSync(file)).digest("hex") : null);
}
function assertPreserved(data: Awaited<ReturnType<typeof fixture>>) {
  expect(manualRows(data.filename)).toEqual(data.manual);
  for (const [rel, bytes] of data.models) expect(fs.readFileSync(path.join(data.root, rel))).toEqual(bytes);
  expect(fs.existsSync(`${data.filename}.lock`)).toBe(false);
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all([...children].map(child => new Promise<void>(resolve => {
    if (child.exitCode !== null || child.signalCode !== null) { resolve(); return; }
    child.once("exit", () => resolve()); child.kill("SIGKILL");
  })));
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("real cross-process CAD native/WASM read-only interop", () => {
  it("keeps xrefs and scan metadata in one generation when a WASM writer attempts an interleaved commit", async () => {
    const data = await fixture();
    const prepare = DatabaseSync.prototype.prepare;
    let attempt: { committed: boolean; error?: string } | undefined;
    vi.spyOn(DatabaseSync.prototype, "prepare").mockImplementation(function (this: DatabaseSync, sql: string) {
      this.exec("PRAGMA cache_size=1");
      const statement = prepare.call(this, sql);
      if (/SELECT \* FROM phoenix_cad_bom_xref\s+WHERE host_repo_rel_path/.test(sql)) {
        const all = statement.all.bind(statement);
        statement.all = ((...params: SQLInputValue[]) => {
          const result = all(...params);
          attempt = commitBetweenReads(data.filename);
          return result;
        }) as typeof statement.all;
      }
      return statement;
    });
    const result = searchOutgoingRefs(data.root, HOST);
    expect(attempt).toBeDefined();
    expect(result).toMatchObject({ count: 1, index_state: "ready", scan_id: 1 });
    expect(result.refs[0]).toMatchObject({ target_part_name: "baseline" });
    expect(attempt).toMatchObject({ committed: false });
    expect(attempt?.error).toMatch(/busy|locked/i);
    vi.restoreAllMocks();
    expect(commitBetweenReads(data.filename)).toEqual({ committed: true });
    expect(searchOutgoingRefs(data.root, HOST)).toMatchObject({ count: 1, scan_id: 2, refs: [{ target_part_name: "interleaved" }] });
    assertPreserved(data);
  });

  it("uses one leased native transaction for file detail incoming and outgoing reads", async () => {
    const data = await fixture(), exec = DatabaseSync.prototype.exec;
    let begins = 0;
    vi.spyOn(DatabaseSync.prototype, "exec").mockImplementation(function (this: DatabaseSync, sql: string) {
      if (/\bBEGIN\b/.test(sql)) begins++;
      return exec.call(this, sql);
    });
    const detail = fileDetailXrefs(data.root, HOST);
    expect(detail).toMatchObject({ scan_id: 1, index_state: "ready", outgoing: { count: 1 }, incoming: { count: 0 } });
    expect(begins).toBe(1);
    vi.restoreAllMocks(); assertPreserved(data);
  });

  it("does not turn SQLite read failure into zero xrefs and preserves a concurrent close failure", async () => {
    const data = await fixture(), prepare = DatabaseSync.prototype.prepare, close = DatabaseSync.prototype.close;
    vi.spyOn(DatabaseSync.prototype, "prepare").mockImplementation(function (this: DatabaseSync, sql: string) {
      if (/SELECT \* FROM phoenix_cad_bom_xref/.test(sql)) throw new Error("synthetic xref read failure");
      return prepare.call(this, sql);
    });
    vi.spyOn(DatabaseSync.prototype, "close").mockImplementationOnce(function (this: DatabaseSync) {
      close.call(this);
      throw new Error("synthetic xref close failure");
    });
    const outcome = capture(() => searchOutgoingRefs(data.root, HOST));
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.error).toBeInstanceOf(AggregateError);
      expect((outcome.error as AggregateError).errors.map(error => error.message)).toEqual(["synthetic xref read failure", "synthetic xref close failure"]);
    }
    // Native close reported failure: keeping the lease is intentionally safer
    // than allowing a WASM writer against a possibly still-open connection.
    expect(fs.existsSync(`${data.filename}.lock`)).toBe(true);
  });

  it("reads committed baseline during an IPC-held WASM transaction and the complete generation after commit", async () => {
    const data = await fixture(), child = await writer(data.filename);
    assertSnapshot(data.root, "baseline", BASELINE_AT, false);
    expect(await child.command("hold", { marker: "committed", at: COMMITTED_AT })).toMatchObject({ transaction: true, lease: true });
    const forbidden = forbidModelReads(), before = fileDigests(data.filename);
    assertSnapshot(data.root, "baseline", BASELINE_AT, true);
    expect(fileDigests(data.filename)).toEqual(before);
    expect(await child.command("release", { commit: true })).toMatchObject({ transaction: false });
    assertSnapshot(data.root, "committed", COMMITTED_AT, false);
    expect(forbidden).toEqual([]); vi.restoreAllMocks(); assertPreserved(data);
    await child.command("stop");
  });

  it("does not expose a rolled-back generation while a second WASM process holds an exclusive transaction", async () => {
    const data = await fixture(), child = await writer(data.filename);
    expect(await child.command("hold", { marker: "rollback-only", at: COMMITTED_AT, exclusive: true })).toMatchObject({ transaction: true, lease: true });
    const forbidden = forbidModelReads(), before = fileDigests(data.filename);
    assertSnapshot(data.root, "baseline", BASELINE_AT, true);
    expect(fileDigests(data.filename)).toEqual(before);
    await child.command("release", { commit: false });
    assertSnapshot(data.root, "baseline", BASELINE_AT, false);
    expect(forbidden).toEqual([]); vi.restoreAllMocks(); assertPreserved(data);
    await child.command("stop");
  });

  it("requires committed data or explicit refusal during live WASM cache spill, never empty xref success", async () => {
    const data = await fixture(), child = await writer(data.filename);
    const held = await child.command("hold", { marker: "uncommitted-spill", at: COMMITTED_AT, spill: true });
    expect(held).toMatchObject({ transaction: true, lease: true, journalHeader: "d9d505f920a163d7" });
    const forbidden = forbidModelReads(), before = fileDigests(data.filename);
    try {
      assertSnapshot(data.root, "baseline", BASELINE_AT, true);
      expect(fileDigests(data.filename)).toEqual(before);
      expect(forbidden).toEqual([]);
    } finally { vi.restoreAllMocks(); await child.command("release", { commit: false }); }
    assertSnapshot(data.root, "baseline", BASELINE_AT, false); assertPreserved(data);
    await child.command("stop");
  });
});
