import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PNW_WORKSPACE_SCHEMA_V13_DDL } from "@phoenix-wing/workspace-schema";
import { phoenixDatabasePath } from "../../lib/phoenixDatabaseService.js";
import { cadIndexSearchRoutes } from "./routes.js";
import { CadIndexSearchError, normalizeIndexedCadPath, searchCadIndex, type CadIndexSearchRow } from "./service.js";
import * as readLease from "../../lib/cadSqliteReadLease.js";

const roots: string[] = [];
function workspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "desk-synthetic-search-")); roots.push(root); return root;
}
function index(root: string, rows: Partial<CadIndexSearchRow>[] = []) {
  const filename = phoenixDatabasePath(root);
  fs.mkdirSync(path.dirname(filename));
  const db = new DatabaseSync(filename);
  db.exec(PNW_WORKSPACE_SCHEMA_V13_DDL);
  db.prepare("INSERT INTO phoenix_meta(key,value) VALUES ('schema_version','13')").run();
  db.prepare("INSERT INTO phoenix_cad_scan(scanned_at,scan_root,stats_json,status) VALUES ('2026-01-01','synthetic','{}','done')").run();
  rows.forEach((row, i) => insert(db, { repo_rel_path: `parts/item-${i}.FCStd`, filename: `item-${i}.FCStd`, ...row }));
  db.close(); return filename;
}
function insert(db: DatabaseSync, row: Partial<CadIndexSearchRow> & { file_status?: string }) {
  db.prepare(`INSERT INTO phoenix_cad_file_asset(repo_rel_path,filename,asset_kind,part_number,part_version,part_name,label,file_status,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?)`).run(row.repo_rel_path!, row.filename!, row.asset_kind ?? null, row.part_number ?? null,
    row.part_version ?? null, row.part_name ?? null, row.label ?? null, row.file_status ?? "present", "2026-01-01");
}
afterEach(() => { vi.restoreAllMocks(); roots.splice(0).forEach(root => fs.rmSync(root, { recursive: true, force: true })); });

