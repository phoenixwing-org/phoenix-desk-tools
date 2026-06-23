"""Code 索引读写（``phoenix_code_*`` 表）。"""

from __future__ import annotations

import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from phoenix.code.scan_index import CodeFileRecord
from phoenix.code.schema import T_CODE_FILE, T_CODE_SCAN
from phoenix.config.user_prefs import workspace_phoenix_dir
from phoenix.freecad.phoenix_store import connect
from phoenix.freecad.phoenix_schema import T_META

CODE_INDEX_JSON_NAME = "code_index.json"

FILE_STATUS_PRESENT = "present"
FILE_STATUS_MISSING = "missing"

SEARCH_MODE_CONTAINS = "contains"
SEARCH_MODE_FILENAME = "filename"


def _looks_like_exact_filename(name: str) -> bool:
    """含扩展名的 basename（如 ``foo.cpp``）视为精确文件名。"""
    base = name.strip()
    if not base or "/" in base or "\\" in base:
        return False
    dot = base.rfind(".")
    return dot > 0 and dot < len(base) - 1


def _code_search_clause(q: str, mode: str = SEARCH_MODE_CONTAINS) -> tuple[str | None, list[Any]]:
    text = (q or "").strip()
    if not text:
        return None, []

    mode = (mode or SEARCH_MODE_CONTAINS).strip().lower()
    needle = text.casefold()

    if mode == SEARCH_MODE_FILENAME:
        if "/" in text or "\\" in text:
            norm = text.replace("\\", "/").casefold()
            tail = norm.rsplit("/", 1)[-1]
            if _looks_like_exact_filename(tail):
                return "LOWER(repo_rel_path) = ?", [norm]
            like = f"%{needle}%"
            return "LOWER(repo_rel_path) LIKE ?", [like]
        if _looks_like_exact_filename(text):
            return "LOWER(filename) = ?", [needle]
        like = f"%{needle}%"
        return "LOWER(filename) LIKE ?", [like]

    like = f"%{needle}%"
    return "(LOWER(repo_rel_path) LIKE ? OR LOWER(filename) LIKE ?)", [like, like]


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def _norm_rel(repo_rel_path: str) -> str:
    return repo_rel_path.replace("\\", "/").strip().lstrip("./")


def save_code_index(
    repo_root: Path,
    records: list[CodeFileRecord],
    *,
    scan_root: str,
) -> dict[str, Any]:
    """全量写入索引；不在本次扫描中的行标为 missing。"""
    rr = repo_root.expanduser().resolve(strict=False)
    now = _utc_now_iso()
    stats: dict[str, int] = {k: 0 for k in ("source", "config", "doc", "resource", "total")}
    seen: set[str] = set()

    with connect(rr) as conn:
        for rec in records:
            key = _norm_rel(rec.repo_rel_path)
            if not key:
                continue
            seen.add(key)
            stats[rec.asset_kind] = stats.get(rec.asset_kind, 0) + 1
            stats["total"] += 1
            conn.execute(
                f"""
                INSERT INTO {T_CODE_FILE} (
                    repo_rel_path, filename, asset_kind, file_ext,
                    file_status, size_bytes, text_encoding, last_seen_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(repo_rel_path) DO UPDATE SET
                    filename = excluded.filename,
                    asset_kind = excluded.asset_kind,
                    file_ext = excluded.file_ext,
                    file_status = excluded.file_status,
                    size_bytes = excluded.size_bytes,
                    text_encoding = excluded.text_encoding,
                    last_seen_at = excluded.last_seen_at,
                    updated_at = excluded.updated_at
                """,
                (
                    key,
                    rec.filename,
                    rec.asset_kind,
                    rec.file_ext,
                    FILE_STATUS_PRESENT,
                    rec.size_bytes,
                    rec.text_encoding,
                    now,
                    now,
                ),
            )

        if seen:
            placeholders = ",".join("?" * len(seen))
            conn.execute(
                f"""
                UPDATE {T_CODE_FILE}
                SET file_status = ?, updated_at = ?
                WHERE repo_rel_path NOT IN ({placeholders})
                  AND file_status != ?
                """,
                (FILE_STATUS_MISSING, now, *sorted(seen), FILE_STATUS_MISSING),
            )
        else:
            conn.execute(
                f"""
                UPDATE {T_CODE_FILE}
                SET file_status = ?, updated_at = ?
                WHERE file_status != ?
                """,
                (FILE_STATUS_MISSING, now, FILE_STATUS_MISSING),
            )

        stats_json = json.dumps(stats, ensure_ascii=False)
        cur = conn.execute(
            f"""
            INSERT INTO {T_CODE_SCAN}(scanned_at, scan_root, stats_json)
            VALUES (?, ?, ?)
            """,
            (now, scan_root, stats_json),
        )
        scan_id = int(cur.lastrowid)
        conn.execute(
            f"INSERT INTO {T_META}(key, value) VALUES ('code_last_scan_at', ?) "
            f"ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            (now,),
        )
        conn.execute(
            f"INSERT INTO {T_META}(key, value) VALUES ('code_last_scan_stats', ?) "
            f"ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            (stats_json,),
        )

    return {"scan_id": scan_id, "scanned_at": now, "stats": stats}


