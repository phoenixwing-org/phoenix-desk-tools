"""FileWorkset SQLite 读写。"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from phoenix.freecad.phoenix_store import connect
from phoenix.workset.schema import T_WORKSET, T_WORKSET_PATH


def load_worksets_from_db(repo_root: Path) -> list[dict[str, Any]]:
    rr = repo_root.expanduser().resolve(strict=False)
    with connect(rr) as conn:
        # 尝试读 entry_type，旧表无此列则回退
        cols = {r[1] for r in conn.execute(f"PRAGMA table_info({T_WORKSET_PATH})").fetchall()}
        has_entry_type = "entry_type" in cols
        type_expr = f"p.entry_type" if has_entry_type else "'file'"
        rows = conn.execute(
            f"""
            SELECT w.id, w.name, w.source, w.updated_at,
                   p.repo_rel_path, {type_expr} AS _type
            FROM {T_WORKSET} w
            LEFT JOIN {T_WORKSET_PATH} p ON p.workset_id = w.id
            ORDER BY w.name, w.id, p.sort_order, p.repo_rel_path
            """
        ).fetchall()
        by_id: dict[str, dict[str, Any]] = {}
        order: list[str] = []
        for row in rows:
            wid = str(row["id"])
            if wid not in by_id:
                by_id[wid] = {
                    "id": wid,
                    "name": str(row["name"]),
                    "source": str(row["source"] or ""),
                    "updated_at": str(row["updated_at"]),
                    "entries": [],
                }
                order.append(wid)
            rel = row["repo_rel_path"]
            if rel is not None:
                by_id[wid]["entries"].append({
                    "path": str(rel),
                    "type": str(row["_type"] or "file"),
                })
        return [by_id[wid] for wid in order]


def save_worksets_to_db(repo_root: Path, worksets: list[dict[str, Any]]) -> list[dict[str, Any]]:
    rr = repo_root.expanduser().resolve(strict=False)
    # 检查 entry_type 列是否存在
    with connect(rr) as conn:
        cols = {r[1] for r in conn.execute(f"PRAGMA table_info({T_WORKSET_PATH})").fetchall()}
    has_entry_type = "entry_type" in cols
    with connect(rr) as conn:
        conn.execute(f"DELETE FROM {T_WORKSET_PATH}")
        conn.execute(f"DELETE FROM {T_WORKSET}")
        for ws in worksets:
            wid = str(ws["id"])
            # 兼容旧 paths 和新 entries 格式
            entries = ws.get("entries") if isinstance(ws.get("entries"), list) else []
            if not entries:
                paths = ws.get("paths") if isinstance(ws.get("paths"), list) else []
                entries = [{"path": str(p), "type": "file"} for p in paths]
            conn.execute(
                f"""
                INSERT INTO {T_WORKSET}(id, name, source, updated_at)
                VALUES (?, ?, ?, ?)
                """,
                (
                    wid,
                    str(ws["name"]),
                    str(ws.get("source") or ""),
                    str(ws["updated_at"]),
                ),
            )
            for i, entry in enumerate(entries):
                path = str(entry["path"]) if isinstance(entry, dict) else str(entry)
                etype = str(entry.get("type") or "file") if isinstance(entry, dict) else "file"
                if has_entry_type:
                    conn.execute(
                        f"""
                        INSERT INTO {T_WORKSET_PATH}(workset_id, repo_rel_path, sort_order, entry_type)
                        VALUES (?, ?, ?, ?)
                        """,
                        (wid, path, i, etype),
                    )
                else:
                    conn.execute(
                        f"""
                        INSERT INTO {T_WORKSET_PATH}(workset_id, repo_rel_path, sort_order)
                        VALUES (?, ?, ?)
                        """,
                        (wid, path, i),
                    )
    return worksets
