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
import * as executionGate from "../drawing-research/executionGate.js";
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
it("reports a missing source with a relative recovery hint before acquiring the Native gate", async () => {
  const root = fixture(), render = vi.fn(async () => png), gate = vi.spyOn(executionGate, "acquireDrawingExecution");
  const error = await regenerateThumbnail(root, "models/Absent.FCStd", options, render).catch(cause => cause);
  expect(error).toMatchObject({ code: "thumbnail_source_missing", rel: "models/Absent.FCStd" });
  expect(error.message).toContain("刷新 CAD 索引和图册");
  expect(error.message).not.toContain(root); expect(error.message).not.toContain(fs.realpathSync(root));
  expect(error.message).not.toContain("ENOENT"); expect(render).not.toHaveBeenCalled(); expect(gate).not.toHaveBeenCalled();
  expect(fs.existsSync(path.join(root, ".phoenix"))).toBe(false);
});
it("reports a missing dependency separately without guessing another file or acquiring the Native gate", async () => {
  const root = fixture(); save(root, xlink('file="models/Absent.FCStd" name="Body"')); save(root, "", "other/Absent.FCStd");
  const before = fs.readFileSync(path.join(root, "Demo.FCStd")), render = vi.fn(async () => png), gate = vi.spyOn(executionGate, "acquireDrawingExecution");
  const error = await regenerateThumbnail(root, "Demo.FCStd", options, render).catch(cause => cause);
  expect(error).toMatchObject({ code: "thumbnail_dependency_missing", rel: "models/Absent.FCStd" });
  expect(error.message).toContain("先修复装配链接"); expect(error.message).not.toContain(root);
  expect(error.message).not.toContain(fs.realpathSync(root)); expect(error.message).not.toContain("ENOENT");
  expect(render).not.toHaveBeenCalled(); expect(gate).not.toHaveBeenCalled();
  expect(fs.readFileSync(path.join(root, "Demo.FCStd"))).toEqual(before); expect(fs.existsSync(path.join(root, ".phoenix"))).toBe(false);
});
it.each(["source", "dependency"] as const)("rejects a %s deleted during rendering without publishing or recreating files", async kind => {
  const root = fixture(); save(root, xlink('file="Child.FCStd" name="Body"')); save(root, "", "Child.FCStd");
  const before = fs.readFileSync(path.join(root, "Demo.FCStd")), rel = kind === "source" ? "Demo.FCStd" : "Child.FCStd";
  const publish = vi.spyOn(gallery, "cacheRenderedThumbnail"), render = vi.fn(async () => { fs.unlinkSync(path.join(root, rel)); return png; });
  const error = await regenerateThumbnail(root, "Demo.FCStd", options, render).catch(cause => cause);
  expect(error).toMatchObject({ code: kind === "source" ? "thumbnail_source_missing" : "thumbnail_dependency_missing", rel });
  expect(error.message).not.toContain(root); expect(error.message).not.toContain(fs.realpathSync(root));
  expect(render).toHaveBeenCalledOnce(); expect(publish).not.toHaveBeenCalled(); expect(fs.existsSync(path.join(root, rel))).toBe(false);
  if (kind === "dependency") expect(fs.readFileSync(path.join(root, "Demo.FCStd"))).toEqual(before);
  expect(fs.existsSync(path.join(root, ".phoenix"))).toBe(false);
});
it("does not relabel permission failures, symlinks or invalid archives as missing files", async () => {
  const root = fixture(), canonical = fs.realpathSync(root), file = path.join(canonical, "Demo.FCStd"), lstat = fs.lstatSync;
  const render = vi.fn(async () => png);
  const denied = Object.assign(new Error("synthetic permission denied"), { code: "EACCES" });
  const read = vi.spyOn(fs, "lstatSync").mockImplementation(((name: fs.PathLike, ...args: unknown[]) => {
    if (String(name) === file) throw denied;
    return Reflect.apply(lstat, fs, [name, ...args]);
  }) as typeof fs.lstatSync);
  const permission = await regenerateThumbnail(root, "Demo.FCStd", options, render).catch(cause => cause);
  expect(permission.message).toBe("synthetic permission denied"); expect(permission).not.toHaveProperty("code", "thumbnail_source_missing");
  read.mockRestore();
  fs.symlinkSync(path.join(root, "NotPresent.FCStd"), path.join(root, "Alias.FCStd"));
  const alias = await regenerateThumbnail(root, "Alias.FCStd", options, render).catch(cause => cause);
  expect(alias.message).toContain("符号链接"); expect(alias).not.toHaveProperty("code", "thumbnail_source_missing");
  fs.writeFileSync(path.join(root, "Bad.FCStd"), "not an archive");
  const invalid = await regenerateThumbnail(root, "Bad.FCStd", options, render).catch(cause => cause);
  expect(invalid).not.toHaveProperty("code", "thumbnail_source_missing"); expect(invalid.message).not.toContain("thumbnail_dependency_missing");
  expect(render).not.toHaveBeenCalled(); expect(fs.existsSync(path.join(root, ".phoenix"))).toBe(false);
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
