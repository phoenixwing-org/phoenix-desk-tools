import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { strToU8, zipSync } from "fflate";
import { afterEach, expect, it, vi } from "vitest";
import { fcstdFingerprint } from "../../lib/fcstdBatchFiles.js";
import { cacheRenderedThumbnail, cancelGalleryJob, galleryJob, loadGallery, startGalleryJob, thumbnailBytes } from "./service.js";
import { cachedRow, openGalleryDb } from "./storage.js";
import { selectedGallery } from "./archive.js";
import { startGeometryJob } from "./geometryService.js";
import * as storage from "./storage.js";
import * as archives from "../../lib/fcstdBatchFiles.js";

const roots: string[] = [];
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "base64");
function root() { const r = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "gallery-scope-test-"))); roots.push(r); return r; }
function save(r: string, rel: string, refs: string[] = [], image: Uint8Array = png) {
  fs.mkdirSync(path.dirname(path.join(r, rel)), { recursive: true });
  const xml = `<Document><Objects><Object name="Body" type="PartDesign::Body"/>${refs.map((_, i) => `<Object name="L${i}" type="App::Link"/>`).join("")}</Objects><ObjectData><Object name="Body"><Properties Count="0"/></Object>${refs.map((file, i) => `<Object name="L${i}"><Properties Count="1"><Property name="LinkedObject" type="App::PropertyXLink"><XLink file="${file}" name="Body"/></Property></Properties></Object>`).join("")}</ObjectData></Document>`;
  fs.writeFileSync(path.join(r, rel), zipSync({ "Document.xml": strToU8(xml), "thumbnails/Thumbnail.png": image }));
}
async function wait(r: string, id: string) {
  for (let i = 0; i < 500; i++) { await new Promise(resolve => setTimeout(resolve, 2)); const job = galleryJob(r, id); if (job.state !== "running") return job; }
  throw new Error("synthetic gallery timeout");
}
const run = (r: string, rel = "Top.ASSY.FCStd") => wait(r, startGalleryJob(r, rel).id);
function members(r: string, product: string) { const db = openGalleryDb(r)!; try { return db.all<{ rel: string }>("SELECT rel FROM desk_cad_gallery_member WHERE product=? ORDER BY rel", [product]).map(row => row.rel); } finally { db.close(); } }
afterEach(() => { vi.restoreAllMocks(); for (const r of roots.splice(0)) fs.rmSync(r, { recursive: true, force: true }); });

it.each(["rename", "move", "unlink"])("reconciles %s from current saved links, not old members or number-like names", async change => {
  const r = root(); save(r, "Top.ASSY.FCStd", ["Old.FCStd"]); save(r, "Old.FCStd"); await run(r);
  const next = change === "move" ? "models/New.FCStd" : "New.FCStd";
  if (change !== "unlink") { fs.mkdirSync(path.dirname(path.join(r, next)), { recursive: true }); fs.renameSync(path.join(r, "Old.FCStd"), path.join(r, next)); }
  save(r, "Top.ASSY.FCStd", change === "unlink" ? [] : [next]);
  const before = loadGallery(r, "Top.ASSY.FCStd");
  expect(before.rows.map(row => row.rel)).toEqual(["Top.ASSY.FCStd"]);
  expect(before).toMatchObject({ scope_pending: true, removed_count: 1 });
  const job = await run(r); expect(job).toMatchObject({ state: "done", removed_count: 1 });
  expect(job.message).toContain("清理本范围旧成员 1 个");
  expect(members(r, "Top.ASSY.FCStd")).toEqual([...(change === "unlink" ? [] : [next]), "Top.ASSY.FCStd"].sort());
  expect(loadGallery(r, "Top.ASSY.FCStd").scope_pending).toBeUndefined();
});

