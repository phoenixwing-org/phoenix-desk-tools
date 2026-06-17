"""Phoenix CAD SQLite schema v10：表名常量、DDL、旧库检测与重建。"""

from __future__ import annotations

import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

PHOENIX_DIR_NAME = ".phoenix"
WORKSPACE_DATABASE_FILENAME = "phoenix-workspace.sqlite"
CAD_DATABASE_FILENAME = WORKSPACE_DATABASE_FILENAME
SCHEMA_VERSION = 10

T_META = "phoenix_meta"
T_CAD_SCAN = "phoenix_cad_scan"
T_FILE_ASSET = "phoenix_cad_file_asset"
T_PART_KEY = "phoenix_cad_part_key"
T_PART_FILE_LINK = "phoenix_cad_part_file_link"
T_BOM_XREF = "phoenix_cad_bom_xref"
T_BOM_ASSEMBLY_CACHE = "phoenix_cad_bom_assembly_cache"
T_BOM_TREE_OCCURRENCE = "phoenix_cad_bom_tree_occurrence"
T_CHANGE_EVENT = "phoenix_audit_change_event"
T_RENAME_LOG = "phoenix_audit_rename_log"
T_REF_HIT = "phoenix_audit_ref_hit"
T_REF_PATCH_LOG = "phoenix_audit_ref_patch_log"
T_UI_SESSION = "phoenix_ui_session"

