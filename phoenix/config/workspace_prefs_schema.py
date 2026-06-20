"""工作空间偏好 SQLite DDL（``phoenix_workspace_pref``）。"""

from __future__ import annotations

import sqlite3

T_WORKSPACE_PREF = "phoenix_workspace_pref"

WORKSPACE_PREF_CREATE_SCHEMA_DDL = f"""
CREATE TABLE IF NOT EXISTS {T_WORKSPACE_PREF} (
    section TEXT PRIMARY KEY NOT NULL,
    value_json TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
"""


def migrate_workspace_pref_schema(conn: sqlite3.Connection) -> None:
    conn.executescript(WORKSPACE_PREF_CREATE_SCHEMA_DDL)
