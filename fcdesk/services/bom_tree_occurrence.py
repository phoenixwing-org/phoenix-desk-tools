"""BOM 树物化路径：预展开各总成的 full 树，便于统计「被引用次数 / 出现位置」。"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from fcdesk.freecad.phoenix_store import (
    _meta_get,
    _meta_set,
    _norm_key,
    _utc_now_iso,
    cad_database_path,
    clear_bom_assembly_cache,
    connect,
    query_assembly_bom_hosts,
)
from fcdesk.services.assembly_tree_cache import build_assembly_tree_payload


def flatten_tree_occurrences(
    root_host: str,
    nodes: list[dict[str, Any]],
    *,
    parent_host: str,
    parent_path: str = "",
    depth: int = 1,
    out: list[dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    """将装配树 JSON 压平为带 ``tree_path``（如 ``1.2.3``）的出现行。"""
    if out is None:
        out = []
    root_key = _norm_key(root_host)
    parent_key = _norm_key(parent_host)

    for index, node in enumerate(nodes):
        tree_path = f"{parent_path}.{index + 1}" if parent_path else str(index + 1)
        target_rel = _norm_key(str(node.get("repo_rel_path") or "").strip()) or ""
        out.append(
            {
                "root_host_repo_rel_path": root_key,
                "tree_path": tree_path,
                "depth": depth,
                "host_repo_rel_path": parent_key,
                "target_repo_rel_path": target_rel,
                "xlink_file_attr": str(node.get("xlink_file_attr") or ""),
                "link_label": str(node.get("link_label") or ""),
            }
        )
        children = node.get("children") or []
        if children and target_rel:
            flatten_tree_occurrences(
                root_key,
                children,
                parent_host=target_rel,
                parent_path=tree_path,
                depth=depth + 1,
                out=out,
            )
    return out


def rebuild_bom_tree_occurrences(repo_root: Path) -> dict[str, Any]:
    """引用表重建后：为每个总成展开 full 树并写入 ``bom_tree_occurrence``。"""
    rr = repo_root.expanduser().resolve(strict=False)
    if not cad_database_path(rr).is_file():
        return {"root_count": 0, "occurrence_count": 0}

    hosts, _ = query_assembly_bom_hosts(rr)
    now = _utc_now_iso()
    rows: list[dict[str, Any]] = []

    for host_row in hosts:
        root = str(host_row["host_repo_rel_path"])
        try:
            payload = build_assembly_tree_payload(rr, root, full=True)
        except (OSError, ValueError):
            continue
        flatten_tree_occurrences(
            root,
            payload.get("nodes") or [],
            parent_host=root,
            out=rows,
        )

    with connect(rr) as conn:
        conn.execute("DELETE FROM bom_tree_occurrence")
        if rows:
            conn.executemany(
                """
                INSERT INTO bom_tree_occurrence (
                    root_host_repo_rel_path, tree_path, depth,
                    host_repo_rel_path, target_repo_rel_path,
                    xlink_file_attr, link_label, built_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                [
                    (
                        r["root_host_repo_rel_path"],
                        r["tree_path"],
                        int(r["depth"]),
                        r["host_repo_rel_path"],
                        r["target_repo_rel_path"] or None,
                        r["xlink_file_attr"],
                        r["link_label"],
                        now,
                    )
                    for r in rows
                ],
            )
        _meta_set(conn, "last_bom_tree_occurrence_at", now)
        _meta_set(conn, "last_bom_tree_occurrence_xref_at", _meta_get(conn, "last_bom_xref_at") or "")

    clear_bom_assembly_cache(rr)
    return {
        "root_count": len(hosts),
        "occurrence_count": len(rows),
    }


def query_target_usage_stats(repo_root: Path, target_repo_rel: str) -> dict[str, Any]:
    """某文件被引用统计：直接宿主数 + BOM 树中出现次数（物化路径）。"""
    rr = repo_root.expanduser().resolve(strict=False)
    key = _norm_key(target_repo_rel.strip())
    if not key or not cad_database_path(rr).is_file():
        return {
            "target_repo_rel_path": key,
            "direct_incoming_host_count": 0,
            "bom_occurrence_count": 0,
            "bom_root_count": 0,
            "occurrences": [],
        }

    with connect(rr) as conn:
        direct_row = conn.execute(
            """
            SELECT COUNT(DISTINCT host_repo_rel_path) AS n
            FROM bom_xref
            WHERE target_repo_rel_path = ?
            """,
            (key,),
        ).fetchone()
        occ_row = conn.execute(
            """
            SELECT COUNT(*) AS slots, COUNT(DISTINCT root_host_repo_rel_path) AS roots
            FROM bom_tree_occurrence
            WHERE target_repo_rel_path = ?
            """,
            (key,),
        ).fetchone()
        occ_rows = conn.execute(
            """
            SELECT root_host_repo_rel_path, tree_path, host_repo_rel_path, link_label
            FROM bom_tree_occurrence
            WHERE target_repo_rel_path = ?
            ORDER BY root_host_repo_rel_path, tree_path
            LIMIT 200
            """,
            (key,),
        ).fetchall()

    return {
        "target_repo_rel_path": key,
        "direct_incoming_host_count": int(direct_row["n"]) if direct_row else 0,
        "bom_occurrence_count": int(occ_row["slots"]) if occ_row else 0,
        "bom_root_count": int(occ_row["roots"]) if occ_row else 0,
        "occurrences": [
            {
                "root_host_repo_rel_path": str(r["root_host_repo_rel_path"]),
                "tree_path": str(r["tree_path"]),
                "host_repo_rel_path": str(r["host_repo_rel_path"]),
                "link_label": str(r["link_label"] or ""),
            }
            for r in occ_rows
        ],
    }


def query_incoming_host_counts_for_targets(
    repo_root: Path,
    target_paths: list[str],
) -> dict[str, int]:
    """批量：各 ``target_repo_rel_path`` 的直接入向宿主数（来自 ``bom_xref``）。"""
    rr = repo_root.expanduser().resolve(strict=False)
    keys = sorted({_norm_key(p) for p in target_paths if str(p).strip()})
    if not keys or not cad_database_path(rr).is_file():
        return {}
    placeholders = ",".join("?" * len(keys))
    with connect(rr) as conn:
        rows = conn.execute(
            f"""
            SELECT target_repo_rel_path, COUNT(DISTINCT host_repo_rel_path) AS n
            FROM bom_xref
            WHERE target_repo_rel_path IN ({placeholders})
            GROUP BY target_repo_rel_path
            """,
            keys,
        ).fetchall()
    return {str(r["target_repo_rel_path"]): int(r["n"]) for r in rows}
