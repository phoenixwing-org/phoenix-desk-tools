import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { strToU8, zipSync } from "fflate";
import { afterEach, expect, it, vi } from "vitest";
import { fcstdFingerprint } from "../../lib/fcstdBatchFiles.js";
import { galleryJob, loadGallery, startGalleryJob, thumbnailBytes } from "./service.js";
import { geometryJob, geometrySnapshot, geometryXlinkFiles, startGeometryJob } from "./geometryService.js";
import { createGeometryTable, saveGeometry, validBoundingBox } from "./geometryStorage.js";
import { galleryBoundingBoxText, galleryDocument } from "./document.js";
import { openGalleryDb } from "./storage.js";
import { GeometryConfigurationError, type GeometryInput, type GeometryResult } from "./geometryRunner.js";

const roots: string[] = [];
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "base64");
function root() { const value = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "gallery-geometry-test-"))); roots.push(value); return value; }
function save(root: string, rel: string, refs: string[] = [], extra = "") {
  const extraData = extra.includes("OtherBody") ? '<Object name="OtherBody"><Properties Count="1"><Property name="Label" type="App::PropertyString"><String value="第二个独立实体"/></Property></Properties></Object>' : "";
  const xml = `<Document><Objects><Object name="Body" type="PartDesign::Body"/>${extra}</Objects><ObjectData><Object name="Body"><Properties Count="2"><Property name="PartName" type="App::PropertyString"><String value="测试零件"/></Property><Property name="Label" type="App::PropertyString"><String value="测试零件"/></Property></Properties></Object>${extraData}${refs.map((file, i) => `<Object name="L${i}"><Properties Count="1"><Property name="LinkedObject" type="App::PropertyXLink"><XLink file="${file}" name="Body"/></Property></Properties></Object>`).join("")}</ObjectData></Document>`;
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), zipSync({ "Document.xml": strToU8(xml), "thumbnails/Thumbnail.png": png }));
}
async function wait<T extends { state: string }>(get: () => T | null) {
  for (let index = 0; index < 300; index++) {
    await new Promise(resolve => setTimeout(resolve, 5));
    const value = get(); if (value && value.state !== "running") return value;
  }
  throw new Error("test job timeout");
}
async function catalog(root: string, product: string) { const value = startGalleryJob(root, product); return wait(() => galleryJob(root, value.id)); }
async function dimensions(root: string, product: string, read: typeof validRead = validRead) { const value = startGeometryJob(root, product, read); return wait(() => geometryJob(root, value.id)); }
const box = { x_mm: 10, y_mm: 20, z_mm: 30 };
async function validRead(inputs: GeometryInput[], onItem?: (item: GeometryResult) => void): Promise<GeometryResult[]> {
  return inputs.map(input => { const item = { rel: input.rel, bounding_box: box, message: "ready" }; onItem?.(item); return item; });
}
afterEach(() => { vi.restoreAllMocks(); for (const value of roots.splice(0)) fs.rmSync(value, { recursive: true, force: true }); });

