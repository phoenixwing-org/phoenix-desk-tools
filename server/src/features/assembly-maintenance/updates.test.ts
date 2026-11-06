import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { strToU8, zipSync } from "fflate";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fcstdFingerprint } from "../../lib/fcstdBatchFiles.js";
import { createAssemblyUpdateService, type AssemblyNativePreviewInput, type AssemblyNativePreviewResult } from "./updates.js";
import * as baselineModule from "./baseline.js";
import * as publicationModule from "./publication.js";

// These are orchestration/IO seams, not Native acceptance. The separate manual
// proof uses the real engine, geometry and Joint/Frame preservation guards.
const group = (names: string[]) => `<Property name="Group" type="App::PropertyLinkList"><LinkList count="${names.length}">${names.map(name => `<Link value="${name}"/>`).join("")}</LinkList></Property>`;
const host = (copy = false) => `<Document><Objects><Object name="Assembly" type="Assembly::AssemblyObject"/><Object name="Sub" type="Assembly::AssemblyLink"/>${copy ? '<Object name="Copy" type="App::Link"/>' : ""}</Objects><ObjectData><Object name="Assembly"><Properties>${group(["Sub"])}</Properties></Object><Object name="Sub"><Properties>${group(copy ? ["Copy"] : [])}<Property name="Rigid" type="App::PropertyBool"><Bool value="true"/></Property><Property name="LinkedObject" type="App::PropertyXLink"><XLink file="Child.FCStd" name="Assembly"/></Property></Properties></Object>${copy ? '<Object name="Copy"><Properties><Property name="LinkedObject" type="App::PropertyXLink"><XLink file="Child.FCStd" name="Element"/></Property></Properties></Object>' : ""}</ObjectData></Document>`;
const child = `<Document><Objects><Object name="Assembly" type="Assembly::AssemblyObject"/><Object name="Element" type="Part::Box"/></Objects><ObjectData><Object name="Assembly"><Properties>${group(["Element"])}</Properties></Object><Object name="Element"><Properties/></Object></ObjectData></Document>`;
const write = (filename: string, xml: string) => fs.writeFileSync(filename, zipSync({ "Document.xml": strToU8(xml), "opaque.bin": new Uint8Array([9, 1, 4]) }));
const hash = (filename: string) => fcstdFingerprint(fs.readFileSync(filename));
let root: string;
beforeEach(() => { root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "assembly-update-io-"))); write(path.join(root, "Host.FCStd"), host()); write(path.join(root, "Child.FCStd"), child); });
afterEach(() => { vi.restoreAllMocks(); fs.rmSync(root, { recursive: true, force: true }); });
async function native(input: AssemblyNativePreviewInput): Promise<AssemblyNativePreviewResult> {
  input.phase("native_update");
  const stagedFile = path.join(input.mirrorRoot, input.baseline.hostRel); write(stagedFile, host(true));
  input.phase("native_reopen");
  return { stagedFile, nativeProof: { update: { nonce: randomUUID(), pid: 101, actual_close_observed: true, exit_code: 0, signal: null },
    reopen: { nonce: randomUUID(), pid: 102, actual_close_observed: true, exit_code: 0, signal: null } }, preview: {
    added: [{ object_name: "Copy", label: "Copy", type_id: "App::Link", parent_object: "Sub" }], removed: [], preserved_joint_count: 0,
    preserved_instance_count: 1, rigid_unchanged: true, placements_unchanged: true, joint_frames_unchanged: true,
    dependency_bytes_unchanged: true, independently_reopened: true, engine_version: "synthetic-io-port" } };
}
describe("frozen assembly update lifecycle", () => {
  it("creates only a private full mirror and publishes a confirmed copy without moving or rewriting the source", async () => {
    const before = hash(path.join(root, "Host.FCStd")), sourceDependency = hash(path.join(root, "Child.FCStd"));
    const refresh = vi.fn().mockResolvedValue(["完整递归 BOM 仍待更新"]), service = createAssemblyUpdateService({ native, refresh });
    const start = service.start(root, "Host.FCStd", ["Sub"]);
    expect(start.status).toBe("preparing"); expect(start.can_publish).toBe(false);
    const ready = await service.wait(root, start.id);
    expect(ready).toMatchObject({ status: "ready", can_publish: true, source_sha256: before });
    expect(JSON.stringify(ready)).not.toContain(root);
    expect(hash(path.join(root, "Host.FCStd"))).toBe(before);
    const result = await service.publish(root, start.id, "verified_copy", { closed: false, notReopened: false });
    expect(result).toMatchObject({ status: "published", output_rel: ready.suggested_copy_rel, can_publish: false });
    expect(hash(path.join(root, result.output_rel!))).not.toBe(before);
    expect(hash(path.join(root, "Host.FCStd"))).toBe(before); expect(hash(path.join(root, "Child.FCStd"))).toBe(sourceDependency);
    expect(refresh).toHaveBeenCalledExactlyOnceWith(root, result.output_rel);
    expect(await service.publish(root, start.id, "verified_copy", { closed: false, notReopened: false })).toEqual(result);
  });
  it("does not convert a no-difference observation to a writable plan", async () => {
    const service = createAssemblyUpdateService({ native: async input => { const result = await native(input); result.preview.added = []; return result; } });
    const job = service.start(root, "Host.FCStd", ["Sub"]), ready = await service.wait(root, job.id);
    expect(ready).toMatchObject({ status: "unchanged", can_publish: false });
    await expect(service.publish(root, job.id, "verified_copy", { closed: false, notReopened: false })).rejects.toThrow("未完成");
  });
  it("blocks a missing independent close proof or a native write to dependency mirror", async () => {
    const before = hash(path.join(root, "Host.FCStd"));
    for (const variant of ["proof", "dependency"] as const) {
      const service = createAssemblyUpdateService({ native: async input => {
        const result = await native(input);
        if (variant === "proof") result.nativeProof.reopen.actual_close_observed = false;
        else fs.appendFileSync(path.join(input.mirrorRoot, "Child.FCStd"), "changed");
        return result;
      } });
      const job = service.start(root, "Host.FCStd", ["Sub"]), failed = await service.wait(root, job.id);
      expect(failed.status).toBe("failed"); expect(failed.can_publish).toBe(false);
      expect(hash(path.join(root, "Host.FCStd"))).toBe(before);
    }
  });
  it("rejects source/dependency mutation and plan expiry before publication", async () => {
    let now = Date.now(); const service = createAssemblyUpdateService({ native, now: () => now });
    const job = service.start(root, "Host.FCStd", ["Sub"]); await service.wait(root, job.id);
    now += 11 * 60_000; expect(service.get(root, job.id).can_publish).toBe(false);
    await expect(service.publish(root, job.id, "verified_copy", { closed: false, notReopened: false })).rejects.toThrow("过期");
    now -= 11 * 60_000; fs.appendFileSync(path.join(root, "Child.FCStd"), "external");
    await expect(service.publish(root, job.id, "verified_copy", { closed: false, notReopened: false })).rejects.toMatchObject({ code: "source_changed" });
  });
  it("cancels an owned preview without publishing and never restores authority after service restart", async () => {
    let nativeStarted!: () => void;
    const reachedNative = new Promise<void>(resolve => { nativeStarted = resolve; });
    const service = createAssemblyUpdateService({ native: async input => new Promise((_resolve, reject) => {
      input.signal.addEventListener("abort", () => reject(new Error("cancelled")), { once: true });
      nativeStarted();
    }) });
    const pending = service.start(root, "Host.FCStd", ["Sub"]);
    await reachedNative; service.cancel(root, pending.id);
    const cancelled = await service.wait(root, pending.id);
    expect(cancelled).toMatchObject({ status: "cancelled", can_publish: false });
    const restarted = createAssemblyUpdateService({ native });
    expect(() => restarted.get(root, pending.id)).toThrow("不恢复写入权限");
    expect(fs.existsSync(path.join(root, ".phoenix", "assembly-maintenance", pending.id, "operation.json"))).toBe(true);
  });
  it("admits only one simultaneous publication of the same frozen stage", async () => {
    const service = createAssemblyUpdateService({ native });
    const job = service.start(root, "Host.FCStd", ["Sub"]); await service.wait(root, job.id);
    const results = await Promise.all([1, 2].map(() => service.publish(root, job.id, "verified_copy", { closed: false, notReopened: false })));
    expect(results.every(result => result.status === "published")).toBe(true);
    expect(fs.readdirSync(root).filter(name => name.includes(".Refreshed."))).toHaveLength(1);
  });
  it("rejects Native update/reopen receipts sharing a pid despite different nonces", async () => {
    const service = createAssemblyUpdateService({ native: async input => { const result = await native(input); result.nativeProof.reopen.pid = result.nativeProof.update.pid; return result; } });
    const job = service.start(root, "Host.FCStd", ["Sub"]);
    expect(await service.wait(root, job.id)).toMatchObject({ status: "failed", can_publish: false });
  });
  it("returns only a bounded diagnostic slug, never Native messages or private-path reason suffixes", async () => {
    const service = createAssemblyUpdateService({ native: async () => { throw Object.assign(new Error(root), { code: "manual_required", reason: "joint_frame_changed:" + root }); } });
    const job = service.start(root, "Host.FCStd", ["Sub"]), result = await service.wait(root, job.id);
    expect(result.status).toBe("blocked"); expect(result.warnings.some(message => message.includes("joint_frame_changed"))).toBe(true);
    expect(JSON.stringify(result)).not.toContain(root);
    const unsafe = createAssemblyUpdateService({ native: async () => { throw Object.assign(new Error(root), { code: "manual_required", reason: root }); } });
    const second = unsafe.start(root, "Host.FCStd", ["Sub"]), rejected = await unsafe.wait(root, second.id);
    expect(rejected.warnings.some(message => message.includes("manual_required"))).toBe(true); expect(JSON.stringify(rejected)).not.toContain(root);
  });
  it("cancellation while the final baseline verification awaits cannot cross into publication", async () => {
    const service = createAssemblyUpdateService({ native }); const job = service.start(root, "Host.FCStd", ["Sub"]); await service.wait(root, job.id);
    const actual = baselineModule.verifySavedAssemblyBaseline; let enter!: () => void, release!: () => void;
    const entered = new Promise<void>(resolve => { enter = resolve; }), released = new Promise<void>(resolve => { release = resolve; });
    vi.spyOn(baselineModule, "verifySavedAssemblyBaseline").mockImplementation(async (...args) => { enter(); await released; return actual(...args); });
    const publish = vi.spyOn(publicationModule, "publishVerifiedAssembly");
    const pending = service.publish(root, job.id, "verified_copy", { closed: false, notReopened: false });
    await entered; expect(service.cancel(root, job.id).status).toBe("cancelled"); release();
    expect(await pending).toMatchObject({ status: "cancelled", can_publish: false }); expect(publish).not.toHaveBeenCalled();
  });
  it("rechecks expiry after an awaited verification rather than publishing an expired preview", async () => {
    let time = Date.now(); const service = createAssemblyUpdateService({ native, now: () => time });
    const job = service.start(root, "Host.FCStd", ["Sub"]); await service.wait(root, job.id);
    const actual = baselineModule.verifySavedAssemblyBaseline; let enter!: () => void, release!: () => void;
    const entered = new Promise<void>(resolve => { enter = resolve; }), released = new Promise<void>(resolve => { release = resolve; });
    vi.spyOn(baselineModule, "verifySavedAssemblyBaseline").mockImplementation(async (...args) => { enter(); await released; return actual(...args); });
    const publish = vi.spyOn(publicationModule, "publishVerifiedAssembly");
    const pending = service.publish(root, job.id, "verified_copy", { closed: false, notReopened: false });
    await entered; time += 11 * 60_000; release();
    await expect(pending).rejects.toThrow("过期"); expect(publish).not.toHaveBeenCalled();
  });
  it("consumes a stale plan after verification failure and does not expose raw private fs errors", async () => {
    const service = createAssemblyUpdateService({ native }); const job = service.start(root, "Host.FCStd", ["Sub"]); await service.wait(root, job.id);
    vi.spyOn(baselineModule, "verifySavedAssemblyBaseline").mockRejectedValue(Object.assign(new Error("read failed at " + root), { code: "EACCES" }));
    await expect(service.publish(root, job.id, "verified_copy", { closed: false, notReopened: false })).rejects.toThrow("预览权限已失效");
    const after = service.get(root, job.id); expect(after).toMatchObject({ status: "blocked", can_publish: false }); expect(JSON.stringify(after)).not.toContain(root);
    expect(await service.publish(root, job.id, "verified_copy", { closed: false, notReopened: false })).toEqual(after);
  });
  it("a failed publishing-phase persist consumes authority before any publication IO", async () => {
    const service = createAssemblyUpdateService({ native }); const job = service.start(root, "Host.FCStd", ["Sub"]); await service.wait(root, job.id);
    const rename = fs.renameSync.bind(fs); let failed = false;
    vi.spyOn(fs, "renameSync").mockImplementation((from, to) => {
      if (!failed && String(to).endsWith("operation.json") && JSON.parse(fs.readFileSync(from, "utf8")).public.phase === "publishing") {
        failed = true; throw new Error("private persistent path " + root);
      }
      return rename(from, to);
    });
    const publish = vi.spyOn(publicationModule, "publishVerifiedAssembly");
    const result = await service.publish(root, job.id, "verified_copy", { closed: false, notReopened: false });
    expect(result).toMatchObject({ status: "needs_reconcile", can_publish: false, error: { code: "receipt_failed" } });
    expect(JSON.stringify(result)).not.toContain(root); expect(publish).not.toHaveBeenCalled();
    expect(await service.publish(root, job.id, "verified_copy", { closed: false, notReopened: false })).toEqual(result);
  });
  it("a Native phase persist failure becomes a closed failure without saving the real source", async () => {
    const before = hash(path.join(root, "Host.FCStd")), rename = fs.renameSync.bind(fs); let failed = false;
    vi.spyOn(fs, "renameSync").mockImplementation((from, to) => {
      if (!failed && String(to).endsWith("operation.json") && JSON.parse(fs.readFileSync(from, "utf8")).public.phase === "native_reopen") {
        failed = true; throw new Error(root);
      }
      return rename(from, to);
    });
    const service = createAssemblyUpdateService({ native }); const job = service.start(root, "Host.FCStd", ["Sub"]);
    const result = await service.wait(root, job.id); expect(result).toMatchObject({ status: "failed", phase: "completed", can_publish: false });
    expect(JSON.stringify(result)).not.toContain(root); expect(hash(path.join(root, "Host.FCStd"))).toBe(before);
  });
  it("a cancellation receipt failure cannot restore a ready preview's authority", async () => {
    const service = createAssemblyUpdateService({ native }); const job = service.start(root, "Host.FCStd", ["Sub"]); await service.wait(root, job.id);
    vi.spyOn(fs, "fsyncSync").mockImplementationOnce(() => { throw new Error(root); });
    const result = service.cancel(root, job.id); expect(result).toMatchObject({ status: "needs_reconcile", can_publish: false });
    expect(JSON.stringify(result)).not.toContain(root);
    expect(await service.publish(root, job.id, "verified_copy", { closed: false, notReopened: false })).toEqual(result);
  });
  it("failure to persist a new job never launches Native and returns only a fixed error", () => {
    const engine = vi.fn(native); const service = createAssemblyUpdateService({ native: engine });
    vi.spyOn(fs, "fsyncSync").mockImplementationOnce(() => { throw new Error(root); });
    expect(() => service.start(root, "Host.FCStd", ["Sub"])).toThrow("未启动原生预览"); expect(engine).not.toHaveBeenCalled();
    expect(() => service.start(root + "/missing-private", "Host.FCStd", ["Sub"])).toThrow("工作空间不可读");
    expect(() => service.start(root, "missing-private.FCStd", ["Sub"])).toThrow("可读、非符号链接");
  });
  it("a publication response lost after the real copy was installed is never replayed", async () => {
    const service = createAssemblyUpdateService({ native }); const job = service.start(root, "Host.FCStd", ["Sub"]); await service.wait(root, job.id);
    const actual = publicationModule.publishVerifiedAssembly;
    vi.spyOn(publicationModule, "publishVerifiedAssembly").mockImplementation((...args) => { actual(...args); throw new Error("lost reply " + root); });
    const result = await service.publish(root, job.id, "verified_copy", { closed: false, notReopened: false });
    expect(result).toMatchObject({ status: "needs_reconcile", can_publish: false, error: { code: "publication_unknown" } });
    expect(JSON.stringify(result)).not.toContain(root);
    expect(await service.publish(root, job.id, "verified_copy", { closed: false, notReopened: false })).toEqual(result);
    expect(fs.readdirSync(root).filter(name => name.includes(".Refreshed."))).toHaveLength(1);
    expect(service.reconcile(root, job.id)).toMatchObject({ observed_publication: "published_observed", can_publish: false });
  });
  it("a lost final operation receipt preserves the installed copy and requires reconciliation", async () => {
    const service = createAssemblyUpdateService({ native }); const job = service.start(root, "Host.FCStd", ["Sub"]); await service.wait(root, job.id);
    const rename = fs.renameSync.bind(fs);
    vi.spyOn(fs, "renameSync").mockImplementation((from, to) => {
      if (String(to).endsWith("operation.json") && JSON.parse(fs.readFileSync(from, "utf8")).public.status === "published") throw new Error(root);
      return rename(from, to);
    });
    const result = await service.publish(root, job.id, "verified_copy", { closed: false, notReopened: false });
    expect(result).toMatchObject({ status: "needs_reconcile", can_publish: false, error: { code: "receipt_failed" } });
    expect(fs.existsSync(path.join(root, result.output_rel!))).toBe(true);
    expect(service.reconcile(root, job.id).observed_publication).toBe("published_observed");
  });
  it("cancel during a consumed publication's delayed refresh cannot become a no-write cancellation", async () => {
    let enter!: () => void, release!: () => void;
    const entered = new Promise<void>(resolve => { enter = resolve; }), released = new Promise<void>(resolve => { release = resolve; });
    const service = createAssemblyUpdateService({ native, refresh: async () => { enter(); await released; return ["refresh failed at " + root]; } });
    const job = service.start(root, "Host.FCStd", ["Sub"]); await service.wait(root, job.id);
    const pending = service.publish(root, job.id, "verified_copy", { closed: false, notReopened: false });
    await entered; expect(service.cancel(root, job.id)).toMatchObject({ status: "published", can_publish: false }); release();
    const result = await pending; expect(result.status).toBe("published"); expect(JSON.stringify(result)).not.toContain(root);
  });
});

