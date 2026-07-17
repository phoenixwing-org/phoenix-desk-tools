import fs from "node:fs";
import path from "node:path";
import { pnwCreateDb, type PnwDbAdapter } from "@phoenix-wing/db-node";
import type { UnitTestCatalog, UnitTestSuiteId } from "./unitTestService.js";
import { runtimeAppConfigPath, runtimeCatalogDatabasePath } from "./appRuntimePaths.js";

const DEFAULT_DATABASE_PATH = runtimeCatalogDatabasePath();
const DEFAULT_APP_CONFIG_PATH = runtimeAppConfigPath();
const SCHEMA_VERSION = 2;

const SUITES: Array<{ id: UnitTestSuiteId; label: string; description: string }> = [
  { id: "code", label: "Code", description: "Code 索引、改名、UUID、忽略规则、工作集与成员排序测试。" },
  { id: "cad", label: "CAD", description: "CAD、FCStd、BOM、零件与 XLink 迁移测试。" },
  { id: "platform", label: "平台", description: "启动器、应用壳、API 契约、布局与测试平台检查。" },
  { id: "caa", label: "CAA", description: "CAA 对话框解析、写回、NLS、Wizard 与编辑器测试。" },
];

export type RuntimeCatalogOptions = {
  databasePath?: string;
  appConfigPath?: string;
};

export type RuntimeCatalogStatus = {
  ok: boolean;
  database_path: string;
  exists: boolean;
  last_sync_at: string | null;
  catalog_scanned_at?: string | null;
  schema_version?: number;
  counts: Record<string, number>;
};

let databasePathOverride: string | null = null;

export function setRuntimeCatalogPathForTests(filename: string | null): void {
  databasePathOverride = filename;
}

export function runtimeCatalogPath(options: RuntimeCatalogOptions = {}): string {
  return path.resolve(options.databasePath || databasePathOverride || DEFAULT_DATABASE_PATH);
}

function appConfigPath(options: RuntimeCatalogOptions): string {
  return path.resolve(options.appConfigPath || DEFAULT_APP_CONFIG_PATH);
}

function ensureRuntimeCatalogSchema(db: PnwDbAdapter): boolean {
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS catalog_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS test_suite (
      id TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      description TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS app_page (
      nav_id TEXT PRIMARY KEY,
      page_id TEXT NOT NULL,
      label TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      module TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS test_module (
      module_name TEXT PRIMARY KEY,
      file_stem TEXT NOT NULL,
      suite_id TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      description_zh TEXT NOT NULL DEFAULT '',
      doc_path TEXT,
      case_count INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (suite_id) REFERENCES test_suite(id)
    );
    CREATE TABLE IF NOT EXISTS test_case (
      full_id TEXT PRIMARY KEY,
      case_key TEXT,
      module_name TEXT NOT NULL,
      class_name TEXT NOT NULL,
      method_name TEXT NOT NULL,
      suite_id TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      description_zh TEXT NOT NULL DEFAULT '',
      docstring TEXT NOT NULL DEFAULT '',
      FOREIGN KEY (module_name) REFERENCES test_module(module_name) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_app_page_module ON app_page(module);
    CREATE INDEX IF NOT EXISTS idx_app_page_page ON app_page(page_id);
    CREATE INDEX IF NOT EXISTS idx_test_module_suite ON test_module(suite_id);
    CREATE INDEX IF NOT EXISTS idx_test_case_suite ON test_case(suite_id);
    CREATE INDEX IF NOT EXISTS idx_test_case_module ON test_case(module_name);
    CREATE INDEX IF NOT EXISTS idx_test_case_key ON test_case(case_key);
  `);
  try {
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS catalog_fts USING fts5(
        entity_type UNINDEXED,
        entity_id UNINDEXED,
        suite_id UNINDEXED,
        module_name UNINDEXED,
        title,
        body,
        tokenize='unicode61 remove_diacritics 0'
      )
    `);
  } catch {
    // Search has a SQL/JS fallback when this SQLite build omits FTS5.
  }
  return Boolean(db.get<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'catalog_fts'",
  ));
}