CREATE_SCHEMA_DDL = f"""
CREATE TABLE IF NOT EXISTS {T_META} (
    key TEXT PRIMARY KEY NOT NULL,
    value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS {T_CAD_SCAN} (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    scanned_at TEXT NOT NULL,
    scan_root TEXT NOT NULL,
    stats_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS {T_FILE_ASSET} (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    repo_rel_path TEXT NOT NULL UNIQUE,
    filename TEXT NOT NULL,
    asset_kind TEXT,
    part_number TEXT,
    part_version TEXT,
    type_code TEXT,
    model_series TEXT,
    part_name TEXT,
    label TEXT,
    file_status TEXT NOT NULL DEFAULT 'present',
    last_seen_at TEXT,
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_phoenix_cad_file_asset_filename
    ON {T_FILE_ASSET}(filename);
CREATE INDEX IF NOT EXISTS idx_phoenix_cad_file_asset_status
    ON {T_FILE_ASSET}(file_status);
CREATE INDEX IF NOT EXISTS idx_phoenix_cad_file_asset_part
    ON {T_FILE_ASSET}(part_number, part_version);

CREATE TABLE IF NOT EXISTS {T_PART_KEY} (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    part_number TEXT NOT NULL,
    part_version TEXT NOT NULL,
    type_code TEXT,
    model_series TEXT,
    part_name TEXT,
    label TEXT,
    notes TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(part_number, part_version)
);

CREATE TABLE IF NOT EXISTS {T_PART_FILE_LINK} (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    part_key_id INTEGER NOT NULL REFERENCES {T_PART_KEY}(id) ON DELETE CASCADE,
    file_asset_id INTEGER NOT NULL UNIQUE REFERENCES {T_FILE_ASSET}(id) ON DELETE CASCADE,
    file_role TEXT NOT NULL DEFAULT 'part',
    notes TEXT,
    link_status TEXT NOT NULL DEFAULT 'active',
    linked_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_phoenix_cad_part_key_pn_pv
    ON {T_PART_KEY}(part_number, part_version);
CREATE INDEX IF NOT EXISTS idx_phoenix_cad_part_file_link_key
    ON {T_PART_FILE_LINK}(part_key_id);

CREATE TABLE IF NOT EXISTS {T_CHANGE_EVENT} (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL,
    created_at TEXT NOT NULL,
    actor TEXT,
    source TEXT,
    note TEXT,
    stats_json TEXT
);

CREATE TABLE IF NOT EXISTS {T_RENAME_LOG} (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id INTEGER NOT NULL REFERENCES {T_CHANGE_EVENT}(id) ON DELETE CASCADE,
    file_asset_id INTEGER REFERENCES {T_FILE_ASSET}(id) ON DELETE SET NULL,
    old_repo_rel_path TEXT NOT NULL,
    new_repo_rel_path TEXT NOT NULL,
    old_filename TEXT NOT NULL,
    new_filename TEXT NOT NULL,
    old_basename TEXT NOT NULL,
    new_basename TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS {T_REF_HIT} (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id INTEGER NOT NULL REFERENCES {T_CHANGE_EVENT}(id) ON DELETE CASCADE,
    rename_log_id INTEGER REFERENCES {T_RENAME_LOG}(id) ON DELETE SET NULL,
    host_repo_rel_path TEXT NOT NULL,
    host_asset_kind TEXT,
    ref_kind TEXT NOT NULL DEFAULT 'xlink_file_attr',
    locator TEXT NOT NULL DEFAULT 'Document.xml',
    matched_text TEXT NOT NULL,
    proposed_text TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    detail_json TEXT
);

CREATE TABLE IF NOT EXISTS {T_REF_PATCH_LOG} (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id INTEGER NOT NULL REFERENCES {T_CHANGE_EVENT}(id) ON DELETE CASCADE,
    ref_hit_id INTEGER REFERENCES {T_REF_HIT}(id) ON DELETE SET NULL,
    host_repo_rel_path TEXT NOT NULL,
    old_text TEXT NOT NULL,
    new_text TEXT NOT NULL,
    applied_at TEXT,
    error TEXT
);

CREATE INDEX IF NOT EXISTS idx_phoenix_audit_rename_log_old_basename
    ON {T_RENAME_LOG}(old_basename);
CREATE INDEX IF NOT EXISTS idx_phoenix_audit_ref_hit_rename
    ON {T_REF_HIT}(rename_log_id);
CREATE INDEX IF NOT EXISTS idx_phoenix_audit_ref_hit_host
    ON {T_REF_HIT}(host_repo_rel_path);

CREATE TABLE IF NOT EXISTS {T_UI_SESSION} (
    scope TEXT PRIMARY KEY NOT NULL,
    payload_json TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS {T_BOM_XREF} (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    scan_id INTEGER NOT NULL REFERENCES {T_CAD_SCAN}(id) ON DELETE CASCADE,
    host_file_asset_id INTEGER NOT NULL REFERENCES {T_FILE_ASSET}(id) ON DELETE CASCADE,
    host_repo_rel_path TEXT NOT NULL,
    ref_kind TEXT NOT NULL DEFAULT 'xlink_file_attr',
    locator TEXT NOT NULL DEFAULT 'Document.xml',
    xlink_file_attr TEXT NOT NULL,
    link_label TEXT NOT NULL DEFAULT '',
    rule_label TEXT NOT NULL DEFAULT '',
    target_basename TEXT NOT NULL,
    target_file_asset_id INTEGER REFERENCES {T_FILE_ASSET}(id) ON DELETE SET NULL,
    target_repo_rel_path TEXT,
    target_part_number TEXT NOT NULL DEFAULT '',
    target_part_version TEXT NOT NULL DEFAULT '',
    target_type_code TEXT NOT NULL DEFAULT '',
    target_model_series TEXT NOT NULL DEFAULT '',
    target_part_name TEXT NOT NULL DEFAULT '',
    target_asset_label TEXT NOT NULL DEFAULT '',
    resolve_status TEXT NOT NULL DEFAULT 'missing',
    detail_json TEXT,
    last_seen_at TEXT NOT NULL,
    UNIQUE(host_file_asset_id, xlink_file_attr)
);

CREATE INDEX IF NOT EXISTS idx_phoenix_cad_bom_xref_host
    ON {T_BOM_XREF}(host_file_asset_id);
CREATE INDEX IF NOT EXISTS idx_phoenix_cad_bom_xref_host_path
    ON {T_BOM_XREF}(host_repo_rel_path);
CREATE INDEX IF NOT EXISTS idx_phoenix_cad_bom_xref_target_asset
    ON {T_BOM_XREF}(target_file_asset_id);
CREATE INDEX IF NOT EXISTS idx_phoenix_cad_bom_xref_target_basename
    ON {T_BOM_XREF}(target_basename);
CREATE INDEX IF NOT EXISTS idx_phoenix_cad_bom_xref_target_path
    ON {T_BOM_XREF}(target_repo_rel_path);
CREATE INDEX IF NOT EXISTS idx_phoenix_cad_bom_xref_scan
    ON {T_BOM_XREF}(scan_id);

CREATE TABLE IF NOT EXISTS {T_BOM_ASSEMBLY_CACHE} (
    host_repo_rel_path TEXT NOT NULL,
    mode TEXT NOT NULL,
    tree_json TEXT NOT NULL,
    node_count INTEGER NOT NULL DEFAULT 0,
    bom_xref_at TEXT NOT NULL DEFAULT '',
    built_at TEXT NOT NULL,
    PRIMARY KEY (host_repo_rel_path, mode)
);

CREATE INDEX IF NOT EXISTS idx_phoenix_cad_bom_asm_cache_built
    ON {T_BOM_ASSEMBLY_CACHE}(bom_xref_at);

CREATE TABLE IF NOT EXISTS {T_BOM_TREE_OCCURRENCE} (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    root_host_repo_rel_path TEXT NOT NULL,
    tree_path TEXT NOT NULL,
    depth INTEGER NOT NULL,
    host_repo_rel_path TEXT NOT NULL,
    target_repo_rel_path TEXT,
    xlink_file_attr TEXT NOT NULL,
    link_label TEXT,
    built_at TEXT NOT NULL,
    UNIQUE(root_host_repo_rel_path, tree_path)
);

CREATE INDEX IF NOT EXISTS idx_phoenix_cad_bom_occ_target
    ON {T_BOM_TREE_OCCURRENCE}(target_repo_rel_path);
CREATE INDEX IF NOT EXISTS idx_phoenix_cad_bom_occ_root
    ON {T_BOM_TREE_OCCURRENCE}(root_host_repo_rel_path);
CREATE INDEX IF NOT EXISTS idx_phoenix_cad_bom_occ_host_target
    ON {T_BOM_TREE_OCCURRENCE}(host_repo_rel_path, target_repo_rel_path);
"""


