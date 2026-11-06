import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { strToU8, zipSync } from "fflate";
import { afterEach, expect, it, vi } from "vitest";
import * as archives from "../../lib/fcstdBatchFiles.js";
import * as storage from "./storage.js";
import { observeGalleryScope, parseGalleryScopeProof, resolveGalleryReference, serializeGalleryScopeProof, type GalleryScopeProof } from "./scope.js";

const roots: string[] = [];
function root() {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "gallery-scope-test-")));
  roots.push(directory); return directory;
}
function xml(refs: string[] = [], extra = "") {
  return `<Document><ObjectData><Object name="ExampleFeature"><Properties>${refs.map(file => `<Property name="LinkedObject" type="App::PropertyXLink"><XLink file="${file}" name="ExampleFeature"/></Property>`).join("")}</Properties></Object></ObjectData>${extra}</Document>`;
}
function save(directory: string, rel: string, refs: string[] = [], extra = "") {
  fs.mkdirSync(path.dirname(path.join(directory, rel)), { recursive: true });
  // Deliberately invalid PNG: membership must not decode thumbnail members.
  fs.writeFileSync(path.join(directory, rel), zipSync({ "Document.xml": strToU8(xml(refs, extra)), "thumbnails/Thumbnail.png": strToU8("not a thumbnail") }));
}
function proof(): GalleryScopeProof {
  return { version: 1, product: "Example.ASSY.FCStd", sources: [{ rel: "Example.ASSY.FCStd", stamp: "1:2:3.5:4.5", hash: "a".repeat(64), refs: ["Unit.FCStd"] }] };
}
function asProof(product: string, observed: ReturnType<typeof observeGalleryScope>): GalleryScopeProof {
  return { version: 1, product, sources: observed.sources };
}
function index(directory: string, files: string[]) {
  const db = storage.openGalleryDb(directory, true)!;
  db.exec("CREATE TABLE phoenix_cad_file_asset(repo_rel_path TEXT,file_status TEXT)");
  for (const rel of files) db.run("INSERT INTO phoenix_cad_file_asset VALUES(?,?)", [rel, "present"]);
  db.close();
}
afterEach(() => {
  vi.restoreAllMocks();
  for (const directory of roots.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

it("round-trips exact, independent scope proof fields", () => {
  const expected = proof();
  expect(parseGalleryScopeProof(serializeGalleryScopeProof(expected), expected.product)).toEqual(expected);
  expect(parseGalleryScopeProof(JSON.stringify({ version: 1, product: "", sources: [] }), "")).toEqual({ version: 1, product: "", sources: [] });
});

it.each([
  undefined, "", "null", "[]", "{broken", JSON.stringify({ version: 0, product: "Example.ASSY.FCStd", sources: [] }),
  JSON.stringify({ ...proof(), extra: true }), JSON.stringify({ ...proof(), product: "Other.ASSY.FCStd" }),
  JSON.stringify({ ...proof(), sources: [proof().sources[0], proof().sources[0]] }),
  JSON.stringify({ ...proof(), sources: [{ ...proof().sources[0], hash: "wrong" }] }),
  JSON.stringify({ ...proof(), sources: [{ ...proof().sources[0], stamp: "unknown" }] }),
  JSON.stringify({ ...proof(), sources: [{ ...proof().sources[0], rel: "../Outside.FCStd" }] }),
  JSON.stringify({ ...proof(), sources: [{ ...proof().sources[0], rel: "./Example.ASSY.FCStd" }] }),
  JSON.stringify({ ...proof(), sources: [{ ...proof().sources[0], rel: ".history/Example.FCStd" }] }),
  JSON.stringify({ ...proof(), sources: [{ ...proof().sources[0], refs: ["bad\0.FCStd"] }] }),
  JSON.stringify({ ...proof(), sources: [{ ...proof().sources[0], refs: ["x".repeat(4097)] }] }),
  JSON.stringify({ ...proof(), sources: [{ ...proof().sources[0], refs: Array(5001).fill("Unit.FCStd") }] }),
  JSON.stringify({ ...proof(), sources: Array(5001).fill(proof().sources[0]) }),
])("ignores malformed, legacy, wrong-scope or unbounded proof %#", raw => {
  expect(parseGalleryScopeProof(raw, "Example.ASSY.FCStd")).toBeNull();
});

it("bounds proof bytes and refuses to serialize invalid source claims", () => {
  expect(parseGalleryScopeProof(" ".repeat(8 * 1024 * 1024 + 1), "")).toBeNull();
  expect(() => serializeGalleryScopeProof({ ...proof(), sources: [{ ...proof().sources[0], hash: "wrong" }] })).toThrow("范围证明");
  const manyRefs = Array(5000).fill("Unit.FCStd");
  const sources = Array.from({ length: 6 }, (_, i) => ({ ...proof().sources[0], rel: `Unit${i}.FCStd`, refs: manyRefs }));
  expect(parseGalleryScopeProof(JSON.stringify({ ...proof(), sources }), proof().product)).toBeNull();
});

it("resolves absent targets lexically without touching disk and silently excludes default directories", () => {
  const directory = root(), stat = vi.spyOn(fs, "lstatSync");
  expect(resolveGalleryReference(directory, "product/Example.ASSY.FCStd", "../shared/Absent.FCStd")).toBe("shared/Absent.FCStd");
  expect(resolveGalleryReference(directory, "product/Example.ASSY.FCStd", "..\\shared\\Absent.FCStd")).toBe("shared/Absent.FCStd");
  for (const target of ["../.history/Absent.FCStd", "../node_modules/demo/Absent.FCStd", "../.git/Absent.FCStd", "__pycache__/Absent.FCStd"])
    expect(resolveGalleryReference(directory, "product/Example.ASSY.FCStd", target)).toBeNull();
  expect(resolveGalleryReference(directory, "product/Example.ASSY.FCStd", ".Draft.FCStd")).toBe("product/.Draft.FCStd");
  expect(stat).not.toHaveBeenCalled();
});

it.each(["../../Outside.FCStd", "/Outside.FCStd", "C:\\Outside.FCStd", "https://example.invalid/Unit.FCStd", "Unit.step", "Unit.FCStd\0"])("rejects unsafe or non-FCStd reference %s", file => {
  expect(() => resolveGalleryReference(root(), "product/Example.FCStd", file)).toThrow();
});

it("keeps fixed actionable boundary diagnostics without exposing private source paths", () => {
  const directory = root(), outside = root(); save(outside, "Unit.FCStd");
  save(directory, "product/Example.ASSY.FCStd", ["../../Outside.FCStd", "Linked.FCStd"]);
  fs.symlinkSync(path.join(outside, "Unit.FCStd"), path.join(directory, "product/Linked.FCStd"));
  const observed = observeGalleryScope(directory, "product/Example.ASSY.FCStd");
  expect(observed.members).toEqual(["product/Example.ASSY.FCStd"]); expect(observed.complete).toBe(false);
  expect(observed.issues.map(issue => issue.message)).toEqual(["图册引用超出工作空间，不允许 .. 越界", "符号链接不可用于图册范围"]);
  expect(JSON.stringify(observed.issues)).not.toContain(directory); expect(JSON.stringify(observed.issues)).not.toContain(outside);
});

it("reads actual XML rather than a fresh but unrelated shared thumbnail row", () => {
  const directory = root(); save(directory, "Example.ASSY.FCStd", ["Current.FCStd"]); save(directory, "Current.FCStd"); save(directory, "Old.FCStd");
  const db = storage.openGalleryDb(directory, true)!;
  storage.saveRow(db, { rel: "Example.ASSY.FCStd", part_number: "SYNTHETIC", part_version: "", part_name: "Example", type_code: "H", role: "assembly", status: "missing", width: 0, height: 0, image_hash: "", source_stamp: storage.fileStamp(path.join(directory, "Example.ASSY.FCStd")), source_hash: "b".repeat(64), updated_at: "", message: "", refs: ["Old.FCStd"] });
  db.close();
  const shared = vi.spyOn(storage, "cachedRow");
  const observed = observeGalleryScope(directory, "Example.ASSY.FCStd");
  expect(observed).toMatchObject({ members: ["Example.ASSY.FCStd", "Current.FCStd"], complete: true, issues: [] });
  expect(observed.sources[0].refs).toEqual(["Current.FCStd"]); expect(shared).not.toHaveBeenCalled();
  const retained = storage.openGalleryDb(directory)!;
  expect(storage.cachedRow(retained, "Example.ASSY.FCStd")?.refs).toEqual(["Old.FCStd"]); retained.close();
});

it("uses matching independent proof without opening any CAD archive", () => {
  const directory = root(); save(directory, "Example.ASSY.FCStd", ["Unit.FCStd"]); save(directory, "Unit.FCStd");
  const first = observeGalleryScope(directory, "Example.ASSY.FCStd"), retained = asProof("Example.ASSY.FCStd", first);
  const read = vi.spyOn(archives, "readFcstdLightArchive").mockImplementation(() => { throw new Error("archive must not be opened"); });
  expect(observeGalleryScope(directory, retained.product, retained)).toEqual(first);
  expect(read).not.toHaveBeenCalled();
});

it("rereads only changed proof nodes and projects their new reachable members", () => {
  const directory = root(); save(directory, "Example.ASSY.FCStd", ["Old.FCStd"]); save(directory, "Old.FCStd"); save(directory, "New.FCStd");
  const retained = asProof("Example.ASSY.FCStd", observeGalleryScope(directory, "Example.ASSY.FCStd"));
  save(directory, "Example.ASSY.FCStd", ["New.FCStd"], "<!-- independently changed source -->");
  const read = vi.spyOn(archives, "readFcstdLightArchive");
  const observed = observeGalleryScope(directory, retained.product, retained);
  expect(observed.members).toEqual(["Example.ASSY.FCStd", "New.FCStd"]); expect(observed.complete).toBe(true);
  expect(observed.sources[0].refs).toEqual(["New.FCStd"]);
  expect(read.mock.calls.map(call => path.basename(call[0]))).toEqual(["Example.ASSY.FCStd", "New.FCStd"]);
  expect(fs.existsSync(path.join(directory, "Old.FCStd"))).toBe(true);
});

it("does not restore a deleted proof member, and reports a genuine dangling link", () => {
  const directory = root(); save(directory, "Example.ASSY.FCStd", ["Unit.FCStd"]); save(directory, "Unit.FCStd");
  const retained = asProof("Example.ASSY.FCStd", observeGalleryScope(directory, "Example.ASSY.FCStd"));
  fs.unlinkSync(path.join(directory, "Unit.FCStd"));
  const read = vi.spyOn(archives, "readFcstdLightArchive");
  expect(observeGalleryScope(directory, retained.product, retained)).toMatchObject({ members: ["Example.ASSY.FCStd"], complete: true, issues: [{ rel: "Unit.FCStd", message: expect.stringContaining("缺失") }] });
  expect(read).not.toHaveBeenCalled();
});

it("falls back to disk for legacy proof and does not create a workspace database", () => {
  const directory = root(); save(directory, "Example.FCStd");
  const legacy = parseGalleryScopeProof(JSON.stringify({ rows: [{ refs: ["Old.FCStd"] }] }), "Example.FCStd");
  const read = vi.spyOn(archives, "readFcstdLightArchive");
  expect(observeGalleryScope(directory, "Example.FCStd", legacy)).toMatchObject({ members: ["Example.FCStd"], complete: true });
  expect(read).toHaveBeenCalledOnce(); expect(fs.existsSync(path.join(directory, ".phoenix"))).toBe(false);
});

it.each(["not a ZIP", "broken XML"])("keeps an existing %s source as an issue member without guessing old references", kind => {
  const directory = root(); save(directory, "Example.ASSY.FCStd", ["Unit.FCStd"]); save(directory, "Unit.FCStd");
  const retained = asProof("Example.ASSY.FCStd", observeGalleryScope(directory, "Example.ASSY.FCStd"));
  fs.writeFileSync(path.join(directory, retained.product), kind === "not a ZIP" ? Buffer.from("inert broken source") : zipSync({ "Document.xml": strToU8("<Document><ObjectData></Document>") }));
  expect(observeGalleryScope(directory, retained.product, retained)).toMatchObject({ members: [retained.product], sources: [], complete: false, issues: [{ rel: retained.product, message: expect.stringContaining("Document.xml") }] });
});

it("does not include missing products or symlinked sources", () => {
  const directory = root(), outside = root(); save(outside, "Unit.FCStd"); fs.symlinkSync(path.join(outside, "Unit.FCStd"), path.join(directory, "Linked.FCStd"));
  const read = vi.spyOn(archives, "readFcstdLightArchive");
  for (const rel of ["Absent.FCStd", "Linked.FCStd"])
    expect(observeGalleryScope(directory, rel)).toMatchObject({ members: [], sources: [], complete: rel === "Absent.FCStd", issues: [{ rel, message: expect.stringContaining(rel === "Absent.FCStd" ? "缺失" : "符号链接") }] });
  expect(read).not.toHaveBeenCalled();
});

it("uses only live indexed seeds globally while reporting unindexed dangling references", () => {
  const directory = root(); save(directory, "Example.ASSY.FCStd", ["Unindexed.FCStd", "Absent.FCStd"]); save(directory, "Unindexed.FCStd");
  index(directory, ["Example.ASSY.FCStd", "Deleted.FCStd"]);
  const read = vi.spyOn(archives, "readFcstdLightArchive");
  const observed = observeGalleryScope(directory, "");
  expect(observed.members).toEqual(["Example.ASSY.FCStd"]); expect(observed.complete).toBe(true);
  expect(observed.issues.map(issue => issue.rel).sort()).toEqual(["Absent.FCStd", "Deleted.FCStd"]);
  expect(read.mock.calls.map(call => path.basename(call[0]))).toEqual(["Example.ASSY.FCStd"]);
});

it("does not discover hidden targets or comment/CDATA example links", () => {
  const directory = root();
  save(directory, "Example.ASSY.FCStd", [".history/Absent.FCStd", "node_modules/demo/Absent.FCStd", ".Draft.FCStd"], "<!-- <XLink file=\"Comment.FCStd\"/> --><![CDATA[<XLink file=\"Example.FCStd\"/>]]>");
  save(directory, ".Draft.FCStd");
  expect(observeGalleryScope(directory, "Example.ASSY.FCStd")).toMatchObject({ members: ["Example.ASSY.FCStd", ".Draft.FCStd"], issues: [], complete: true });
});

it("does not impose BOM quantity semantics on a structurally valid XLink document", () => {
  const directory = root();
  save(directory, "Example.ASSY.FCStd", ["Unit.FCStd"], '<ObjectData><Object name="Metadata"><Properties><Property name="Quantity" type="App::PropertyString"><String value="an unsupported quantity expression"/></Property></Properties></Object></ObjectData>');
  save(directory, "Unit.FCStd");
  expect(observeGalleryScope(directory, "Example.ASSY.FCStd")).toMatchObject({ members: ["Example.ASSY.FCStd", "Unit.FCStd"], complete: true, issues: [] });
});

it("does not mistake inaccessible sources for known absent members", () => {
  const directory = root(); save(directory, "Example.FCStd");
  const original = fs.lstatSync;
  vi.spyOn(fs, "lstatSync").mockImplementation(((filename: fs.PathLike, options?: fs.StatOptions) => {
    if (String(filename) === path.join(directory, "Example.FCStd")) throw Object.assign(new Error("synthetic access denied"), { code: "EACCES" });
    return original(filename, options as { bigint?: false });
  }) as typeof fs.lstatSync);
  expect(observeGalleryScope(directory, "Example.FCStd")).toMatchObject({ members: [], sources: [], complete: false, issues: [{ rel: "Example.FCStd", message: expect.stringContaining("安全访问") }] });
});

it("deduplicates cyclic membership while retaining an explicit cycle warning", () => {
  const directory = root(); save(directory, "Example.ASSY.FCStd", ["Unit.FCStd", "Unit.FCStd"]); save(directory, "Unit.FCStd", ["Example.ASSY.FCStd"]);
  const observed = observeGalleryScope(directory, "Example.ASSY.FCStd");
  expect(observed.members).toEqual(["Example.ASSY.FCStd", "Unit.FCStd"]); expect(observed.complete).toBe(true);
  expect(observed.issues).toEqual([{ rel: "Example.ASSY.FCStd", message: expect.stringContaining("循环") }]);
});

it("rejects source changes during archive reading without expanding stale references", () => {
  const directory = root(); save(directory, "Example.ASSY.FCStd", ["Unit.FCStd"]); save(directory, "Unit.FCStd");
  const original = archives.readFcstdLightArchive;
  vi.spyOn(archives, "readFcstdLightArchive").mockImplementation(filename => {
    const value = original(filename); save(directory, "Example.ASSY.FCStd", [], "<!-- changed while reading -->"); return value;
  });
  const observed = observeGalleryScope(directory, "Example.ASSY.FCStd");
  expect(observed).toMatchObject({ members: ["Example.ASSY.FCStd"], sources: [], complete: false });
});

it("rechecks earlier nodes and drops a source that disappears later in the traversal", () => {
  const directory = root(); save(directory, "Example.ASSY.FCStd", ["Unit.FCStd"]); save(directory, "Unit.FCStd");
  const original = archives.readFcstdLightArchive;
  vi.spyOn(archives, "readFcstdLightArchive").mockImplementation(filename => {
    const value = original(filename);
    if (path.basename(filename) === "Unit.FCStd") fs.unlinkSync(path.join(directory, "Example.ASSY.FCStd"));
    return value;
  });
  const observed = observeGalleryScope(directory, "Example.ASSY.FCStd");
  expect(observed.members).toEqual(["Unit.FCStd"]); expect(observed.sources.map(source => source.rel)).toEqual(["Unit.FCStd"]); expect(observed.complete).toBe(false);
});

it("bounds actual reference expansion and ignores excluded explicit products", () => {
  const directory = root(); save(directory, "Example.ASSY.FCStd", Array.from({ length: 5001 }, (_, i) => `Unit${i}.FCStd`));
  expect(observeGalleryScope(directory, "Example.ASSY.FCStd")).toMatchObject({ members: ["Example.ASSY.FCStd"], sources: [], complete: false, issues: [{ message: expect.stringContaining("安全上限") }] });
  expect(observeGalleryScope(directory, ".history/Example.FCStd")).toMatchObject({ members: [], sources: [], complete: false });
});

it("returns an empty read-only global observation when no index exists", () => {
  const directory = root(); expect(observeGalleryScope(directory, "")).toEqual({ members: [], sources: [], issues: [], complete: true });
  expect(fs.readdirSync(directory)).toEqual([]);
});