it("requires an explicit cached scope; ordinary gallery reads never create geometry tables or run the kernel", async () => {
  const r = root(); expect(() => startGeometryJob(r, "Unit.FCStd")).toThrow("缩略图");
  expect(fs.existsSync(path.join(r, ".phoenix"))).toBe(false);
  save(r, "Unit.FCStd"); await catalog(r, "Unit.FCStd");
  expect(loadGallery(r, "Unit.FCStd").rows[0]).toMatchObject({ bounding_box: null, dimension_message: "尺寸未获取，请更新尺寸" });
  const db = openGalleryDb(r)!;
  expect(db.get("SELECT name FROM sqlite_master WHERE name='desk_cad_geometry'")).toBeFalsy(); db.close();
});
it("stores real millimetres separately, reuses unchanged geometry, and preserves CAD and PNG bytes", async () => {
  const r = root(); save(r, "Unit.FCStd"); await catalog(r, "Unit.FCStd");
  const before = fcstdFingerprint(fs.readFileSync(path.join(r, "Unit.FCStd")));
  const read = vi.fn(validRead); const first = await dimensions(r, "Unit.FCStd", read);
  expect(first).toMatchObject({ state: "done", completed: 1, reused: 0 });
  expect(read.mock.calls[0][0][0]).toMatchObject({ rel: "Unit.FCStd", node: "Body" });
  const row = loadGallery(r, "Unit.FCStd").rows[0];
  expect(row).toMatchObject({ bounding_box: box, width: 1, height: 1, status: "ready" });
  expect(galleryBoundingBoxText(row)).toBe("10 × 20 × 30 mm");
  const fileRead = vi.spyOn(fs, "readFileSync"); loadGallery(r, "Unit.FCStd");
  expect(fileRead.mock.calls.some(call => call[0] === path.join(r, "Unit.FCStd"))).toBe(false); fileRead.mockRestore();
  const second = await dimensions(r, "Unit.FCStd", read); expect(second.reused).toBe(1); expect(read).toHaveBeenCalledTimes(1);
  expect(thumbnailBytes(r, "Unit.FCStd")).toEqual(png);
  expect(fcstdFingerprint(fs.readFileSync(path.join(r, "Unit.FCStd")))).toBe(before);
});
it("skips drawing and assembly geometry, and continues past individual missing shapes", async () => {
  const r = root(); save(r, "Top.ASSY.FCStd", ["Unit.FCStd", "Blank.FCStd", "Page.Drawing.FCStd"]);
  save(r, "Unit.FCStd"); save(r, "Blank.FCStd"); save(r, "Page.Drawing.FCStd"); await catalog(r, "Top.ASSY.FCStd");
  const read = vi.fn(async (inputs: GeometryInput[]) => inputs.map(input => ({ rel: input.rel, bounding_box: input.rel === "Blank.FCStd" ? null : box, message: "ignored raw text" })));
  const job = await dimensions(r, "Top.ASSY.FCStd", read);
  expect(job).toMatchObject({ state: "attention", completed: 4 });
  expect(read.mock.calls[0][0].map(input => input.rel).sort()).toEqual(["Blank.FCStd", "Unit.FCStd"]);
  const rows = loadGallery(r, "Top.ASSY.FCStd").rows;
  expect(rows.find(row => row.rel === "Unit.FCStd")?.bounding_box).toEqual(box);
  expect(rows.filter(row => row.rel !== "Unit.FCStd").every(row => row.bounding_box === null)).toBe(true);
  expect(rows.every(row => row.status === "ready")).toBe(true);
  expect(rows.some(row => row.dimension_message?.includes("ignored raw text"))).toBe(false);
});
it("does not publish streamed geometry if final native validation fails", async () => {
  const r = root(); save(r, "Unit.FCStd"); await catalog(r, "Unit.FCStd");
  const job = await dimensions(r, "Unit.FCStd", async (inputs, onItem) => {
    onItem?.({ rel: inputs[0].rel, bounding_box: box, message: "ready" });
    expect(loadGallery(r, "Unit.FCStd").rows[0].bounding_box).toBeNull();
    throw new Error("private native path must not appear");
  });
  expect(job).toMatchObject({ state: "attention", completed: 1 });
  const row = loadGallery(r, "Unit.FCStd").rows[0]; expect(row.bounding_box).toBeNull(); expect(row.status).toBe("ready");
  expect(row.dimension_message).toMatch(/失败或超时/); expect(JSON.stringify(job)).not.toContain("private native");
  expect((await dimensions(r, "Unit.FCStd")).state).toBe("done");
});
it("keeps fixed configuration failures available to the bottom log without leaking arbitrary errors", async () => {
  const r = root(); save(r, "Unit.FCStd"); await catalog(r, "Unit.FCStd");
  await dimensions(r, "Unit.FCStd", async () => { throw new GeometryConfigurationError("freecad_not_found"); });
  expect(loadGallery(r, "Unit.FCStd").rows[0].dimension_message).toBe("未找到 FreeCADCmd，请先配置 FreeCAD 安装目录");
});
it("keeps a validated empty-shape reason instead of replacing all per-file failures with a generic message", async () => {
  const r = root(); save(r, "Unit.FCStd"); await catalog(r, "Unit.FCStd");
  await dimensions(r, "Unit.FCStd", async inputs => inputs.map(input => ({ rel: input.rel, bounding_box: null, message: "主零件节点的 Shape 为空" })));
  expect(loadGallery(r, "Unit.FCStd").rows[0].dimension_message).toBe("主零件节点的 Shape 为空");
});
it("fails closed for duplicate or out-of-order final identities", async () => {
  const r = root(); save(r, "Top.ASSY.FCStd", ["A.FCStd", "B.FCStd"]); save(r, "A.FCStd"); save(r, "B.FCStd"); await catalog(r, "Top.ASSY.FCStd");
  await dimensions(r, "Top.ASSY.FCStd", async inputs => inputs.map(() => ({ rel: inputs[0].rel, bounding_box: box, message: "ready" })));
  expect(loadGallery(r, "Top.ASSY.FCStd").rows.every(row => row.bounding_box === null)).toBe(true);
});
it("invalidates geometry when the source changes during or after the native read", async () => {
  const r = root(); save(r, "Unit.FCStd"); await catalog(r, "Unit.FCStd");
  await dimensions(r, "Unit.FCStd", async inputs => { const results = await validRead(inputs); save(r, "Unit.FCStd", [], '<Object name="Extra" type="App::FeaturePython"/>'); return results; });
  expect(loadGallery(r, "Unit.FCStd").rows[0]).toMatchObject({ bounding_box: null, status: "stale" });
  expect(() => startGeometryJob(r, "Unit.FCStd")).toThrow("源文件已变化");
  save(r, "Unit.FCStd"); await catalog(r, "Unit.FCStd"); await dimensions(r, "Unit.FCStd");
  save(r, "Unit.FCStd"); expect(loadGallery(r, "Unit.FCStd").rows[0].bounding_box).toBeNull();
});
it("invalidates dependent dimensions even if the root model is unchanged", async () => {
  const r = root(); save(r, "Root.FCStd", ["Support.FCStd"]); save(r, "Support.FCStd"); await catalog(r, "Root.FCStd"); await dimensions(r, "Root.FCStd");
  expect(loadGallery(r, "Root.FCStd").rows.find(row => row.rel === "Root.FCStd")?.bounding_box).toEqual(box);
  save(r, "Support.FCStd");
  const rootRow = loadGallery(r, "Root.FCStd").rows.find(row => row.rel === "Root.FCStd")!;
  expect(rootRow.status).toBe("ready"); expect(rootRow.bounding_box).toBeNull(); expect(rootRow.dimension_message).toMatch(/引用已变化/);
});
it("does not launch native readers for external or symlink dependencies or ambiguous targets", async () => {
  const r = root(), outside = root(); save(outside, "Foreign.FCStd"); save(r, "Root.FCStd", ["Escape.FCStd"]);
  fs.symlinkSync(path.join(outside, "Foreign.FCStd"), path.join(r, "Escape.FCStd"));
  expect(() => geometrySnapshot(r, "Root.FCStd")).toThrow(); await catalog(r, "Root.FCStd");
  const read = vi.fn(validRead); await dimensions(r, "Root.FCStd", read); expect(read).not.toHaveBeenCalled();
  save(r, "Ambiguous.FCStd", [], '<Object name="OtherBody" type="PartDesign::Body"/>'); await catalog(r, "Ambiguous.FCStd");
  await dimensions(r, "Ambiguous.FCStd", read); expect(read).not.toHaveBeenCalled();
  expect(loadGallery(r, "Ambiguous.FCStd").rows[0].dimension_message).toMatch(/无法安全确定/);
});
it("does not reuse old algorithm versions or invalid cached dimensions", async () => {
  const r = root(); save(r, "Unit.FCStd"); await catalog(r, "Unit.FCStd"); await dimensions(r, "Unit.FCStd");
  const db = openGalleryDb(r)!; db.run("UPDATE desk_cad_geometry SET algorithm_version=0"); db.close();
  expect(loadGallery(r, "Unit.FCStd").rows[0].bounding_box).toBeNull();
  const read = vi.fn(validRead); await dimensions(r, "Unit.FCStd", read); expect(read).toHaveBeenCalledOnce();
  const cache = openGalleryDb(r)!; cache.run("UPDATE desk_cad_geometry SET box_json='{}'"); cache.close();
  expect(loadGallery(r, "Unit.FCStd").rows[0].bounding_box).toBeNull();
});
it("prints model dimensions, handles small or planar geometry, and never prints PNG pixels", async () => {
  const r = root(); save(r, "Unit.FCStd"); await catalog(r, "Unit.FCStd"); await dimensions(r, "Unit.FCStd");
  const row = { ...loadGallery(r, "Unit.FCStd").rows[0], width: 512, height: 512 };
  const html = galleryDocument([row], "测试产品", "2026-01-01", () => "");
  expect(html).toContain("10 × 20 × 30 mm"); expect(html).not.toContain("512"); expect(html).not.toContain(r);
  expect(galleryBoundingBoxText({ ...row, bounding_box: { x_mm: 0, y_mm: 0.0001, z_mm: 1.25 } })).toBe("0 × <0.01 × 1.25 mm");
  expect(galleryBoundingBoxText({ ...row, bounding_box: null })).toBe("尺寸未获取");
  expect(validBoundingBox({ x_mm: 0, y_mm: 1, z_mm: 2 })).toBe(true);
  for (const bad of [null, {}, { x_mm: 0, y_mm: 0, z_mm: 0 }, { x_mm: -1, y_mm: 1, z_mm: 1 }, { x_mm: Infinity, y_mm: 1, z_mm: 1 }]) expect(validBoundingBox(bad)).toBe(false);
  const db = openGalleryDb(r)!; createGeometryTable(db);
  expect(() => saveGeometry(db, { rel: row.rel, sources: [], box: { x_mm: 0, y_mm: 0, z_mm: 0 }, message: "" })).toThrow("无效"); db.close();
});
it("separates workspace jobs and processes more than 100 parts in bounded native batches", async () => {
  const r = root(), other = root(), refs = Array.from({ length: 101 }, (_, index) => `parts/P${index}.FCStd`);
  save(r, "Top.ASSY.FCStd", refs); for (const rel of refs) save(r, rel); await catalog(r, "Top.ASSY.FCStd");
  const read = vi.fn(validRead), job = await dimensions(r, "Top.ASSY.FCStd", read);
  expect(job).toMatchObject({ state: "attention", completed: 102 }); expect(read.mock.calls.map(call => call[0].length)).toEqual([100, 1]);
  expect(geometryJob(other, job.id)).toBeNull();
});
it("preflights quote-safe XLinks, masks opaque text, and decodes entities only once", () => {
  expect(geometryXlinkFiles(`<Document><!-- <XLink file="../hidden.FCStd"/> --><![CDATA[<XLink file="../hidden.FCStd"/>]]><XLink file='A&gt;B.FCStd' name="Body"/><XLink name='Body' file="A&amp;gt;B.FCStd"/></Document>`)).toEqual(["A>B.FCStd", "A&gt;B.FCStd"]);
  expect(geometryXlinkFiles('<XLink file="A>B.FCStd"/>')).toEqual(["A>B.FCStd"]);
  for (const xml of ['<!DOCTYPE Document SYSTEM "external"><Document/>', '<XLink file="A&bogus;B.FCStd"/>', '<XLink file="A&#0;B.FCStd"/>', '<XLink file="A.FCStd" file="B.FCStd"/>']) expect(() => geometryXlinkFiles(xml)).toThrow();
  const r = root(); save(r, "Root.FCStd", ["A>B.FCStd"]); save(r, "A>B.FCStd"); expect(geometrySnapshot(r, "Root.FCStd").sources).toHaveLength(2);
  for (const ref of ["../external>model.FCStd", "Other.stp", "C:\\external\\Part.FCStd", "/outside/Part.FCStd"]) { save(r, "Root.FCStd", [ref]); expect(() => geometrySnapshot(r, "Root.FCStd")).toThrow(); }
});