class PhoenixDatabaseError(RuntimeError):
    """工作空间 SQLite schema 与当前版本不一致。"""

    def __init__(self, message: str, *, reasons: list[str] | None = None) -> None:
        super().__init__(message)
        self.reasons = reasons or []


# 兼容旧异常名
LegacyPhoenixDatabaseError = PhoenixDatabaseError


def phoenix_dir(repo_root: Path) -> Path:
    return repo_root.expanduser().resolve(strict=False) / PHOENIX_DIR_NAME


def workspace_database_path(repo_root: Path) -> Path:
    return phoenix_dir(repo_root) / WORKSPACE_DATABASE_FILENAME


def cad_database_path(repo_root: Path) -> Path:
    """``workspace_database_path`` 的兼容别名。"""
    return workspace_database_path(repo_root)


def _list_user_tables(conn: sqlite3.Connection) -> set[str]:
    rows = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
    ).fetchall()
    return {str(r[0]) for r in rows}


def _read_schema_version(conn: sqlite3.Connection) -> int | None:
    tables = _list_user_tables(conn)
    if T_META not in tables:
        return None
    row = conn.execute(
        f"SELECT value FROM {T_META} WHERE key = 'schema_version'"
    ).fetchone()
    if not row:
        return None
    try:
        return int(row[0])
    except (TypeError, ValueError):
        return None


def database_status_payload(repo_root: Path) -> dict[str, Any]:
    rr = repo_root.expanduser().resolve(strict=False)
    db_path = workspace_database_path(rr)
    reasons: list[str] = []
    schema_version: int | None = None
    if db_path.is_file():
        conn = sqlite3.connect(str(db_path))
        try:
            schema_version = _read_schema_version(conn)
            if schema_version != SCHEMA_VERSION:
                reasons.append("schema_version_mismatch")
        finally:
            conn.close()
    return {
        "database_exists": db_path.is_file(),
        "needs_recreate": bool(reasons),
        "reasons": reasons,
        "schema_version": schema_version,
        "expected_schema_version": SCHEMA_VERSION,
        "database_filename": WORKSPACE_DATABASE_FILENAME,
        "database_path": str(db_path),
        "database_path_display": str(db_path.relative_to(rr)) if db_path.is_file() else "",
    }


def recreate_database(repo_root: Path) -> dict[str, Any]:
    """删除工作空间库并创建空 v10 库。"""
    rr = repo_root.expanduser().resolve(strict=False)
    phoenix_dir(rr).mkdir(parents=True, exist_ok=True)
    removed: list[str] = []
    db = workspace_database_path(rr)
    if db.is_file():
        db.unlink()
        removed.append(db.name)

    conn = sqlite3.connect(str(db), timeout=30.0)
    try:
        conn.execute("PRAGMA foreign_keys = ON")
        conn.execute("PRAGMA journal_mode = WAL")
        conn.executescript(CREATE_SCHEMA_DDL)
        conn.execute(
            f"INSERT INTO {T_META}(key, value) VALUES ('schema_version', ?)",
            (str(SCHEMA_VERSION),),
        )
        conn.commit()
    finally:
        conn.close()

    now = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
    return {
        "status": "recreated",
        "removed_files": removed,
        "database_path": str(db),
        "schema_version": SCHEMA_VERSION,
        "recreated_at": now,
    }