it("does not borrow a new shared row fingerprint as proof for an old product closure", async () => {
  const r = root(); save(r, "Top.ASSY.FCStd", ["Old.FCStd"]); save(r, "Other.ASSY.FCStd", ["Old.FCStd"]); save(r, "Old.FCStd"); save(r, "New.FCStd");
  await run(r); await run(r, "Other.ASSY.FCStd");
  const otherBefore = members(r, "Other.ASSY.FCStd");
  const before = fs.readFileSync(path.join(r, "Old.FCStd"));
  save(r, "Top.ASSY.FCStd", ["New.FCStd"]);
  cacheRenderedThumbnail(r, "Top.ASSY.FCStd", png, fcstdFingerprint(fs.readFileSync(path.join(r, "Top.ASSY.FCStd"))));
  expect(loadGallery(r, "Top.ASSY.FCStd")).toMatchObject({ scope_pending: true, removed_count: 1 });
  expect(loadGallery(r, "Top.ASSY.FCStd").rows.some(row => row.rel === "Old.FCStd")).toBe(false);
  await run(r);
  expect(members(r, "Other.ASSY.FCStd")).toEqual(otherBefore);
  expect(loadGallery(r, "Other.ASSY.FCStd").rows.some(row => row.rel === "Old.FCStd")).toBe(true);
  const db = openGalleryDb(r)!;
  const old = cachedRow(db, "Old.FCStd")!; db.close();
  expect(fs.readFileSync(path.join(r, `.phoenix/thumbnail-cache/${old.image_hash}.png`))).toEqual(png);
  expect(fs.readFileSync(path.join(r, "Old.FCStd"))).toEqual(before);
});

it("retains a real missing-link diagnostic but never a missing-file executable card", async () => {
  const r = root(); save(r, "Top.ASSY.FCStd", ["Child.FCStd"]); save(r, "Child.FCStd"); await run(r);
  fs.unlinkSync(path.join(r, "Child.FCStd"));
  const current = loadGallery(r, "Top.ASSY.FCStd");
  expect(current.rows.map(row => row.rel)).toEqual(["Top.ASSY.FCStd"]);
  expect(current.issues.some(issue => issue.rel === "Child.FCStd" && /缺失/.test(issue.message))).toBe(true);
  expect(await run(r)).toMatchObject({ state: "attention", removed_count: 1 });
  expect(members(r, "Top.ASSY.FCStd")).toEqual(["Top.ASSY.FCStd"]);
  expect(loadGallery(r, "Top.ASSY.FCStd").issues.some(issue => /缺失/.test(issue.message))).toBe(true);
});

it("does not resurrect missing present-index seeds or guess unindexed replacements", async () => {
  const r = root(); save(r, "Old.FCStd");
  const db = openGalleryDb(r, true)!;
  db.exec("CREATE TABLE phoenix_cad_file_asset(repo_rel_path TEXT,asset_kind TEXT,file_status TEXT)");
  db.run("INSERT INTO phoenix_cad_file_asset VALUES(?,?,?)", ["Old.FCStd", "part", "present"]); db.close();
  await run(r, ""); fs.renameSync(path.join(r, "Old.FCStd"), path.join(r, "Replacement.FCStd"));
  expect(loadGallery(r).rows).toEqual([]);
  expect(await run(r, "")).toMatchObject({ state: "attention", completed: 0, removed_count: 1 });
  expect(members(r, "")).toEqual([]);
  expect(loadGallery(r).issues.map(issue => issue.message).join(" ")).toMatch(/缺失/);
});

it("ignores legacy scope provenance and poisoned cached refs, then upgrades only on explicit update", async () => {
  const r = root(); save(r, "Top.ASSY.FCStd", ["Live.FCStd"]); save(r, "Live.FCStd"); await run(r);
  const db = openGalleryDb(r)!;
  db.run("UPDATE desk_cad_gallery_scope SET sources_json='' WHERE product=?", ["Top.ASSY.FCStd"]);
  db.run("UPDATE desk_cad_thumbnail SET refs_json=? WHERE rel=?", [JSON.stringify(["Ghost.FCStd"]), "Top.ASSY.FCStd"]); db.close();
  expect(loadGallery(r, "Top.ASSY.FCStd")).toMatchObject({ scope_pending: true });
  expect(loadGallery(r, "Top.ASSY.FCStd").rows.map(row => row.rel)).toEqual(["Live.FCStd", "Top.ASSY.FCStd"]);
  await run(r); const next = openGalleryDb(r)!;
  expect(cachedRow(next, "Top.ASSY.FCStd")?.refs).toEqual(["Live.FCStd"]);
  expect(next.get<{ sources_json: string }>("SELECT sources_json FROM desk_cad_gallery_scope")?.sources_json).toContain('"version":1'); next.close();
});

