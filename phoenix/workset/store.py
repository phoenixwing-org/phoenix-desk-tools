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
            f"SELECT id, name, source, updated_at FROM {T_WORKSET} ORDER BY name, id"
        ).fetchall()
        out: list[dict[str, Any]] = []
        for row in rows:
            wid = str(row["id"])
            path_rows = conn.execute(
                f"""
                SELECT repo_rel_path FROM {T_WORKSET_PATH}
                WHERE workset_id = ?
                ORDER BY sort_order, repo_rel_path
                """,
                (wid,),
            ).fetchall()
            out.append(
                {
                    "id": wid,
                    "name": str(row["name"]),
                    "source": str(row["source"] or ""),
                    "updated_at": str(row["updated_at"]),
                    "paths": [str(p["repo_rel_path"]) for p in path_rows],
                }
            )
        return out


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
