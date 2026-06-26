"""CAA 模块 SQLite 表（``phoenix_caa_*``，与工作空间库同库）。"""

from __future__ import annotations

import sqlite3

T_CAA_SCAN = "phoenix_caa_scan"
T_CAA_DIALOG = "phoenix_caa_dialog"
T_CAA_GROUP = "phoenix_caa_dialog_group"
T_CAA_GROUP_MEMBER = "phoenix_caa_dialog_group_member"
T_CAA_DIALOG_FTS = "phoenix_caa_dialog_fts"

CAA_CREATE_SCHEMA_DDL = f"""
CREATE TABLE IF NOT EXISTS {T_CAA_SCAN} (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    scanned_at TEXT NOT NULL,
    scan_root TEXT NOT NULL,
    stats_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS {T_CAA_DIALOG} (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    repo_rel_catdlg TEXT NOT NULL UNIQUE,
    dialog_name TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    filename TEXT NOT NULL,
    group_key TEXT NOT NULL,
    group_label TEXT NOT NULL,
    file_status TEXT NOT NULL DEFAULT 'present',
    size_bytes INTEGER NOT NULL DEFAULT 0,
    last_seen_at TEXT,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS {T_CAA_GROUP} (
    group_key TEXT PRIMARY KEY,
    group_label TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS {T_CAA_GROUP_MEMBER} (
    group_key TEXT NOT NULL,
    dialog_id INTEGER NOT NULL,
    PRIMARY KEY(group_key, dialog_id),
    FOREIGN KEY(dialog_id) REFERENCES {T_CAA_DIALOG}(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_phoenix_caa_dialog_status
    ON {T_CAA_DIALOG}(file_status);
CREATE INDEX IF NOT EXISTS idx_phoenix_caa_dialog_group
    ON {T_CAA_DIALOG}(group_key);
CREATE INDEX IF NOT EXISTS idx_phoenix_caa_dialog_name
    ON {T_CAA_DIALOG}(dialog_name);

CREATE VIRTUAL TABLE IF NOT EXISTS {T_CAA_DIALOG_FTS} USING fts5(
    repo_rel_catdlg UNINDEXED,
    dialog_name,
    title,
    filename,
    group_key,
    group_label,
    body,
    tokenize='unicode61 remove_diacritics 0'
);
"""


def migrate_caa_schema(conn: sqlite3.Connection) -> None:
    conn.executescript(CAA_CREATE_SCHEMA_DDL)
