"""工作空间 ``.phoenix/cad-database.sqlite`` — FCStd 索引与扫描元数据。"""

from __future__ import annotations

import json
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator, Mapping

from fcdesk.freecad.fcstd_mapping import (
    FILE_STATUS_MISSING,
    FILE_STATUS_PRESENT,
    FcstdMapDocument,
    FcstdMapEntry,
    normalize_repo_rel_path_for_map,
)

PHOENIX_DIR_NAME = ".phoenix"
CAD_DATABASE_FILENAME = "cad-database.sqlite"
FCSTD_MAP_JSON_NAME = "fcstd_map.json"
STORE_SCHEMA_VERSION = 1


def phoenix_dir(repo_root: Path) -> Path:
    return repo_root.expanduser().resolve(strict=False) / PHOENIX_DIR_NAME


def cad_database_path(repo_root: Path) -> Path:
    return phoenix_dir(repo_root) / CAD_DATABASE_FILENAME


def fcstd_map_json_path(repo_root: Path) -> Path:
    return repo_root.expanduser().resolve(strict=False) / FCSTD_MAP_JSON_NAME


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def _norm_key(repo_rel_path: str) -> str:
    return normalize_repo_rel_path_for_map(repo_rel_path.replace("\\", "/").strip())


@contextmanager
def connect(repo_root: Path) -> Iterator[sqlite3.Connection]:
    rr = repo_root.expanduser().resolve(strict=False)
    phoenix_dir(rr).mkdir(parents=True, exist_ok=True)
    db = cad_database_path(rr)
    conn = sqlite3.connect(str(db), timeout=30.0)
    conn.row_factory = sqlite3.Row
    try:
        conn.execute("PRAGMA foreign_keys = ON")
        conn.execute("PRAGMA journal_mode = WAL")
        _ensure_schema(conn)
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def _ensure_schema(conn: sqlite3.Connection) -> None:
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS meta (
            key TEXT PRIMARY KEY NOT NULL,
            value TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS fcstd_scan (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            scanned_at TEXT NOT NULL,
            scan_root TEXT NOT NULL,
            stats_json TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS file_asset (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            repo_rel_path TEXT NOT NULL UNIQUE,
            filename TEXT NOT NULL,
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

        CREATE INDEX IF NOT EXISTS idx_file_asset_filename ON file_asset(filename);
        CREATE INDEX IF NOT EXISTS idx_file_asset_status ON file_asset(file_status);
        """
    )
    row = conn.execute("SELECT value FROM meta WHERE key = 'schema_version'").fetchone()
    if row is None:
        conn.execute(
            "INSERT INTO meta(key, value) VALUES ('schema_version', ?)",
            (str(STORE_SCHEMA_VERSION),),
        )


def _meta_get(conn: sqlite3.Connection, key: str) -> str | None:
    row = conn.execute("SELECT value FROM meta WHERE key = ?", (key,)).fetchone()
    return str(row["value"]) if row else None


def _meta_set(conn: sqlite3.Connection, key: str, value: str) -> None:
    conn.execute(
        "INSERT INTO meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        (key, value),
    )


def _row_to_entry(row: sqlite3.Row) -> FcstdMapEntry:
    return FcstdMapEntry(
        repo_rel_path=row["repo_rel_path"],
        filename=row["filename"],
        PartNumber=row["part_number"] or None,
        PartVersion=row["part_version"] or None,
        TypeCode=row["type_code"] or None,
        ModelSeries=row["model_series"] or None,
        PartName=row["part_name"] or None,
        label=row["label"] or None,
        file_status=row["file_status"] or FILE_STATUS_PRESENT,
        last_seen_at=row["last_seen_at"] or None,
    )


def _entry_to_row_values(e: FcstdMapEntry, *, updated_at: str) -> tuple[Any, ...]:
    return (
        _norm_key(e.repo_rel_path),
        e.filename,
        e.PartNumber or None,
        e.PartVersion or None,
        e.TypeCode or None,
        e.ModelSeries or None,
        e.PartName or None,
        e.label or None,
        e.file_status or FILE_STATUS_PRESENT,
        e.last_seen_at or None,
        updated_at,
    )


def load_fcstd_document(repo_root: Path) -> FcstdMapDocument | None:
    rr = repo_root.expanduser().resolve(strict=False)
    if not cad_database_path(rr).is_file():
        if migrate_fcstd_map_json(repo_root):
            pass
        else:
            return None
    if not cad_database_path(rr).is_file():
        return None

    with connect(rr) as conn:
        rows = conn.execute(
            "SELECT * FROM file_asset ORDER BY repo_rel_path, file_status"
        ).fetchall()
        if not rows:
            return None

        last_scan = _meta_get(conn, "last_scan_at")
        scan_root = _meta_get(conn, "scan_root")
        stats_raw = _meta_get(conn, "last_scan_stats")
        stats: dict[str, Any] | None = None
        if stats_raw:
            try:
                parsed = json.loads(stats_raw)
                if isinstance(parsed, dict):
                    stats = parsed
            except json.JSONDecodeError:
                pass

        entries = [_row_to_entry(r) for r in rows]
        return FcstdMapDocument(
            entries=entries,
            last_scan_at=last_scan,
            scan_root=scan_root,
            scan_stats=stats,
            anchor_note=(
                "repo_rel_path 相对工作空间根；数据存于 .phoenix/cad-database.sqlite。"
            ),
        )


def save_fcstd_document(
    repo_root: Path,
    doc: FcstdMapDocument,
    *,
    scan_root: str,
    stats: Mapping[str, int],
) -> None:
    rr = repo_root.expanduser().resolve(strict=False)
    now = doc.last_scan_at or _utc_now_iso()
    stats_json = json.dumps(dict(stats), ensure_ascii=False)

    with connect(rr) as conn:
        conn.execute("DELETE FROM file_asset")
        for e in doc.entries:
            conn.execute(
                """
                INSERT INTO file_asset (
                    repo_rel_path, filename, part_number, part_version, type_code,
                    model_series, part_name, label, file_status, last_seen_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                _entry_to_row_values(e, updated_at=now),
            )
        _meta_set(conn, "last_scan_at", now)
        _meta_set(conn, "scan_root", scan_root)
        _meta_set(conn, "last_scan_stats", stats_json)
        conn.execute(
            "INSERT INTO fcstd_scan(scanned_at, scan_root, stats_json) VALUES (?, ?, ?)",
            (now, scan_root, stats_json),
        )


def find_fcstd_entry(repo_root: Path, rel_workspace: Path) -> FcstdMapEntry | None:
    doc = load_fcstd_document(repo_root)
    if doc is None:
        return None
    want = _norm_key(rel_workspace.as_posix())
    for e in doc.entries:
        if _norm_key(e.repo_rel_path) == want:
            return e
    return None


def update_fcstd_entry_rename(
    repo_root: Path,
    old_rel: Path,
    new_rel: Path,
) -> bool:
    rr = repo_root.expanduser().resolve(strict=False)
    migrate_fcstd_map_json(rr)
    if not cad_database_path(rr).is_file():
        return False

    want = _norm_key(old_rel.as_posix())
    new_rr = _norm_key(new_rel.as_posix())
    now = _utc_now_iso()

    with connect(rr) as conn:
        row = conn.execute(
            "SELECT id FROM file_asset WHERE repo_rel_path = ?",
            (want,),
        ).fetchone()
        if row is None:
            return False
        conn.execute(
            """
            UPDATE file_asset
            SET repo_rel_path = ?, filename = ?, updated_at = ?
            WHERE repo_rel_path = ?
            """,
            (new_rr, new_rel.name, now, want),
        )
    return True


def fcstd_map_json_dict(repo_root: Path) -> dict[str, Any]:
    """从 SQLite 加载索引，返回与 ``fcstd_map.json`` 同结构的 dict（不写盘）。"""
    rr = repo_root.expanduser().resolve(strict=False)
    migrate_fcstd_map_json(rr)
    doc = load_fcstd_document(rr)
    if doc is None:
        raise FileNotFoundError("索引库为空，请先执行 FCStd 工程内搜索")
    return doc.to_json_dict()


def migrate_fcstd_map_json(repo_root: Path) -> bool:
    """若库为空且存在 ``fcstd_map.json``，一次性导入 SQLite。"""
    rr = repo_root.expanduser().resolve(strict=False)
    jp = fcstd_map_json_path(rr)
    if not jp.is_file():
        return False

    if cad_database_path(rr).is_file():
        with connect(rr) as conn:
            n = conn.execute("SELECT COUNT(*) AS c FROM file_asset").fetchone()
            if n and int(n["c"]) > 0:
                return False

    try:
        raw = json.loads(jp.read_text(encoding="utf-8"))
        if not isinstance(raw, dict):
            return False
        if "schema_version" not in raw:
            raw = dict(raw)
            raw["schema_version"] = 2
        doc = FcstdMapDocument.from_json_mapping(raw)
    except (OSError, json.JSONDecodeError, TypeError, ValueError):
        return False

    if not doc.entries:
        return False

    stats = doc.scan_stats or {
        "total_entries": len(doc.entries),
        "present": sum(1 for e in doc.entries if e.file_status != FILE_STATUS_MISSING),
        "missing": sum(1 for e in doc.entries if e.file_status == FILE_STATUS_MISSING),
    }
    save_fcstd_document(
        rr,
        doc,
        scan_root=doc.scan_root or ".",
        stats=stats,
    )
    _meta_set_migration_note(rr, jp)
    return True


def _meta_set_migration_note(repo_root: Path, jp: Path) -> None:
    with connect(repo_root) as conn:
        _meta_set(
            conn,
            "migrated_from_fcstd_map_json",
            f"{jp.name}@{_utc_now_iso()}",
        )


def export_fcstd_map_json(repo_root: Path, dest: Path | None = None) -> Path:
    """从 SQLite 导出 ``fcstd_map.json``（供 xlink 脚本等外部工具）。"""
    rr = repo_root.expanduser().resolve(strict=False)
    doc = load_fcstd_document(rr)
    if doc is None:
        raise FileNotFoundError("索引库为空，无法导出 fcstd_map.json")

    out = dest or fcstd_map_json_path(rr)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(
        json.dumps(doc.to_json_dict(), ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return out
