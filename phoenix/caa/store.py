"""CAA 对话框轻量索引读写。"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from phoenix.caa.schema import (
    T_CAA_DIALOG,
    T_CAA_DIALOG_FTS,
    T_CAA_GROUP,
    T_CAA_GROUP_MEMBER,
    T_CAA_SCAN,
)
from phoenix.freecad.phoenix_schema import T_META
from phoenix.freecad.phoenix_store import connect

FILE_STATUS_PRESENT = "present"
FILE_STATUS_MISSING = "missing"

_DIALOG_RE = re.compile(r"^\s*CATDlgDialog\s+([A-Za-z_]\w*)\b", re.MULTILINE)
_CATDLG_TYPE_RE = re.compile(r"^\s*(CATDlg\w+)\s+[A-Za-z_]\w*\b", re.MULTILINE)


@dataclass(frozen=True)
class CaaDialogIndexRecord:
    repo_rel_catdlg: str
    dialog_name: str
    title: str
    filename: str
    group_key: str
    group_label: str
    size_bytes: int
    type_counts: dict[str, int]


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def _norm_rel(path: Path, repo_root: Path) -> str:
    return path.relative_to(repo_root).as_posix()


def caa_dialog_group_key(catdlg_rel: str) -> str:
    norm = catdlg_rel.replace("\\", "/").strip().lstrip("/")
    match = re.search(r"/([^/]+UI\.m)/", norm, flags=re.IGNORECASE)
    if match:
        return match.group(1)
    parts = norm.split("/")
    if len(parts) >= 2:
        return parts[-2]
    return "(根目录)"


def extract_catdlg_dialog_name(text: str, fallback: str) -> str:
    match = _DIALOG_RE.search(text)
    return match.group(1) if match else fallback


def extract_catdlg_type_counts(text: str) -> dict[str, int]:
    counts = Counter(match.group(1) for match in _CATDLG_TYPE_RE.finditer(text))
    return dict(sorted(counts.items()))


def _load_catalog_types() -> set[str]:
    catalog_path = Path(__file__).resolve().parents[2] / "packages" / "catdlg-core" / "control_catalog.json"
    try:
        raw = json.loads(catalog_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return set()
    return {
        str(row.get("type", "")).strip()
        for row in raw.get("controls", [])
        if str(row.get("type", "")).strip()
    }


def build_catdlg_type_coverage(records: list[CaaDialogIndexRecord]) -> dict[str, Any]:
    catalog_types = _load_catalog_types()
    total_by_type: Counter[str] = Counter()
    dialogs_by_type: Counter[str] = Counter()
    for rec in records:
        for type_name, count in rec.type_counts.items():
            total_by_type[type_name] += int(count)
            dialogs_by_type[type_name] += 1

    rows = [
        {
            "type": type_name,
            "count": int(count),
            "dialog_count": int(dialogs_by_type[type_name]),
            "known": type_name in catalog_types,
        }
        for type_name, count in sorted(
            total_by_type.items(),
            key=lambda kv: (-kv[1], kv[0].casefold()),
        )
    ]
    unknown = [row for row in rows if not row["known"]]
    return {
        "catalog_type_count": len(catalog_types),
        "total_types": len(rows),
        "known_types": len(rows) - len(unknown),
        "unknown_types": len(unknown),
        "total_controls": sum(int(row["count"]) for row in rows),
        "unknown_controls": sum(int(row["count"]) for row in unknown),
        "types": rows,
        "unknown": unknown,
    }


def _fts_query(q: str) -> str:
    tokens = re.findall(r"[\w\u4e00-\u9fff.-]+", q.strip(), flags=re.UNICODE)
    if not tokens:
        return ""
    return " OR ".join(f'"{token}"*' for token in tokens)


def scan_caa_dialog_files(repo_root: Path) -> list[CaaDialogIndexRecord]:
    rr = repo_root.expanduser().resolve(strict=False)
    records: list[CaaDialogIndexRecord] = []
    for path in rr.rglob("*.CATDlg"):
        if any(part in {".git", "node_modules", ".phoenix"} for part in path.parts):
            continue
        try:
            stat = path.stat()
            text = path.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue
        rel = _norm_rel(path, rr)
        filename = path.name
        dialog_name = extract_catdlg_dialog_name(text, path.stem)
        group_key = caa_dialog_group_key(rel)
        type_counts = extract_catdlg_type_counts(text)
        records.append(
            CaaDialogIndexRecord(
                repo_rel_catdlg=rel,
                dialog_name=dialog_name,
                title=dialog_name,
                filename=filename,
                group_key=group_key,
                group_label=group_key,
                size_bytes=int(stat.st_size),
                type_counts=type_counts,
            )
        )
    return records


def save_caa_index(
    repo_root: Path,
    records: list[CaaDialogIndexRecord],
    *,
    scan_root: str,
) -> dict[str, Any]:
    rr = repo_root.expanduser().resolve(strict=False)
    now = _utc_now_iso()
    seen: set[str] = set()

    with connect(rr) as conn:
        conn.execute(f"DELETE FROM {T_CAA_DIALOG_FTS}")
        for rec in records:
            seen.add(rec.repo_rel_catdlg)
            cur = conn.execute(
                f"""
                INSERT INTO {T_CAA_DIALOG} (
                    repo_rel_catdlg, dialog_name, title, filename, group_key,
                    group_label, file_status, size_bytes, last_seen_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(repo_rel_catdlg) DO UPDATE SET
                    dialog_name = excluded.dialog_name,
                    title = excluded.title,
                    filename = excluded.filename,
                    group_key = excluded.group_key,
                    group_label = excluded.group_label,
                    file_status = excluded.file_status,
                    size_bytes = excluded.size_bytes,
                    last_seen_at = excluded.last_seen_at,
                    updated_at = excluded.updated_at
                """,
                (
                    rec.repo_rel_catdlg,
                    rec.dialog_name,
                    rec.title,
                    rec.filename,
                    rec.group_key,
                    rec.group_label,
                    FILE_STATUS_PRESENT,
                    rec.size_bytes,
                    now,
                    now,
                ),
            )
            dialog_id = int(cur.lastrowid or 0)
            if dialog_id == 0:
                row = conn.execute(
                    f"SELECT id FROM {T_CAA_DIALOG} WHERE repo_rel_catdlg = ?",
                    (rec.repo_rel_catdlg,),
                ).fetchone()
                dialog_id = int(row[0]) if row else 0
            conn.execute(
                f"""
                INSERT INTO {T_CAA_GROUP}(group_key, group_label, updated_at)
                VALUES (?, ?, ?)
                ON CONFLICT(group_key) DO UPDATE SET
                    group_label = excluded.group_label,
                    updated_at = excluded.updated_at
                """,
                (rec.group_key, rec.group_label, now),
            )
            if dialog_id:
                conn.execute(
                    f"DELETE FROM {T_CAA_GROUP_MEMBER} WHERE dialog_id = ?",
                    (dialog_id,),
                )
                conn.execute(
                    f"""
                    INSERT OR IGNORE INTO {T_CAA_GROUP_MEMBER}(group_key, dialog_id)
                    VALUES (?, ?)
                    """,
                    (rec.group_key, dialog_id),
                )
            conn.execute(
                f"""
                INSERT INTO {T_CAA_DIALOG_FTS}(
                    repo_rel_catdlg, dialog_name, title, filename,
                    group_key, group_label, body
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    rec.repo_rel_catdlg,
                    rec.dialog_name,
                    rec.title,
                    rec.filename,
                    rec.group_key,
                    rec.group_label,
                    " ".join(
                        [
                            rec.repo_rel_catdlg,
                            rec.dialog_name,
                            rec.title,
                            rec.filename,
                            rec.group_key,
                            rec.group_label,
                            *sorted(rec.type_counts.keys()),
                        ]
                    ),
                ),
            )

        if seen:
            placeholders = ",".join("?" * len(seen))
            conn.execute(
                f"""
                UPDATE {T_CAA_DIALOG}
                SET file_status = ?, updated_at = ?
                WHERE repo_rel_catdlg NOT IN ({placeholders})
                  AND file_status != ?
                """,
                (FILE_STATUS_MISSING, now, *sorted(seen), FILE_STATUS_MISSING),
            )
        else:
            conn.execute(
                f"""
                UPDATE {T_CAA_DIALOG}
                SET file_status = ?, updated_at = ?
                WHERE file_status != ?
                """,
                (FILE_STATUS_MISSING, now, FILE_STATUS_MISSING),
            )

        stats = {
            "dialogs": len(records),
            "total": len(records),
            "control_type_coverage": build_catdlg_type_coverage(records),
        }
        stats_json = json.dumps(stats, ensure_ascii=False)
        cur = conn.execute(
            f"INSERT INTO {T_CAA_SCAN}(scanned_at, scan_root, stats_json) VALUES (?, ?, ?)",
            (now, scan_root, stats_json),
        )
        scan_id = int(cur.lastrowid)
        conn.execute(
            f"INSERT INTO {T_META}(key, value) VALUES ('caa_last_scan_at', ?) "
            f"ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            (now,),
        )
        conn.execute(
            f"INSERT INTO {T_META}(key, value) VALUES ('caa_last_scan_stats', ?) "
            f"ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            (stats_json,),
        )

    return {"scan_id": scan_id, "scanned_at": now, "stats": stats}