it("keeps present CAD with a broken embedded PNG as an image problem, not a removed member", async () => {
  const r = root(); save(r, "Top.ASSY.FCStd", ["Present.FCStd"]); save(r, "Present.FCStd", [], Buffer.from("broken image"));
  expect(await run(r)).toMatchObject({ state: "attention", removed_count: 0 });
  expect(loadGallery(r, "Top.ASSY.FCStd").rows.find(row => row.rel === "Present.FCStd")?.status).toBe("error");
  expect(members(r, "Top.ASSY.FCStd")).toContain("Present.FCStd");
});

it("cancellation, unreadable closure and failed publication leave the prior scope intact", async () => {
  const r = root(); save(r, "Top.ASSY.FCStd", ["Old.FCStd"]); save(r, "Old.FCStd"); await run(r);
  const before = members(r, "Top.ASSY.FCStd");
  save(r, "New.FCStd"); save(r, "Top.ASSY.FCStd", ["New.FCStd"]);
  const job = startGalleryJob(r, "Top.ASSY.FCStd"); cancelGalleryJob(r, job.id);
  expect(await wait(r, job.id)).toMatchObject({ state: "cancelled" }); expect(members(r, "Top.ASSY.FCStd")).toEqual(before);
  fs.writeFileSync(path.join(r, "Top.ASSY.FCStd"), "broken CAD");
  expect((await run(r)).state).toBe("failed"); expect(members(r, "Top.ASSY.FCStd")).toEqual(before);
  save(r, "Top.ASSY.FCStd", ["New.FCStd"]);
  const db = openGalleryDb(r)!; db.exec("CREATE TRIGGER deny_scope_update BEFORE UPDATE ON desk_cad_gallery_scope BEGIN SELECT RAISE(ABORT,'synthetic publication failure'); END"); db.close();
  expect((await run(r)).state).toBe("failed"); expect(members(r, "Top.ASSY.FCStd")).toEqual(before);
  const checked = openGalleryDb(r)!; expect(cachedRow(checked, "New.FCStd")).toBeNull(); checked.close();
});

it("rejects old pending scope selections before output or Native geometry, even if its shared row is fresh", async () => {
  const r = root(); save(r, "Top.ASSY.FCStd", ["Old.FCStd"]); save(r, "Old.FCStd"); await run(r);
  save(r, "Top.ASSY.FCStd", []);
  cacheRenderedThumbnail(r, "Top.ASSY.FCStd", png, fcstdFingerprint(fs.readFileSync(path.join(r, "Top.ASSY.FCStd"))));
  expect(() => selectedGallery(r, { product: "Top.ASSY.FCStd", rels: ["Top.ASSY.FCStd"] })).toThrow("范围已变化");
  expect(() => startGeometryJob(r, "Top.ASSY.FCStd")).toThrow("引用范围");
});

