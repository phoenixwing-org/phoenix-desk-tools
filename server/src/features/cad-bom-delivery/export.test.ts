import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { strToU8, zipSync } from "fflate";
import { afterEach, describe, expect, it, vi } from "vitest";
import { scanCadWorkspaceIndex } from "../../lib/cadIndexScanService.js";
import { phoenixDatabasePath } from "../../lib/phoenixDatabaseService.js";
import { prepareCadBomTransfer, type PreparedCadBomTransfer } from "./snapshot.js";
import { exportPreparedCadBomTransfer } from "./export.js";

const roots: string[] = [];
const MODEL = "810.001-S-Independent.FCStd";
function directory(prefix: string) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  roots.push(root); return root;
}
async function fixture() {
  // Independent metadata-only document: no real geometry/inventory/project.
  const workspace = directory("desk-bom-export-source-"), output = directory("desk-bom-export-target-");
  const model = path.join(workspace, MODEL);
  fs.writeFileSync(model, zipSync({ "Document.xml": strToU8(`<Document><Objects><Object name="Body" type="PartDesign::Body"/></Objects><ObjectData><Object name="Body"><Properties><Property name="PartName"><String value="Independent metadata"/></Property></Properties></Object></ObjectData></Document>`) }));
  expect(await scanCadWorkspaceIndex(workspace)).toMatchObject({ files: 1, parsedFiles: 1 });
  const prepared = await prepareCadBomTransfer(workspace, { producerVersion: "0.1.0" });
  const target = path.join(output, "transfer.json");
  return { workspace, output, model, prepared, target };
}
function temps(output: string) { return fs.readdirSync(output).filter(filename => filename.startsWith(".cad-bom-export-")); }
function errors(error: unknown): string {
  return error instanceof AggregateError ? error.errors.map(errors).join(";") : error instanceof Error ? error.message : String(error);
}
async function rejected(operation: Promise<unknown>, pattern: RegExp) {
  let failure: unknown;
  try { await operation; } catch (error) { failure = error; }
  expect(failure).toBeTruthy(); expect(errors(failure)).toMatch(pattern);
}
afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("CAD BOM offline no-replace publication", () => {
  it("publishes exact prepared bytes in a separately selected directory with private permissions", async () => {
    const data = await fixture(), original = fs.readFileSync(data.model);
    const dbBefore = fs.readFileSync(phoenixDatabasePath(data.workspace));
    const link = vi.spyOn(fs, "linkSync");
    const receipt = await exportPreparedCadBomTransfer(data.workspace, data.prepared, data.target);
    expect(receipt).toEqual({ status: "created", targetPath: data.target,
      transferId: data.prepared.envelope.transferId, payloadHash: data.prepared.envelope.payloadHash,
      bytes: data.prepared.bytes.byteLength, directorySync: "synced", warnings: [] });
    expect(fs.readFileSync(data.target)).toEqual(Buffer.from(data.prepared.bytes));
    expect(fs.statSync(data.target).mode & 0o777).toBe(0o600);
    expect(link).toHaveBeenCalledTimes(1); expect(path.dirname(String(link.mock.calls[0][0]))).toBe(data.output);
    expect(temps(data.output)).toEqual([]);
    expect(fs.readFileSync(data.model)).toEqual(original);
    expect(fs.readFileSync(phoenixDatabasePath(data.workspace))).toEqual(dbBefore);
    expect(Object.isFrozen(receipt)).toBe(true); expect(Object.isFrozen(receipt.warnings)).toBe(true);
  });

  it("reuses byte-identical retry without replacing identity or using the caller's mutable copy", async () => {
    const data = await fixture(); fs.writeFileSync(data.target, data.prepared.bytes);
    const identity = fs.statSync(data.target);
    const mutable = data.prepared.bytes; mutable.fill(0);
    const link = vi.spyOn(fs, "linkSync");
    const receipt = await exportPreparedCadBomTransfer(data.workspace, data.prepared, data.target);
    expect(receipt.status).toBe("existing"); expect(receipt.warnings).toEqual([]);
    expect(fs.statSync(data.target).ino).toBe(identity.ino); expect(link).not.toHaveBeenCalled();
    expect(fs.readFileSync(data.target)).toEqual(Buffer.from(data.prepared.bytes)); expect(temps(data.output)).toEqual([]);
  });

  it("rejects a forged prepared object before invoking its byte getter or export IO", async () => {
    const data = await fixture(); let accessed = false;
    const forged: PreparedCadBomTransfer = { ...data.prepared, get bytes(): Uint8Array { accessed = true; throw new Error("caller bytes should not run"); } };
    await rejected(exportPreparedCadBomTransfer(data.workspace, forged, data.target), /本服务准备/);
    expect(accessed).toBe(false); expect(fs.readdirSync(data.output)).toEqual([]);
  });

  it.each(["different", "formatted", "directory", "symlink", "dangling"])("preserves unsafe/conflicting existing target: %s", async kind => {
    const data = await fixture();
    const original = Buffer.from(data.prepared.bytes);
    if (kind === "different") fs.writeFileSync(data.target, Buffer.from("different"));
    if (kind === "formatted") fs.writeFileSync(data.target, `${original.toString("utf8")}\n`);
    if (kind === "directory") fs.mkdirSync(data.target);
    if (kind === "symlink") { fs.writeFileSync(path.join(data.output, "referent"), original); fs.symlinkSync("referent", data.target); }
    if (kind === "dangling") fs.symlinkSync("missing", data.target);
    const identity = fs.lstatSync(data.target), existing = identity.isFile() ? fs.readFileSync(data.target) : undefined;
    await rejected(exportPreparedCadBomTransfer(data.workspace, data.prepared, data.target), /regular file|different bytes/);
    expect(fs.lstatSync(data.target).ino).toBe(identity.ino);
    if (existing) expect(fs.readFileSync(data.target)).toEqual(existing);
    expect(temps(data.output)).toEqual([]);
  });

  it("does not overwrite a competing target created at the check/link boundary", async () => {
    const data = await fixture(), competing = Buffer.from("independent competing delivery");
    await rejected(exportPreparedCadBomTransfer(data.workspace, data.prepared, data.target, {
      testHooks: { beforeLink: () => fs.writeFileSync(data.target, competing, { flag: "wx" }) },
    }), /EEXIST|exist/i);
    expect(fs.readFileSync(data.target)).toEqual(competing); expect(temps(data.output)).toEqual([]);
  });

  it("rechecks same-byte target identity before a reused receipt", async () => {
    const data = await fixture(); fs.writeFileSync(data.target, data.prepared.bytes);
    await rejected(exportPreparedCadBomTransfer(data.workspace, data.prepared, data.target, {
      testHooks: { beforeLink: () => { fs.renameSync(data.target, `${data.target}.previous`); fs.writeFileSync(data.target, data.prepared.bytes); } },
    }), /identity changed/);
    expect(fs.readFileSync(data.target)).toEqual(Buffer.from(data.prepared.bytes)); expect(temps(data.output)).toEqual([]);
  });

  it.each([false, true])("rejects source change after temp write, including same-byte existing retry=%s", async retry => {
    const data = await fixture(); if (retry) fs.writeFileSync(data.target, data.prepared.bytes);
    await rejected(exportPreparedCadBomTransfer(data.workspace, data.prepared, data.target, {
      testHooks: { beforeRevalidate: () => fs.appendFileSync(data.model, "changed") },
    }), /过期|改变/);
    expect(fs.existsSync(data.target)).toBe(retry);
    if (retry) expect(fs.readFileSync(data.target)).toEqual(Buffer.from(data.prepared.bytes));
    expect(temps(data.output)).toEqual([]); expect(fs.existsSync(`${phoenixDatabasePath(data.workspace)}.lock`)).toBe(false);
  });

  it("rejects index generation changes even when target bytes already match", async () => {
    const data = await fixture(); fs.writeFileSync(data.target, data.prepared.bytes);
    await rejected(exportPreparedCadBomTransfer(data.workspace, data.prepared, data.target, {
      testHooks: { beforeRevalidate: () => {
        const db = new DatabaseSync(phoenixDatabasePath(data.workspace));
        try { db.exec("UPDATE phoenix_cad_scan SET scan_uuid='bbbbbbbb-cccc-4ddd-8eee-ffffffffffff'"); } finally { db.close(); }
      } },
    }), /过期|改变/);
    expect(fs.readFileSync(data.target)).toEqual(Buffer.from(data.prepared.bytes)); expect(temps(data.output)).toEqual([]);
  });

  it("keeps the index read transaction held through the synchronous link action", async () => {
    const data = await fixture(), database = phoenixDatabasePath(data.workspace);
    let attempted = false;
    const receipt = await exportPreparedCadBomTransfer(data.workspace, data.prepared, data.target, {
      testHooks: { beforeLink: () => {
        expect(fs.existsSync(`${database}.lock`)).toBe(true);
        const writer = new DatabaseSync(database);
        try {
          attempted = true;
          expect(() => writer.exec("UPDATE phoenix_cad_file_asset SET part_name='Independent blocked writer'")).toThrow(/locked|busy/i);
        } finally { writer.close(); }
      } },
    });
    expect(attempted).toBe(true); expect(receipt.status).toBe("created");
    expect(fs.existsSync(`${database}.lock`)).toBe(false);
    const released = new DatabaseSync(database);
    try { expect(() => released.exec("UPDATE phoenix_cad_file_asset SET part_name='Independent released writer'")).not.toThrow(); }
    finally { released.close(); }
    expect(fs.readFileSync(data.target)).toEqual(Buffer.from(data.prepared.bytes));
  });

  it.each([false, true])("rechecks CAD files at the final link boundary, including existing retry=%s", async retry => {
    const data = await fixture(); if (retry) fs.writeFileSync(data.target, data.prepared.bytes);
    await rejected(exportPreparedCadBomTransfer(data.workspace, data.prepared, data.target, {
      testHooks: { beforeLink: () => fs.appendFileSync(data.model, "final boundary change") },
    }), /改变|过期/);
    expect(fs.existsSync(data.target)).toBe(retry); expect(temps(data.output)).toEqual([]);
    if (retry) expect(fs.readFileSync(data.target)).toEqual(Buffer.from(data.prepared.bytes));
  });

  it.each([false, true])("runs the last activity callback before the final source observation, existing retry=%s", async retry => {
    const data = await fixture(); if (retry) fs.writeFileSync(data.target, data.prepared.bytes);
    let atBoundary = false, boundaryChecks = 0;
    await rejected(exportPreparedCadBomTransfer(data.workspace, data.prepared, data.target, {
      testHooks: { beforeLink: () => { atBoundary = true; } },
      assertActive() {
        if (atBoundary && ++boundaryChecks === 2) fs.appendFileSync(data.model, "last activity boundary change");
      },
    }), /改变|过期/);
    expect(boundaryChecks).toBe(2);
    expect(fs.existsSync(data.target)).toBe(retry); expect(temps(data.output)).toEqual([]);
    if (retry) expect(fs.readFileSync(data.target)).toEqual(Buffer.from(data.prepared.bytes));
  });

  it.each([false, true])("rejects newly discovered CAD files at the final boundary, including existing retry=%s", async retry => {
    const data = await fixture(); if (retry) fs.writeFileSync(data.target, data.prepared.bytes);
    await rejected(exportPreparedCadBomTransfer(data.workspace, data.prepared, data.target, {
      testHooks: { beforeLink: () => fs.copyFileSync(data.model, path.join(data.workspace, "811.001-S-IndependentAdded.FCStd")) },
    }), /改变|过期/);
    expect(fs.existsSync(data.target)).toBe(retry); expect(temps(data.output)).toEqual([]);
  });

  it("bounds target reads when an existing file grows after its stat check", async () => {
    const data = await fixture(); fs.writeFileSync(data.target, data.prepared.bytes);
    const targetIno = fs.statSync(data.target).ino, read = fs.readSync;
    let observed = 0, grew = false;
    vi.spyOn(fs, "readSync").mockImplementation(((fd: number, buffer: Uint8Array, offset: number, length: number, position: number | null) => {
      if (fs.fstatSync(fd).ino === targetIno) {
        observed += length;
        if (!grew) { grew = true; fs.appendFileSync(data.target, Buffer.alloc(64 * 1024)); }
      }
      return read(fd, buffer, offset, length, position);
    }) as typeof fs.readSync);
    await rejected(exportPreparedCadBomTransfer(data.workspace, data.prepared, data.target), /changed during verification/);
    expect(grew).toBe(true); expect(observed).toBeLessThanOrEqual(data.prepared.bytes.byteLength + 1);
    expect(fs.statSync(data.target).size).toBe(data.prepared.bytes.byteLength + 64 * 1024); expect(temps(data.output)).toEqual([]);
  });

  it.each(["before-start", "before-revalidate", "before-link"])("supports cancellation without publication: %s", async stage => {
    const data = await fixture(); let cancelled = stage === "before-start";
    await rejected(exportPreparedCadBomTransfer(data.workspace, data.prepared, data.target, {
      assertActive() { if (cancelled) throw new Error("synthetic cancellation"); },
      testHooks: { beforeRevalidate() { if (stage === "before-revalidate") cancelled = true; }, beforeLink() { if (stage === "before-link") cancelled = true; } },
    }), /synthetic cancellation/);
    expect(fs.existsSync(data.target)).toBe(false); expect(temps(data.output)).toEqual([]);
  });

  it.each(["relative", "trailing", "dotdot", "parent-symlink"])("refuses unsafe target path: %s", async kind => {
    const data = await fixture(); let target = data.target;
    if (kind === "relative") target = "relative.json";
    if (kind === "trailing") target = `${data.output}/`;
    if (kind === "dotdot") target = `${data.output}/../transfer.json`;
    if (kind === "parent-symlink") { const alias = path.join(directory("desk-bom-export-alias-"), "alias"); fs.symlinkSync(data.output, alias); target = path.join(alias, "transfer.json"); }
    await rejected(exportPreparedCadBomTransfer(data.workspace, data.prepared, target), /absolute|basename|parent is unsafe/);
    expect(fs.readdirSync(data.output)).toEqual([]);
  });

  it("refuses a replaced parent and does not clean through the replacement directory", async () => {
    const data = await fixture(), displaced = `${data.output}-owned`;
    roots.push(displaced);
    await rejected(exportPreparedCadBomTransfer(data.workspace, data.prepared, data.target, {
      testHooks: { beforeLink: () => { fs.renameSync(data.output, displaced); fs.mkdirSync(data.output); } },
    }), /parent identity changed/);
    expect(fs.readdirSync(data.output)).toEqual([]);
    // The only retained file is our old private temporary file. Fail-closed path
    // cleanup cannot safely follow the moved parent; it reports that explicitly.
    expect(temps(displaced)).toHaveLength(1); expect(fs.existsSync(path.join(displaced, "transfer.json"))).toBe(false);
  });

  it("never unlinks a foreign replacement temporary file", async () => {
    const data = await fixture(); let replacement = "";
    await rejected(exportPreparedCadBomTransfer(data.workspace, data.prepared, data.target, {
      testHooks: { beforeRevalidate: () => {
        replacement = path.join(data.output, temps(data.output)[0]);
        fs.renameSync(replacement, `${replacement}.owned`); fs.writeFileSync(replacement, "foreign replacement");
      } },
    }), /identity changed/);
    expect(fs.readFileSync(replacement, "utf8")).toBe("foreign replacement"); expect(fs.existsSync(data.target)).toBe(false);
  });

  it("handles partial writes and refuses zero progress without a target", async () => {
    const data = await fixture(), write = fs.writeSync;
    const partial = vi.spyOn(fs, "writeSync").mockImplementation(((fd: number, bytes: Uint8Array, offset: number, length: number, position: number | null) => write(fd, bytes, offset, Math.min(31, length), position)) as typeof fs.writeSync);
    await exportPreparedCadBomTransfer(data.workspace, data.prepared, data.target);
    expect(partial.mock.calls.length).toBeGreaterThan(1); expect(fs.readFileSync(data.target)).toEqual(Buffer.from(data.prepared.bytes));
    partial.mockRestore(); fs.unlinkSync(data.target);
    vi.spyOn(fs, "writeSync").mockReturnValue(0);
    await rejected(exportPreparedCadBomTransfer(data.workspace, data.prepared, data.target), /no progress/);
    expect(fs.existsSync(data.target)).toBe(false); expect(temps(data.output)).toEqual([]);
  });

  it("cleans its temporary file when file fsync fails before publication", async () => {
    const data = await fixture();
    vi.spyOn(fs, "fsyncSync").mockImplementation(fd => { if (fs.fstatSync(fd).isFile()) throw new Error("synthetic file sync failure"); });
    await rejected(exportPreparedCadBomTransfer(data.workspace, data.prepared, data.target), /synthetic file sync failure/);
    expect(fs.existsSync(data.target)).toBe(false); expect(temps(data.output)).toEqual([]);
  });

  it("cleans its own temporary file after a file close failure and never publishes", async () => {
    const data = await fixture(), close = fs.closeSync;
    let failed = false;
    vi.spyOn(fs, "closeSync").mockImplementation(fd => {
      const temporary = temps(data.output)[0];
      const ours = temporary && fs.fstatSync(fd).ino === fs.statSync(path.join(data.output, temporary)).ino;
      close(fd);
      if (ours && !failed) { failed = true; throw new Error("synthetic temporary close failure"); }
    });
    await rejected(exportPreparedCadBomTransfer(data.workspace, data.prepared, data.target), /synthetic temporary close failure/);
    expect(failed).toBe(true); expect(fs.existsSync(data.target)).toBe(false); expect(temps(data.output)).toEqual([]);
  });

  it("preserves both the primary failure and an ownership-safe cleanup failure", async () => {
    const data = await fixture(), unlink = fs.unlinkSync;
    vi.spyOn(fs, "linkSync").mockImplementation(() => { throw new Error("synthetic link failure"); });
    vi.spyOn(fs, "unlinkSync").mockImplementation(filename => {
      if (String(filename).includes(".cad-bom-export-")) throw new Error("synthetic temporary cleanup failure");
      unlink(filename);
    });
    let failure: unknown;
    try { await exportPreparedCadBomTransfer(data.workspace, data.prepared, data.target); } catch (error) { failure = error; }
    expect(failure).toBeInstanceOf(AggregateError);
    expect(errors(failure)).toMatch(/synthetic link failure.*synthetic temporary cleanup failure/);
    expect(fs.existsSync(data.target)).toBe(false); expect(temps(data.output)).toHaveLength(1);
  });

  it("refuses asynchronous publication hooks and cleans unpublished bytes", async () => {
    const data = await fixture();
    await rejected(exportPreparedCadBomTransfer(data.workspace, data.prepared, data.target, {
      testHooks: { beforeLink: () => Promise.resolve() },
    }), /synchronous/);
    expect(fs.existsSync(data.target)).toBe(false); expect(temps(data.output)).toEqual([]);
  });

  it("reports directory sync failure as published, not as an unpublished error", async () => {
    const data = await fixture(), sync = fs.fsyncSync;
    vi.spyOn(fs, "fsyncSync").mockImplementation(fd => {
      if (fs.fstatSync(fd).isDirectory()) throw new Error("synthetic unsupported directory sync");
      sync(fd);
    });
    const receipt = await exportPreparedCadBomTransfer(data.workspace, data.prepared, data.target);
    expect(receipt).toMatchObject({ status: "created", directorySync: "failed" });
    expect(receipt.warnings.join(";")).toMatch(/created.*directory sync.*synthetic unsupported/);
    expect(fs.readFileSync(data.target)).toEqual(Buffer.from(data.prepared.bytes)); expect(temps(data.output)).toEqual([]);
  });

  it("retains a published receipt while reporting temporary unlink failure", async () => {
    const data = await fixture(), unlink = fs.unlinkSync;
    vi.spyOn(fs, "unlinkSync").mockImplementation(filename => {
      if (String(filename).includes(".cad-bom-export-")) throw new Error("synthetic unlink failure");
      unlink(filename);
    });
    const receipt = await exportPreparedCadBomTransfer(data.workspace, data.prepared, data.target);
    expect(receipt.status).toBe("created"); expect(receipt.warnings.join(";")).toMatch(/created.*temporary cleanup.*synthetic unlink/);
    expect(fs.readFileSync(data.target)).toEqual(Buffer.from(data.prepared.bytes)); expect(temps(data.output)).toHaveLength(1);
  });

  it("reports a published result if source lease close fails after publication", async () => {
    const data = await fixture(), close = DatabaseSync.prototype.close;
    let failed = false;
    vi.spyOn(DatabaseSync.prototype, "close").mockImplementation(function(this: DatabaseSync) {
      close.call(this);
      if (!failed && fs.existsSync(data.target)) { failed = true; throw new Error("synthetic source close failure"); }
    });
    const receipt = await exportPreparedCadBomTransfer(data.workspace, data.prepared, data.target);
    expect(failed).toBe(true); expect(receipt.status).toBe("created");
    expect(receipt.warnings.join(";")).toMatch(/created.*source lease cleanup.*synthetic source close/);
    expect(fs.readFileSync(data.target)).toEqual(Buffer.from(data.prepared.bytes)); expect(temps(data.output)).toEqual([]);
    // The shared lease intentionally retains ownership after a close exception.
    // Export must not silently reclaim that sidecar, nor claim publication failed.
    expect(fs.existsSync(`${phoenixDatabasePath(data.workspace)}.lock`)).toBe(true);
  });

  it("reports a published result if directory close fails without concealing file state", async () => {
    const data = await fixture(), close = fs.closeSync;
    let failed = false;
    vi.spyOn(fs, "closeSync").mockImplementation(fd => {
      const isParent = fs.fstatSync(fd).ino === fs.statSync(data.output).ino;
      close(fd);
      if (!failed && isParent && fs.existsSync(data.target)) { failed = true; throw new Error("synthetic directory close failure"); }
    });
    const receipt = await exportPreparedCadBomTransfer(data.workspace, data.prepared, data.target);
    expect(failed).toBe(true); expect(receipt.status).toBe("created");
    expect(receipt.warnings.join(";")).toMatch(/created.*directory close.*synthetic directory close/);
    expect(fs.readFileSync(data.target)).toEqual(Buffer.from(data.prepared.bytes)); expect(temps(data.output)).toEqual([]);
  });
});