def _meta_get(conn: sqlite3.Connection, key: str) -> str | None:
    row = conn.execute(f"SELECT value FROM {T_META} WHERE key = ?", (key,)).fetchone()
    return str(row[0]) if row else None


def _meta_set(conn: sqlite3.Connection, key: str, value: str) -> None:
    conn.execute(
        f"INSERT INTO {T_META}(key, value) VALUES (?, ?) "
        f"ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        (key, value),
    )


CODE_INDEX_EXTRA_EXTS_KEY = "code_index_extra_exts"


def load_code_index_extra_exts(repo_root: Path) -> list[str]:
    from phoenix.code.kinds import normalize_index_extension

    rr = repo_root.expanduser().resolve(strict=False)
    with connect(rr) as conn:
        raw = _meta_get(conn, CODE_INDEX_EXTRA_EXTS_KEY)
    if not raw:
        return []
    try:
        data = json.loads(raw)
        if not isinstance(data, list):
            return []
        out: list[str] = []
        for item in data:
            norm = normalize_index_extension(str(item))
            if norm:
                out.append(norm)
        return sorted(set(out))
    except (json.JSONDecodeError, TypeError, ValueError):
        return []


def save_code_index_extra_exts(repo_root: Path, extensions: list[str]) -> list[str]:
    from phoenix.code.kinds import normalize_index_extension

    rr = repo_root.expanduser().resolve(strict=False)
    normalized = sorted(
        {norm for e in extensions if (norm := normalize_index_extension(e))}
    )
    with connect(rr) as conn:
        _meta_set(
            conn,
            CODE_INDEX_EXTRA_EXTS_KEY,
            json.dumps(normalized, ensure_ascii=False),
        )
    return normalized


def code_index_json_path(repo_root: Path) -> Path:
    return workspace_phoenix_dir(repo_root) / "exports" / CODE_INDEX_JSON_NAME


def delete_missing_code_files(repo_root: Path) -> int:
    """永久删除 ``file_status=missing`` 的 Code 索引行。"""
    rr = repo_root.expanduser().resolve(strict=False)
    with connect(rr) as conn:
        row = conn.execute(
            f"SELECT COUNT(*) FROM {T_CODE_FILE} WHERE file_status = ?",
            (FILE_STATUS_MISSING,),
        ).fetchone()
        n = int(row[0]) if row else 0
        if n == 0:
            return 0
        conn.execute(
            f"DELETE FROM {T_CODE_FILE} WHERE file_status = ?",
            (FILE_STATUS_MISSING,),
        )
    return n


def export_code_index_json(repo_root: Path, dest: Path | None = None) -> Path:
    """从 SQLite 导出 Code 索引快照 JSON。"""
    rr = repo_root.expanduser().resolve(strict=False)
    meta = load_code_index_meta(rr)
    if not meta.get("file_count"):
        raise FileNotFoundError("Code 索引为空，请先执行工程内搜索")
    entries, total = query_code_files(rr, limit=1_000_000, offset=0)
    out = dest or code_index_json_path(rr)
    out.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "schema_version": 1,
        "exported_at": _utc_now_iso(),
        "last_scan_at": meta.get("last_scan_at"),
        "stats": meta.get("stats"),
        "file_count": total,
        "present_count": meta.get("present_count", 0),
        "entries": entries,
    }
    out.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return out


