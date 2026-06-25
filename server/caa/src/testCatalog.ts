/**
 * 共享测试目录（SQLite）—— Node + Python 两后端公用。
 * Node 写 vitest 模块，Python 写 unittest 模块。
 */
import Database from "better-sqlite3";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.resolve(__dirname, "../../../tests/fixtures/caa/test-catalog.db");

let _db: Database.Database | null = null;

function db(): Database.Database {
  if (!_db) {
    _db = new Database(DB_PATH);
    _db.pragma("journal_mode = WAL");
    _db.exec(`
      CREATE TABLE IF NOT EXISTS test_modules (
        backend   TEXT NOT NULL,
        module    TEXT NOT NULL,
        case_count INTEGER NOT NULL DEFAULT 0,
        cases_json TEXT DEFAULT '[]',
        updated_at TEXT DEFAULT (datetime('now')),
        PRIMARY KEY (backend, module)
      )
    `);
  }
  return _db;
}

export interface TestModuleRow {
  backend: string;
  module: string;
  case_count: number;
  cases_json: string;
}

/** 写入 vitest 模块（Node 启动时调用） */
export function upsertVitestModules(modules: { file: string; count: number; tests: string[] }[]) {
  const d = db();
  const stmt = d.prepare(`
    INSERT INTO test_modules (backend, module, case_count, cases_json, updated_at)
    VALUES ('vitest', ?, ?, ?, datetime('now'))
    ON CONFLICT(backend, module) DO UPDATE SET case_count=excluded.case_count, cases_json=excluded.cases_json, updated_at=datetime('now')
  `);
  const tx = d.transaction(() => {
    // 先清旧 vitest 条目
    d.prepare("DELETE FROM test_modules WHERE backend = 'vitest'").run();
    for (const m of modules) {
      stmt.run(m.file, m.count, JSON.stringify(m.tests));
    }
  });
  tx();
}

/** 读取所有模块 */
export function readAllModules(): TestModuleRow[] {
  return db().prepare("SELECT * FROM test_modules ORDER BY backend, module").all() as TestModuleRow[];
}

/** 按 backend 读取 */
export function readModulesByBackend(backend: string): TestModuleRow[] {
  return db().prepare("SELECT * FROM test_modules WHERE backend = ? ORDER BY module").all(backend) as TestModuleRow[];
}