it.each(["cancel", "source_change", "missing_becomes_unsafe"])("does not publish staged members after mid-job %s", async operation => {
  const r = root(); save(r, "Top.ASSY.FCStd"); await run(r);
  const before = members(r, "Top.ASSY.FCStd");
  const refs = Array.from({ length: 24 }, (_, i) => `parts/Unit${i}.FCStd`);
  refs.forEach(rel => save(r, rel)); save(r, "Top.ASSY.FCStd", operation === "missing_becomes_unsafe" ? [...refs, "Absent.FCStd"] : refs);
  const outside = operation === "missing_becomes_unsafe" ? root() : "";
  if (outside) save(outside, "Foreign.FCStd");
  const job = startGalleryJob(r, "Top.ASSY.FCStd");
  let acted = false;
  for (let i = 0; i < 500; i++) {
    await new Promise(resolve => setTimeout(resolve, 1));
    const current = galleryJob(r, job.id);
    if (current.completed > 0 && current.state === "running") {
      if (operation === "cancel") cancelGalleryJob(r, job.id);
      else if (operation === "source_change") save(r, "Top.ASSY.FCStd", []);
      else fs.symlinkSync(path.join(outside, "Foreign.FCStd"), path.join(r, "Absent.FCStd"));
      acted = true; break;
    }
  }
  expect(acted).toBe(true);
  expect((await wait(r, job.id)).state).toBe(operation === "cancel" ? "cancelled" : "failed");
  expect(members(r, "Top.ASSY.FCStd")).toEqual(before);
  const db = openGalleryDb(r)!; expect(cachedRow(db, refs[0])).toBeNull(); db.close();
});

it("classifies a missing cache PNG separately from a missing CAD and rebuilds only the image cache", async () => {
  const r = root(); save(r, "Top.ASSY.FCStd"); await run(r);
  const row = loadGallery(r, "Top.ASSY.FCStd").rows[0];
  const sourceBefore = fs.readFileSync(path.join(r, row.rel));
  fs.unlinkSync(path.join(r, `.phoenix/thumbnail-cache/${row.image_hash}.png`));
  expect(() => thumbnailBytes(r, row.rel)).toThrow("源 CAD 存在，但图片缓存缺失");
  expect((await run(r)).state).toBe("done");
  expect(thumbnailBytes(r, row.rel)).toEqual(png);
  expect(fs.readFileSync(path.join(r, row.rel))).toEqual(sourceBefore);
});

it("reports a lost commit return as unknown instead of claiming the old scope was preserved", async () => {
  const r = root(); save(r, "Top.ASSY.FCStd", ["Old.FCStd"]); save(r, "Old.FCStd"); await run(r);
  save(r, "New.FCStd"); save(r, "Top.ASSY.FCStd", ["New.FCStd"]);
  const original = storage.openGalleryDb;
  vi.spyOn(storage, "openGalleryDb").mockImplementationOnce((...args) => {
    const db = original(...args)!;
    const exec = db.exec.bind(db);
    db.exec = sql => { const result = exec(sql); if (sql === "RELEASE desk_gallery_members") throw new Error("synthetic lost commit return"); return result; };
    return db;
  });
  const job = await run(r); expect(job.state).toBe("failed");
  expect(job.message).toMatch(/提交结果未确认.*核对.*不要重复运行/);
  expect(job.message).not.toContain("原范围未替换");
  expect(members(r, "Top.ASSY.FCStd")).toEqual(["New.FCStd", "Top.ASSY.FCStd"]);
  expect(loadGallery(r, "Top.ASSY.FCStd").scope_pending).toBeUndefined();
});

it("rejects a source change immediately after the final archive read returns old bytes", async () => {
  const r = root(); save(r, "Top.ASSY.FCStd"); await run(r);
  const db = openGalleryDb(r)!, before = cachedRow(db, "Top.ASSY.FCStd")!; db.close();
  const read = archives.readFcstdBatchArchive; let calls = 0;
  vi.spyOn(archives, "readFcstdBatchArchive").mockImplementation((...args) => {
    const archive = read(...args);
    if (args[0] === path.join(r, "Top.ASSY.FCStd") && ++calls === 2) save(r, "Top.ASSY.FCStd", [], Buffer.from("changed after hash read"));
    return archive;
  });
  const job = await run(r); expect(job.state).toBe("failed"); expect(job.message).toContain("源文件变化");
  const after = openGalleryDb(r)!;
  expect(cachedRow(after, "Top.ASSY.FCStd")?.source_hash).toBe(before.source_hash); after.close();
});