function metaSet(db: PnwDbAdapter, key: string, value: string): void {
  db.run(
    `INSERT INTO catalog_meta(key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [key, value],
  );
}

function metaMap(db: PnwDbAdapter): Record<string, string> {
  return Object.fromEntries(
    db.all<{ key: string; value: string }>("SELECT key, value FROM catalog_meta")
      .map((row) => [String(row.key), String(row.value)]),
  );
}

function loadAppPages(filename: string) {
  try {
    const config = JSON.parse(fs.readFileSync(filename, "utf8"));
    const navigation = Array.isArray(config?.navigation) ? config.navigation : [];
    return navigation
      .map((item: any, index: number) => {
        const navId = String(item?.id || item?.page || "").trim();
        if (!navId) return null;
        return {
          nav_id: navId,
          page_id: String(item?.page || navId),
          label: String(item?.label || item?.page || navId),
          description: String(item?.description || ""),
          module: item?.module ? String(item.module) : null,
          sort_order: index,
        };
      })
      .filter(Boolean) as Array<{
        nav_id: string;
        page_id: string;
        label: string;
        description: string;
        module: string | null;
        sort_order: number;
      }>;
  } catch {
    return [];
  }
}

function moduleDescription(catalogModule: UnitTestCatalog["modules"][number]): string {
  const label = SUITES.find((suite) => suite.id === catalogModule.suite_id)?.label || catalogModule.suite_id;
  const groups = [...new Set(catalogModule.cases.map((testCase) => testCase.class_name).filter(Boolean))].slice(0, 3);
  return groups.length ? `${label}：${groups.join("；")}` : `${label} / ${catalogModule.file_stem}`;
}

export function syncRuntimeCatalog(
  catalog: UnitTestCatalog,
  options: RuntimeCatalogOptions = {},
) {
  const filename = runtimeCatalogPath(options);
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  const db = pnwCreateDb(filename);
  try {
    const hasFts = ensureRuntimeCatalogSchema(db);
    const pages = loadAppPages(appConfigPath(options));
    const now = new Date().toISOString();
    db.exec("BEGIN TRANSACTION");
    try {
      if (hasFts) db.run("DELETE FROM catalog_fts");
      db.run("DELETE FROM test_case");
      db.run("DELETE FROM test_module");
      db.run("DELETE FROM app_page");
      db.run("DELETE FROM test_suite");

      SUITES.forEach((suite, index) => {
        db.run(
          "INSERT INTO test_suite(id, label, description, sort_order) VALUES (?, ?, ?, ?)",
          [suite.id, suite.label, suite.description, index],
        );
      });
      for (const page of pages) {
        db.run(
          `INSERT INTO app_page(nav_id, page_id, label, description, module, sort_order)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [page.nav_id, page.page_id, page.label, page.description, page.module, page.sort_order],
        );
        if (hasFts) {
          db.run(
            `INSERT INTO catalog_fts(entity_type, entity_id, suite_id, module_name, title, body)
             VALUES ('page', ?, ?, ?, ?, ?)`,
            [page.nav_id, page.module || "", page.module || "", page.label, `${page.description} ${page.page_id} ${page.nav_id}`],
          );
        }
      }

      for (const module of catalog.modules) {
        const description = moduleDescription(module);
        db.run(
          `INSERT INTO test_module(
             module_name, file_stem, suite_id, title, description_zh, doc_path, case_count
           ) VALUES (?, ?, ?, ?, ?, NULL, ?)`,
          [module.module, module.file_stem, module.suite_id, module.file_stem, description, module.case_count],
        );
        if (hasFts) {
          db.run(
            `INSERT INTO catalog_fts(entity_type, entity_id, suite_id, module_name, title, body)
             VALUES ('test_module', ?, ?, ?, ?, ?)`,
            [module.module, module.suite_id, module.module, module.file_stem, `${description} ${module.module}`],
          );
        }
        for (const testCase of module.cases) {
          db.run(
            `INSERT INTO test_case(
               full_id, case_key, module_name, class_name, method_name,
               suite_id, title, description_zh, docstring
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, '')`,
            [
              testCase.id,
              testCase.method,
              testCase.module,
              testCase.class_name,
              testCase.method,
              testCase.suite_id,
              testCase.method,
              testCase.full_name,
            ],
          );
          if (hasFts) {
            db.run(
              `INSERT INTO catalog_fts(entity_type, entity_id, suite_id, module_name, title, body)
               VALUES ('test_case', ?, ?, ?, ?, ?)`,
              [testCase.id, testCase.suite_id, testCase.module, testCase.method, testCase.full_name],
            );
          }
        }
      }

      metaSet(db, "schema_version", String(SCHEMA_VERSION));
      metaSet(db, "last_sync_at", now);
      metaSet(db, "catalog_scanned_at", catalog.scanned_at);
      db.exec("COMMIT");
    } catch (error) {
      if (db.inTransaction) db.exec("ROLLBACK");
      throw error;
    }
    return {
      ok: true,
      forced: true,
      last_sync_at: now,
      database_path: filename,
      added_or_updated: {
        pages: pages.length,
        test_modules: catalog.modules.length,
        test_cases: catalog.modules.reduce((sum, module) => sum + module.case_count, 0),
      },
    };
  } finally {
    db.close();
  }
}

