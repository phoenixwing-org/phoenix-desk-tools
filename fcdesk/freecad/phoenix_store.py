"""工作空间 ``.phoenix/cad-database.sqlite`` — FCStd 索引与扫描元数据。"""

from __future__ import annotations

import inspect
import json
import logging
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator, Mapping

from fcdesk.freecad.cad_index_types import cad_asset_kind, is_fcstd_filename
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
STORE_SCHEMA_VERSION = 2

PART_KEY_STATUS_ACTIVE = "active"
PART_KEY_STATUS_OBSOLETE = "obsolete"

logger = logging.getLogger(__name__)

_SQL_LOG_SKIP_FUNCTIONS = frozenset(
    {
        "execute",
        "executemany",
        "_log_sql_execute",
        "__getattr__",
        "__setattr__",
        "connect",
    }
)

LINK_STATUS_ACTIVE = "active"
LINK_STATUS_OBSOLETE = "obsolete"


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


def _sql_like_escape(text: str) -> str:
    return text.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def _looks_like_exact_basename(name: str) -> bool:
    lower = name.casefold()
    return lower.endswith(".fcstd") and "/" not in name and "\\" not in name


def _sql_caller_hint() -> str:
    """从调用栈解析业务入口（模块.函数），便于对照页面/API。"""
    for frame in inspect.stack()[2:16]:
        fn = frame.function
        if fn in _SQL_LOG_SKIP_FUNCTIONS:
            continue
        path = frame.filename.replace("\\", "/")
        if "/fcdesk/" not in path:
            continue
        return f"{Path(path).stem}.{fn}"
    return "unknown"


def _log_sql_execute(
    sql: str,
    parameters: Any = (),
    *,
    batch_note: str = "",
) -> None:
    if not isinstance(sql, str):
        return
    if sql.strip().upper().startswith("PRAGMA"):
        return
    hint = _sql_caller_hint() + batch_note
    if isinstance(parameters, (list, tuple)) and parameters and isinstance(parameters[0], (list, tuple)):
        params: tuple[Any, ...] = tuple(parameters[0])
    elif isinstance(parameters, (list, tuple)):
        params = tuple(parameters)
    else:
        params = (parameters,) if parameters != () else ()
    log_query_sql(logger, hint=hint, sql=sql, params=params)