describe("bounded read-only CAD file asset search", () => {
  it("filters old hidden/cache rows before the result limit while retaining visible dot-prefixed files and legacy paths", () => {
    const root = workspace(), file = index(root, Array.from({ length: 210 }, (_, i) => ({ repo_rel_path: `.snapshots/Old-${i}.FCStd` })));
    const db = new DatabaseSync(file);
    for (const rel of ["./parts/Visible.FCStd", "parts/.Visible.FCStd", "parts/.old/Hidden.FCStd", "__pycache__/Cache.FCStd", "parts/node_modules/Cache.FCStd"]) insert(db, { repo_rel_path: rel, filename: path.basename(rel) });
    db.close(); const before = fs.readFileSync(file);
    expect(searchCadIndex(root).rows.map(row => row.repo_rel_path)).toEqual(["parts/Visible.FCStd", "parts/.Visible.FCStd"]);
    expect(searchCadIndex(root).limitReached).toBe(false);
    expect(fs.readFileSync(file)).toEqual(before);
  });
  it.each([
    ["filename", { filename: "file-token.FCStd" }, "FILE-TOKEN"],
    ["path", { repo_rel_path: "path-token/plain.FCStd" }, "path-token"],
    ["number", { part_number: "number-token" }, "number-token"],
    ["version", { part_version: "version-token" }, "version-token"],
    ["name", { part_name: "name-token" }, "name-token"],
    ["label", { label: "label-token" }, "label-token"],
  ])("matches the %s field by itself with six-field OR", (_field, fields, term) => {
    const root = workspace(), file = index(root, [fields]);
    const before = fs.readFileSync(file), filesBefore = fs.readdirSync(path.dirname(file));
    expect(searchCadIndex(root, `  ${term}  `)).toMatchObject({ source: "sqlite", rows: [fields], limit: 200, limitReached: false });
    expect(fs.readFileSync(file)).toEqual(before); expect(fs.readdirSync(path.dirname(file))).toEqual(filesBefore);
  });

  it("treats multiple words as one term, ORs fields, and binds SQL-like input", () => {
    const root = workspace(); index(root, [
      { part_number: "common", part_name: "alpha beta" },
      { label: "common", part_name: "alpha", part_version: "beta" },
    ]);
    expect(searchCadIndex(root, "common").rows).toHaveLength(2);
    expect(searchCadIndex(root, "alpha beta").rows).toHaveLength(1);
    expect(searchCadIndex(root, "' OR 1=1 --").rows).toEqual([]);
  });

  it("uses one six-field parameterized asset-result query, never six searches merged in the host", () => {
    const root = workspace(); index(root, [{ label: "search-token" }]);
    const prepare = vi.spyOn(DatabaseSync.prototype, "prepare");
    searchCadIndex(root, "search-token");
    const searches = prepare.mock.calls.map(([sql]) => sql).filter(sql => sql.startsWith("SELECT repo_rel_path,filename,asset_kind"));
    expect(searches).toHaveLength(1);
    expect(searches[0]?.match(/LIKE \?/g)).toHaveLength(6);
    expect(searches[0]).toContain("ORDER BY repo_rel_path LIMIT 200");
  });

  it("keeps SQLite LIKE percent and underscore semantics instead of literal fallback matching", () => {
    const root = workspace(); index(root, [{ filename: "ab.FCStd" }, { filename: "a_b.FCStd" }, { filename: "axb.FCStd" }]);
    expect(searchCadIndex(root, "%").rows).toHaveLength(3);
    expect(searchCadIndex(root, "a_b").rows).toHaveLength(2);
  });

  it("returns each present file even when files share one PartKey, and excludes missing assets", () => {
    const root = workspace(), file = index(root, [
      { repo_rel_path: "zeta/file.FCStd", part_number: "SYNTHETIC", part_version: "rev" },
      { repo_rel_path: "alpha/file.FCStd", part_number: "SYNTHETIC", part_version: "rev" },
    ]);
    const db = new DatabaseSync(file);
    db.prepare("INSERT INTO phoenix_cad_part_key(part_number,part_version,created_at,updated_at) VALUES ('SYNTHETIC','rev','2026-01-01','2026-01-01')").run();
    db.prepare("INSERT INTO phoenix_cad_part_file_link(part_key_id,file_asset_id,linked_at) SELECT 1,id,'2026-01-01' FROM phoenix_cad_file_asset").run();
    insert(db, { repo_rel_path: "absent/file.FCStd", filename: "file.FCStd", part_number: "SYNTHETIC", file_status: "missing" });
    db.close();
    expect(searchCadIndex(root, "SYNTHETIC").rows.map(row => row.repo_rel_path)).toEqual(["alpha/file.FCStd", "zeta/file.FCStd"]);
  });

  it("lists empty queries in path order, returns zero matches, and caps at 200 rows", () => {
    const root = workspace(); index(root, Array.from({ length: 205 }, (_, i) => ({ repo_rel_path: `parts/${String(204 - i).padStart(3, "0")}.FCStd` })));
    const result = searchCadIndex(root, "  ");
    expect(result.rows).toHaveLength(200); expect(result.limitReached).toBe(true);
    expect(result.rows[0]?.repo_rel_path).toBe("parts/000.FCStd");
    expect(result.rows[199]?.repo_rel_path).toBe("parts/199.FCStd");
    expect(searchCadIndex(root, "no-such-token").rows).toEqual([]);
  });

  it("normalizes legacy ./ paths without reading CAD files or creating models", () => {
    const root = workspace(); index(root, [{ repo_rel_path: "./parts/legacy.FCStd", filename: "legacy.FCStd" }]);
    expect(searchCadIndex(root).rows[0]?.repo_rel_path).toBe("parts/legacy.FCStd");
    expect(fs.readdirSync(root)).toEqual([".phoenix"]);
  });

  it.each(["../outside.FCStd", "./../outside.FCStd", "parts/../outside.FCStd", "/outside.FCStd", "C:\\outside.FCStd", "C:outside.FCStd", "\\\\host\\outside.FCStd", "parts/\0file.FCStd", "parts//file.FCStd"])("rejects unsafe indexed navigation path %j", rel => {
    expect(() => normalizeIndexedCadPath(rel)).toThrow(CadIndexSearchError);
  });

  it("does not hide unsafe stored paths as valid search results", () => {
    const root = workspace(); index(root, [{ repo_rel_path: "../outside.FCStd" }]);
    expect(() => searchCadIndex(root)).toThrow("不安全");
  });

  it("reports missing, incompatible and corrupt indexes without creating or upgrading them", () => {
    const root = workspace();
    expect(() => searchCadIndex("")).toThrow("工作空间");
    expect(() => searchCadIndex(root)).toThrow("没有可用扫描缓存"); expect(fs.readdirSync(root)).toEqual([]);
    const file = index(root), db = new DatabaseSync(file);
    db.prepare("UPDATE phoenix_meta SET value='0' WHERE key='schema_version'").run(); db.close();
    const before = fs.readFileSync(file);
    expect(() => searchCadIndex(root)).toThrow("Schema 不兼容"); expect(fs.readFileSync(file)).toEqual(before);
    fs.writeFileSync(file, "synthetic invalid SQLite");
    expect(() => searchCadIndex(root)).toThrow("读取失败"); expect(fs.readFileSync(file, "utf8")).toBe("synthetic invalid SQLite");
  });

  it("does not recreate a database which vanishes before acquiring its single read lease", () => {
    const root = workspace(), file = index(root), open = readLease.openCadSqliteReadDatabase;
    vi.spyOn(readLease, "openCadSqliteReadDatabase").mockImplementationOnce(filename => {
      fs.unlinkSync(file); return open(filename);
    });
    expect(() => searchCadIndex(root)).toThrow("读取失败");
    expect(fs.existsSync(file)).toBe(false); expect(fs.readdirSync(path.dirname(file))).toEqual([]);
  });

  it("can query an incomplete index but visibly retains its diagnostic state", () => {
    const root = workspace(), file = index(root, [{ label: "saved-token" }]), db = new DatabaseSync(file);
    db.prepare("DELETE FROM phoenix_cad_scan").run(); db.close();
    expect(searchCadIndex(root, "saved-token")).toMatchObject({ rows: [{ label: "saved-token" }], diagnostics: { state: "empty", lastScanAt: "" } });
  });

  it("rejects a symlinked index before reading it", () => {
    const root = workspace(), external = workspace(); index(external);
    fs.mkdirSync(path.join(root, ".phoenix"));
    fs.symlinkSync(phoenixDatabasePath(external), phoenixDatabasePath(root));
    expect(() => searchCadIndex(root)).toThrow("符号链接");
  });

  it("refuses an existing host lock with unreadable diagnostics and never removes its owner", () => {
    const root = workspace(), file = index(root, [{ label: "retained" }]);
    const lock = `${fs.realpathSync(file)}.lock`; fs.mkdirSync(lock); const owner = fs.statSync(lock);
    const before = fs.readFileSync(file);
    let error: unknown; try { searchCadIndex(root); } catch (caught) { error = caught; }
    expect(error).toBeInstanceOf(CadIndexSearchError);
    expect(error).toMatchObject({ code: "index_unreadable", status: 503, diagnostics: { state: "unreadable", schemaVersion: null } });
    expect((error as Error).message).toMatch(/busy|lock/i);
    expect(fs.statSync(lock).ino).toBe(owner.ino); expect(fs.readFileSync(file)).toEqual(before);
  });

  it("refuses WAL mode with accurate diagnostics without converting the journal or querying assets", () => {
    const root = workspace(), file = index(root, [{ label: "retained" }]), db = new DatabaseSync(file);
    db.exec("PRAGMA journal_mode=WAL"); db.close();
    const before = fs.readFileSync(file), files = fs.readdirSync(path.dirname(file)).sort();
    const prepare = vi.spyOn(DatabaseSync.prototype, "prepare");
    let error: unknown; try { searchCadIndex(root); } catch (caught) { error = caught; }
    expect(error).toMatchObject({ code: "index_unreadable", status: 503, diagnostics: { state: "unreadable" } });
    expect((error as Error).message).toMatch(/WAL|journal/i);
    expect(prepare.mock.calls.some(([sql]) => sql.includes("FROM phoenix_cad_file_asset"))).toBe(false);
    expect(fs.readFileSync(file)).toEqual(before); expect(fs.readdirSync(path.dirname(file)).sort()).toEqual(files);
  });

  it("retains the known schema overview when a later diagnostic query fails", () => {
    const root = workspace(), file = index(root), db = new DatabaseSync(file);
    db.exec("ALTER TABLE phoenix_cad_scan RENAME COLUMN stats_json TO unsupported_stats"); db.close();
    const before = fs.readFileSync(file);
    let error: unknown; try { searchCadIndex(root); } catch (caught) { error = caught; }
    expect(error).toMatchObject({ code: "index_unreadable", status: 503,
      diagnostics: { state: "unreadable", schemaVersion: 13, totalEntries: 0 } });
    expect((error as Error).message).toContain("stats_json"); expect(fs.readFileSync(file)).toEqual(before);
    expect(fs.existsSync(`${file}.lock`)).toBe(false);
  });

  it("exposes success and failure status through the route without implying a missing index is empty", async () => {
    const root = workspace();
    const missing = await cadIndexSearchRoutes.request(`/?workspace=${encodeURIComponent(root)}&q=sample`);
    expect(missing.status).toBe(409); expect(await missing.json()).toMatchObject({ code: "index_missing", diagnostics: { state: "missing" } });
    index(root, [{ label: "sample" }]);
    const ok = await cadIndexSearchRoutes.request(`/?workspace=${encodeURIComponent(root)}&q=sample`);
    expect(ok.status).toBe(200); expect(ok.headers.get("Cache-Control")).toBe("no-store");
    expect(await ok.json()).toMatchObject({ source: "sqlite", query: "sample", rows: [{ label: "sample" }] });
    fs.writeFileSync(phoenixDatabasePath(root), "synthetic invalid SQLite");
    const unreadable = await cadIndexSearchRoutes.request(`/?workspace=${encodeURIComponent(root)}`);
    expect(unreadable.status).toBe(503); expect(await unreadable.json()).toMatchObject({ code: "index_unreadable" });
  });
});