export function runtimeCatalogStatus(options: RuntimeCatalogOptions = {}): RuntimeCatalogStatus {
  const filename = runtimeCatalogPath(options);
  if (!fs.existsSync(filename)) {
    return { ok: false, database_path: filename, exists: false, last_sync_at: null, counts: {} };
  }
  const db = pnwCreateDb(filename);
  try {
    ensureRuntimeCatalogSchema(db);
    const meta = metaMap(db);
    const count = (table: string) => Number(db.get<{ count: number }>(`SELECT COUNT(*) AS count FROM ${table}`)?.count || 0);
    return {
      ok: true,
      database_path: filename,
      exists: true,
      last_sync_at: meta.last_sync_at || null,
      catalog_scanned_at: meta.catalog_scanned_at || null,
      schema_version: Number(meta.schema_version || 0),
      counts: {
        pages: count("app_page"),
        test_modules: count("test_module"),
        test_cases: count("test_case"),
        suites: count("test_suite"),
      },
    };
  } finally {
    db.close();
  }
}

export function ensureRuntimeCatalog(
  catalog: UnitTestCatalog,
  options: RuntimeCatalogOptions = {},
): RuntimeCatalogStatus {
  const status = runtimeCatalogStatus(options);
  if (!status.exists || status.catalog_scanned_at !== catalog.scanned_at) {
    syncRuntimeCatalog(catalog, options);
  }
  return runtimeCatalogStatus(options);
}

function placeholders(count: number): string {
  return Array.from({ length: count }, () => "?").join(",");
}

export function runtimeTestModuleMap(
  moduleNames: string[] = [],
  options: RuntimeCatalogOptions = {},
) {
  const filename = runtimeCatalogPath(options);
  if (!fs.existsSync(filename)) return { modules: {} as Record<string, unknown> };
  const names = [...new Set(moduleNames.map(String).filter(Boolean))];
  const db = pnwCreateDb(filename);
  try {
    ensureRuntimeCatalogSchema(db);
    const where = names.length ? `WHERE module_name IN (${placeholders(names.length)})` : "";
    const rows = db.all<Record<string, unknown>>(
      `SELECT module_name, file_stem, suite_id, title, description_zh, doc_path, case_count
       FROM test_module ${where} ORDER BY module_name`,
      names,
    );
    return {
      modules: Object.fromEntries(rows.map((row) => [String(row.module_name), row])),
    };
  } finally {
    db.close();
  }
}