def load_code_index_meta(repo_root: Path) -> dict[str, Any]:
    rr = repo_root.expanduser().resolve(strict=False)
    with connect(rr) as conn:
        last_scan = _meta_get(conn, "code_last_scan_at")
        stats_raw = _meta_get(conn, "code_last_scan_stats")
        total = conn.execute(f"SELECT COUNT(*) FROM {T_CODE_FILE}").fetchone()
        present = conn.execute(
            f"SELECT COUNT(*) FROM {T_CODE_FILE} WHERE file_status = ?",
            (FILE_STATUS_PRESENT,),
        ).fetchone()
    stats: dict[str, int] | None = None
    if stats_raw:
        try:
            parsed = json.loads(stats_raw)
            if isinstance(parsed, dict):
                stats = {k: int(v) for k, v in parsed.items()}
        except (json.JSONDecodeError, TypeError, ValueError):
            pass
    return {
        "last_scan_at": last_scan,
        "stats": stats,
        "file_count": int(total[0]) if total else 0,
        "present_count": int(present[0]) if present else 0,
    }


def query_code_files(
    repo_root: Path,
    *,
    kind: str | None = None,
    status: str | None = None,
    q: str | None = None,
    search_mode: str = SEARCH_MODE_CONTAINS,
    limit: int = 500,
    offset: int = 0,
) -> tuple[list[dict[str, Any]], int]:
    rr = repo_root.expanduser().resolve(strict=False)
    clauses: list[str] = []
    params: list[Any] = []

    if kind and kind != "all":
        clauses.append("asset_kind = ?")
        params.append(kind)
    if status and status != "all":
        clauses.append("file_status = ?")
        params.append(status)
    search_sql, search_params = _code_search_clause(q or "", search_mode)
    if search_sql:
        clauses.append(search_sql)
        params.extend(search_params)

    where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
    sql_count = f"SELECT COUNT(*) FROM {T_CODE_FILE} {where}"
    sql_rows = f"""
        SELECT repo_rel_path, filename, asset_kind, file_ext, file_status, size_bytes,
               text_encoding, last_seen_at
        FROM {T_CODE_FILE}
        {where}
        ORDER BY repo_rel_path COLLATE NOCASE
        LIMIT ? OFFSET ?
    """
    with connect(rr) as conn:
        total_row = conn.execute(sql_count, tuple(params)).fetchone()
        total = int(total_row[0]) if total_row else 0
        rows = conn.execute(sql_rows, tuple(params + [limit, offset])).fetchall()

    entries = [
        {
            "repo_rel_path": str(r[0]),
            "filename": str(r[1]),
            "asset_kind": str(r[2]),
            "file_ext": str(r[3]),
            "file_status": str(r[4]),
            "size_bytes": int(r[5] or 0),
            "text_encoding": str(r[6] or ""),
            "last_seen_at": r[7],
        }
        for r in rows
    ]
    return entries, total


def query_catdlg_index_files(repo_root: Path) -> tuple[list[dict[str, Any]], int]:
    """单次 SQL：列出 Code 索引中存在的 ``.catdlg`` 文件。"""
    rr = repo_root.expanduser().resolve(strict=False)
    sql_count = f"""
        SELECT COUNT(*) FROM {T_CODE_FILE}
        WHERE file_status = ? AND file_ext = ?
    """
    sql_rows = f"""
        SELECT repo_rel_path, filename, size_bytes, last_seen_at
        FROM {T_CODE_FILE}
        WHERE file_status = ? AND file_ext = ?
        ORDER BY repo_rel_path COLLATE NOCASE
    """
    with connect(rr) as conn:
        params = (FILE_STATUS_PRESENT, ".catdlg")
        total_row = conn.execute(sql_count, params).fetchone()
        total = int(total_row[0]) if total_row else 0
        rows = conn.execute(sql_rows, params).fetchall()

    entries = [
        {
            "repo_rel_path": str(r[0]),
            "filename": str(r[1]),
            "size_bytes": int(r[2] or 0),
            "last_seen_at": r[3],
        }
        for r in rows
    ]
    return entries, total
