"""FileWorkset 表（``phoenix_workset*``，与 CAD/Code 同库，壳层系统能力）。"""

from __future__ import annotations

import sqlite3

T_WORKSET = "phoenix_workset"
T_WORKSET_PATH = "phoenix_workset_path"

WORKSET_CREATE_SCHEMA_DDL = f"""
CREATE TABLE IF NOT EXISTS {T_WORKSET} (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS {T_WORKSET_PATH} (
    workset_id TEXT NOT NULL REFERENCES {T_WORKSET}(id) ON DELETE CASCADE,
    repo_rel_path TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (workset_id, repo_rel_path)
);

CREATE INDEX IF NOT EXISTS idx_phoenix_workset_path_rel
    ON {T_WORKSET_PATH}(repo_rel_path);
"""


def migrate_workset_schema(conn: sqlite3.Connection) -> None:
    """已有库补建工作集表（不 bump schema_version）。"""
    conn.executescript(WORKSET_CREATE_SCHEMA_DDL)