export function runtimeTestCaseMap(
  fullIds: string[] = [],
  options: RuntimeCatalogOptions = {},
) {
  const filename = runtimeCatalogPath(options);
  if (!fs.existsSync(filename)) return { cases: {} as Record<string, unknown> };
  const ids = [...new Set(fullIds.map(String).filter(Boolean))];
  const db = pnwCreateDb(filename);
  try {
    ensureRuntimeCatalogSchema(db);
    const where = ids.length ? `WHERE full_id IN (${placeholders(ids.length)})` : "";
    const rows = db.all<Record<string, unknown>>(
      `SELECT full_id, case_key, module_name, class_name, method_name,
              suite_id, title, description_zh, docstring
       FROM test_case ${where} ORDER BY full_id`,
      ids,
    );
    return {
      cases: Object.fromEntries(rows.map((row) => [String(row.full_id), row])),
    };
  } finally {
    db.close();
  }
}

export function searchRuntimeCatalog(
  query: { q?: string; suite_id?: string; entity_type?: string; limit?: number; offset?: number } = {},
  options: RuntimeCatalogOptions = {},
) {
  const filename = runtimeCatalogPath(options);
  const limit = Math.max(1, Math.min(200, Number(query.limit || 40)));
  const offset = Math.max(0, Number(query.offset || 0));
  if (!fs.existsSync(filename)) return { items: [], total: 0, q: query.q || "", limit, offset };
  const db = pnwCreateDb(filename);
  try {
    ensureRuntimeCatalogSchema(db);
    const items: Array<Record<string, unknown>> = [];
    if (!query.entity_type || query.entity_type === "page") {
      const rows = db.all<Record<string, unknown>>(
        `SELECT nav_id, page_id, label, description, module
         FROM app_page ORDER BY sort_order, label`,
      );
      for (const row of rows) {
        items.push({
          entity_type: "page",
          entity_id: row.nav_id,
          suite_id: row.module || "",
          module: row.module || "",
          title: row.label,
          subtitle: row.description || row.page_id,
          page_id: row.page_id,
        });
      }
    }
    if (!query.entity_type || query.entity_type === "test_module") {
      const rows = db.all<Record<string, unknown>>(
        `SELECT module_name, suite_id, title, description_zh, case_count
         FROM test_module ORDER BY module_name`,
      );
      for (const row of rows) {
        items.push({
          entity_type: "test_module",
          entity_id: row.module_name,
          suite_id: row.suite_id,
          module: row.module_name,
          title: row.title,
          subtitle: row.description_zh || row.module_name,
          case_count: Number(row.case_count || 0),
        });
      }
    }
    if (!query.entity_type || query.entity_type === "test_case") {
      const rows = db.all<Record<string, unknown>>(
        `SELECT full_id, case_key, module_name, class_name, method_name,
                suite_id, title, description_zh
         FROM test_case ORDER BY module_name, class_name, method_name`,
      );
      for (const row of rows) {
        items.push({
          entity_type: "test_case",
          entity_id: row.full_id,
          suite_id: row.suite_id,
          module: row.module_name,
          title: row.title,
          subtitle: row.description_zh || row.full_id,
          case_key: row.case_key,
          class_name: row.class_name,
          method_name: row.method_name,
        });
      }
    }
    const suite = String(query.suite_id || "").trim();
    const needle = String(query.q || "").trim().toLocaleLowerCase();
    const filtered = items
      .filter((item) => !suite || item.suite_id === suite || (item.entity_type === "page" && !item.suite_id))
      .filter((item) => !needle || `${item.title || ""} ${item.subtitle || ""} ${item.entity_id || ""}`.toLocaleLowerCase().includes(needle));
    return { items: filtered.slice(offset, offset + limit), total: filtered.length, q: query.q || "", limit, offset };
  } finally {
    db.close();
  }
}
