import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { zipSync, strToU8, unzipSync } from "fflate";
import { afterEach, expect, it, vi } from "vitest";
import { regenerateThumbnail, thumbnailOptions, thumbnailSources, thumbnailTimeoutStage } from "./service.js";
import { readFileThumbnail } from "../../lib/fcstdThumbnail.js";
import { thumbnailBytes } from "../part-gallery/service.js";
import { ensureSaveThumbnail } from "./preferences.js";
import * as gallery from "../part-gallery/service.js";
vi.mock("./preferences.js", () => ({ ensureSaveThumbnail: vi.fn(async () => {}) }));
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j6mcAAAAASUVORK5CYII=", "base64");
const options = { color: "original", axonometric: true, fit: true };
const roots: string[] = [];
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "thumbnail-test-")); roots.push(root);
  save(root); return root;
}
function save(root: string, extra = "", rel = "Demo.FCStd") {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), zipSync({ "Document.xml": strToU8(`<Document><Objects><Object name="Body" type="PartDesign::Body"/></Objects><ObjectData>${extra}</ObjectData></Document>`) }));
}
const xlink = (attributes: string) => `<Object name="Link"><Properties Count="1"><Property name="LinkedObject" type="App::PropertyXLink"><XLink ${attributes}/></Property></Properties></Object>`;
afterEach(() => { vi.restoreAllMocks(); vi.mocked(ensureSaveThumbnail).mockReset().mockResolvedValue(undefined); for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
it("reports only known timeout stages, without exposing arbitrary report text", () => {
  expect(thumbnailTimeoutStage({ stage: "rendering" })).toBe("渲染图片");
  expect(thumbnailTimeoutStage({ status: "completed" })).toBe("退出渲染进程");
  for (const value of [undefined, { stage: "/private/example" }, { stage: "__proto__" }]) expect(thumbnailTimeoutStage(value)).toBe("启动 FreeCAD 图形程序");
});
it("writes only the embedded thumbnail and publishes the new file hash into the shared detail/gallery cache", async () => {
  const root = fixture(), before = fs.readFileSync(path.join(root, "Demo.FCStd"));
  const render = vi.fn(async () => png);
  const result = await regenerateThumbnail(root, "Demo.FCStd", options, render);
  expect(ensureSaveThumbnail).not.toHaveBeenCalled();
  expect(render).toHaveBeenCalledWith(fs.realpathSync(path.join(root, "Demo.FCStd")), options);
  expect(readFileThumbnail(root, "Demo.FCStd")?.data_url).toBe(`data:image/png;base64,${png.toString("base64")}`);
  expect(thumbnailBytes(root, "Demo.FCStd")).toEqual(png);
  const saved = unzipSync(fs.readFileSync(path.join(root, "Demo.FCStd")));
  expect(saved["Document.xml"]).toEqual(unzipSync(before)["Document.xml"]);
  expect(Buffer.from(saved["thumbnails/Thumbnail.png"])).toEqual(png);
  expect(fs.readFileSync(path.join(root, result.backup))).toEqual(before);
});
it("reports the completed FCStd write truthfully when the derived cache cannot be updated", async () => {
  const root = fixture(), before = fs.readFileSync(path.join(root, "Demo.FCStd"));
  vi.spyOn(gallery, "cacheRenderedThumbnail").mockImplementationOnce(() => { throw new Error("synthetic cache failure"); });
  const result = await regenerateThumbnail(root, "Demo.FCStd", options, async () => png);
  expect(result.message).toMatch(/已写入 FCStd.*缓存更新失败/);
  expect(readFileThumbnail(root, "Demo.FCStd")?.data_url).toBe(`data:image/png;base64,${png.toString("base64")}`);
  expect(fs.readFileSync(path.join(root, result.backup))).toEqual(before);
});
it("renders without calling or depending on a connected user GUI preference operation", async () => {
  const root = fixture(), before = fs.readFileSync(path.join(root, "Demo.FCStd")), render = vi.fn(async () => png);
  vi.mocked(ensureSaveThumbnail).mockRejectedValueOnce(new Error("无法持久化保存缩略图"));
  const result=await regenerateThumbnail(root, "Demo.FCStd", options, render);
  expect(ensureSaveThumbnail).not.toHaveBeenCalled();expect(render).toHaveBeenCalledWith(fs.realpathSync(path.join(root,"Demo.FCStd")),options);
  expect(readFileThumbnail(root,"Demo.FCStd")?.data_url).toBe(`data:image/png;base64,${png.toString("base64")}`);
  expect(fs.readFileSync(path.join(root,result.backup))).toEqual(before);
});
it("preserves a successful thumbnail on renderer failure or invalid PNG", async () => {
  const root = fixture(); await regenerateThumbnail(root, "Demo.FCStd", options, async () => png);
  await expect(regenerateThumbnail(root, "Demo.FCStd", options, async () => { throw new Error("renderer unavailable"); })).rejects.toThrow("renderer unavailable");
  await expect(regenerateThumbnail(root, "Demo.FCStd", options, async () => Buffer.from("bad"))).rejects.toThrow("PNG");
  expect(thumbnailBytes(root, "Demo.FCStd")).toEqual(png);
});
it("rejects concurrent requests and releases its lock after completion", async () => {
  const root = fixture(); let finish!: (png: Buffer) => void;
  const first = regenerateThumbnail(root, "Demo.FCStd", options, () => new Promise(resolve => { finish = resolve; }));
  await expect(regenerateThumbnail(root, "Demo.FCStd", options)).rejects.toThrow("正在生成");
  finish(png); await first;
  await expect(regenerateThumbnail(root, "Demo.FCStd", options, async () => png)).resolves.toMatchObject({ width: 1 });
});
it("rejects stale source or linked geometry before publishing", async () => {
  const root = fixture();
  await expect(regenerateThumbnail(root, "Demo.FCStd", options, async () => { save(root, "<!--changed-->"); return png; })).rejects.toThrow("已变化");
  save(root, '<Object name="Link"><Properties><Property name="LinkedObject" type="App::PropertyXLink"><XLink file="Child.FCStd" name="Body"/></Property></Properties></Object>');
  save(root, "", "Child.FCStd");
  await expect(regenerateThumbnail(root, "Demo.FCStd", options, async () => { save(root, "<!--changed-->", "Child.FCStd"); return png; })).rejects.toThrow("已变化");
  expect(fs.existsSync(path.join(root, ".phoenix"))).toBe(false);
});
it("rejects unsafe paths, missing dependencies, drawings and invalid options before rendering", async () => {
  const root = fixture(), render = vi.fn(async () => png);
  for (const rel of ["../Demo.FCStd", "/Demo.FCStd", "Demo.step"]) await expect(regenerateThumbnail(root, rel, options, render)).rejects.toThrow();
  fs.symlinkSync(path.join(root, "Demo.FCStd"), path.join(root, "Alias.FCStd"));
  await expect(regenerateThumbnail(root, "Alias.FCStd", options, render)).rejects.toThrow("符号链接");
  save(root, '<Object type="TechDraw::DrawPage"/>', "Demo.Drawing.FCStd");
  await expect(regenerateThumbnail(root, "Demo.Drawing.FCStd", options, render)).rejects.toThrow("源模型");
  save(root, '<Object name="Link"><Properties><Property name="LinkedObject" type="App::PropertyXLink"><XLink file="Missing.FCStd" name="Body"/></Property></Properties></Object>');
  await expect(regenerateThumbnail(root, "Demo.FCStd", options, render)).rejects.toThrow();
  for (const invalid of [null, {}, { ...options, color: "unknown" }, { ...options, fit: "yes" }]) expect(() => thumbnailOptions(invalid)).toThrow("选项");
  expect(render).not.toHaveBeenCalled();
});
it("allows a model with embedded TechDraw pages, without treating it as a standalone drawing", async () => {
  const root = fixture(); save(root, '<Object type="TechDraw::DrawPage"/>');
  await expect(regenerateThumbnail(root, "Demo.FCStd", options, async () => png)).resolves.toMatchObject({ width: 1 });
});
it.each(["../External.step", "../External.bin", "Child.step"])("rejects non-FCStd native dependency %s before MCP or rendering instead of silently filtering it", async dependency => {
  const root = fixture(); save(root, xlink(`file="${dependency}" name="Body"`));
  const before = fs.readFileSync(path.join(root, "Demo.FCStd")), render = vi.fn(async () => png);
  await expect(regenerateThumbnail(root, "Demo.FCStd", options, render)).rejects.toThrow(/依赖/);
  expect(ensureSaveThumbnail).not.toHaveBeenCalled(); expect(render).not.toHaveBeenCalled();
  expect(fs.readFileSync(path.join(root, "Demo.FCStd"))).toEqual(before); expect(fs.existsSync(path.join(root, ".phoenix"))).toBe(false);
});
it.each(["../Outside>Child.FCStd", "../Outside&gt;Child.FCStd", "/outside/A>B.FCStd", "C:\\external\\A>B.FCStd"])("rejects quote-containing external native dependency %s before MCP or rendering", async dependency => {
  const root = fixture(); save(root, xlink(`name='Body' file="${dependency}"`));
  const before = fs.readFileSync(path.join(root, "Demo.FCStd")), render = vi.fn(async () => png);
  await expect(regenerateThumbnail(root, "Demo.FCStd", options, render)).rejects.toThrow();
  expect(ensureSaveThumbnail).not.toHaveBeenCalled(); expect(render).not.toHaveBeenCalled();
  expect(fs.readFileSync(path.join(root, "Demo.FCStd"))).toEqual(before); expect(fs.existsSync(path.join(root, ".phoenix"))).toBe(false);
});
it("preflights legitimate quote-safe layouts and ignores opaque text without changing gallery discovery", async () => {
  const root = fixture();
  save(root, "", "models/A>B.FCStd"); save(root, "", "models/A&gt;B.FCStd");
  save(root, `<!-- <XLink file="../Outside.step"/> --><![CDATA[<XLink file="../Outside.step"/>]]>`
    + xlink("name = 'Body'\n file = 'models/A>B.FCStd'")
    + xlink('file="models/A&amp;gt;B.FCStd" name="Body"'));
  const snapshots = thumbnailSources(fs.realpathSync(root), "Demo.FCStd");
  expect([...snapshots.keys()].map(filename => path.basename(filename)).sort()).toEqual(["A>B.FCStd", "A&gt;B.FCStd", "Demo.FCStd"].sort());
  const before = ["models/A>B.FCStd", "models/A&gt;B.FCStd"].map(rel => fs.readFileSync(path.join(root, rel)));
  const render = vi.fn(async () => png);
  await expect(regenerateThumbnail(root, "Demo.FCStd", options, render)).resolves.toMatchObject({ width: 1 });
  expect(ensureSaveThumbnail).not.toHaveBeenCalled(); expect(render).toHaveBeenCalledOnce();
  ["models/A>B.FCStd", "models/A&gt;B.FCStd"].forEach((rel, index) => expect(fs.readFileSync(path.join(root, rel))).toEqual(before[index]));
});
it("tracks quote-containing dependencies through rendering and refuses changed geometry before writing PNG", async () => {
  const root = fixture(); save(root, "", "A>B.FCStd"); save(root, xlink("file='A>B.FCStd' name='Body'"));
  const before = fs.readFileSync(path.join(root, "Demo.FCStd"));
  await expect(regenerateThumbnail(root, "Demo.FCStd", options, async () => { save(root, "<!-- synthetic change -->", "A>B.FCStd"); return png; })).rejects.toThrow(/已变化/);
  expect(ensureSaveThumbnail).not.toHaveBeenCalled(); expect(fs.readFileSync(path.join(root, "Demo.FCStd"))).toEqual(before);
  expect(fs.existsSync(path.join(root, ".phoenix"))).toBe(false);
});
it.each([
  '<XLink file="Child.FCStd" file="Other.FCStd"/>', '<XLink file="A&bogus;B.FCStd"/>',
  '<XLink file="A&#0;B.FCStd"/>', '<XLink file="Child.FCStd" broken/>', '<XLink file="Child.FCStd',
  '<!DOCTYPE Document SYSTEM "external"><XLink file="Child.FCStd"/>',
])("rejects ambiguous native XLink structure before MCP or rendering: %s", async extra => {
  const root = fixture(); save(root, extra); const render = vi.fn(async () => png);
  await expect(regenerateThumbnail(root, "Demo.FCStd", options, render)).rejects.toThrow();
  expect(ensureSaveThumbnail).not.toHaveBeenCalled(); expect(render).not.toHaveBeenCalled(); expect(fs.existsSync(path.join(root, ".phoenix"))).toBe(false);
});
