"""FileWorkset SQLite 读写。"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from phoenix.freecad.phoenix_store import connect
from phoenix.workset.schema import T_WORKSET, T_WORKSET_PATH


def load_worksets_from_db(repo_root: Path) -> list[dict[str, Any]]:
    rr = repo_root.expanduser().resolve(strict=False)
    with connect(rr) as conn:
        rows = conn.execute(
            f"""
            SELECT w.id, w.name, w.source, w.updated_at, p.repo_rel_path
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
                    "paths": [],
                }
                order.append(wid)
            rel = row["repo_rel_path"]
            if rel is not None:
                by_id[wid]["paths"].append(str(rel))
        return [by_id[wid] for wid in order]


def save_worksets_to_db(repo_root: Path, worksets: list[dict[str, Any]]) -> list[dict[str, Any]]:
    rr = repo_root.expanduser().resolve(strict=False)
    with connect(rr) as conn:
        conn.execute(f"DELETE FROM {T_WORKSET_PATH}")
        conn.execute(f"DELETE FROM {T_WORKSET}")
        for ws in worksets:
            wid = str(ws["id"])
            paths = ws.get("paths") if isinstance(ws.get("paths"), list) else []
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
            for i, rel in enumerate(paths):
                conn.execute(
                    f"""
                    INSERT INTO {T_WORKSET_PATH}(workset_id, repo_rel_path, sort_order)
                    VALUES (?, ?, ?)
                    """,
                    (wid, str(rel), i),
                )
    return worksets