describe("bounded, read-only restart history and reconciliation", () => {
  async function ready(publish = false) {
    const service = createAssemblyUpdateService({ native }); const job = service.start(root, "Host.FCStd", ["Sub"]); await service.wait(root, job.id);
    if (publish) await service.publish(root, job.id, "verified_copy", { closed: false, notReopened: false });
    return { service, id: job.id, directory: path.join(root, ".phoenix", "assembly-maintenance", job.id) };
  }
  it("observes a completed publication on restart without reconstructing any write authority", async () => {
    const f = await ready(true), engine = vi.fn(native), restarted = createAssemblyUpdateService({ native: engine });
    const operation = fs.readFileSync(path.join(f.directory, "operation.json"));
    const result = restarted.reconcile(root, f.id);
    expect(result).toMatchObject({ read_only: true, can_publish: false, observed_publication: "published_observed", receipt_state: "published",
      source_state: "original", target_state: "verified", backup_state: "verified", dependencies_state: "unchanged" });
    expect(JSON.stringify(result)).not.toContain(root); expect(engine).not.toHaveBeenCalled();
    expect(fs.readFileSync(path.join(f.directory, "operation.json"))).toEqual(operation);
    expect(() => restarted.get(root, f.id)).toThrow("不恢复写入权限");
    await expect(restarted.publish(root, f.id, "verified_copy", { closed: false, notReopened: false })).rejects.toThrow("不恢复写入权限");
  });
  it("a ready pre-restart plan is metadata only, and history does not hash CAD files", async () => {
    const f = await ready(), restarted = createAssemblyUpdateService({ native: vi.fn(native) });
    expect(restarted.reconcile(root, f.id)).toMatchObject({ observed_publication: "not_published_observed", can_publish: false, read_only: true });
    const open = vi.spyOn(fs, "openSync"); const history = restarted.history(root);
    expect(history.records).toHaveLength(1); expect(history.records[0]).toMatchObject({ id: f.id, can_publish: false, read_only: true });
    expect(open.mock.calls.every(([filename]) => !String(filename).toLowerCase().endsWith(".fcstd"))).toBe(true);
    expect(() => restarted.get(root, f.id)).toThrow("不恢复写入权限");
  });
  it("never follows forged operation paths, symlinked job directories, or hardlinked records", async () => {
    const f = await ready(), restarted = createAssemblyUpdateService({ native });
    const operationFile = path.join(f.directory, "operation.json"), record = JSON.parse(fs.readFileSync(operationFile, "utf8"));
    record.public.file_path = "../../private-secret.FCStd"; record.public.error = { code: "private", message: root };
    fs.writeFileSync(operationFile, JSON.stringify(record));
    expect(restarted.reconcile(root, f.id)).toMatchObject({ operation: null, observed_publication: "unknown", can_publish: false });
    expect(JSON.stringify(restarted.reconcile(root, f.id))).not.toContain(root);
    expect(() => restarted.reconcile(root, "../../private-secret")).toThrow("标识无效");
    const other = await ready(); fs.linkSync(path.join(other.directory, "operation.json"), path.join(root, "independent-record-hardlink"));
    expect(restarted.reconcile(root, other.id).operation).toBeNull();
    const linkId = randomUUID(); fs.symlinkSync(f.directory, path.join(root, ".phoenix", "assembly-maintenance", linkId));
    expect(restarted.reconcile(root, linkId).operation).toBeNull();
    expect(restarted.history(root).records.some(row => row.id === linkId)).toBe(false);
  });
  it("bounds record bytes and rejects conflicting or incomplete publication records", async () => {
    const f = await ready(true), service = createAssemblyUpdateService({ native });
    const receiptFile = path.join(f.directory, "publication", "published.json"), receipt = fs.readFileSync(receiptFile);
    fs.writeFileSync(receiptFile, "x".repeat(512 * 1024 + 1));
    expect(service.reconcile(root, f.id)).toMatchObject({ observed_publication: "unknown", receipt_state: "unknown" });
    const forged = JSON.parse(receipt.toString()); forged.targetRel = "/private/opaque-secret.FCStd";
    fs.writeFileSync(receiptFile, JSON.stringify(forged));
    const result = service.reconcile(root, f.id); expect(result.observed_publication).toBe("unknown"); expect(JSON.stringify(result)).not.toContain("opaque-secret");
    fs.writeFileSync(path.join(f.directory, "operation.json"), "x".repeat(2 * 1024 * 1024 + 1));
    expect(service.reconcile(root, f.id).operation).toBeNull();
  });
  it("observes changed targets and dependencies without repairing or rewriting anything", async () => {
    const f = await ready(true), job = f.service.get(root, f.id), service = createAssemblyUpdateService({ native });
    const output = path.join(root, job.output_rel!); fs.appendFileSync(output, "independent concurrent save");
    const changed = fs.readFileSync(output), source = hash(path.join(root, "Host.FCStd"));
    expect(service.reconcile(root, f.id)).toMatchObject({ observed_publication: "unknown", target_state: "other", requires_manual_review: true });
    expect(fs.readFileSync(output)).toEqual(changed); expect(hash(path.join(root, "Host.FCStd"))).toBe(source);
    write(output, host(true)); fs.appendFileSync(path.join(root, "Child.FCStd"), "independent dependency save");
    expect(service.reconcile(root, f.id)).toMatchObject({ observed_publication: "unknown", dependencies_state: "changed" });
  });
  it("lists at most the requested records and scans at most 257 fixed-directory entries", async () => {
    const f = await ready(), service = createAssemblyUpdateService({ native });
    for (let index = 0; index < 300; index++) fs.mkdirSync(path.join(root, ".phoenix", "assembly-maintenance", randomUUID()), { mode: 0o700 });
    const open = fs.opendirSync.bind(fs); let reads = 0;
    vi.spyOn(fs, "opendirSync").mockImplementation((...args) => {
      const handle = open(...args), read = handle.readSync.bind(handle);
      handle.readSync = (() => { reads++; return read(); }) as typeof handle.readSync;
      return handle;
    });
    const result = service.history(root, 50); expect(result.records.length).toBeLessThanOrEqual(50); expect(result.truncated).toBe(true); expect(reads).toBeLessThanOrEqual(257);
    expect(() => service.history(root, 51)).toThrow("1 至 50");
    expect(service.reconcile(root, f.id).can_publish).toBe(false);
  });
  it("bounds retained terminal jobs while retaining read-only on-disk history", async () => {
    const service = createAssemblyUpdateService({ native: vi.fn(native) }); let first = "";
    for (let index = 0; index < 130; index++) {
      const job = service.start(root, "Host.FCStd", ["Missing"]); if (!index) first = job.id;
      expect((await service.wait(root, job.id)).can_publish).toBe(false);
    }
    expect(() => service.get(root, first)).toThrow("不恢复写入权限");
    expect(service.reconcile(root, first)).toMatchObject({ id: first, read_only: true, can_publish: false });
  }, 20_000);
});
