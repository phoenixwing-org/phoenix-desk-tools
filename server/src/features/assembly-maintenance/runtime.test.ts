import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { configuredAssemblyFreecadHome, refreshAssemblyDerivedData } from "./runtime.js";
import { createGeometryTable, saveGeometry, withGeometry } from "../part-gallery/geometryStorage.js";
import type { GalleryRow } from "../part-gallery/types.js";

const mocks = vi.hoisted(() => ({ xref: vi.fn(), open: vi.fn(), table: vi.fn() }));
vi.mock("../../lib/pnwBomXrefService.js", () => ({ refreshBomXrefsForHosts: mocks.xref }));
vi.mock("../part-gallery/storage.js", async original => ({
  ...await original<typeof import("../part-gallery/storage.js")>(), openGalleryDb: mocks.open, tableExists: mocks.table,
}));
const folders: string[] = [];
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); mocks.xref.mockReset(); mocks.open.mockReset(); mocks.table.mockReset(); for (const folder of folders.splice(0)) fs.rmSync(folder, { recursive: true, force: true }); });
function preferences(value?: unknown) {
  const folder = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "assembly-settings-test-"))); folders.push(folder);
  vi.stubEnv("PHOENIX_USER_DATA_DIR", folder);
  if (value !== undefined) fs.writeFileSync(path.join(folder, "launcher-prefs.json"), JSON.stringify(value));
  return folder;
}

