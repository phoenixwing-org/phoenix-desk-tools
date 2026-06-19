"""Code 模块 SQLite 表（``phoenix_code_*``，与 CAD 表同库）。"""

from __future__ import annotations

import sqlite3

T_CODE_SCAN = "phoenix_code_scan"
T_CODE_FILE = "phoenix_code_file_asset"

CODE_CREATE_SCHEMA_DDL = f"""
CREATE TABLE IF NOT EXISTS {T_CODE_SCAN} (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    scanned_at TEXT NOT NULL,
    scan_root TEXT NOT NULL,
    stats_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS {T_CODE_FILE} (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    repo_rel_path TEXT NOT NULL UNIQUE,
    filename TEXT NOT NULL,
    asset_kind TEXT NOT NULL,
    file_ext TEXT NOT NULL DEFAULT '',
    file_status TEXT NOT NULL DEFAULT 'present',
    size_bytes INTEGER NOT NULL DEFAULT 0,
    text_encoding TEXT NOT NULL DEFAULT '',
    last_seen_at TEXT,
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_phoenix_code_file_kind
    ON {T_CODE_FILE}(asset_kind);
CREATE INDEX IF NOT EXISTS idx_phoenix_code_file_filename
    ON {T_CODE_FILE}(filename);
CREATE INDEX IF NOT EXISTS idx_phoenix_code_file_status
    ON {T_CODE_FILE}(file_status);
CREATE INDEX IF NOT EXISTS idx_phoenix_code_file_ext
    ON {T_CODE_FILE}(file_ext);
CREATE INDEX IF NOT EXISTS idx_phoenix_code_file_encoding
    ON {T_CODE_FILE}(text_encoding);
"""


def migrate_code_schema(conn: sqlite3.Connection) -> None:
    """增量迁移：已有库补 ``text_encoding`` 列。"""
    rows = conn.execute(f"PRAGMA table_info({T_CODE_FILE})").fetchall()
    cols = {str(r[1]) for r in rows}
    if "text_encoding" not in cols:
        conn.execute(
            f"ALTER TABLE {T_CODE_FILE} ADD COLUMN text_encoding TEXT NOT NULL DEFAULT ''"
        )
        conn.execute(
            f"CREATE INDEX IF NOT EXISTS idx_phoenix_code_file_encoding "
            f"ON {T_CODE_FILE}(text_encoding)"
        )

