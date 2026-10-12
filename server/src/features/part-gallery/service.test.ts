import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { strToU8, zipSync } from "fflate";
import { afterEach, expect, it, vi } from "vitest";
import { fcstdFingerprint } from "../../lib/fcstdBatchFiles.js";
import { pnwCreateDb } from "@phoenix-wing/db-node";
import { galleryJob, galleryOptions, loadGallery, startGalleryJob, thumbnailBytes } from "./service.js";
import { archiveGallery, printGallery } from "./archive.js";
import { galleryDocument } from "./document.js";
import { partGalleryRoutes } from "./routes.js";
import { readFileThumbnail } from "../../lib/fcstdThumbnail.js";
import { cachedRow, openGalleryDb, saveRow } from "./storage.js";
import { geometryJob, startGeometryJob } from "./geometryService.js";
import type { GeometryInput } from "./geometryRunner.js";

const roots: string[] = [];
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "base64");
function root() { const r = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "part-gallery-test-"))); roots.push(r); return r; }
function save(root: string, rel: string, opts: { refs?: string[]; noImage?: boolean; name?: string; number?: string; png?: Uint8Array } = {}) {
  const fields = { PartNumber: opts.number || "710801", PartVersion: "003", PartName: opts.name || "测试件", TypeCode: "H", Label: "不要从这个标签推断名称" };
  const properties = Object.entries(fields).map(([key, value]) => `<Property name="${key}" type="App::PropertyString"><String value="${value}"/></Property>`).join("");
  const xml = `<Document><Objects><Object name="Body" type="PartDesign::Body"/></Objects><ObjectData><Object name="Body"><Properties Count="5">${properties}</Properties></Object>${(opts.refs || []).map((file, i) => `<Object name="L${i}"><Properties Count="1"><Property name="LinkedObject" type="App::PropertyXLink"><XLink file="${file}" name="Body"/></Property></Properties></Object>`).join("")}</ObjectData></Document>`;
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), zipSync({ "Document.xml": strToU8(xml), ...opts.noImage ? {} : { "thumbnails/Thumbnail.png": opts.png || png } }));
}
async function run(root: string, product: string) {
  const job = startGalleryJob(root, product);
  for (let i = 0; i < 500; i++) { await new Promise(resolve => setTimeout(resolve, 5)); const state = galleryJob(root, job.id); if (state.state !== "running") return state; }
  throw new Error("timeout");
}
afterEach(() => { for (const r of roots.splice(0)) fs.rmSync(r, { recursive: true, force: true }); });
it("follows cross-directory dependencies, deduplicates files, preserves versions and reuses unchanged thumbnails without writing CAD", async () => {
  const r = root();
  save(r, "product/Top.ASSY.FCStd", { refs: ["../shared/A.FCStd", "../shared/A.FCStd", "../old/A.FCStd"] });
  save(r, "shared/A.FCStd", { name: "源名称" }); save(r, "old/A.FCStd", { noImage: true });
  const before = fcstdFingerprint(fs.readFileSync(path.join(r, "product/Top.ASSY.FCStd")));
  const first = await run(r, "product/Top.ASSY.FCStd"); expect(first).toMatchObject({ completed: 3, reused: 0, state: "attention" });
  const data = loadGallery(r, "product/Top.ASSY.FCStd"); expect(data.rows).toHaveLength(3);
  expect(data.rows.find(row => row.rel === "shared/A.FCStd")).toMatchObject({ part_name: "源名称", status: "ready", width: 1, height: 1 });
  expect(data.rows.find(row => row.rel === "old/A.FCStd")?.status).toBe("missing");
  expect(thumbnailBytes(r, "shared/A.FCStd")).toEqual(png);
  expect((await run(r, "product/Top.ASSY.FCStd")).reused).toBe(3);
  expect(fcstdFingerprint(fs.readFileSync(path.join(r, "product/Top.ASSY.FCStd")))).toBe(before);
  save(r, "shared/A.FCStd", { name: "新版名称" });
  expect(loadGallery(r, "product/Top.ASSY.FCStd").rows.find(row => row.rel === "shared/A.FCStd")?.status).toBe("stale");
  expect(() => thumbnailBytes(r, "shared/A.FCStd")).toThrow("过期");
  await run(r, "product/Top.ASSY.FCStd"); expect(loadGallery(r, "product/Top.ASSY.FCStd").rows.find(row => row.rel === "shared/A.FCStd")?.part_name).toBe("新版名称");
});
it("reports missing references, cycles, unsafe symlinks and broken archives", async () => {
  const r = root(), outside = root(); save(outside, "secret.FCStd");
  save(r, "Root.ASSY.FCStd", { refs: ["B.FCStd", "Absent.FCStd", "Escape.FCStd", "../Outside.FCStd"] });
  save(r, "B.FCStd", { refs: ["Root.ASSY.FCStd"] });
  fs.symlinkSync(path.join(outside, "secret.FCStd"), path.join(r, "Escape.FCStd"));
  expect((await run(r, "Root.ASSY.FCStd")).state).toBe("attention");
  const data = loadGallery(r, "Root.ASSY.FCStd"); expect(data.rows).toHaveLength(2);
  expect(data.issues.map(i => i.message).join(" ")).toMatch(/循环/);
  expect(data.issues.map(i => i.message).join(" ")).toMatch(/符号链接/);
  expect(data.issues.map(i => i.message).join(" ")).toMatch(/不允许 \.\./);
  expect(() => startGalleryJob(r, "../escape.FCStd")).toThrow();
  fs.writeFileSync(path.join(r, "Bad.FCStd"), "not a zip"); await run(r, "Bad.FCStd");
  expect(loadGallery(r, "Bad.FCStd").rows[0].status).toBe("error");
});
it("allows read-only empty GET without creating a DB; global scope reads only indexed files", async () => {
  const r = root(); expect(loadGallery(r).rows).toEqual([]); expect(fs.existsSync(path.join(r, ".phoenix"))).toBe(false);
  const response = await partGalleryRoutes.request(`/catalog?workspace=${encodeURIComponent(r)}`); expect(response.status).toBe(200);
  save(r, "One.FCStd"); save(r, "Top.ASSY.FCStd"); save(r, "Unindexed.FCStd");
  fs.mkdirSync(path.join(r, ".phoenix"));
  const db = pnwCreateDb(path.join(r, ".phoenix/phoenix-workspace.sqlite"));
  db.exec("CREATE TABLE phoenix_cad_file_asset(repo_rel_path TEXT,asset_kind TEXT,file_status TEXT)");
  for (const values of [["./One.FCStd", "part", "present"], ["Top.ASSY.FCStd", "assembly", "present"], ["Missing.FCStd", "part", "missing"], ["Other.step", "part", "present"]]) db.run("INSERT INTO phoenix_cad_file_asset VALUES(?,?,?)", values);
  db.close();
  expect(galleryOptions(r)).toEqual({ products: ["Top.ASSY.FCStd"], indexed_files: 2 });
  await run(r, ""); expect(loadGallery(r).rows.map(row => row.rel).sort()).toEqual(["One.FCStd", "Top.ASSY.FCStd"]);
});
it("filters root and nested excluded directories from legacy index entries without deleting backups or excluding dot-prefixed files", async () => {
  const r = root();
  const visible = ["Visible.FCStd", "product/Top.ASSY.FCStd", "product/.Draft.FCStd"];
  const excluded = [".thumbnail-backups/Saved.FCStd", "product/.history/Old.ASSY.FCStd", "__pycache__/Cache.FCStd", "product/__pycache__/Cache.FCStd", "node_modules/demo/Model.FCStd", "product/node_modules/demo/Model.FCStd", ".git/Copy.FCStd", "product/.venv/Model.FCStd"];
  for (const rel of [...visible, ...excluded]) save(r, rel, { number: "SYNTHETIC" });
  const before = excluded.map(rel => fcstdFingerprint(fs.readFileSync(path.join(r, rel))));
  const db = openGalleryDb(r, true)!;
  db.exec("CREATE TABLE phoenix_cad_file_asset(repo_rel_path TEXT,asset_kind TEXT,file_status TEXT)");
  for (const rel of [...visible, ...excluded]) db.run("INSERT INTO phoenix_cad_file_asset VALUES(?,?,?)", [`./${rel}`, "part", "present"]);
  db.close();
  expect(galleryOptions(r)).toEqual({ products: ["product/Top.ASSY.FCStd"], indexed_files: visible.length });
  expect(await run(r, "")).toMatchObject({ state: "done", completed: visible.length });
  expect(loadGallery(r).rows.map(row => row.rel).sort()).toEqual([...visible].sort());
  expect(excluded.map(rel => fcstdFingerprint(fs.readFileSync(path.join(r, rel))))).toEqual(before);
});
it("skips excluded reference targets silently, including missing backups, while rejecting explicit excluded products", async () => {
  const r = root();
  save(r, "product/Top.ASSY.FCStd", { number: "SYNTHETIC", refs: ["Unit.FCStd", "../.thumbnail-backups/Old.FCStd", ".history/Missing.FCStd", "__pycache__/Missing.FCStd", "../node_modules/demo/Missing.FCStd", "../.git/Missing.FCStd"] });
  save(r, "product/Unit.FCStd", { number: "SYNTHETIC" });
  expect(await run(r, "product/Top.ASSY.FCStd")).toMatchObject({ state: "done", completed: 2 });
  expect(loadGallery(r, "product/Top.ASSY.FCStd")).toMatchObject({ issues: [] });
  expect(loadGallery(r, "product/Top.ASSY.FCStd").rows.map(row => row.rel).sort()).toEqual(["product/Top.ASSY.FCStd", "product/Unit.FCStd"]);
  for (const rel of [".thumbnail-backups/Old.ASSY.FCStd", "product/.history/Old.ASSY.FCStd", "product/__pycache__/Old.ASSY.FCStd", "node_modules/demo/Old.ASSY.FCStd"])
    expect(() => startGalleryJob(r, rel)).toThrow("默认图册范围");
});
it("hides polluted catalog members and their host issues at read time, retaining historical DB records", async () => {
  const r = root(); save(r, "Visible.FCStd", { number: "SYNTHETIC" }); await run(r, "Visible.FCStd");
  const excluded = [".thumbnail-backups/Old.FCStd", "product/.history/Old.FCStd", "product/__pycache__/Old.FCStd", "node_modules/demo/Old.FCStd"];
  const db = openGalleryDb(r)!, visible = cachedRow(db, "Visible.FCStd")!;
  for (const rel of excluded) {
    saveRow(db, { ...visible, rel, status: "error", source_stamp: "", message: "旧备份读取失败" });
    db.run("INSERT INTO desk_cad_gallery_member(product,rel) VALUES(?,?)", ["Visible.FCStd", rel]);
  }
  const issues = [{ rel: "Visible.FCStd", message: "保留可见源文件提示" }, ...excluded.map(rel => ({ rel, message: "旧隐藏来源提示" }))];
  db.run("UPDATE desk_cad_gallery_scope SET issues_json=? WHERE product=?", [JSON.stringify(issues), "Visible.FCStd"]);
  db.run("INSERT INTO desk_cad_gallery_scope(product,updated_at,issues_json) VALUES(?,?,?)", [excluded[0], "2026-01-01", "[]"]);
  db.run("INSERT INTO desk_cad_gallery_member(product,rel) VALUES(?,?)", [excluded[0], excluded[0]]);
  db.close();
  const data = loadGallery(r, "Visible.FCStd");
  expect(data.rows.map(row => row.rel)).toEqual(["Visible.FCStd"]);
  expect(data.issues).toEqual([issues[0]]);
  expect(loadGallery(r, excluded[0])).toEqual({ product: excluded[0], updated_at: "", rows: [], issues: [] });
  const retained = openGalleryDb(r)!;
  expect(retained.all("SELECT rel FROM desk_cad_gallery_member WHERE product=?", ["Visible.FCStd"])).toHaveLength(excluded.length + 1);
  expect(retained.all("SELECT rel FROM desk_cad_thumbnail")).toHaveLength(excluded.length + 1);
  retained.close();
});
it("uses only visible cached catalog rows for dimensions and rejects excluded product scopes before native work", async () => {
  const r = root(); save(r, "Visible.FCStd", { number: "SYNTHETIC" }); await run(r, "Visible.FCStd");
  const db = openGalleryDb(r)!, visible = cachedRow(db, "Visible.FCStd")!;
  db.run("INSERT INTO desk_cad_gallery_scope(product,updated_at,issues_json) VALUES(?,?,?)", ["", "2026-01-01", "[]"]);
  db.run("INSERT INTO desk_cad_gallery_member(product,rel) VALUES(?,?)", ["", visible.rel]);
  for (const rel of [".thumbnail-backups/Old.FCStd", "product/.history/Old.FCStd", "product/__pycache__/Old.FCStd"]) {
    saveRow(db, { ...visible, rel, status: "error", source_stamp: "" });
    db.run("INSERT INTO desk_cad_gallery_member(product,rel) VALUES(?,?)", ["", rel]);
    expect(() => startGeometryJob(r, rel)).toThrow("默认图册范围");
  }
  db.close();
  const read = vi.fn(async (inputs: GeometryInput[]) => inputs.map(input => ({ rel: input.rel, bounding_box: { x_mm: 1, y_mm: 2, z_mm: 3 }, message: "synthetic" })));
  const job = startGeometryJob(r, "", read);
  let finished = false;
  for (let index = 0; index < 500; index++) {
    await new Promise(resolve => setTimeout(resolve, 5));
    const state = geometryJob(r, job.id);
    if (state && state.state !== "running") { expect(state).toMatchObject({ state: "done", completed: 1, total: 1 }); finished = true; break; }
  }
  expect(finished).toBe(true);
  expect(read).toHaveBeenCalledOnce();
  expect(read.mock.calls[0][0].map(input => input.rel)).toEqual(["Visible.FCStd"]);
});
it("archives only PNG by default, maintains same basenames in separate source directories, and never stages Git", async () => {
  const r = root(); execFileSync("git", ["init", r], { stdio: "ignore" });
  save(r, "Top.ASSY.FCStd", { refs: ["a/Same.FCStd", "b/Same.FCStd"] }); save(r, "a/Same.FCStd"); save(r, "b/Same.FCStd");
  await run(r, "Top.ASSY.FCStd"); const rels = loadGallery(r, "Top.ASSY.FCStd").rows.map(row => row.rel);
  const body = { product: "Top.ASSY.FCStd", rels, directory: "assets/thumbnails", include_documents: false, confirmed: true };
  expect(() => archiveGallery(r, { ...body, confirmed: false })).toThrow();
  const result = archiveGallery(r, body); expect(result.png_count).toBe(3);
  expect(fs.existsSync(path.join(r, result.directory, "catalog.html"))).toBe(false);
  expect(fs.readFileSync(path.join(r, result.directory, "a/Same.png"))).toEqual(png);
  expect(fs.readFileSync(path.join(r, result.directory, "b/Same.png"))).toEqual(png);
  expect(execFileSync("git", ["-C", r, "diff", "--cached", "--name-only"], { encoding: "utf8" })).toBe("");
  const second = archiveGallery(r, { ...body, include_documents: true }); expect(second.directory).toBe(result.directory); expect(second.reused).toBe(3);
  expect(second.directory).toBe("assets/thumbnails");
  const html = fs.readFileSync(path.join(r, second.document_directory, "catalog.html"), "utf8"); expect(html).toContain("../../a/Same.png"); expect(html).not.toContain(r);
  const db = pnwCreateDb(path.join(r, ".phoenix/phoenix-workspace.sqlite")); expect(db.all("SELECT * FROM desk_cad_thumbnail_archive")).toHaveLength(3); db.close();
  fs.writeFileSync(path.join(r, ".gitignore"), "ignored/\n");
  expect(() => archiveGallery(r, { ...body, directory: "ignored" })).toThrow("忽略");
  fs.writeFileSync(path.join(r, ".gitignore"), "Same.png\n");
  expect(() => archiveGallery(r, body)).toThrow("忽略");
  expect(() => archiveGallery(r, { ...body, directory: "../outside" })).toThrow();
  expect(() => archiveGallery(r, { ...body, directory: ".GIT/images" })).toThrow();
});
it("flattens nested source directories, reuses registered PNGs for gallery and primary, and does not re-open CAD", async () => {
  const r = root(); execFileSync("git", ["init", r], { stdio: "ignore" });
  const rel = "product/models/deep/Unit.FCStd";
  save(r, rel); await run(r, rel);
  const result = archiveGallery(r, { product: rel, rels: [rel], directory: "assets/thumbnails", include_documents: false, confirmed: true });
  expect(result.directory).toBe("assets/thumbnails");
  const output = path.join(r, "assets/thumbnails/product/Unit.png"); expect(fs.readFileSync(output)).toEqual(png);
  const row = loadGallery(r, rel).rows[0]; fs.unlinkSync(path.join(r, `.phoenix/thumbnail-cache/${row.image_hash}.png`));
  const read = vi.spyOn(fs, "readFileSync");
  try {
    expect(thumbnailBytes(r, rel)).toEqual(png);
    expect(readFileThumbnail(r, rel)?.data_url).toContain(png.toString("base64"));
    expect(read.mock.calls.some(call => call[0] === path.join(r, rel))).toBe(false);
  } finally { read.mockRestore(); }
  expect((await run(r, rel)).reused).toBe(1);
  fs.writeFileSync(output, "externally edited");
  await run(r, rel); // Missing valid PNG is rebuilt into the private cache, not the edited archive.
  expect(fs.readFileSync(output, "utf8")).toBe("externally edited");
  expect(() => archiveGallery(r, { product: rel, rels: [rel], directory: "assets/thumbnails", include_documents: false, confirmed: true })).toThrow("外部修改");
});
it("blocks same-level basename collisions before export and keeps historical snapshots intact", async () => {
  const r = root(); execFileSync("git", ["init", r], { stdio: "ignore" });
  save(r, "Top.ASSY.FCStd", { refs: ["group/a/Same.FCStd", "group/b/Same.FCStd"] });
  save(r, "group/a/Same.FCStd"); save(r, "group/b/Same.FCStd");
  await run(r, "Top.ASSY.FCStd");
  expect(() => archiveGallery(r, { product: "Top.ASSY.FCStd", rels: loadGallery(r, "Top.ASSY.FCStd").rows.map(row => row.rel), directory: "assets/thumbnails", include_documents: false, confirmed: true })).toThrow("同名冲突");
  expect(fs.existsSync(path.join(r, "assets/thumbnails"))).toBe(false);
});
it("updates only registered unchanged archive bytes, backing up the previous PNG", async () => {
  const r = root(); execFileSync("git", ["init", r], { stdio: "ignore" });
  save(r, "Unit.FCStd"); await run(r, "Unit.FCStd");
  const body = { product: "Unit.FCStd", rels: ["Unit.FCStd"], directory: "assets/thumbnails", include_documents: false, confirmed: true };
  archiveGallery(r, body);
  const changed = Buffer.concat([png, Buffer.from("new synthetic image version")]);
  save(r, "Unit.FCStd", { png: changed }); await run(r, "Unit.FCStd");
  expect(archiveGallery(r, body).updated).toBe(1);
  expect(fs.readFileSync(path.join(r, "assets/thumbnails/Unit.png"))).toEqual(changed);
  const backups = fs.readdirSync(path.join(r, ".phoenix/thumbnail-archive-backups")); expect(backups).toHaveLength(1);
  expect(fs.readFileSync(path.join(r, ".phoenix/thumbnail-archive-backups", backups[0]))).toEqual(png);
});
it("rejects tampered image caches, invalid PNGs, changed export inputs and cross-workspace jobs", async () => {
  const r = root(), other = root(); save(r, "A.FCStd");
  const job = await run(r, "A.FCStd"); const row = loadGallery(r, "A.FCStd").rows[0];
  expect(() => galleryJob(other, job.id)).toThrow("任务不存在");
  fs.writeFileSync(path.join(r, `.phoenix/thumbnail-cache/${row.image_hash}.png`), "tampered");
  expect(() => thumbnailBytes(r, "A.FCStd")).toThrow("校验失败");
  expect(() => printGallery(r, { product: "A.FCStd", rels: ["Other.FCStd"] })).toThrow("不属于");
  save(r, "Bad.FCStd", { png: Buffer.from("not a png") }); await run(r, "Bad.FCStd");
  expect(loadGallery(r, "Bad.FCStd").rows[0]).toMatchObject({ status: "error" });
  save(r, "A.FCStd", { name: "名称变化" });
  expect(() => printGallery(r, { product: "A.FCStd", rels: ["A.FCStd"] })).toThrow("已变化");
});
it("generates self-contained escaped A4 documents without storing them or including absolute paths", async () => {
  const r = root(); save(r, "Sample.FCStd", { name: "&lt;script&gt;不执行&lt;/script&gt;" }); await run(r, "Sample.FCStd");
  const html = printGallery(r, { product: "Sample.FCStd", rels: ["Sample.FCStd"] }).html;
  expect(html).toContain("data:image/png;base64,"); expect(html).toContain("&lt;script&gt;"); expect(html).not.toContain("<script>"); expect(html).not.toContain(r); expect(html).toContain("size:A4");
  const row = loadGallery(r, "Sample.FCStd").rows[0];
  expect(galleryDocument(Array.from({ length: 21 }, () => row), "产品", "2026-01-01", () => "").match(/class="sheet"/g)).toHaveLength(2);
  const optionsHtml = printGallery(r, { product: "Sample.FCStd", rels: ["Sample.FCStd"], show_category: false, show_dimensions: false, show_part_number: false, show_filenames: true }).html;
  expect(optionsHtml).not.toContain('class="badges"');
  expect(optionsHtml).not.toContain('class="dimensions"');
  expect(optionsHtml).not.toContain('class="number"');
  expect(optionsHtml).toContain('<div class="file" title="Sample.FCStd">Sample.FCStd</div>');
});