class _LoggingConnection:
    """包装 SQLite 连接：每次 ``execute`` / ``executemany`` 打统一 SQL 日志。"""

    def __init__(self, inner: sqlite3.Connection) -> None:
        object.__setattr__(self, "_inner", inner)

    def execute(self, sql: str, parameters: Any = ()):
        _log_sql_execute(sql, parameters)
        return self._inner.execute(sql, parameters)

    def executemany(self, sql: str, parameters: Any):
        try:
            n = len(parameters)  # type: ignore[arg-type]
        except TypeError:
            n = 0
        _log_sql_execute(sql, (), batch_note=f" executemany×{n}")
        return self._inner.executemany(sql, parameters)

    def __getattr__(self, name: str) -> Any:
        return getattr(self._inner, name)

    def __setattr__(self, name: str, value: Any) -> None:
        if name == "_inner":
            object.__setattr__(self, name, value)
        else:
            setattr(self._inner, name, value)


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
        yield _LoggingConnection(conn)  # type: ignore[misc]
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

        CREATE INDEX IF NOT EXISTS idx_file_asset_filename ON file_asset(filename);
        CREATE INDEX IF NOT EXISTS idx_file_asset_status ON file_asset(file_status);
        CREATE INDEX IF NOT EXISTS idx_file_asset_part ON file_asset(part_number, part_version);
        """
    )
    _migrate_schema(conn)


def _migrate_schema(conn: sqlite3.Connection) -> None:
    row = conn.execute("SELECT value FROM meta WHERE key = 'schema_version'").fetchone()
    version = int(row["value"]) if row else 0
    if version < 1:
        conn.execute(
            "INSERT INTO meta(key, value) VALUES ('schema_version', '1') "
            "ON CONFLICT(key) DO UPDATE SET value = excluded.value"
        )
        version = 1
    if version < 2:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS part_key (
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

            CREATE TABLE IF NOT EXISTS part_file_link (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                part_key_id INTEGER NOT NULL REFERENCES part_key(id) ON DELETE CASCADE,
                file_asset_id INTEGER NOT NULL UNIQUE REFERENCES file_asset(id) ON DELETE CASCADE,
                file_role TEXT NOT NULL DEFAULT 'part',
                notes TEXT,
                link_status TEXT NOT NULL DEFAULT 'active',
                linked_at TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_part_key_pn_pv ON part_key(part_number, part_version);
            CREATE INDEX IF NOT EXISTS idx_part_file_link_key ON part_file_link(part_key_id);
            """
        )
        conn.execute(
            "UPDATE meta SET value = '2' WHERE key = 'schema_version'"
        )
        sync_part_keys_from_file_assets(conn)
    if version < 3:
        cols = {r["name"] for r in conn.execute("PRAGMA table_info(file_asset)").fetchall()}
        if "asset_kind" not in cols:
            conn.execute("ALTER TABLE file_asset ADD COLUMN asset_kind TEXT")
        conn.execute(
            """
            UPDATE file_asset
            SET asset_kind = 'fcstd'
            WHERE asset_kind IS NULL OR TRIM(asset_kind) = ''
            """
        )
        conn.execute(
            "UPDATE meta SET value = '3' WHERE key = 'schema_version'"
        )
        version = 3
    if version < 4:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS change_event (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                kind TEXT NOT NULL,
                created_at TEXT NOT NULL,
                actor TEXT,
                source TEXT,
                note TEXT,
                stats_json TEXT
            );

            CREATE TABLE IF NOT EXISTS rename_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                event_id INTEGER NOT NULL REFERENCES change_event(id) ON DELETE CASCADE,
                file_asset_id INTEGER REFERENCES file_asset(id) ON DELETE SET NULL,
                old_repo_rel_path TEXT NOT NULL,
                new_repo_rel_path TEXT NOT NULL,
                old_filename TEXT NOT NULL,
                new_filename TEXT NOT NULL,
                old_basename TEXT NOT NULL,
                new_basename TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS ref_hit (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                event_id INTEGER NOT NULL REFERENCES change_event(id) ON DELETE CASCADE,
                rename_log_id INTEGER REFERENCES rename_log(id) ON DELETE SET NULL,
                host_repo_rel_path TEXT NOT NULL,
                host_asset_kind TEXT,
                ref_kind TEXT NOT NULL DEFAULT 'xlink_file_attr',
                locator TEXT NOT NULL DEFAULT 'Document.xml',
                matched_text TEXT NOT NULL,
                proposed_text TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'pending',
                detail_json TEXT
            );

            CREATE TABLE IF NOT EXISTS ref_patch_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                event_id INTEGER NOT NULL REFERENCES change_event(id) ON DELETE CASCADE,
                ref_hit_id INTEGER REFERENCES ref_hit(id) ON DELETE SET NULL,
                host_repo_rel_path TEXT NOT NULL,
                old_text TEXT NOT NULL,
                new_text TEXT NOT NULL,
                applied_at TEXT,
                error TEXT
            );

            CREATE INDEX IF NOT EXISTS idx_rename_log_old_basename ON rename_log(old_basename);
            CREATE INDEX IF NOT EXISTS idx_ref_hit_rename ON ref_hit(rename_log_id);
            CREATE INDEX IF NOT EXISTS idx_ref_hit_host ON ref_hit(host_repo_rel_path);
            """
        )
        conn.execute(
            "UPDATE meta SET value = '4' WHERE key = 'schema_version'"
        )
        version = 4
    if version < 5:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS ui_session (
                scope TEXT PRIMARY KEY NOT NULL,
                payload_json TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            """
        )
        conn.execute(
            "UPDATE meta SET value = '5' WHERE key = 'schema_version'"
        )
        version = 5
    if version < 6:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS bom_xref (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                scan_id INTEGER NOT NULL REFERENCES fcstd_scan(id) ON DELETE CASCADE,
                host_file_asset_id INTEGER NOT NULL REFERENCES file_asset(id) ON DELETE CASCADE,
                host_repo_rel_path TEXT NOT NULL,
                ref_kind TEXT NOT NULL DEFAULT 'xlink_file_attr',
                locator TEXT NOT NULL DEFAULT 'Document.xml',
                xlink_file_attr TEXT NOT NULL,
                target_basename TEXT NOT NULL,
                target_file_asset_id INTEGER REFERENCES file_asset(id) ON DELETE SET NULL,
                target_repo_rel_path TEXT,
                resolve_status TEXT NOT NULL DEFAULT 'missing',
                detail_json TEXT,
                last_seen_at TEXT NOT NULL,
                UNIQUE(host_file_asset_id, xlink_file_attr)
            );

            CREATE INDEX IF NOT EXISTS idx_bom_xref_host ON bom_xref(host_file_asset_id);
            CREATE INDEX IF NOT EXISTS idx_bom_xref_host_path ON bom_xref(host_repo_rel_path);
            CREATE INDEX IF NOT EXISTS idx_bom_xref_target_asset ON bom_xref(target_file_asset_id);
            CREATE INDEX IF NOT EXISTS idx_bom_xref_target_basename ON bom_xref(target_basename);
            CREATE INDEX IF NOT EXISTS idx_bom_xref_target_path ON bom_xref(target_repo_rel_path);
            CREATE INDEX IF NOT EXISTS idx_bom_xref_scan ON bom_xref(scan_id);
            """
        )
        conn.execute(
            "UPDATE meta SET value = '6' WHERE key = 'schema_version'"
        )
        version = 6
    if version < 7:
        cols = {r["name"] for r in conn.execute("PRAGMA table_info(bom_xref)").fetchall()}
        if "link_label" not in cols:
            conn.execute(
                "ALTER TABLE bom_xref ADD COLUMN link_label TEXT NOT NULL DEFAULT ''"
            )
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS bom_assembly_cache (
                host_repo_rel_path TEXT NOT NULL,
                mode TEXT NOT NULL,
                tree_json TEXT NOT NULL,
                node_count INTEGER NOT NULL DEFAULT 0,
                bom_xref_at TEXT NOT NULL DEFAULT '',
                built_at TEXT NOT NULL,
                PRIMARY KEY (host_repo_rel_path, mode)
            );
            CREATE INDEX IF NOT EXISTS idx_bom_asm_cache_built
                ON bom_assembly_cache(bom_xref_at);
            """
        )
        conn.execute(
            "UPDATE meta SET value = '7' WHERE key = 'schema_version'"
        )
        version = 7
    if version < 8:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS bom_tree_occurrence (
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
            CREATE INDEX IF NOT EXISTS idx_bom_occ_target
                ON bom_tree_occurrence(target_repo_rel_path);
            CREATE INDEX IF NOT EXISTS idx_bom_occ_root
                ON bom_tree_occurrence(root_host_repo_rel_path);
            CREATE INDEX IF NOT EXISTS idx_bom_occ_host_target
                ON bom_tree_occurrence(host_repo_rel_path, target_repo_rel_path);
            """
        )
        conn.execute(
            "UPDATE meta SET value = '8' WHERE key = 'schema_version'"
        )
        version = 8
    if version < 9:
        cols = {r["name"] for r in conn.execute("PRAGMA table_info(bom_xref)").fetchall()}
        redundant = (
            ("rule_label", "TEXT NOT NULL DEFAULT ''"),
            ("target_part_number", "TEXT NOT NULL DEFAULT ''"),
            ("target_part_version", "TEXT NOT NULL DEFAULT ''"),
            ("target_type_code", "TEXT NOT NULL DEFAULT ''"),
            ("target_model_series", "TEXT NOT NULL DEFAULT ''"),
            ("target_part_name", "TEXT NOT NULL DEFAULT ''"),
            ("target_asset_label", "TEXT NOT NULL DEFAULT ''"),
        )
        for name, ddl in redundant:
            if name not in cols:
                conn.execute(f"ALTER TABLE bom_xref ADD COLUMN {name} {ddl}")
        _backfill_bom_xref_redundant_columns(conn)
        conn.execute("DELETE FROM bom_assembly_cache")
        conn.execute(
            "UPDATE meta SET value = '9' WHERE key = 'schema_version'"
        )


def _backfill_bom_xref_redundant_columns(conn: sqlite3.Connection) -> None:
    """将既有 ``bom_xref`` 行的子件快照与 ``rule_label`` 从 ``file_asset`` 回填进冗余列。"""
    from fcdesk.freecad.fcstd_mapping import compute_rule_label_from_target_fields

    rows = conn.execute(
        """
        SELECT bx.id, bx.target_basename, bx.target_repo_rel_path,
               COALESCE(ta.part_number, '') AS target_part_number,
               COALESCE(ta.part_version, '') AS target_part_version,
               COALESCE(ta.type_code, '') AS target_type_code,
               COALESCE(ta.model_series, '') AS target_model_series,
               COALESCE(ta.part_name, '') AS target_part_name,
               COALESCE(ta.label, '') AS target_asset_label
        FROM bom_xref bx
        LEFT JOIN file_asset ta ON ta.id = bx.target_file_asset_id
        """
    ).fetchall()
    updates: list[tuple[Any, ...]] = []
    for row in rows:
        pn = str(row["target_part_number"] or "")
        pv = str(row["target_part_version"] or "")
        tc = str(row["target_type_code"] or "")
        ms = str(row["target_model_series"] or "")
        pname = str(row["target_part_name"] or "")
        label = str(row["target_asset_label"] or "")
        base = str(row["target_basename"] or "")
        trel = str(row["target_repo_rel_path"] or "")
        rule_label = compute_rule_label_from_target_fields(
            target_asset_label=label,
            target_part_number=pn,
            target_part_version=pv,
            target_part_name=pname,
            target_basename=base,
            target_repo_rel_path=trel,
        )
        updates.append((rule_label, pn, pv, tc, ms, pname, label, int(row["id"])))
    if updates:
        conn.executemany(
            """
            UPDATE bom_xref SET
                rule_label = ?,
                target_part_number = ?,
                target_part_version = ?,
                target_type_code = ?,
                target_model_series = ?,
                target_part_name = ?,
                target_asset_label = ?
            WHERE id = ?
            """,
            updates,
        )


def enrich_bom_xref_edges_target_fields(
    repo_root: Path,
    edges: list[dict[str, Any]],
) -> None:
    """索引写入前：批量从 ``file_asset`` 填充 ``bom_xref`` 冗余子件字段与 ``rule_label``。"""
    from fcdesk.freecad.fcstd_mapping import compute_rule_label_from_target_fields

    rr = repo_root.expanduser().resolve(strict=False)
    if not edges:
        return
    ids = sorted(
        {
            int(edge["target_file_asset_id"])
            for edge in edges
            if edge.get("target_file_asset_id") is not None
        }
    )
    by_id: dict[int, dict[str, str]] = {}
    if ids and cad_database_path(rr).is_file():
        placeholders = ",".join("?" * len(ids))
        with connect(rr) as conn:
            rows = conn.execute(
                f"""
                SELECT id, part_number, part_version, type_code, model_series, part_name, label
                FROM file_asset
                WHERE id IN ({placeholders})
                """,
                ids,
            ).fetchall()
        for row in rows:
            by_id[int(row["id"])] = {
                "target_part_number": str(row["part_number"] or ""),
                "target_part_version": str(row["part_version"] or ""),
                "target_type_code": str(row["type_code"] or ""),
                "target_model_series": str(row["model_series"] or ""),
                "target_part_name": str(row["part_name"] or ""),
                "target_asset_label": str(row["label"] or ""),
            }

    for edge in edges:
        tid = edge.get("target_file_asset_id")
        snap = by_id.get(int(tid)) if tid is not None else None
        edge["target_part_number"] = snap["target_part_number"] if snap else ""
        edge["target_part_version"] = snap["target_part_version"] if snap else ""
        edge["target_type_code"] = snap["target_type_code"] if snap else ""
        edge["target_model_series"] = snap["target_model_series"] if snap else ""
        edge["target_part_name"] = snap["target_part_name"] if snap else ""
        edge["target_asset_label"] = snap["target_asset_label"] if snap else ""
        target_path = edge.get("target_repo_rel_path")
        edge["rule_label"] = compute_rule_label_from_target_fields(
            target_asset_label=edge["target_asset_label"],
            target_part_number=edge["target_part_number"],
            target_part_version=edge["target_part_version"],
            target_part_name=edge["target_part_name"],
            target_basename=str(edge.get("target_basename") or ""),
            target_repo_rel_path=str(target_path or ""),
        )


def _meta_get(conn: sqlite3.Connection, key: str) -> str | None:
    row = conn.execute("SELECT value FROM meta WHERE key = ?", (key,)).fetchone()
    return str(row["value"]) if row else None


def _meta_set(conn: sqlite3.Connection, key: str, value: str) -> None:
    conn.execute(
        "INSERT INTO meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        (key, value),
    )


def sql_one_line(sql: str) -> str:
    """折叠空白为单行，便于终端日志自动换行显示。"""
    return " ".join(sql.split())


def log_query_sql(
    log: logging.Logger,
    *,
    hint: str,
    sql: str,
    params: tuple[Any, ...] = (),
) -> None:
    """统一 SQL 日志：``SQL <调用方> | <单行语句>``。"""
    rendered = _format_debug_sql(sql, params) if params else sql.strip()
    log.info("SQL %s | %s", hint, sql_one_line(rendered))


def _format_debug_sql(sql: str, params: tuple[Any, ...]) -> str:
    """将参数代入 ``?`` 占位符，便于复制到 SQLite 客户端调试。"""
    parts = sql.split("?")
    if len(parts) - 1 != len(params):
        return f"{sql.strip()}\n-- params: {params!r}"
    out: list[str] = []
    for i, p in enumerate(params):
        out.append(parts[i])
        if p is None:
            out.append("NULL")
        elif isinstance(p, (int, float)):
            out.append(str(p))
        else:
            out.append("'" + str(p).replace("'", "''") + "'")
    out.append(parts[-1])
    return "".join(out).strip()


def _row_to_entry(row: sqlite3.Row) -> FcstdMapEntry:
    kind = row["asset_kind"] if "asset_kind" in row.keys() else None
    if not kind:
        kind = cad_asset_kind(str(row["filename"]))
    return FcstdMapEntry(
        repo_rel_path=row["repo_rel_path"],
        filename=row["filename"],
        PartNumber=row["part_number"] or None,
        PartVersion=row["part_version"] or None,
        TypeCode=row["type_code"] or None,
        ModelSeries=row["model_series"] or None,
        PartName=row["part_name"] or None,
        label=row["label"] or None,
        asset_kind=kind,
        file_status=row["file_status"] or FILE_STATUS_PRESENT,
        last_seen_at=row["last_seen_at"] or None,
    )


def _entry_to_row_values(e: FcstdMapEntry, *, updated_at: str) -> tuple[Any, ...]:
    kind = e.asset_kind or cad_asset_kind(e.filename)
    return (
        _norm_key(e.repo_rel_path),
        e.filename,
        kind,
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


def format_part_key(part_number: str, part_version: str) -> str:
    return f"{part_number.strip()}.{part_version.strip()}"


def infer_part_file_role(filename: str) -> str:
    stem = Path(filename).stem.casefold()
    if stem.endswith(".drawing"):
        return "drawing"
    if stem.endswith(".assy"):
        return "assembly"
    return "part"


def _pick_scan_attr(files: list[sqlite3.Row], field: str) -> str | None:
    for prefer_present in (True, False):
        for row in files:
            if prefer_present and row["file_status"] == FILE_STATUS_MISSING:
                continue
            val = row[field]
            if val:
                return str(val).strip()
    return None


def sync_part_keys_from_file_assets(conn: sqlite3.Connection) -> None:
    """按 ``file_asset`` 的零件号+版本重建 ``part_key`` 与 ``part_file_link``。

    批量 UPSERT（``executemany``），避免逐文件 SELECT+UPDATE 的 N+1 查库。
    """
    now = _utc_now_iso()
    rows = conn.execute(
        """
        SELECT id, part_number, part_version, type_code, model_series, part_name, label,
               filename, file_status
        FROM file_asset
        WHERE part_number IS NOT NULL AND TRIM(part_number) != ''
          AND part_version IS NOT NULL AND TRIM(part_version) != ''
        ORDER BY file_status, repo_rel_path
        """
    ).fetchall()

    groups: dict[tuple[str, str], list[sqlite3.Row]] = {}
    for row in rows:
        key = (str(row["part_number"]).strip(), str(row["part_version"]).strip())
        groups.setdefault(key, []).append(row)

    key_upserts: list[tuple[Any, ...]] = []
    for (pn, pv), files in groups.items():
        key_upserts.append(
            (
                pn,
                pv,
                _pick_scan_attr(files, "type_code"),
                _pick_scan_attr(files, "model_series"),
                _pick_scan_attr(files, "part_name"),
                _pick_scan_attr(files, "label"),
                PART_KEY_STATUS_ACTIVE,
                now,
                now,
            )
        )

    if key_upserts:
        conn.executemany(
            """
            INSERT INTO part_key (
                part_number, part_version, type_code, model_series, part_name, label,
                notes, status, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)
            ON CONFLICT(part_number, part_version) DO UPDATE SET
                type_code = excluded.type_code,
                model_series = excluded.model_series,
                part_name = excluded.part_name,
                label = excluded.label,
                updated_at = excluded.updated_at
            """,
            key_upserts,
        )

    pk_map: dict[tuple[str, str], int] = {}
    if groups:
        pk_rows = conn.execute(
            """
            SELECT id, part_number, part_version FROM part_key
            WHERE part_number IS NOT NULL AND TRIM(part_number) != ''
              AND part_version IS NOT NULL AND TRIM(part_version) != ''
            """
        ).fetchall()
        pk_map = {
            (str(r["part_number"]).strip(), str(r["part_version"]).strip()): int(r["id"])
            for r in pk_rows
        }

    touched_key_ids: set[int] = set()
    link_upserts: list[tuple[Any, ...]] = []
    for (pn, pv), files in groups.items():
        pk_id = pk_map.get((pn, pv))
        if pk_id is None:
            continue
        touched_key_ids.add(pk_id)
        for f in files:
            link_upserts.append(
                (
                    pk_id,
                    int(f["id"]),
                    infer_part_file_role(str(f["filename"])),
                    LINK_STATUS_ACTIVE,
                    now,
                )
            )

    if link_upserts:
        conn.executemany(
            """
            INSERT INTO part_file_link (
                part_key_id, file_asset_id, file_role, notes, link_status, linked_at
            ) VALUES (?, ?, ?, NULL, ?, ?)
            ON CONFLICT(file_asset_id) DO UPDATE SET
                part_key_id = excluded.part_key_id,
                file_role = excluded.file_role,
                linked_at = excluded.linked_at
            """,
            link_upserts,
        )

    if touched_key_ids:
        placeholders = ",".join("?" * len(touched_key_ids))
        conn.execute(
            f"DELETE FROM part_key WHERE id NOT IN ({placeholders})",
            tuple(touched_key_ids),
        )
    else:
        conn.execute("DELETE FROM part_key")

    conn.execute(
        """
        DELETE FROM part_file_link
        WHERE file_asset_id NOT IN (
            SELECT id FROM file_asset
            WHERE part_number IS NOT NULL AND TRIM(part_number) != ''
              AND part_version IS NOT NULL AND TRIM(part_version) != ''
        )
        """
    )


def _upsert_file_asset(conn: sqlite3.Connection, e: FcstdMapEntry, *, updated_at: str) -> None:
    key = _norm_key(e.repo_rel_path)
    vals = _entry_to_row_values(e, updated_at=updated_at)
    conn.execute(
        """
        INSERT INTO file_asset (
            repo_rel_path, filename, asset_kind, part_number, part_version, type_code,
            model_series, part_name, label, file_status, last_seen_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(repo_rel_path) DO UPDATE SET
            filename = excluded.filename,
            asset_kind = excluded.asset_kind,
            part_number = excluded.part_number,
            part_version = excluded.part_version,
            type_code = excluded.type_code,
            model_series = excluded.model_series,
            part_name = excluded.part_name,
            label = excluded.label,
            file_status = excluded.file_status,
            last_seen_at = excluded.last_seen_at,
            updated_at = excluded.updated_at
        """,
        vals,
    )


def read_fcstd_map_meta(repo_root: Path) -> dict[str, str | None]:
    """读取 CAD 索引扫描元数据（不加载 ``file_asset`` 行）。"""
    rr = repo_root.expanduser().resolve(strict=False)
    if not cad_database_path(rr).is_file():
        return {
            "last_scan_at": None,
            "scan_root": None,
            "last_scan_stats_json": None,
        }
    with connect(rr) as conn:
        return {
            "last_scan_at": _meta_get(conn, "last_scan_at"),
            "scan_root": _meta_get(conn, "scan_root"),
            "last_scan_stats_json": _meta_get(conn, "last_scan_stats"),
        }


def query_file_asset_entries_paged(
    repo_root: Path,
    *,
    offset: int = 0,
    limit: int = 20,
    status: str | None = None,
    kind: str | None = None,
    search: str | None = None,
) -> tuple[list[dict[str, Any]], int, str]:
    """单次 SQL 分页列出 ``file_asset``（``COUNT(*) OVER()`` 同查总数）。"""
    rr = repo_root.expanduser().resolve(strict=False)
    if not cad_database_path(rr).is_file():
        return [], 0, ""
    cap = max(1, min(int(limit), 500))
    off = max(0, int(offset))
    where_parts: list[str] = []
    params: list[Any] = []

    st = (status or "").strip().lower()
    if st in (FILE_STATUS_PRESENT, FILE_STATUS_MISSING):
        where_parts.append("file_status = ?")
        params.append(st)

    k = (kind or "").strip().lower()
    if k and k != "all":
        where_parts.append("COALESCE(NULLIF(asset_kind, ''), 'fcstd') = ?")
        params.append(k)

    tokens = [t for t in (search or "").strip().lower().split() if t]
    search_cols = (
        "filename",
        "repo_rel_path",
        "part_number",
        "part_version",
        "type_code",
        "model_series",
        "part_name",
        "label",
        "COALESCE(NULLIF(asset_kind, ''), 'fcstd')",
    )
    for token in tokens:
        like = f"%{token}%"
        col_clauses = " OR ".join(f"{col} LIKE ? COLLATE NOCASE" for col in search_cols)
        where_parts.append(f"({col_clauses})")
        params.extend([like] * len(search_cols))

    where_sql = f"WHERE {' AND '.join(where_parts)}" if where_parts else ""
    sql = f"""
        SELECT
            repo_rel_path,
            filename,
            asset_kind,
            part_number,
            part_version,
            type_code,
            model_series,
            part_name,
            label,
            file_status,
            last_seen_at,
            COUNT(*) OVER() AS _total_count
        FROM file_asset
        {where_sql}
        ORDER BY repo_rel_path, file_status
        LIMIT ? OFFSET ?
    """
    query_params = tuple([*params, cap, off])
    debug_sql = _format_debug_sql(sql, query_params)

    with connect(rr) as conn:
        rows = conn.execute(sql, query_params).fetchall()

    if not rows:
        return [], 0, debug_sql

    total = int(rows[0]["_total_count"])
    out: list[dict[str, Any]] = []
    for r in rows:
        entry = _row_to_entry(r)
        out.append(
            {
                "repo_rel_path": entry.repo_rel_path,
                "filename": entry.filename,
                "asset_kind": entry.asset_kind or cad_asset_kind(entry.filename),
                "PartNumber": entry.PartNumber or "",
                "PartVersion": entry.PartVersion or "",
                "TypeCode": entry.TypeCode or "",
                "ModelSeries": entry.ModelSeries or "",
                "PartName": entry.PartName or "",
                "label": entry.label or "",
                "file_status": entry.file_status or FILE_STATUS_PRESENT,
                "last_seen_at": entry.last_seen_at or "",
            }
        )
    return out, total, debug_sql


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
) -> int:
    """写入索引并记录扫描历史，返回 ``fcstd_scan.id``。"""
    rr = repo_root.expanduser().resolve(strict=False)
    now = doc.last_scan_at or _utc_now_iso()
    stats_json = json.dumps(dict(stats), ensure_ascii=False)
    scan_id = 0

    with connect(rr) as conn:
        seen: set[str] = set()
        for e in doc.entries:
            key = _norm_key(e.repo_rel_path)
            seen.add(key)
            _upsert_file_asset(conn, e, updated_at=now)

        if seen:
            placeholders = ",".join("?" * len(seen))
            conn.execute(
                f"DELETE FROM file_asset WHERE repo_rel_path NOT IN ({placeholders})",
                tuple(sorted(seen)),
            )
        else:
            conn.execute("DELETE FROM file_asset")

        sync_part_keys_from_file_assets(conn)
        _meta_set(conn, "last_scan_at", now)
        _meta_set(conn, "scan_root", scan_root)
        _meta_set(conn, "last_scan_stats", stats_json)
        cur = conn.execute(
            "INSERT INTO fcstd_scan(scanned_at, scan_root, stats_json) VALUES (?, ?, ?)",
            (now, scan_root, stats_json),
        )
        scan_id = int(cur.lastrowid)

    return scan_id


def delete_missing_file_assets(repo_root: Path) -> int:
    """从 ``file_asset`` 永久删除 ``file_status=missing`` 行，并同步 ``part_key`` / ``part_file_link``。"""
    rr = repo_root.expanduser().resolve(strict=False)
    if not cad_database_path(rr).is_file():
        return 0
    with connect(rr) as conn:
        row = conn.execute(
            "SELECT COUNT(*) AS c FROM file_asset WHERE file_status = ?",
            (FILE_STATUS_MISSING,),
        ).fetchone()
        n = int(row["c"]) if row else 0
        if n == 0:
            return 0
        conn.execute(
            "DELETE FROM file_asset WHERE file_status = ?",
            (FILE_STATUS_MISSING,),
        )
        sync_part_keys_from_file_assets(conn)
    return n


def update_scan_stats_meta(repo_root: Path, stats: Mapping[str, int]) -> None:
    """更新 ``cad_meta.last_scan_stats``（列表页顶栏统计）。"""
    rr = repo_root.expanduser().resolve(strict=False)
    with connect(rr) as conn:
        _meta_set(conn, "last_scan_stats", json.dumps(dict(stats), ensure_ascii=False))


def find_file_asset_entry(
    repo_root: Path,
    rel_workspace: Path,
) -> tuple[FcstdMapEntry | None, str]:
    """按 ``repo_rel_path`` 单次查询 ``file_asset``。"""
    rr = repo_root.expanduser().resolve(strict=False)
    if not cad_database_path(rr).is_file():
        migrate_fcstd_map_json(repo_root)
    if not cad_database_path(rr).is_file():
        return None, ""
    want = _norm_key(rel_workspace.as_posix())
    sql = """
        SELECT repo_rel_path, filename, asset_kind, part_number, part_version,
               type_code, model_series, part_name, label, file_status, last_seen_at
        FROM file_asset
        WHERE repo_rel_path = ?
    """
    params = (want,)
    debug_sql = _format_debug_sql(sql, params)
    with connect(rr) as conn:
        row = conn.execute(sql, params).fetchone()
    if row is None:
        return None, debug_sql
    return _row_to_entry(row), debug_sql


def find_fcstd_entry(repo_root: Path, rel_workspace: Path) -> FcstdMapEntry | None:
    entry, _ = find_file_asset_entry(repo_root, rel_workspace)
    return entry


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
    fcstd_entries = [e for e in doc.entries if is_fcstd_filename(e.filename)]
    export_doc = FcstdMapDocument(
        entries=fcstd_entries,
        schema_version=doc.schema_version,
        mapping_kind=doc.mapping_kind,
        anchor_note=doc.anchor_note,
        last_scan_at=doc.last_scan_at,
        scan_root=doc.scan_root,
        scan_stats=doc.scan_stats,
    )
    out.write_text(
        json.dumps(export_doc.to_json_dict(), ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return out


def _part_key_row_to_dict(row: sqlite3.Row, *, file_count: int = 0, present_count: int = 0, missing_count: int = 0) -> dict[str, Any]:
    pn = str(row["part_number"])
    pv = str(row["part_version"])
    return {
        "id": int(row["id"]),
        "part_number": pn,
        "part_version": pv,
        "part_key": format_part_key(pn, pv),
        "TypeCode": row["type_code"] or "",
        "ModelSeries": row["model_series"] or "",
        "PartName": row["part_name"] or "",
        "label": row["label"] or "",
        "notes": row["notes"] or "",
        "status": row["status"] or PART_KEY_STATUS_ACTIVE,
        "file_count": file_count,
        "present_count": present_count,
        "missing_count": missing_count,
        "primary_repo_rel": str(row["primary_repo_rel"] or "").strip()
        if "primary_repo_rel" in row.keys()
        else "",
        "created_at": row["created_at"] or "",
        "updated_at": row["updated_at"] or "",
    }


def list_part_keys(repo_root: Path) -> list[dict[str, Any]]:
    rr = repo_root.expanduser().resolve(strict=False)
    migrate_fcstd_map_json(rr)
    if not cad_database_path(rr).is_file():
        return []

    with connect(rr) as conn:
        rows = conn.execute(
            """
            SELECT pk.*,
                   COUNT(pfl.id) AS file_count,
                   SUM(CASE WHEN fa.file_status = ? THEN 1 ELSE 0 END) AS present_count,
                   SUM(CASE WHEN fa.file_status = ? THEN 1 ELSE 0 END) AS missing_count,
                   (
                     SELECT fa2.repo_rel_path
                     FROM part_file_link pfl2
                     JOIN file_asset fa2 ON fa2.id = pfl2.file_asset_id
                     WHERE pfl2.part_key_id = pk.id
                       AND fa2.file_status = ?
                     ORDER BY fa2.repo_rel_path
                     LIMIT 1
                   ) AS primary_repo_rel
            FROM part_key pk
            LEFT JOIN part_file_link pfl ON pfl.part_key_id = pk.id
            LEFT JOIN file_asset fa ON fa.id = pfl.file_asset_id
            GROUP BY pk.id
            ORDER BY pk.part_number, pk.part_version
            """,
            (FILE_STATUS_PRESENT, FILE_STATUS_MISSING, FILE_STATUS_PRESENT),
        ).fetchall()

    out: list[dict[str, Any]] = []
    for row in rows:
        out.append(
            _part_key_row_to_dict(
                row,
                file_count=int(row["file_count"] or 0),
                present_count=int(row["present_count"] or 0),
                missing_count=int(row["missing_count"] or 0),
            )
        )
    return out


def get_part_key_detail(repo_root: Path, part_number: str, part_version: str) -> dict[str, Any] | None:
    rr = repo_root.expanduser().resolve(strict=False)
    migrate_fcstd_map_json(rr)
    if not cad_database_path(rr).is_file():
        return None

    pn = part_number.strip()
    pv = part_version.strip()
    with connect(rr) as conn:
        pk = conn.execute(
            "SELECT * FROM part_key WHERE part_number = ? AND part_version = ?",
            (pn, pv),
        ).fetchone()
        if pk is None:
            return None

        files = conn.execute(
            """
            SELECT fa.*, pfl.file_role, pfl.notes AS link_notes, pfl.link_status, pfl.linked_at
            FROM part_file_link pfl
            JOIN file_asset fa ON fa.id = pfl.file_asset_id
            WHERE pfl.part_key_id = ?
            ORDER BY fa.file_status, fa.repo_rel_path
            """,
            (int(pk["id"]),),
        ).fetchall()

    detail = _part_key_row_to_dict(
        pk,
        file_count=len(files),
        present_count=sum(1 for f in files if f["file_status"] != FILE_STATUS_MISSING),
        missing_count=sum(1 for f in files if f["file_status"] == FILE_STATUS_MISSING),
    )
    detail["files"] = [
        {
            "id": int(f["id"]),
            "repo_rel_path": f["repo_rel_path"],
            "filename": f["filename"],
            "PartNumber": f["part_number"] or "",
            "PartVersion": f["part_version"] or "",
            "TypeCode": f["type_code"] or "",
            "ModelSeries": f["model_series"] or "",
            "PartName": f["part_name"] or "",
            "label": f["label"] or "",
            "asset_kind": f["asset_kind"] or cad_asset_kind(str(f["filename"])),
            "file_status": f["file_status"] or FILE_STATUS_PRESENT,
            "file_role": f["file_role"] or "part",
            "link_notes": f["link_notes"] or "",
            "link_status": f["link_status"] or LINK_STATUS_ACTIVE,
            "linked_at": f["linked_at"] or "",
            "last_seen_at": f["last_seen_at"] or "",
            "updated_at": f["updated_at"] or "",
        }
        for f in files
    ]
    return detail


def update_part_key_record(
    repo_root: Path,
    part_number: str,
    part_version: str,
    *,
    type_code: str | None = None,
    model_series: str | None = None,
    part_name: str | None = None,
    label: str | None = None,
    notes: str | None = None,
    status: str | None = None,
) -> dict[str, Any] | None:
    rr = repo_root.expanduser().resolve(strict=False)
    pn = part_number.strip()
    pv = part_version.strip()
    now = _utc_now_iso()

    with connect(rr) as conn:
        row = conn.execute(
            "SELECT id FROM part_key WHERE part_number = ? AND part_version = ?",
            (pn, pv),
        ).fetchone()
        if row is None:
            return None

        fields: dict[str, Any] = {"updated_at": now}
        if type_code is not None:
            fields["type_code"] = type_code.strip() or None
        if model_series is not None:
            fields["model_series"] = model_series.strip() or None
        if part_name is not None:
            fields["part_name"] = part_name.strip() or None
        if label is not None:
            fields["label"] = label.strip() or None
        if notes is not None:
            fields["notes"] = notes.strip() or None
        if status is not None:
            st = status.strip() or PART_KEY_STATUS_ACTIVE
            fields["status"] = st

        sets = ", ".join(f"{k} = ?" for k in fields)
        conn.execute(
            f"UPDATE part_key SET {sets} WHERE part_number = ? AND part_version = ?",
            (*fields.values(), pn, pv),
        )

    return get_part_key_detail(rr, pn, pv)


def update_part_file_link_record(
    repo_root: Path,
    part_number: str,
    part_version: str,
    file_asset_id: int,
    *,
    file_role: str | None = None,
    link_notes: str | None = None,
    link_status: str | None = None,
) -> dict[str, Any] | None:
    rr = repo_root.expanduser().resolve(strict=False)
    pn = part_number.strip()
    pv = part_version.strip()

    with connect(rr) as conn:
        pk = conn.execute(
            "SELECT id FROM part_key WHERE part_number = ? AND part_version = ?",
            (pn, pv),
        ).fetchone()
        if pk is None:
            return None
        link = conn.execute(
            """
            SELECT id FROM part_file_link
            WHERE part_key_id = ? AND file_asset_id = ?
            """,
            (int(pk["id"]), file_asset_id),
        ).fetchone()
        if link is None:
            return None

        fields: dict[str, Any] = {}
        if file_role is not None:
            fields["file_role"] = file_role.strip() or "part"
        if link_notes is not None:
            fields["notes"] = link_notes.strip() or None
        if link_status is not None:
            fields["link_status"] = link_status.strip() or LINK_STATUS_ACTIVE
        if not fields:
            return get_part_key_detail(rr, pn, pv)

        sets = ", ".join(f"{k} = ?" for k in fields)
        conn.execute(
            f"UPDATE part_file_link SET {sets} WHERE id = ?",
            (*fields.values(), int(link["id"])),
        )

    return get_part_key_detail(rr, pn, pv)


def insert_rename_log(
    repo_root: Path,
    *,
    old_rel: Path,
    new_rel: Path,
    source: str = "web",
) -> dict[str, Any]:
    """记录一次磁盘改名事件，返回 ``rename_log`` 行摘要。"""
    rr = repo_root.expanduser().resolve(strict=False)
    old_rr = _norm_key(old_rel.as_posix())
    new_rr = _norm_key(new_rel.as_posix())
    now = _utc_now_iso()

    with connect(rr) as conn:
        asset = conn.execute(
            "SELECT id FROM file_asset WHERE repo_rel_path = ?",
            (new_rr,),
        ).fetchone()
        file_asset_id = int(asset["id"]) if asset else None

        cur = conn.execute(
            """
            INSERT INTO change_event(kind, created_at, actor, source, note, stats_json)
            VALUES ('rename', ?, NULL, ?, NULL, NULL)
            """,
            (now, source),
        )
        event_id = int(cur.lastrowid)
        cur = conn.execute(
            """
            INSERT INTO rename_log (
                event_id, file_asset_id, old_repo_rel_path, new_repo_rel_path,
                old_filename, new_filename, old_basename, new_basename
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                event_id,
                file_asset_id,
                old_rr,
                new_rr,
                old_rel.name,
                new_rel.name,
                old_rel.name,
                new_rel.name,
            ),
        )
        rename_log_id = int(cur.lastrowid)

    return get_rename_log(rr, rename_log_id) or {}


def get_rename_log(repo_root: Path, rename_log_id: int) -> dict[str, Any] | None:
    rr = repo_root.expanduser().resolve(strict=False)
    with connect(rr) as conn:
        row = conn.execute(
            """
            SELECT rl.*, ce.created_at AS event_created_at, ce.source AS event_source
            FROM rename_log rl
            JOIN change_event ce ON ce.id = rl.event_id
            WHERE rl.id = ?
            """,
            (rename_log_id,),
        ).fetchone()
        if row is None:
            return None
        return _rename_log_row_to_dict(row)


def _rename_log_row_to_dict(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": int(row["id"]),
        "event_id": int(row["event_id"]),
        "file_asset_id": int(row["file_asset_id"]) if row["file_asset_id"] else None,
        "old_repo_rel_path": row["old_repo_rel_path"],
        "new_repo_rel_path": row["new_repo_rel_path"],
        "old_filename": row["old_filename"],
        "new_filename": row["new_filename"],
        "old_basename": row["old_basename"],
        "new_basename": row["new_basename"],
        "created_at": row["event_created_at"],
        "source": row["event_source"],
    }


def replace_ref_hits_for_rename_scan(
    repo_root: Path,
    *,
    rename_log_id: int,
    hits: list[Mapping[str, Any]],
) -> dict[str, Any]:
    """写入引用扫描结果（替换同 ``rename_log_id`` 下全部命中快照）。"""
    rr = repo_root.expanduser().resolve(strict=False)
    now = _utc_now_iso()
    with connect(rr) as conn:
        conn.execute("DELETE FROM ref_hit WHERE rename_log_id = ?", (rename_log_id,))
        cur = conn.execute(
            """
            INSERT INTO change_event(kind, created_at, actor, source, note, stats_json)
            VALUES ('ref_scan', ?, NULL, 'web', NULL, ?)
            """,
            (now, json.dumps({"hit_count": len(hits)}, ensure_ascii=False)),
        )
        event_id = int(cur.lastrowid)
        for h in hits:
            matched = str(h["matched_text"])
            proposed = str(h["proposed_text"])
            raw_status = str(h.get("status") or "").strip().lower()
            if raw_status in ("ok", "applied", "pending"):
                status = raw_status
            elif proposed != matched:
                status = "pending"
            else:
                status = "ok"
            conn.execute(
                """
                INSERT INTO ref_hit (
                    event_id, rename_log_id, host_repo_rel_path, host_asset_kind,
                    ref_kind, locator, matched_text, proposed_text, status, detail_json
                ) VALUES (?, ?, ?, 'fcstd', 'xlink_file_attr', 'Document.xml', ?, ?, ?, NULL)
                """,
                (
                    event_id,
                    rename_log_id,
                    h["host_repo_rel_path"],
                    matched,
                    proposed,
                    status,
                ),
            )
    return load_ref_hits_for_rename(rr, rename_log_id)


def load_ref_hits_for_rename(repo_root: Path, rename_log_id: int) -> dict[str, Any]:
    rr = repo_root.expanduser().resolve(strict=False)
    with connect(rr) as conn:
        rows = conn.execute(
            """
            SELECT id, host_repo_rel_path, matched_text, proposed_text, status
            FROM ref_hit
            WHERE rename_log_id = ?
            ORDER BY host_repo_rel_path, id
            """,
            (rename_log_id,),
        ).fetchall()
    hosts: dict[str, dict[str, Any]] = {}
    for row in rows:
        host = row["host_repo_rel_path"]
        bucket = hosts.setdefault(
            host,
            {
                "host_repo_rel_path": host,
                "host_filename": Path(host).name,
                "hits": [],
                "hit_count": 0,
            },
        )
        bucket["hits"].append(
            {
                "id": int(row["id"]),
                "matched_text": row["matched_text"],
                "proposed_text": row["proposed_text"],
                "status": row["status"],
            }
        )
        bucket["hit_count"] = len(bucket["hits"])
    host_list = sorted(hosts.values(), key=lambda x: x["host_repo_rel_path"])
    pending_hit_count = sum(
        1
        for h in host_list
        for hit in h["hits"]
        if hit["proposed_text"] != hit["matched_text"] and hit["status"] != "applied"
    )
    return {
        "rename_log_id": rename_log_id,
        "host_count": len(host_list),
        "hit_count": sum(h["hit_count"] for h in host_list),
        "pending_hit_count": pending_hit_count,
        "hosts": host_list,
    }


def mark_ref_hits_applied(
    repo_root: Path,
    *,
    rename_log_id: int,
    host_repo_rel_paths: list[str],
) -> None:
    rr = repo_root.expanduser().resolve(strict=False)
    if not host_repo_rel_paths:
        return
    keys = [_norm_key(p) for p in host_repo_rel_paths]
    placeholders = ",".join("?" * len(keys))
    with connect(rr) as conn:
        conn.execute(
            f"""
            UPDATE ref_hit
            SET status = 'applied'
            WHERE rename_log_id = ? AND host_repo_rel_path IN ({placeholders})
            """,
            (rename_log_id, *keys),
        )


def insert_ref_patch_event(repo_root: Path, *, stats: Mapping[str, Any]) -> int:
    rr = repo_root.expanduser().resolve(strict=False)
    now = _utc_now_iso()
    with connect(rr) as conn:
        cur = conn.execute(
            """
            INSERT INTO change_event(kind, created_at, actor, source, note, stats_json)
            VALUES ('ref_patch', ?, NULL, 'web', NULL, ?)
            """,
            (now, json.dumps(dict(stats), ensure_ascii=False)),
        )
        return int(cur.lastrowid)


def phoenix_reports_dir(repo_root: Path) -> Path:
    d = phoenix_dir(repo_root) / "reports"
    d.mkdir(parents=True, exist_ok=True)
    return d


def list_rename_logs(repo_root: Path, *, limit: int = 50) -> list[dict[str, Any]]:
    """最近改名记录（新 → 旧）。"""
    rr = repo_root.expanduser().resolve(strict=False)
    if not cad_database_path(rr).is_file():
        return []
    cap = max(1, min(int(limit), 200))
    with connect(rr) as conn:
        rows = conn.execute(
            """
            SELECT rl.*, ce.created_at AS event_created_at, ce.source AS event_source
            FROM rename_log rl
            JOIN change_event ce ON ce.id = rl.event_id
            ORDER BY ce.created_at DESC, rl.id DESC
            LIMIT ?
            """,
            (cap,),
        ).fetchall()
    return [_rename_log_row_to_dict(r) for r in rows]


UI_SESSION_SCOPE_WORKBENCH = "workbench"


def load_ui_session(repo_root: Path, *, scope: str = UI_SESSION_SCOPE_WORKBENCH) -> dict[str, Any] | None:
    """读取 Web 壳层 UI 会话（Tab 列表与页内快照 JSON）。"""
    rr = repo_root.expanduser().resolve(strict=False)
    if not cad_database_path(rr).is_file():
        return None
    with connect(rr) as conn:
        row = conn.execute(
            "SELECT payload_json FROM ui_session WHERE scope = ?",
            (scope,),
        ).fetchone()
    if row is None:
        return None
    try:
        data = json.loads(str(row["payload_json"]))
    except json.JSONDecodeError:
        return None
    return data if isinstance(data, dict) else None


def save_ui_session(
    repo_root: Path,
    payload: Mapping[str, Any],
    *,
    scope: str = UI_SESSION_SCOPE_WORKBENCH,
) -> str:
    """写入 UI 会话 JSON，返回 ``updated_at``（UTC ISO）。"""
    rr = repo_root.expanduser().resolve(strict=False)
    updated_at = _utc_now_iso()
    blob = json.dumps(dict(payload), ensure_ascii=False, separators=(",", ":"))
    with connect(rr) as conn:
        conn.execute(
            """
            INSERT INTO ui_session(scope, payload_json, updated_at)
            VALUES (?, ?, ?)
            ON CONFLICT(scope) DO UPDATE SET
                payload_json = excluded.payload_json,
                updated_at = excluded.updated_at
            """,
            (scope, blob, updated_at),
        )
    return updated_at


def ui_session_updated_at(repo_root: Path, *, scope: str = UI_SESSION_SCOPE_WORKBENCH) -> str | None:
    rr = repo_root.expanduser().resolve(strict=False)
    if not cad_database_path(rr).is_file():
        return None
    with connect(rr) as conn:
        row = conn.execute(
            "SELECT updated_at FROM ui_session WHERE scope = ?",
            (scope,),
        ).fetchone()
    return str(row["updated_at"]) if row else None


def get_last_fcstd_scan_id(repo_root: Path) -> int | None:
    rr = repo_root.expanduser().resolve(strict=False)
    if not cad_database_path(rr).is_file():
        return None
    with connect(rr) as conn:
        row = conn.execute(
            "SELECT id FROM fcstd_scan ORDER BY id DESC LIMIT 1"
        ).fetchone()
    return int(row["id"]) if row else None


def ensure_fcstd_scan_record(repo_root: Path) -> int | None:
    """若已有 ``file_asset`` 但缺少 ``fcstd_scan`` 行，补一条扫描记录供 BOM 引用重建。"""
    rr = repo_root.expanduser().resolve(strict=False)
    if not cad_database_path(rr).is_file():
        return None
    existing = get_last_fcstd_scan_id(rr)
    if existing is not None:
        return existing
    with connect(rr) as conn:
        row = conn.execute("SELECT COUNT(*) AS c FROM file_asset").fetchone()
        if not row or int(row["c"]) <= 0:
            return None
        now = _meta_get(conn, "last_scan_at") or _utc_now_iso()
        scan_root = _meta_get(conn, "scan_root") or "."
        stats_raw = _meta_get(conn, "last_scan_stats") or "{}"
        cur = conn.execute(
            "INSERT INTO fcstd_scan(scanned_at, scan_root, stats_json) VALUES (?, ?, ?)",
            (now, scan_root, stats_raw),
        )
        return int(cur.lastrowid)


def get_file_asset_id(repo_root: Path, repo_rel_path: str) -> int | None:
    rr = repo_root.expanduser().resolve(strict=False)
    key = _norm_key(repo_rel_path)
    with connect(rr) as conn:
        row = conn.execute(
            "SELECT id FROM file_asset WHERE repo_rel_path = ?",
            (key,),
        ).fetchone()
    return int(row["id"]) if row else None


def get_file_asset_bom_fields(repo_root: Path, repo_rel_path: str) -> dict[str, str] | None:
    """从 CAD 索引 ``file_asset`` 读取 BOM 字段（规则 Label 优先来源）。"""
    rr = repo_root.expanduser().resolve(strict=False)
    if not cad_database_path(rr).is_file():
        return None
    key = _norm_key(repo_rel_path)
    with connect(rr) as conn:
        row = conn.execute(
            """
            SELECT part_number, part_version, part_name, label
            FROM file_asset
            WHERE repo_rel_path = ?
            """,
            (key,),
        ).fetchone()
    if row is None:
        return None
    return {
        "part_number": str(row["part_number"] or ""),
        "part_version": str(row["part_version"] or ""),
        "part_name": str(row["part_name"] or ""),
        "label": str(row["label"] or ""),
    }


def list_present_fcstd_file_assets(repo_root: Path) -> list[dict[str, Any]]:
    rr = repo_root.expanduser().resolve(strict=False)
    if not cad_database_path(rr).is_file():
        return []
    with connect(rr) as conn:
        rows = conn.execute(
            """
            SELECT id, repo_rel_path, filename
            FROM file_asset
            WHERE file_status = ? AND LOWER(filename) LIKE '%.fcstd'
            ORDER BY repo_rel_path
            """,
            (FILE_STATUS_PRESENT,),
        ).fetchall()
    return [
        {
            "id": int(r["id"]),
            "repo_rel_path": str(r["repo_rel_path"]),
            "filename": str(r["filename"]),
        }
        for r in rows
    ]


def _dedupe_bom_xref_edges(edges: list[Mapping[str, Any]]) -> list[dict[str, Any]]:
    """同一宿主 + 同一 XLink file 属性只保留一条（避免 UNIQUE 冲突）。"""
    seen: set[tuple[int, str]] = set()
    out: list[dict[str, Any]] = []
    for edge in edges:
        host_id = int(edge["host_file_asset_id"])
        xlink = str(edge["xlink_file_attr"])
        key = (host_id, xlink)
        if key in seen:
            continue
        seen.add(key)
        out.append(dict(edge))
    return out


_BOM_XREF_UPSERT_SQL = """
    INSERT INTO bom_xref (
        scan_id, host_file_asset_id, host_repo_rel_path, ref_kind, locator,
        xlink_file_attr, link_label, rule_label,
        target_basename, target_file_asset_id, target_repo_rel_path,
        target_part_number, target_part_version, target_type_code,
        target_model_series, target_part_name, target_asset_label,
        resolve_status, detail_json, last_seen_at
    ) VALUES (
        ?, ?, ?, 'xlink_file_attr', 'Document.xml', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
    )
    ON CONFLICT(host_file_asset_id, xlink_file_attr) DO UPDATE SET
        scan_id = excluded.scan_id,
        host_repo_rel_path = excluded.host_repo_rel_path,
        link_label = excluded.link_label,
        rule_label = excluded.rule_label,
        target_basename = excluded.target_basename,
        target_file_asset_id = excluded.target_file_asset_id,
        target_repo_rel_path = excluded.target_repo_rel_path,
        target_part_number = excluded.target_part_number,
        target_part_version = excluded.target_part_version,
        target_type_code = excluded.target_type_code,
        target_model_series = excluded.target_model_series,
        target_part_name = excluded.target_part_name,
        target_asset_label = excluded.target_asset_label,
        resolve_status = excluded.resolve_status,
        detail_json = excluded.detail_json,
        last_seen_at = excluded.last_seen_at
"""


def _bom_xref_edge_upsert_params(
    edge: Mapping[str, Any],
    *,
    scan_id: int,
    now: str,
) -> tuple[Any, ...]:
    host_id = int(edge["host_file_asset_id"])
    host_path = _norm_key(str(edge["host_repo_rel_path"]))
    xlink = str(edge["xlink_file_attr"])
    target_base = str(edge["target_basename"])
    target_id = edge.get("target_file_asset_id")
    target_path = edge.get("target_repo_rel_path")
    if target_path:
        target_path = _norm_key(str(target_path))
    status = str(edge.get("resolve_status") or "missing")
    detail = edge.get("detail_json")
    if detail is not None and not isinstance(detail, str):
        detail = json.dumps(detail, ensure_ascii=False)
    return (
        scan_id,
        host_id,
        host_path,
        xlink,
        str(edge.get("link_label") or ""),
        str(edge.get("rule_label") or ""),
        target_base,
        int(target_id) if target_id is not None else None,
        target_path,
        str(edge.get("target_part_number") or ""),
        str(edge.get("target_part_version") or ""),
        str(edge.get("target_type_code") or ""),
        str(edge.get("target_model_series") or ""),
        str(edge.get("target_part_name") or ""),
        str(edge.get("target_asset_label") or ""),
        status,
        detail,
        now,
    )


def replace_bom_xrefs(
    repo_root: Path,
    *,
    scan_id: int,
    edges: list[Mapping[str, Any]],
    rebuilt_at: str | None = None,
) -> dict[str, int]:
    rr = repo_root.expanduser().resolve(strict=False)
    now = rebuilt_at or _utc_now_iso()
    stats = {"edge_count": 0, "host_count": 0, "target_resolved": 0, "target_ambiguous": 0, "target_missing": 0}
    hosts: set[str] = set()
    edges = _dedupe_bom_xref_edges(edges)
    enrich_bom_xref_edges_target_fields(rr, edges)

    with connect(rr) as conn:
        conn.execute("DELETE FROM bom_xref")
        conn.execute("DELETE FROM bom_assembly_cache")
        conn.execute("DELETE FROM bom_tree_occurrence")
        for edge in edges:
            host_path = _norm_key(str(edge["host_repo_rel_path"]))
            status = str(edge.get("resolve_status") or "missing")

            conn.execute(
                _BOM_XREF_UPSERT_SQL,
                _bom_xref_edge_upsert_params(edge, scan_id=scan_id, now=now),
            )
            stats["edge_count"] += 1
            hosts.add(host_path)
            if status == "resolved":
                stats["target_resolved"] += 1
            elif status == "ambiguous":
                stats["target_ambiguous"] += 1
            elif status in ("missing", "non_fcstd"):
                stats["target_missing"] += 1

        stats["host_count"] = len(hosts)
        _meta_set(conn, "last_bom_xref_at", now)
        _meta_set(conn, "last_bom_xref_scan_id", str(scan_id))
        _meta_set(conn, "last_bom_xref_stats", json.dumps(stats, ensure_ascii=False))

    return stats


def delete_bom_xrefs_for_hosts(repo_root: Path, host_repo_rel_paths: list[str]) -> int:
    """删除指定宿主在 ``bom_xref`` 中的引用边（写回 XLink 后局部刷新用）。"""
    rr = repo_root.expanduser().resolve(strict=False)
    keys = [_norm_key(p) for p in host_repo_rel_paths if str(p).strip()]
    if not keys:
        return 0
    deleted = 0
    with connect(rr) as conn:
        conn.execute("DELETE FROM bom_assembly_cache")
        conn.execute("DELETE FROM bom_tree_occurrence")
        for key in keys:
            cur = conn.execute("DELETE FROM bom_xref WHERE host_repo_rel_path = ?", (key,))
            deleted += int(cur.rowcount)
            asset_id = get_file_asset_id(rr, key)
            if asset_id is not None:
                cur2 = conn.execute(
                    "DELETE FROM bom_xref WHERE host_file_asset_id = ?",
                    (asset_id,),
                )
                deleted += int(cur2.rowcount)
    return deleted


def insert_bom_xref_edges(
    repo_root: Path,
    *,
    scan_id: int,
    edges: list[Mapping[str, Any]],
    rebuilt_at: str | None = None,
) -> dict[str, int]:
    """向 ``bom_xref`` 追加边（不整表清空；配合 ``delete_bom_xrefs_for_hosts`` 使用）。"""
    rr = repo_root.expanduser().resolve(strict=False)
    now = rebuilt_at or _utc_now_iso()
    stats = {"edge_count": 0, "target_resolved": 0, "target_ambiguous": 0, "target_missing": 0}
    edges = _dedupe_bom_xref_edges(edges)
    if not edges:
        return stats

    enrich_bom_xref_edges_target_fields(rr, edges)

    with connect(rr) as conn:
        for edge in edges:
            status = str(edge.get("resolve_status") or "missing")

            conn.execute(
                _BOM_XREF_UPSERT_SQL,
                _bom_xref_edge_upsert_params(edge, scan_id=scan_id, now=now),
            )
            stats["edge_count"] += 1
            if status == "resolved":
                stats["target_resolved"] += 1
            elif status == "ambiguous":
                stats["target_ambiguous"] += 1
            elif status in ("missing", "non_fcstd"):
                stats["target_missing"] += 1

        _meta_set(conn, "last_bom_xref_at", now)
        _meta_set(conn, "last_bom_xref_scan_id", str(scan_id))

    return stats


def load_bom_xref_meta(repo_root: Path) -> dict[str, Any]:
    rr = repo_root.expanduser().resolve(strict=False)
    if not cad_database_path(rr).is_file():
        return {"edge_count": 0, "host_count": 0, "last_bom_xref_at": ""}
    with connect(rr) as conn:
        count = conn.execute("SELECT COUNT(*) AS n FROM bom_xref").fetchone()
        hosts = conn.execute(
            "SELECT COUNT(DISTINCT host_repo_rel_path) AS n FROM bom_xref"
        ).fetchone()
        last_at = _meta_get(conn, "last_bom_xref_at")
        raw_stats = _meta_get(conn, "last_bom_xref_stats")
    extra: dict[str, Any] = {}
    if raw_stats:
        try:
            parsed = json.loads(raw_stats)
            if isinstance(parsed, dict):
                extra = parsed
        except json.JSONDecodeError:
            pass
    return {
        "edge_count": int(count["n"]) if count else 0,
        "host_count": int(hosts["n"]) if hosts else 0,
        "last_bom_xref_at": last_at or "",
        **extra,
    }


def _bom_xref_row_to_dict(row: sqlite3.Row) -> dict[str, Any]:
    detail: Any = None
    raw = row["detail_json"]
    if raw:
        try:
            detail = json.loads(str(raw))
        except json.JSONDecodeError:
            detail = raw
    out: dict[str, Any] = {
        "id": int(row["id"]),
        "host_repo_rel_path": str(row["host_repo_rel_path"]),
        "host_file_asset_id": int(row["host_file_asset_id"]),
        "xlink_file_attr": str(row["xlink_file_attr"]),
        "target_basename": str(row["target_basename"]),
        "target_repo_rel_path": row["target_repo_rel_path"],
        "target_file_asset_id": row["target_file_asset_id"],
        "resolve_status": str(row["resolve_status"]),
        "ref_kind": str(row["ref_kind"]),
        "detail": detail,
    }
    keys = row.keys()
    if "link_label" in keys:
        out["link_label"] = str(row["link_label"] or "")
    if "rule_label" in keys:
        out["rule_label"] = str(row["rule_label"] or "")
    if "target_part_number" in keys:
        out["target_part_number"] = str(row["target_part_number"] or "")
        out["target_part_version"] = str(row["target_part_version"] or "")
        out["target_type_code"] = str(row["target_type_code"] or "")
        out["target_model_series"] = str(row["target_model_series"] or "")
        out["target_part_name"] = str(row["target_part_name"] or "")
        out["target_asset_label"] = str(row["target_asset_label"] or "")
    return out


def clear_bom_assembly_cache(repo_root: Path) -> None:
    rr = repo_root.expanduser().resolve(strict=False)
    if not cad_database_path(rr).is_file():
        return
    with connect(rr) as conn:
        conn.execute("DELETE FROM bom_assembly_cache")


def load_bom_assembly_cache(
    repo_root: Path,
    host_repo_rel: str,
    mode: str,
) -> tuple[dict[str, Any] | None, str]:
    rr = repo_root.expanduser().resolve(strict=False)
    if not cad_database_path(rr).is_file():
        return None, ""
    key = _norm_key(host_repo_rel)
    sql = """
        SELECT tree_json, node_count, bom_xref_at
        FROM bom_assembly_cache
        WHERE host_repo_rel_path = ? AND mode = ?
    """
    params = (key, mode)
    debug_sql = _format_debug_sql(sql, params)
    with connect(rr) as conn:
        row = conn.execute(sql, params).fetchone()
    if row is None:
        return None, debug_sql
    try:
        nodes = json.loads(str(row["tree_json"]))
    except json.JSONDecodeError:
        return None, debug_sql
    if not isinstance(nodes, list):
        return None, debug_sql
    return {
        "nodes": nodes,
        "node_count": int(row["node_count"] or 0),
        "bom_xref_at": str(row["bom_xref_at"] or ""),
    }, debug_sql


def save_bom_assembly_cache(
    repo_root: Path,
    host_repo_rel: str,
    mode: str,
    *,
    nodes: list[dict[str, Any]],
    node_count: int,
    bom_xref_at: str,
) -> None:
    rr = repo_root.expanduser().resolve(strict=False)
    key = _norm_key(host_repo_rel)
    now = _utc_now_iso()
    payload = json.dumps(nodes, ensure_ascii=False)
    with connect(rr) as conn:
        conn.execute(
            """
            INSERT INTO bom_assembly_cache (
                host_repo_rel_path, mode, tree_json, node_count, bom_xref_at, built_at
            ) VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(host_repo_rel_path, mode) DO UPDATE SET
                tree_json = excluded.tree_json,
                node_count = excluded.node_count,
                bom_xref_at = excluded.bom_xref_at,
                built_at = excluded.built_at
            """,
            (key, mode, payload, node_count, bom_xref_at or "", now),
        )


def query_all_bom_xref_edges_enriched(repo_root: Path) -> tuple[list[dict[str, Any]], str]:
    """一次查询全部引用边（子件快照与标签已冗余在 ``bom_xref``）。"""
    rr = repo_root.expanduser().resolve(strict=False)
    sql = """
        SELECT * FROM bom_xref
        ORDER BY host_repo_rel_path, xlink_file_attr
    """
    debug_sql = sql_one_line(sql)
    if not cad_database_path(rr).is_file():
        return [], debug_sql
    with connect(rr) as conn:
        rows = conn.execute(sql).fetchall()
    return [_bom_xref_row_to_dict(r) for r in rows], debug_sql


def query_assembly_bom_hosts(
    repo_root: Path,
    *,
    search: str | None = None,
) -> tuple[list[dict[str, Any]], int, str]:
    """一次 SQL 汇总各总成（有出向引用的装配宿主；排除图纸档）。

    总成判定：文件名含 ``.assy.fcstd``，或出向引用数 ≥ 2（子装配）。
    单零件仅 1 条出向引用且非 assy 命名的不计入。
    """
    rr = repo_root.expanduser().resolve(strict=False)
    if not cad_database_path(rr).is_file():
        return [], 0, ""
    where_extra = ""
    params: list[Any] = []
    q = (search or "").strip()
    if q:
        like = f"%{q}%"
        where_extra = """
            AND (
                bx.host_repo_rel_path LIKE ? COLLATE NOCASE
                OR fa.filename LIKE ? COLLATE NOCASE
                OR COALESCE(fa.part_name, '') LIKE ? COLLATE NOCASE
                OR COALESCE(fa.label, '') LIKE ? COLLATE NOCASE
            )
        """
        params.extend([like, like, like, like])
    sql = f"""
        SELECT
            bx.host_repo_rel_path,
            fa.filename,
            fa.part_number,
            fa.part_version,
            fa.type_code,
            fa.model_series,
            fa.part_name,
            fa.label,
            COUNT(*) AS ref_count,
            SUM(CASE WHEN bx.resolve_status = 'missing' THEN 1 ELSE 0 END) AS missing_count,
            SUM(CASE WHEN bx.resolve_status = 'ambiguous' THEN 1 ELSE 0 END) AS ambiguous_count,
            (
                SELECT COUNT(DISTINCT bx_in.host_repo_rel_path)
                FROM bom_xref bx_in
                WHERE bx_in.target_repo_rel_path = fa.repo_rel_path
            ) AS incoming_host_count
        FROM bom_xref bx
        INNER JOIN file_asset fa ON fa.id = bx.host_file_asset_id
        WHERE fa.file_status = 'present'
          AND LOWER(fa.filename) LIKE '%.fcstd'
          AND LOWER(fa.filename) NOT LIKE '%.drawing.fcstd'
          {where_extra}
        GROUP BY bx.host_repo_rel_path
        HAVING COUNT(*) > 0
           AND (
                LOWER(fa.filename) LIKE '%.assy.fcstd'
                OR COUNT(*) >= 2
           )
        ORDER BY fa.filename COLLATE NOCASE
    """
    query_params = tuple(params)
    debug_sql = _format_debug_sql(sql, query_params)
    with connect(rr) as conn:
        rows = conn.execute(sql, query_params).fetchall()
    out: list[dict[str, Any]] = []
    for r in rows:
        pn = str(r["part_number"] or "").strip()
        pv = str(r["part_version"] or "").strip()
        fname = str(r["filename"] or "")
        out.append(
            {
                "host_repo_rel_path": str(r["host_repo_rel_path"]),
                "filename": fname,
                "part_number": pn,
                "part_version": pv,
                "part_key": format_part_key(pn, pv) if pn and pv else "",
                "TypeCode": str(r["type_code"] or ""),
                "ModelSeries": str(r["model_series"] or ""),
                "PartName": str(r["part_name"] or ""),
                "label": str(r["label"] or ""),
                "ref_count": int(r["ref_count"] or 0),
                "missing_count": int(r["missing_count"] or 0),
                "ambiguous_count": int(r["ambiguous_count"] or 0),
                "incoming_host_count": int(r["incoming_host_count"] or 0),
                "file_role": infer_part_file_role(fname),
            }
        )
    return out, len(out), debug_sql


def query_all_bom_xref_edges(repo_root: Path) -> tuple[list[dict[str, Any]], str]:
    """加载全部引用边（构图 / 传递查询用）。"""
    rr = repo_root.expanduser().resolve(strict=False)
    sql = """
        SELECT
            host_repo_rel_path,
            xlink_file_attr,
            target_basename,
            target_repo_rel_path,
            target_file_asset_id,
            resolve_status
        FROM bom_xref
        ORDER BY host_repo_rel_path, xlink_file_attr
    """
    debug_sql = sql_one_line(sql)
    if not cad_database_path(rr).is_file():
        return [], debug_sql
    with connect(rr) as conn:
        rows = conn.execute(sql).fetchall()
    return [
        {
            "host_repo_rel_path": str(r["host_repo_rel_path"]),
            "xlink_file_attr": str(r["xlink_file_attr"]),
            "target_basename": str(r["target_basename"]),
            "target_repo_rel_path": r["target_repo_rel_path"],
            "target_file_asset_id": r["target_file_asset_id"],
            "resolve_status": str(r["resolve_status"]),
        }
        for r in rows
    ], debug_sql


def query_bom_xrefs_incoming(
    repo_root: Path,
    *,
    repo_rel: str | None = None,
    basename: str | None = None,
    limit: int = 500,
) -> tuple[list[dict[str, Any]], str]:
    rr = repo_root.expanduser().resolve(strict=False)
    cap = max(1, min(int(limit), 2000))
    clauses: list[str] = []
    params: list[Any] = []

    if repo_rel:
        key = _norm_key(repo_rel)
        asset_id = get_file_asset_id(rr, key)
        if asset_id is not None:
            clauses.append("(target_file_asset_id = ? OR target_repo_rel_path = ?)")
            params.extend([asset_id, key])
        else:
            clauses.append("target_repo_rel_path LIKE ? ESCAPE '\\' COLLATE NOCASE")
            params.append(f"%{_sql_like_escape(key)}%")
    if basename:
        base = basename.strip()
        if _looks_like_exact_basename(base):
            clauses.append("target_basename = ? COLLATE NOCASE")
            params.append(base)
        else:
            clauses.append("target_basename LIKE ? ESCAPE '\\' COLLATE NOCASE")
            params.append(f"%{_sql_like_escape(base)}%")

    if not clauses:
        return [], ""

    where = " OR ".join(f"({c})" for c in clauses) if len(clauses) > 1 else clauses[0]
    sql = f"""
        SELECT * FROM bom_xref
        WHERE {where}
        ORDER BY host_repo_rel_path, xlink_file_attr
        LIMIT ?
    """
    params.append(cap)
    query_params = tuple(params)
    debug_sql = _format_debug_sql(sql, query_params)

    with connect(rr) as conn:
        rows = conn.execute(sql, query_params).fetchall()
    return [_bom_xref_row_to_dict(r) for r in rows], debug_sql


def query_bom_xref_edges_paged(
    repo_root: Path,
    *,
    offset: int = 0,
    limit: int = 100,
    search: str | None = None,
) -> tuple[list[dict[str, Any]], int]:
    """分页列出 ``bom_xref`` 引用边（可选关键词过滤宿主/子件路径）。"""
    rr = repo_root.expanduser().resolve(strict=False)
    if not cad_database_path(rr).is_file():
        return [], 0
    cap = max(1, min(int(limit), 500))
    off = max(0, int(offset))
    where = ""
    params: list[Any] = []
    q = (search or "").strip()
    if q:
        like = f"%{q}%"
        where = """
            WHERE bx.host_repo_rel_path LIKE ? COLLATE NOCASE
               OR bx.target_basename LIKE ? COLLATE NOCASE
               OR COALESCE(bx.target_repo_rel_path, '') LIKE ? COLLATE NOCASE
        """
        params.extend([like, like, like])
    with connect(rr) as conn:
        total_row = conn.execute(
            f"SELECT COUNT(*) AS n FROM bom_xref bx {where}",
            params,
        ).fetchone()
        total = int(total_row["n"]) if total_row else 0
        rows = conn.execute(
            f"""
            SELECT * FROM bom_xref bx
            {where}
            ORDER BY bx.host_repo_rel_path, bx.target_basename, bx.xlink_file_attr
            LIMIT ? OFFSET ?
            """,
            [*params, cap, off],
        ).fetchall()
    return [_bom_xref_row_to_dict(r) for r in rows], total


def query_bom_xrefs_outgoing(
    repo_root: Path,
    host_repo_rel: str,
    *,
    limit: int = 500,
) -> tuple[list[dict[str, Any]], str]:
    rr = repo_root.expanduser().resolve(strict=False)
    key = _norm_key(host_repo_rel)
    cap = max(1, min(int(limit), 2000))
    sql = """
        SELECT * FROM bom_xref
        WHERE host_repo_rel_path = ?
        ORDER BY target_basename, xlink_file_attr
        LIMIT ?
    """
    params = (key, cap)
    debug_sql = _format_debug_sql(sql, params)
    with connect(rr) as conn:
        rows = conn.execute(sql, params).fetchall()
    return [_bom_xref_row_to_dict(r) for r in rows], debug_sql


def query_bom_xrefs_outgoing_enriched(
    repo_root: Path,
    host_repo_rel: str,
    *,
    limit: int = 500,
) -> tuple[list[dict[str, Any]], str]:
    """出向引用边（子件快照冗余在 ``bom_xref``，单表查询）。"""
    rr = repo_root.expanduser().resolve(strict=False)
    key = _norm_key(host_repo_rel)
    cap = max(1, min(int(limit), 2000))
    sql = """
        SELECT * FROM bom_xref
        WHERE host_repo_rel_path = ?
        ORDER BY target_basename, xlink_file_attr
        LIMIT ?
    """
    params = (key, cap)
    debug_sql = _format_debug_sql(sql, params)
    if not cad_database_path(rr).is_file():
        return [], debug_sql
    with connect(rr) as conn:
        rows = conn.execute(sql, params).fetchall()
    return [_bom_xref_row_to_dict(r) for r in rows], debug_sql


def query_bom_xref_counts_for_rel(
    repo_root: Path,
    repo_rel: str,
) -> tuple[dict[str, int], str]:
    """Tab 角标用：出向边数 + 直接入向宿主数（单条 SQL）。"""
    rr = repo_root.expanduser().resolve(strict=False)
    key = _norm_key(repo_rel)
    sql = """
        SELECT
            (SELECT COUNT(*) FROM bom_xref WHERE host_repo_rel_path = ?) AS outgoing_count,
            (
                SELECT COUNT(DISTINCT host_repo_rel_path) FROM bom_xref
                WHERE target_repo_rel_path = ?
                   OR target_file_asset_id = (
                       SELECT id FROM file_asset WHERE repo_rel_path = ? LIMIT 1
                   )
            ) AS direct_incoming_count
    """
    params = (key, key, key)
    debug_sql = _format_debug_sql(sql, params)
    if not cad_database_path(rr).is_file():
        return {"outgoing_count": 0, "direct_incoming_count": 0}, debug_sql
    with connect(rr) as conn:
        row = conn.execute(sql, params).fetchone()
    if row is None:
        return {"outgoing_count": 0, "direct_incoming_count": 0}, debug_sql
    return {
        "outgoing_count": int(row["outgoing_count"] or 0),
        "direct_incoming_count": int(row["direct_incoming_count"] or 0),
    }, debug_sql


def find_present_repo_rel_by_filename(repo_root: Path, filename: str) -> str | None:
    """工作空间内按 filename 找唯一 present 文件（改名分析默认 basename 不重复）。"""
    from fcdesk.freecad.fcstd_mapping import FILE_STATUS_PRESENT

    name = filename.strip()
    if not name:
        return None
    rr = repo_root.expanduser().resolve(strict=False)
    with connect(rr) as conn:
        row = conn.execute(
            """
            SELECT repo_rel_path FROM file_asset
            WHERE lower(filename) = lower(?) AND file_status = ?
            ORDER BY repo_rel_path
            LIMIT 1
            """,
            (name, FILE_STATUS_PRESENT),
        ).fetchone()
    if row is None:
        return None
    return normalize_repo_rel_path_for_map(str(row["repo_rel_path"]))


def query_bom_xrefs_for_rename_basename(
    repo_root: Path,
    basename: str,
    *,
    limit: int = 2000,
) -> list[dict[str, Any]]:
    """改名分析：仅按 basename 查全部引用边（不用路径；含 XLink 属性匹配）。"""
    rr = repo_root.expanduser().resolve(strict=False)
    base = basename.strip()
    if not base:
        return []
    cap = max(1, min(int(limit), 2000))
    like_tail = f"%/{base}"
    like_tail_win = f"%\\{base}"
    if _looks_like_exact_basename(base):
        target_clause = "target_basename = ? COLLATE NOCASE"
        target_param: Any = base
    else:
        target_clause = "target_basename LIKE ? ESCAPE '\\' COLLATE NOCASE"
        target_param = f"%{_sql_like_escape(base)}%"

    sql = f"""
        SELECT * FROM bom_xref
        WHERE ({target_clause}
               OR xlink_file_attr = ? COLLATE NOCASE
               OR xlink_file_attr LIKE ? ESCAPE '\\' COLLATE NOCASE
               OR xlink_file_attr LIKE ? ESCAPE '\\' COLLATE NOCASE)
        ORDER BY host_repo_rel_path, xlink_file_attr
        LIMIT ?
    """
    with connect(rr) as conn:
        rows = conn.execute(
            sql,
            (target_param, base, like_tail, like_tail_win, cap),
        ).fetchall()
    return [_bom_xref_row_to_dict(r) for r in rows]


def query_bom_xrefs_for_basename(
    repo_root: Path,
    *,
    old_basename: str,
    exclude_repo_rel: str | None = None,
    target_repo_rel: str | None = None,
) -> list[dict[str, Any]]:
    """改名分析：从库中查仍引用目标文件的宿主边（支持部分 basename / 精确路径）。"""
    base = old_basename.strip()
    rel = (target_repo_rel or "").strip() or None
    if not base and not rel:
        return []

    lookup_base = base if not rel else None
    rows, _ = query_bom_xrefs_incoming(
        repo_root,
        repo_rel=rel,
        basename=lookup_base,
        limit=2000,
    )
    exclude_key = _norm_key(exclude_repo_rel) if exclude_repo_rel else None
    if exclude_key:
        rows = [r for r in rows if _norm_key(r["host_repo_rel_path"]) != exclude_key]
    return rows