def load_caa_index_meta(repo_root: Path) -> dict[str, Any]:
    rr = repo_root.expanduser().resolve(strict=False)
    with connect(rr) as conn:
        last = conn.execute(
            f"SELECT value FROM {T_META} WHERE key = 'caa_last_scan_at'"
        ).fetchone()
        stats_row = conn.execute(
            f"SELECT value FROM {T_META} WHERE key = 'caa_last_scan_stats'"
        ).fetchone()
        total = conn.execute(f"SELECT COUNT(*) FROM {T_CAA_DIALOG}").fetchone()
        present = conn.execute(
            f"SELECT COUNT(*) FROM {T_CAA_DIALOG} WHERE file_status = ?",
            (FILE_STATUS_PRESENT,),
        ).fetchone()
    stats: dict[str, Any] = {}
    if stats_row and stats_row[0]:
        try:
            parsed = json.loads(str(stats_row[0]))
            if isinstance(parsed, dict):
                stats = parsed
        except json.JSONDecodeError:
            stats = {}
    return {
        "last_scan_at": str(last[0]) if last else None,
        "file_count": int(total[0]) if total else 0,
        "present_count": int(present[0]) if present else 0,
        "stats": stats,
    }


def load_caa_dialog_groups(repo_root: Path, q: str | None = None) -> dict[str, Any]:
    rr = repo_root.expanduser().resolve(strict=False)
    query = (q or "").strip().casefold()
    with connect(rr) as conn:
        fts_q = _fts_query(query) if query else ""
        if fts_q:
            rows = conn.execute(
                f"""
                SELECT d.repo_rel_catdlg, d.dialog_name, d.title, d.filename, d.group_key, d.group_label
                FROM {T_CAA_DIALOG} d
                JOIN {T_CAA_DIALOG_FTS}
                  ON {T_CAA_DIALOG_FTS}.repo_rel_catdlg = d.repo_rel_catdlg
                WHERE d.file_status = ?
                  AND {T_CAA_DIALOG_FTS} MATCH ?
                ORDER BY bm25({T_CAA_DIALOG_FTS}),
                         d.group_key COLLATE NOCASE,
                         d.filename COLLATE NOCASE
                """,
                (FILE_STATUS_PRESENT, fts_q),
            ).fetchall()
        else:
            rows = conn.execute(
                f"""
                SELECT repo_rel_catdlg, dialog_name, title, filename, group_key, group_label
                FROM {T_CAA_DIALOG}
                WHERE file_status = ?
                ORDER BY group_key COLLATE NOCASE, filename COLLATE NOCASE
                """,
                (FILE_STATUS_PRESENT,),
            ).fetchall()
        meta = load_caa_index_meta(rr)

    groups_by_key: dict[str, dict[str, Any]] = {}
    for row in rows:
        group_key = str(row[4])
        group = groups_by_key.setdefault(
            group_key,
            {"groupKey": group_key, "label": str(row[5]), "items": []},
        )
        group["items"].append(
            {
                "catDlgRel": str(row[0]),
                "dialogName": str(row[1]),
                "title": str(row[2]),
                "fileName": str(row[3]),
                "groupKey": group_key,
                "groupLabel": str(row[5]),
            }
        )
    groups = list(groups_by_key.values())
    return {
        "indexed": bool(meta["last_scan_at"]),
        "last_scan_at": meta["last_scan_at"],
        "stats": meta.get("stats") or {},
        "count": sum(len(g["items"]) for g in groups),
        "groups": groups,
    }