async function sqliteCaches() {
  const storage = await vi.importActual<typeof import("../part-gallery/storage.js")>("../part-gallery/storage.js");
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "assembly-derived-cache-test-"))); folders.push(root);
  const host = "Host.ASSY.FCStd", parent = "Parent.ASSY.FCStd", other = "Other.ASSY.FCStd", part = "Unit.FCStd";
  const bytes = new Map<string, Buffer>();
  for (const rel of [host, parent, other, part]) {
    // Opaque independent bytes: neither a CAD archive nor a Native fixture.
    const value = Buffer.from(`independent cache source: ${rel}`); bytes.set(rel, value); fs.writeFileSync(path.join(root, rel), value);
  }
  const proof = (rel: string) => ({ rel, stamp: storage.fileStamp(path.join(root, rel)), hash: createHash("sha256").update(bytes.get(rel.replace(/^\.\//, ""))!).digest("hex") });
  const db = storage.openGalleryDb(root, true)!; createGeometryTable(db);
  const rows = new Map<string, GalleryRow>(), images = new Map<string, Buffer>();
  fs.mkdirSync(path.join(root, ".phoenix/thumbnail-cache"));
  for (const rel of [host, `./${host}`, parent, other, part]) {
    const source = proof(rel), image = Buffer.from(`independent opaque image cache: ${rel}`), hash = createHash("sha256").update(image).digest("hex");
    const row: GalleryRow = { rel, part_number: "SYNTHETIC", part_version: "", part_name: path.basename(rel), type_code: "H", role: rel === part ? "part" : "assembly",
      status: "ready", width: 128, height: 128, image_hash: hash, source_stamp: source.stamp, source_hash: source.hash, updated_at: "2026-01-01T00:00:00.000Z", message: "independent cached image", refs: [] };
    rows.set(rel, row); storage.saveRow(db, row);
    const filename = path.join(root, ".phoenix/thumbnail-cache", `${hash}.png`); fs.writeFileSync(filename, image); images.set(filename, image);
    saveGeometry(db, { rel, kind: row.role === "assembly" ? "assembly" : "part", sources: rel === parent ? [source, proof(host)] : [source], box: { x_mm: 24, y_mm: 13, z_mm: 9 }, message: "independent saved geometry envelope" });
  }
  for (const product of [host, parent, other]) {
    db.run("INSERT INTO desk_cad_gallery_scope(product,updated_at,issues_json,sources_json) VALUES(?,?,?,?)", [product, "2026-01-01", "[]", "independent retained scope provenance"]);
    db.run("INSERT INTO desk_cad_gallery_member(product,rel) VALUES(?,?)", [product, product]);
    db.run("INSERT INTO desk_cad_gallery_member(product,rel) VALUES(?,?)", [product, part]);
  }
  db.run("INSERT INTO desk_cad_thumbnail_archive(output_rel,source_rel,image_hash,created_at) VALUES(?,?,?,?)", ["assets/thumbnails/example.png", other, rows.get(other)!.image_hash, "2026-01-01"]);
  db.close();
  mocks.open.mockImplementation((workspace: string) => storage.openGalleryDb(workspace)); mocks.table.mockImplementation(storage.tableExists);
  const snapshot = () => {
    const connection = storage.openGalleryDb(root)!;
    try { return {
      thumbnails: connection.all<{ rel: string; status: string; message: string }>("SELECT * FROM desk_cad_thumbnail ORDER BY rel"),
      geometry: connection.all<{ rel: string; algorithm_version: number }>("SELECT * FROM desk_cad_geometry ORDER BY rel"),
      scopes: connection.all("SELECT * FROM desk_cad_gallery_scope ORDER BY product"),
      members: connection.all("SELECT * FROM desk_cad_gallery_member ORDER BY product,rel"),
      archives: connection.all("SELECT * FROM desk_cad_thumbnail_archive ORDER BY output_rel"),
    }; } finally { connection.close(); }
  };
  const dimensions = (rel: string) => {
    const connection = storage.openGalleryDb(root)!;
    try { return withGeometry(root, connection, rows.get(rel)!); } finally { connection.close(); }
  };
  const assertRetainedFiles = () => {
    for (const [filename, image] of images) expect(fs.readFileSync(filename)).toEqual(image);
    for (const [rel, value] of bytes) if (rel !== host) expect(fs.readFileSync(path.join(root, rel))).toEqual(value);
  };
  // The refresher's input contract is an already-published host. Model that
  // boundary with opaque bytes only; this is not a source-publication/Native QA.
  const publishedBytes = Buffer.from("independently changed host bytes after the publication boundary");
  const simulatePublishedHost = () => fs.writeFileSync(path.join(root, host), publishedBytes);
  return { storage, root, host, parent, other, part, snapshot, dimensions, assertRetainedFiles, simulatePublishedHost, publishedBytes };
}
describe("assembly host settings and post-publication derived refresh", () => {
  it("uses explicit host settings and does not silently fall back from invalid settings", () => {
    const root = preferences({ freecad_dir: "/synthetic/FreeCAD" });
    expect(configuredAssemblyFreecadHome()).toBe("/synthetic/FreeCAD");
    fs.writeFileSync(path.join(root, "launcher-prefs.json"), JSON.stringify({ freecad_dir: "relative/engine" }));
    expect(configuredAssemblyFreecadHome).toThrow("绝对路径");
    fs.writeFileSync(path.join(root, "launcher-prefs.json"), "not json");
    expect(configuredAssemblyFreecadHome).toThrow("不可读");
  });
  it("only discovers the standard macOS install when no engine is configured", () => {
    preferences(); vi.spyOn(os, "platform").mockReturnValue("darwin");
    expect(configuredAssemblyFreecadHome()).toBe("/Applications/FreeCAD.app");
    vi.spyOn(os, "platform").mockReturnValue("linux"); expect(configuredAssemblyFreecadHome).toThrow("配置");
  });
  it("rejects nontext, symlinked or oversized preferences", () => {
    const root = preferences({ freecad_dir: ["/synthetic"] }), file = path.join(root, "launcher-prefs.json");
    expect(configuredAssemblyFreecadHome).toThrow("无效");
    fs.writeFileSync(file, "x".repeat(70_000)); expect(configuredAssemblyFreecadHome).toThrow("不可读");
    fs.renameSync(file, path.join(root, "other.json")); fs.symlinkSync(path.join(root, "other.json"), file);
    expect(configuredAssemblyFreecadHome).toThrow("不可读");
  });
  it("rejects malformed root records, null settings and trimmed control characters instead of falling back", () => {
    const root = preferences(), file = path.join(root, "launcher-prefs.json");
    vi.spyOn(os, "platform").mockReturnValue("darwin");
    for (const value of [null, [], "opaque", 2]) { fs.writeFileSync(file, JSON.stringify(value)); expect(configuredAssemblyFreecadHome).toThrow("不可读"); }
    for (const freecad_dir of [null, false, "\n/Applications/FreeCAD.app", "/Applications/FreeCAD.app\t"]) {
      fs.writeFileSync(file, JSON.stringify({ freecad_dir })); expect(configuredAssemblyFreecadHome).toThrow("无效");
    }
  });
  it("rejects hardlinked preferences and lost path identity after the file was opened", () => {
    const root = preferences({ freecad_dir: "/synthetic/FreeCAD" }), file = path.join(root, "launcher-prefs.json");
    const retained = path.join(root, "independent-settings"); fs.linkSync(file, retained);
    expect(configuredAssemblyFreecadHome).toThrow("不可读"); fs.unlinkSync(retained);
    const read = fs.readSync.bind(fs); let changed = false;
    vi.spyOn(fs, "readSync").mockImplementation((...args: any[]) => {
      const result = (read as (...parameters: any[]) => number)(...args);
      if (!changed) { changed = true; fs.renameSync(file, retained); }
      return result;
    });
    expect(configuredAssemblyFreecadHome).toThrow("不可读");
  });
  it("refreshes only the explicit host and invalidates derived rows without claiming full BOM freshness", async () => {
    const db = { exec: vi.fn(), run: vi.fn(), close: vi.fn(), inTransaction: false };
    mocks.xref.mockReturnValue({ hosts: ["./Host.FCStd"], index_stale: true }); mocks.open.mockReturnValue(db); mocks.table.mockReturnValue(true);
    const messages = await refreshAssemblyDerivedData("/synthetic/workspace", "Host.FCStd");
    expect(mocks.xref).toHaveBeenCalledWith("/synthetic/workspace", ["Host.FCStd"]);
    expect(db.run).toHaveBeenCalledWith(expect.stringContaining("status='stale'"), ["装配已更新，请重新生成缩略图", "Host.FCStd", "./Host.FCStd"]);
    expect(db.run).toHaveBeenCalledWith(expect.stringContaining("DELETE FROM desk_cad_geometry"), ["Host.FCStd", "./Host.FCStd"]);
    expect(db.close).toHaveBeenCalledOnce(); expect(messages.join()).toContain("递归 BOM 仍需完整更新");
  });
  it("reports refresh problems separately from an already successful file publication", async () => {
    mocks.xref.mockImplementation(() => { throw new Error("/private/unknown/database"); }); mocks.open.mockImplementation(() => { throw new Error("private"); });
    const messages = await refreshAssemblyDerivedData("/synthetic/workspace", "Host.FCStd");
    expect(messages).toHaveLength(2); expect(messages.every(message => message.startsWith("文件已发布"))).toBe(true);
    expect(messages.join()).not.toContain("/private");
  });
  it("does not fabricate an index for a newly generated copy", async () => {
    mocks.xref.mockReturnValue({ index_pending: true }); mocks.open.mockReturnValue(null);
    expect((await refreshAssemblyDerivedData("/synthetic/workspace", "Host.Refreshed.FCStd")).join()).toContain("索引未包含该文件");
  });
  it("rolls back cache invalidation failures, closes the database and never reports the file as unpublished", async () => {
    const db = { exec: vi.fn(), run: vi.fn(() => { throw new Error("private cache detail"); }), close: vi.fn(), inTransaction: true };
    mocks.xref.mockReturnValue({ index_pending: true }); mocks.open.mockReturnValue(db); mocks.table.mockReturnValue(true);
    const messages = await refreshAssemblyDerivedData("/synthetic/workspace", "Host.FCStd");
    expect(db.exec).toHaveBeenCalledWith("ROLLBACK"); expect(db.exec).not.toHaveBeenCalledWith("COMMIT"); expect(db.close).toHaveBeenCalledOnce();
    expect(messages.join()).toContain("文件已发布"); expect(messages.join()).not.toContain("private cache");
  });
  it("invalidates this host's assembly v2 cache, retaining other scopes and rejecting a parent's stale dependency on read", async () => {
    const fixture = await sqliteCaches(), { root, host, parent, other, part } = fixture, before = fixture.snapshot();
    expect(before.geometry.filter(row => row.rel !== part).every(row => row.algorithm_version === 2)).toBe(true);
    expect(before.geometry.find(row => row.rel === part)?.algorithm_version).toBe(1);
    expect(fixture.dimensions(parent).bounding_box).toEqual({ x_mm: 24, y_mm: 13, z_mm: 9 });
    expect(fixture.dimensions(other).bounding_box).toEqual({ x_mm: 24, y_mm: 13, z_mm: 9 });
    fixture.simulatePublishedHost(); mocks.xref.mockReturnValue({ index_stale: true });
    const messages = await refreshAssemblyDerivedData(root, host), after = fixture.snapshot();
    expect(mocks.xref).toHaveBeenCalledWith(root, [host]);
    expect(after.geometry).toEqual(before.geometry.filter(row => row.rel !== host && row.rel !== `./${host}`));
    const affected = after.thumbnails.filter(row => row.rel === host || row.rel === `./${host}`);
    expect(affected).toHaveLength(2);
    for (const row of affected) expect(row).toEqual({ ...before.thumbnails.find(old => old.rel === row.rel), status: "stale", message: "装配已更新，请重新生成缩略图" });
    expect(after.thumbnails.filter(row => row.rel !== host && row.rel !== `./${host}`)).toEqual(before.thumbnails.filter(row => row.rel !== host && row.rel !== `./${host}`));
    expect(after.scopes).toEqual(before.scopes); expect(after.members).toEqual(before.members); expect(after.archives).toEqual(before.archives);
    // Parent persistence is retained, but withGeometry cannot present its old
    // v2 envelope as current after the host dependency's stamp changed.
    expect(fixture.dimensions(parent)).toMatchObject({ bounding_box: null, dimension_message: "模型或引用已变化，请更新尺寸" });
    expect(fixture.dimensions(other).bounding_box).toEqual({ x_mm: 24, y_mm: 13, z_mm: 9 });
    expect(fixture.dimensions(part).bounding_box).toEqual({ x_mm: 24, y_mm: 13, z_mm: 9 });
    fixture.assertRetainedFiles(); expect(messages.join()).toContain("递归 BOM 仍需完整更新");
  });
  it("keeps an already-published result truthful when reference refresh fails but SQLite cache invalidation succeeds", async () => {
    const fixture = await sqliteCaches(); fixture.simulatePublishedHost();
    mocks.xref.mockImplementation(() => { throw new Error(path.join(fixture.root, "synthetic-index-detail")); });
    const messages = await refreshAssemblyDerivedData(fixture.root, fixture.host), after = fixture.snapshot();
    expect(messages).toEqual(["文件已发布；引用索引刷新失败，请手动更新 CAD 索引"]);
    expect(messages.join()).not.toContain(fixture.root); expect(messages.join()).not.toMatch(/未发布|未写入/);
    expect(after.geometry.some(row => row.rel === fixture.host || row.rel === `./${fixture.host}`)).toBe(false);
    expect(after.thumbnails.find(row => row.rel === fixture.host)?.status).toBe("stale");
    expect(fs.readFileSync(path.join(fixture.root, fixture.host))).toEqual(fixture.publishedBytes);
    expect(fixture.dimensions(fixture.other).bounding_box).toEqual({ x_mm: 24, y_mm: 13, z_mm: 9 }); fixture.assertRetainedFiles();
  });
  it("rolls back real SQLite v2 deletion failures together with thumbnail invalidation, without losing caches or undoing published bytes", async () => {
    const fixture = await sqliteCaches(), before = fixture.snapshot(); fixture.simulatePublishedHost();
    const db = fixture.storage.openGalleryDb(fixture.root)!;
    db.exec("CREATE TRIGGER reject_geometry_invalidation BEFORE DELETE ON desk_cad_geometry BEGIN SELECT RAISE(ABORT,'synthetic cache transaction failure'); END;"); db.close();
    mocks.xref.mockReturnValue({ index_pending: true });
    const messages = await refreshAssemblyDerivedData(fixture.root, fixture.host);
    expect(fixture.snapshot()).toEqual(before);
    expect(messages).toContain("文件已发布；图册派生缓存未能标记过期，请手动刷新图册及尺寸");
    expect(messages.join()).not.toContain("synthetic cache transaction"); expect(messages.join()).not.toMatch(/未发布|未写入/);
    expect(fs.readFileSync(path.join(fixture.root, fixture.host))).toEqual(fixture.publishedBytes);
    // Even retained cache records cannot resurrect a stale host/parent box.
    expect(fixture.dimensions(fixture.host).bounding_box).toBeNull(); expect(fixture.dimensions(fixture.parent).bounding_box).toBeNull();
    expect(fixture.dimensions(fixture.other).bounding_box).toEqual({ x_mm: 24, y_mm: 13, z_mm: 9 }); fixture.assertRetainedFiles();
  });
});
