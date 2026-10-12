import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { strToU8, zipSync } from "fflate";
import { afterEach, describe, expect, it } from "vitest";
import manifest from "../../../../package.json" with { type: "json" };
import { scanCadWorkspaceIndex } from "../../lib/cadIndexScanService.js";
import { phoenixDatabasePath } from "../../lib/phoenixDatabaseService.js";
import { prepareCadBomTransfer } from "./snapshot.js";
import { exportPreparedCadBomTransfer, type CadBomTransferExportReceipt } from "./export.js";
import { cadBomDeliveryFailure, createCadBomDeliveryService, type CadBomDeliveryService } from "./service.js";

const roots: string[] = [], services: CadBomDeliveryService[] = [];
const ID = "00000000-0000-4000-8000-000000000001";
function directory() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "desk-transfer-session-")));
  roots.push(root); return root;
}
function service(options: Parameters<typeof createCadBomDeliveryService>[0] = {}) {
  const current = createCadBomDeliveryService(options); services.push(current); return current;
}
function barrier() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve };
}
async function fixture() {
  const workspace = directory(), output = directory(), model = path.join(workspace, "Specimen.FCStd");
  // Independent metadata-only source, not a renamed engineering inventory.
  const fields = { PartNumber: "SPECIMEN", PartVersion: "A", TypeCode: "S", PartName: "Independent specimen" };
  const properties = Object.entries(fields).map(([name, value]) => `<Property name="${name}" type="App::PropertyString" group="CustomDefine"><String value="${value}"/></Property>`).join("");
  fs.writeFileSync(model, zipSync({ "Document.xml": strToU8(`<Document><Objects><Object name="Body" type="PartDesign::Body"/></Objects><ObjectData><Object name="Body"><Properties>${properties}</Properties></Object></ObjectData></Document>`) }));
  expect(await scanCadWorkspaceIndex(workspace)).toMatchObject({ files: 1, parsedFiles: 1, partial: false });
  return { workspace, output, model, database: phoenixDatabasePath(workspace), target: path.join(output, "transfer.json") };
}
afterEach(() => {
  for (const current of services.splice(0)) current.dispose();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("server-owned BOM preview sessions", () => {
  it("previews with manifest version and no source mutation, proof disclosure or outbox creation", async () => {
    const data = await fixture(), current = service();
    const before = [data.model, data.database].map(file => fs.readFileSync(file));
    const preview = await current.preview(data.workspace);
    expect(preview.preview_id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(preview.expires_at).toMatch(/T.*\.\d{3}Z$/);
    expect(preview.envelope.producer).toEqual({ id: "phoenix-desk-tools", version: manifest.version });
    expect(preview.bytes).toBe(Buffer.byteLength(JSON.stringify(preview.envelope)));
    expect(preview.suggested_filename).toBe(`phoenix-bom-${preview.envelope.transferId}.json`);
    expect(preview).not.toHaveProperty("proof"); expect(JSON.stringify(preview)).not.toContain(data.workspace);
    expect(fs.existsSync(path.join(data.workspace, ".phoenix", "outbox"))).toBe(false);
    expect([data.model, data.database].map(file => fs.readFileSync(file))).toEqual(before);
    expect(current.release(data.workspace, preview.preview_id)).toEqual({ released: true });
    await expect(current.exportPreview(data.workspace, preview.preview_id, data.target, true)).rejects.toMatchObject({ status: 410, code: "expired" });
  });

  it("creates only the validated default outbox, accepts a chosen basename and preserves retry bytes", async () => {
    const data = await fixture(), current = service(), preview = await current.preview(data.workspace);
    const target = path.join(data.workspace, ".phoenix", "outbox", "chosen-name.json");
    const before = [data.model, data.database].map(file => fs.readFileSync(file));
    const first = await current.exportPreview(data.workspace, preview.preview_id, target, true);
    expect(first.receipt).toMatchObject({ status: "created", targetPath: target, bytes: preview.bytes, warnings: [] });
    expect(fs.statSync(path.dirname(target)).mode & 0o777).toBe(0o700);
    const identity = fs.statSync(target), bytes = fs.readFileSync(target);
    expect((await current.exportPreview(data.workspace, preview.preview_id, target, true)).receipt.status).toBe("existing");
    expect(fs.statSync(target).ino).toBe(identity.ino); expect(fs.readFileSync(target)).toEqual(bytes);
    expect(fs.readdirSync(path.dirname(target))).toEqual(["chosen-name.json"]);
    expect([data.model, data.database].map(file => fs.readFileSync(file))).toEqual(before);
  });

  it("does not create any default parent when source no longer matches", async () => {
    const data = await fixture(), current = service(), preview = await current.preview(data.workspace);
    fs.appendFileSync(data.model, "source changed");
    await expect(current.exportPreview(data.workspace, preview.preview_id,
      path.join(data.workspace, ".phoenix", "outbox", preview.suggested_filename), true)).rejects.toMatchObject({ status: 409, code: "conflict" });
    expect(fs.existsSync(path.join(data.workspace, ".phoenix", "outbox"))).toBe(false);
  });

  it("does not create outbox on an unconfirmed or already-cancelled default export", async () => {
    const data = await fixture(), current = service(), preview = await current.preview(data.workspace);
    const target = path.join(data.workspace, ".phoenix", "outbox", preview.suggested_filename), abort = new AbortController(); abort.abort();
    await expect(current.exportPreview(data.workspace, preview.preview_id, target, false)).rejects.toMatchObject({ code: "invalid_arguments", status: 400 });
    await expect(current.exportPreview(data.workspace, preview.preview_id, target, true, abort.signal)).rejects.toMatchObject({ code: "cancelled", status: 400 });
    expect(fs.existsSync(path.dirname(target))).toBe(false);
  });

  it.each(["custom-missing", "outbox-symlink", "outbox-file"])("rejects unsafe/non-existing parent without broad mkdir: %s", async kind => {
    const data = await fixture(), current = service(), preview = await current.preview(data.workspace);
    const outbox = path.join(data.workspace, ".phoenix", "outbox");
    if (kind === "outbox-symlink") fs.symlinkSync(data.output, outbox);
    if (kind === "outbox-file") fs.writeFileSync(outbox, "not a directory");
    const target = kind === "custom-missing" ? path.join(data.output, "missing", "transfer.json") : path.join(outbox, "transfer.json");
    await expect(current.exportPreview(data.workspace, preview.preview_id, target, true)).rejects.toMatchObject({ status: 409 });
    expect(fs.readdirSync(data.output)).toEqual([]);
    expect(fs.existsSync(path.join(data.output, "missing"))).toBe(false);
  });

  it("requires canonical safe target, explicit confirmation and real absolute workspace before any publication", async () => {
    const data = await fixture(), current = service(), preview = await current.preview(data.workspace);
    for (const target of ["relative.json", `${data.output}/sub/../transfer.json`, `${data.output}/`, "\0"]) {
      await expect(current.exportPreview(data.workspace, preview.preview_id, target, true)).rejects.toMatchObject({ code: "invalid_arguments", status: 400 });
    }
    await expect(current.exportPreview(data.workspace, preview.preview_id, data.target, false)).rejects.toMatchObject({ status: 400 });
    for (const workspace of ["", " ", "relative", data.model, path.join(data.output, "missing")]) {
      await expect(current.preview(workspace)).rejects.toMatchObject({ code: "invalid_arguments", status: 400 });
    }
    expect(fs.readdirSync(data.output)).toEqual([]);
  });

  it("binds canonical workspace aliases, but rejects valid cross-workspace IDs and forged/unknown IDs", async () => {
    const data = await fixture(), current = service(), alias = path.join(data.output, "source-alias"); fs.symlinkSync(data.workspace, alias);
    const preview = await current.preview(alias);
    await expect(current.exportPreview(data.output, preview.preview_id, data.target, true)).rejects.toMatchObject({ code: "workspace_conflict", status: 409 });
    await expect(current.exportPreview(data.workspace, "forged-id", data.target, true)).rejects.toMatchObject({ code: "invalid_arguments", status: 400 });
    await expect(current.exportPreview(data.workspace, ID, data.target, true)).rejects.toMatchObject({ code: "expired", status: 410 });
    expect((await current.exportPreview(data.workspace, preview.preview_id, data.target, true)).receipt.status).toBe("created");
  });

  it("keeps four previews including reservations, rejects busy immediately, releases capacity", async () => {
    const data = await fixture(), entered = barrier(), finish = barrier(); let index = 0;
    const current = service({ id: () => `00000000-0000-4000-8000-${String(++index).padStart(12, "0")}`,
      prepare: async (root, options) => {
        if (index === 4) { entered.resolve(); await finish.promise; }
        return prepareCadBomTransfer(root, options);
      } });
    const first = await current.preview(data.workspace); await current.preview(data.workspace); await current.preview(data.workspace);
    const pending = current.preview(data.workspace); await entered.promise;
    await expect(current.preview(data.workspace)).rejects.toMatchObject({ code: "busy", status: 409 });
    await expect(current.exportPreview(data.workspace, first.preview_id, data.target, true)).rejects.toMatchObject({ code: "busy", status: 409 });
    finish.resolve(); await pending;
    await expect(current.preview(data.workspace)).rejects.toMatchObject({ code: "preview_limit", status: 409 });
    current.release(data.workspace, first.preview_id); expect((await current.preview(data.workspace)).preview_id).toContain("000000000005");
  });

  it("expires at the exact ten-minute boundary, frees reservations and rejects IDs after restart", async () => {
    const data = await fixture(); let now = Date.UTC(2026, 0, 1);
    const current = service({ now: () => now }), preview = await current.preview(data.workspace);
    expect(preview.expires_at).toBe(new Date(now + 600_000).toISOString()); now += 600_000;
    await expect(current.exportPreview(data.workspace, preview.preview_id, data.target, true)).rejects.toMatchObject({ code: "expired", status: 410 });
    expect((await current.preview(data.workspace)).preview_id).not.toBe(preview.preview_id);
    const restarted = service(); await expect(restarted.exportPreview(data.workspace, preview.preview_id, data.target, true)).rejects.toMatchObject({ status: 410 });
  });

  it("does not retain a completed preview request signal as a later export cancellation source", async () => {
    const data = await fixture(), current = service(), previous = new AbortController();
    const preview = await current.preview(data.workspace, previous.signal); previous.abort();
    expect((await current.exportPreview(data.workspace, preview.preview_id, data.target, true)).receipt.status).toBe("created");
  });

  it("checks release/TTL/disposal through the retained source assertion after a deterministic preparation barrier", async () => {
    const data = await fixture();
    for (const reason of ["release", "expire", "dispose"] as const) {
      const entered = barrier(), finish = barrier(); let now = 1;
      const current = service({ id: () => ID, now: () => now, prepare: async (root, options) => {
        entered.resolve(); await finish.promise; options.assertActive?.(); return prepareCadBomTransfer(root, options);
      } });
      const result = current.preview(data.workspace); await entered.promise;
      if (reason === "release") current.release(data.workspace, ID);
      if (reason === "expire") now += 600_000;
      if (reason === "dispose") current.dispose();
      finish.resolve(); await expect(result).rejects.toMatchObject({ code: reason === "expire" ? "expired" : "inactive", status: reason === "expire" ? 410 : 400 });
    }
    expect(fs.existsSync(path.join(data.workspace, ".phoenix", "outbox"))).toBe(false);
  });

  it("cleans aborted preparation and allows an independent release after active export abort", async () => {
    const data = await fixture(), entered = barrier(), finish = barrier(), controller = new AbortController();
    const current = service({ id: () => ID, prepare: async (root, options) => {
      entered.resolve(); await finish.promise; options.assertActive?.(); return prepareCadBomTransfer(root, options);
    } });
    const pending = current.preview(data.workspace, controller.signal); await entered.promise; controller.abort(); finish.resolve();
    await expect(pending).rejects.toMatchObject({ code: "cancelled", status: 400 });
    expect((await current.preview(data.workspace)).preview_id).toBe(ID);
    current.dispose();
    const exporting = barrier(), end = barrier(), exportSignal = new AbortController();
    const second = service({ publish: async (_root, _prepared, _target, options) => {
      exporting.resolve(); await end.promise; options?.assertActive?.(); throw new Error("must not publish");
    } });
    const preview = await second.preview(data.workspace), exportPromise = second.exportPreview(data.workspace, preview.preview_id, data.target, true, exportSignal.signal);
    await exporting.promise; exportSignal.abort();
    expect(second.release(data.workspace, preview.preview_id)).toEqual({ released: true });
    end.resolve(); await expect(exportPromise).rejects.toMatchObject({ code: "inactive", status: 400 });
    expect(fs.existsSync(data.target)).toBe(false);
  });

  it.each(["release", "expire", "abort", "dispose"])("observes %s at the final no-replace publication gate", async reason => {
    const data = await fixture(), signal = new AbortController(); let now = 1, id = "";
    let current!: CadBomDeliveryService;
    current = service({ now: () => now, publish: (root, prepared, target, options) => exportPreparedCadBomTransfer(root, prepared, target, {
      ...options, testHooks: { beforeLink: () => {
        if (reason === "release") current.release(data.workspace, id);
        if (reason === "expire") now += 600_000;
        if (reason === "abort") signal.abort();
        if (reason === "dispose") current.dispose();
      } },
    }) });
    id = (await current.preview(data.workspace)).preview_id;
    await expect(current.exportPreview(data.workspace, id, data.target, true, signal.signal)).rejects.toMatchObject({ status: reason === "expire" ? 410 : 400,
      code: reason === "expire" ? "expired" : reason === "abort" ? "cancelled" : "inactive" });
    expect(fs.readdirSync(data.output)).toEqual([]);
    expect(fs.existsSync(`${data.database}.lock`)).toBe(false);
  });

  it("returns already-published receipts and warnings without a post-publication cancellation override", async () => {
    const data = await fixture(), abort = new AbortController();
    const receipt: CadBomTransferExportReceipt = { status: "created", targetPath: data.target, transferId: ID, payloadHash: `sha256:${"0".repeat(64)}`,
      bytes: 1, directorySync: "failed", warnings: ["published; directory sync failed"] };
    const current = service({ publish: async () => { abort.abort(); return receipt; } });
    const preview = await current.preview(data.workspace);
    expect(await current.exportPreview(data.workspace, preview.preview_id, data.target, true, abort.signal)).toEqual({ receipt });
  });

  it("keeps failure retries alive while preserving conflicting targets", async () => {
    const data = await fixture(), current = service(), preview = await current.preview(data.workspace);
    fs.writeFileSync(data.target, "keep existing");
    await expect(current.exportPreview(data.workspace, preview.preview_id, data.target, true)).rejects.toMatchObject({ code: "conflict", status: 409 });
    expect(fs.readFileSync(data.target, "utf8")).toBe("keep existing");
    const alternate = path.join(data.output, "alternate.json");
    expect((await current.exportPreview(data.workspace, preview.preview_id, alternate, true)).receipt.status).toBe("created");
  });

  it("bounds AggregateError diagnostics and never includes stacks", () => {
    const cause = new Error("leaf", { cause: new Error("inner") });
    const failure = cadBomDeliveryFailure(new AggregateError([cause, ...Array.from({ length: 20 }, (_, i) => new Error(`${i}:${"x".repeat(800)}`))], "summary"));
    expect(failure).toMatchObject({ code: "conflict", status: 409, message: "summary" });
    expect(failure.causes).toHaveLength(8); expect(failure.causes?.every(item => item.length <= 512)).toBe(true);
    expect(JSON.stringify(failure.causes)).not.toContain(" at "); expect(Object.isFrozen(failure.causes)).toBe(true);
  });
});
