"""装配树预计算：一次加载 ``phoenix_cad_bom_xref`` 邻接表在内存展开，结果 JSON 缓存到 SQLite。"""

from __future__ import annotations

import json
from collections import defaultdict
from pathlib import Path
from typing import Any, Mapping

from fcdesk.freecad.fcstd_mapping import (
    infer_part_key_from_filename,
    normalize_repo_rel_path_for_map,
)
from fcdesk.freecad.phoenix_store import (
    _norm_key,
    clear_bom_assembly_cache,
    connect,
    format_part_key,
    infer_part_file_role,
    load_bom_assembly_cache,
    load_bom_xref_meta,
    query_all_bom_xref_edges_enriched,
    save_bom_assembly_cache,
)
from fcdesk.services.cad_index import norm_xref_path as _norm_xref_path

# 与 bom_xref_service 装配树展示一致
_ASSEMBLY_TREE_STATUSES = frozenset({"resolved", "ambiguous", "self", "missing"})


def _xref_adjacency(edges: list[dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    adj: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for edge in edges:
        host = _norm_key(str(edge["host_repo_rel_path"]))
        adj[host].append(edge)
    return adj


def _group_host_edges(
    rows: list[dict[str, Any]],
) -> list[tuple[str, list[dict[str, Any]]]]:
    grouped: dict[str, list[dict[str, Any]]] = {}
    group_order: list[str] = []
    for row in rows:
        status = str(row.get("resolve_status") or "")
        if status not in _ASSEMBLY_TREE_STATUSES:
            continue
        target_rel = _norm_xref_path(row.get("target_repo_rel_path"))
        attr = str(row.get("xlink_file_attr") or "").strip()
        if target_rel:
            group_key = f"target:{target_rel}"
        elif status == "missing" and attr:
            group_key = f"missing:{attr}"
        elif status == "ambiguous" and attr:
            group_key = f"ambiguous:{attr}"
        else:
            continue
        if group_key not in grouped:
            grouped[group_key] = []
            group_order.append(group_key)
        grouped[group_key].append(row)
    return [(k, grouped[k]) for k in group_order]


def _node_from_row_group(
    host_key: str,
    row_group: list[dict[str, Any]],
    *,
    tree_path: str,
) -> dict[str, Any]:
    from pathlib import Path

    first_row = row_group[0]
    target_rel = _norm_xref_path(first_row.get("target_repo_rel_path"))
    status = str(first_row.get("resolve_status") or "")
    xref_instances: list[dict[str, str]] = []
    link_labels: list[str] = []
    for r in row_group:
        r_attr = str(r.get("xlink_file_attr") or "")
        lbl = str(r.get("link_label") or "").strip()
        xref_instances.append({"xlink_file_attr": r_attr, "link_label": lbl})
        if lbl:
            link_labels.append(lbl)

    rule_label = str(first_row.get("rule_label") or "").strip() if target_rel else ""
    attr = str(first_row.get("xlink_file_attr") or "")
    basename = str(first_row.get("target_basename") or "").strip()
    if not basename and attr:
        basename = Path(attr.replace("\\", "/")).name
    if not basename:
        basename = "（缺失引用）"

    return {
        "host_repo_rel": host_key,
        "repo_rel_path": target_rel or "",
        "basename": basename,
        "resolve_status": status,
        "xlink_file_attr": attr,
        "link_label": link_labels[0] if link_labels else "",
        "link_labels": link_labels,
        "xref_instances": xref_instances,
        "rule_label": rule_label,
        "ref_count": len(row_group),
        "tree_path": tree_path,
        "part_number": str(first_row.get("target_part_number") or ""),
        "part_version": str(first_row.get("target_part_version") or ""),
        "part_key": "",
        "TypeCode": str(first_row.get("target_type_code") or ""),
        "ModelSeries": str(first_row.get("target_model_series") or ""),
        "PartName": str(first_row.get("target_part_name") or ""),
        "label": str(first_row.get("target_asset_label") or ""),
        "file_role": "",
        "children": [],
    }


def _apply_part_key(node: dict[str, Any]) -> None:
    pn = str(node.get("part_number") or "").strip()
    pv = str(node.get("part_version") or "").strip()
    if pn and pv:
        node["part_key"] = format_part_key(pn, pv)
    else:
        base = str(node.get("basename") or "").strip()
        if base:
            ipn, ipv = infer_part_key_from_filename(base)
            if ipn and ipv:
                node["part_number"] = ipn
                node["part_version"] = ipv
                node["part_key"] = format_part_key(ipn, ipv)
    rel = str(node.get("repo_rel_path") or "").strip()
    node["file_role"] = infer_part_file_role(
        Path(rel).name if rel else str(node.get("basename") or ""),
    )


def _batch_enrich_file_roles(repo_root: Path, nodes: list[dict[str, Any]]) -> None:
    """对仍缺索引字段的节点做一次 IN 查询（整棵树仅一条 SQL）。"""
    need: list[dict[str, Any]] = []
    for n in nodes:
        if n.get("repo_rel_path") and not n.get("TypeCode") and not n.get("part_number"):
            need.append(n)
    if not need:
        for n in nodes:
            _apply_part_key(n)
        return

    keys = sorted({_norm_key(str(n["repo_rel_path"])) for n in need})
    rr = repo_root.expanduser().resolve(strict=False)
    placeholders = ",".join("?" * len(keys))
    with connect(rr) as conn:
        rows = conn.execute(
            f"""
            SELECT fa.repo_rel_path, fa.filename, fa.part_number, fa.part_version,
                   fa.type_code, fa.model_series, fa.part_name, fa.label,
                   pfl.file_role
            FROM phoenix_cad_file_asset fa
            LEFT JOIN phoenix_cad_part_file_link pfl ON pfl.file_asset_id = fa.id
            WHERE fa.repo_rel_path IN ({placeholders})
            """,
            keys,
        ).fetchall()
    by_rel = {str(r["repo_rel_path"]): r for r in rows}
    for n in nodes:
        rel = _norm_key(str(n.get("repo_rel_path") or ""))
        row = by_rel.get(rel)
        if row:
            pn = str(row["part_number"] or "").strip()
            pv = str(row["part_version"] or "").strip()
            n["part_number"] = pn
            n["part_version"] = pv
            n["part_key"] = format_part_key(pn, pv) if pn and pv else ""
            n["TypeCode"] = str(row["type_code"] or "")
            n["ModelSeries"] = str(row["model_series"] or "")
            n["PartName"] = str(row["part_name"] or "")
            n["label"] = str(row["label"] or "")
            n["file_role"] = str(row["file_role"] or infer_part_file_role(str(row["filename"] or "")))
        _apply_part_key(n)


def _flatten_nodes(nodes: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []

    def walk(ns: list[dict[str, Any]]) -> None:
        for n in ns:
            out.append(n)
            walk(n.get("children") or [])

    walk(nodes)
    return out


def _build_level(
    adj: dict[str, list[dict[str, Any]]],
    host_rel: str,
    *,
    depth: int,
    stack: frozenset[str],
    full: bool,
    max_depth: int,
    parent_path: str,
) -> list[dict[str, Any]]:
    key = _norm_xref_path(host_rel) or _norm_key(host_rel) or host_rel
    if key in stack:
        return []

    host_rows = adj.get(key, [])
    if not host_rows:
        host_rows = adj.get(_norm_key(host_rel), [])

    nodes: list[dict[str, Any]] = []
    next_stack = stack | {key}

    for idx, (_group_key, row_group) in enumerate(_group_host_edges(host_rows)):
        if not row_group:
            continue
        tree_path = f"{parent_path}.{idx + 1}" if parent_path else str(idx + 1)
        node = _node_from_row_group(key, row_group, tree_path=tree_path)
        _apply_part_key(node)

        target_rel = _norm_xref_path(row_group[0].get("target_repo_rel_path"))
        if full and depth < max_depth and target_rel:
            child_key = _norm_xref_path(target_rel) or target_rel
            if child_key not in next_stack:
                child_edges = adj.get(child_key, [])
                if any(
                    str(e.get("resolve_status") or "") in _ASSEMBLY_TREE_STATUSES
                    for e in child_edges
                ):
                    node["children"] = _build_level(
                        adj,
                        child_key,
                        depth=depth + 1,
                        stack=next_stack,
                        full=True,
                        max_depth=max_depth,
                        parent_path=tree_path,
                    )

        nodes.append(node)

    return nodes


def _assign_tree_node_ids(nodes: list[dict[str, Any]], *, prefix: str = "") -> None:
    for index, node in enumerate(nodes):
        rel = str(node.get("repo_rel_path") or index)
        node_id = f"{prefix}{index}:{rel}"
        node["id"] = node_id
        children = node.get("children") or []
        if children:
            _assign_tree_node_ids(children, prefix=f"{node_id}/")


def _count_tree_nodes(nodes: list[dict[str, Any]]) -> int:
    total = len(nodes)
    for node in nodes:
        total += _count_tree_nodes(node.get("children") or [])
    return total


def build_assembly_tree_payload(
    repo_root: Path,
    host_repo_rel: str,
    *,
    full: bool = False,
    max_depth: int = 16,
) -> dict[str, Any]:
    """从预加载邻接表构建装配树（无递归 SQL / 无按层读盘）。"""
    host = normalize_repo_rel_path_for_map(host_repo_rel.strip())
    if not host:
        raise ValueError("请提供 host_repo_rel")

    edges, _ = query_all_bom_xref_edges_enriched(repo_root)
    adj = _xref_adjacency(edges)
    nodes = _build_level(
        adj,
        host,
        depth=0,
        stack=frozenset(),
        full=full,
        max_depth=max_depth,
        parent_path="",
    )
    flat = _flatten_nodes(nodes)
    _batch_enrich_file_roles(repo_root, flat)
    _assign_tree_node_ids(nodes)
    return {
        "host_repo_rel_path": host,
        "mode": "full" if full else "first",
        "node_count": _count_tree_nodes(nodes),
        "nodes": nodes,
    }


def load_assembly_tree_cached(
    repo_root: Path,
    host_repo_rel: str,
    *,
    full: bool = False,
    max_depth: int = 16,
) -> dict[str, Any]:
    """优先读 JSON 缓存；失效时一次查表构建并写回。"""
    host = normalize_repo_rel_path_for_map(host_repo_rel.strip())
    if not host:
        raise ValueError("请提供 host_repo_rel")

    mode = "full" if full else "first"
    xref_at = str(load_bom_xref_meta(repo_root).get("last_bom_xref_at") or "")
    cached, _ = load_bom_assembly_cache(repo_root, host, mode)
    if cached and cached.get("bom_xref_at") == xref_at and xref_at:
        return {
            "host_repo_rel_path": host,
            "mode": mode,
            "node_count": int(cached.get("node_count") or 0),
            "nodes": cached["nodes"],
            "cached": True,
        }

    payload = build_assembly_tree_payload(
        repo_root,
        host,
        full=full,
        max_depth=max_depth,
    )
    save_bom_assembly_cache(
        repo_root,
        host,
        mode,
        nodes=payload["nodes"],
        node_count=int(payload["node_count"]),
        bom_xref_at=xref_at,
    )
    payload["cached"] = False
    return payload


# 供索引重建后失效
invalidate_assembly_cache = clear_bom_assembly_cache
