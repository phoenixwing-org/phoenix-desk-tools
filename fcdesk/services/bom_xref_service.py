"""BOM XLink 引用关系 — 构建与查询（读 SQLite，不写回 FCStd）。"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any

from fcdesk.config.user_prefs import format_resolved_under_workspace
from fcdesk.freecad.bom_xref.extract import list_fcstd_xlink_attrs_from_file
from fcdesk.freecad.bom_xref.resolve import resolve_xlink_target
from fcdesk.freecad.cad_index_types import is_fcstd_filename
from fcdesk.freecad.fcstd_mapping import normalize_repo_rel_path_for_map
from fcdesk.freecad.phoenix_store import (
    cad_database_path,
    delete_bom_xrefs_for_hosts,
    ensure_fcstd_scan_record,
    get_file_asset_id,
    get_last_fcstd_scan_id,
    insert_bom_xref_edges,
    list_present_fcstd_file_assets,
    load_bom_xref_meta,
    query_all_bom_xref_edges,
    query_bom_xrefs_for_rename_basename,
    query_bom_xrefs_incoming,
    query_bom_xrefs_outgoing,
    replace_bom_xrefs,
    find_present_repo_rel_by_filename,
)
from fcdesk.freecad.phoenix_store import _norm_key
from fcdesk.freecad.rename_analysis.types import HostRefGroup, RenameAnalysisError, XLinkBasenameHit
from fcdesk.freecad.rename_analysis.xlink import (
    preferred_xlink_attr_for_target,
    replace_basename_in_xlink_attr,
    xlink_attr_matches_target,
)


def rebuild_bom_xrefs(repo_root: Path, *, scan_id: int, scan_root: Path) -> dict[str, Any]:
    """在 CAD 索引扫描后，从各 FCStd 提取 XLink 并写入 ``bom_xref`` 表。"""
    from fcdesk.services.fcstd_map_service import scan_cad_basename_map

    rr = repo_root.expanduser().resolve(strict=False)
    root = scan_root.expanduser().resolve(strict=False)
    basename_map = scan_cad_basename_map(root, anchor=rr)
    assets = list_present_fcstd_file_assets(rr)
    path_to_id = {a["repo_rel_path"]: a["id"] for a in assets}

    edges: list[dict[str, Any]] = []
    for asset in assets:
        edges.extend(
            _bom_xref_edges_for_host(
                rr,
                asset,
                basename_map=basename_map,
                path_to_id=path_to_id,
            )
        )

    stats = replace_bom_xrefs(rr, scan_id=scan_id, edges=edges)
    return {
        "scan_id": scan_id,
        "database_path": str(cad_database_path(rr)),
        "database_path_display": format_resolved_under_workspace(cad_database_path(rr), rr),
        **stats,
    }


def _bom_xref_edges_for_host(
    repo_root: Path,
    asset: dict[str, Any],
    *,
    basename_map: dict[str, list[str]],
    path_to_id: dict[str, int],
) -> list[dict[str, Any]]:
    host_rel = asset["repo_rel_path"]
    host_path = repo_root / host_rel
    if not host_path.is_file():
        return []

    edges: list[dict[str, Any]] = []
    for xlink in list_fcstd_xlink_attrs_from_file(host_path):
        target_base = Path(xlink.replace("\\", "/")).name
        resolved = resolve_xlink_target(
            repo_root=repo_root,
            host_repo_rel=host_rel,
            xlink_file_attr=xlink,
            basename_map=basename_map,
        )
        target_rel = resolved.target_repo_rel_path
        target_id = path_to_id.get(target_rel) if target_rel else None
        if target_id is None and target_rel:
            target_id = get_file_asset_id(repo_root, target_rel)

        detail = None
        if resolved.candidate_paths:
            detail = {"candidates": list(resolved.candidate_paths)}

        edges.append(
            {
                "host_file_asset_id": asset["id"],
                "host_repo_rel_path": host_rel,
                "xlink_file_attr": xlink,
                "target_basename": target_base,
                "target_file_asset_id": target_id,
                "target_repo_rel_path": target_rel,
                "resolve_status": resolved.resolve_status,
                "detail_json": detail,
            }
        )
    return edges


def refresh_bom_xrefs_for_hosts(repo_root: Path, host_repo_rel_paths: list[str]) -> dict[str, Any]:
    """XLink 写回后，从磁盘重读指定宿主的引用边并更新 ``bom_xref``。"""
    from fcdesk.config.user_prefs import load_workspace_prefs
    from fcdesk.services.fcstd_map_service import resolve_scan_root, scan_cad_basename_map

    rr = repo_root.expanduser().resolve(strict=False)
    hosts = [_norm_xref_path(p) or str(p).strip() for p in host_repo_rel_paths if str(p).strip()]
    hosts = sorted({h for h in hosts if h})
    if not hosts:
        return {"updated_hosts": 0, "edge_count": 0}

    ensure_bom_xref_built(rr)
    scan_id = ensure_fcstd_scan_record(rr) or get_last_fcstd_scan_id(rr)
    if scan_id is None:
        return {"updated_hosts": 0, "edge_count": 0}

    ws_pref = load_workspace_prefs(rr).get("fcstd_map") or {}
    scan_root = resolve_scan_root(rr, ws_pref.get("scan_root"))
    basename_map = scan_cad_basename_map(scan_root, anchor=rr)
    path_to_id = {a["repo_rel_path"]: a["id"] for a in list_present_fcstd_file_assets(rr)}

    delete_bom_xrefs_for_hosts(rr, hosts)
    edges: list[dict[str, Any]] = []
    updated = 0
    for host_rel in hosts:
        asset_id = get_file_asset_id(rr, host_rel)
        if asset_id is None:
            continue
        asset = {"id": asset_id, "repo_rel_path": host_rel}
        host_edges = _bom_xref_edges_for_host(
            rr,
            asset,
            basename_map=basename_map,
            path_to_id=path_to_id,
        )
        if host_edges:
            updated += 1
        edges.extend(host_edges)

    stats = insert_bom_xref_edges(rr, scan_id=scan_id, edges=edges)
    return {"updated_hosts": updated, **stats}


def load_bom_xref_payload(repo_root: Path) -> dict[str, Any]:
    rr = repo_root.expanduser().resolve(strict=False)
    meta = load_bom_xref_meta(rr)
    db = cad_database_path(rr)
    return {
        "database_path": str(db),
        "database_path_display": format_resolved_under_workspace(db, rr),
        **meta,
    }


_GRAPH_TARGET_STATUSES = frozenset({"resolved", "ambiguous", "self"})


def _looks_like_exact_basename(name: str) -> bool:
    lower = name.casefold()
    return lower.endswith(".fcstd") and "/" not in name and "\\" not in name


def _norm_xref_path(path: str | None) -> str | None:
    if not path:
        return None
    return normalize_repo_rel_path_for_map(str(path).replace("\\", "/").strip())


def _build_xref_parent_map(edges: list[dict[str, Any]]) -> dict[str, set[str]]:
    """``target_repo_rel_path`` → 直接引用它的宿主集合。"""
    parents: dict[str, set[str]] = {}
    for edge in edges:
        target = _norm_xref_path(edge.get("target_repo_rel_path"))
        if not target or edge.get("resolve_status") not in _GRAPH_TARGET_STATUSES:
            continue
        host = _norm_xref_path(edge.get("host_repo_rel_path"))
        if not host:
            continue
        parents.setdefault(target, set()).add(host)
    return parents


def _resolve_incoming_target_paths(
    repo_root: Path,
    *,
    repo_rel: str | None,
    basename: str | None,
    edges: list[dict[str, Any]],
) -> set[str]:
    """根据查询条件，确定传递闭包的起始目标路径集合。"""
    targets: set[str] = set()
    rel = _norm_xref_path(repo_rel)
    base = (basename or "").strip()

    if rel:
        targets.add(rel)

    if base:
        base_fold = base.casefold()
        exact = _looks_like_exact_basename(base)
        for edge in edges:
            target_name = str(edge.get("target_basename", ""))
            if exact:
                if target_name.casefold() != base_fold:
                    continue
            elif base_fold not in target_name.casefold():
                continue
            path = _norm_xref_path(edge.get("target_repo_rel_path"))
            if path and edge.get("resolve_status") in _GRAPH_TARGET_STATUSES:
                targets.add(path)

    if rel and not targets:
        asset_id = get_file_asset_id(repo_root, rel)
        if asset_id is not None:
            for edge in edges:
                if edge.get("target_file_asset_id") == asset_id:
                    path = _norm_xref_path(edge.get("target_repo_rel_path"))
                    if path:
                        targets.add(path)

    return targets


def _direct_refs_for_host(
    direct_rows: list[dict[str, Any]],
    host: str,
) -> list[dict[str, Any]]:
    key = _norm_xref_path(host) or host
    return [r for r in direct_rows if _norm_xref_path(r.get("host_repo_rel_path")) == key]


def fetch_rename_ref_rows(
    repo_root: Path,
    *,
    old_basename: str,
    exclude_repo_rel: str | None = None,
    limit: int = 500,
) -> list[dict[str, Any]]:
    """改名分析：全库按 basename 查引用边（不依赖 target_repo_rel）。"""
    base = old_basename.strip()
    if not base:
        return []
    cap = max(1, min(int(limit), 2000))
    rows = query_bom_xrefs_for_rename_basename(repo_root, base, limit=cap)
    if exclude_repo_rel:
        exclude_key = _norm_key(exclude_repo_rel)
        rows = [r for r in rows if _norm_key(r["host_repo_rel_path"]) != exclude_key]
    return rows


def _find_unique_basename_path(repo_root: Path, basename: str) -> str | None:
    rel = find_present_repo_rel_by_filename(repo_root, basename)
    return _norm_xref_path(rel) if rel else None


def fetch_incoming_direct_rows(
    repo_root: Path,
    *,
    repo_rel: str | None = None,
    basename: str | None = None,
    exclude_repo_rel: str | None = None,
    limit: int = 500,
) -> list[dict[str, Any]]:
    """统一入向查询：直接引用边（BOM 引用 / 改名分析共用）。"""
    rel = (repo_rel or "").strip() or None
    base = (basename or "").strip() or None
    cap = max(1, min(int(limit), 2000))
    if base and not rel:
        return fetch_rename_ref_rows(
            repo_root,
            old_basename=base,
            exclude_repo_rel=exclude_repo_rel,
            limit=cap,
        )
    lookup_rel = rel
    lookup_base = base if not rel else None
    rows = query_bom_xrefs_incoming(
        repo_root,
        repo_rel=lookup_rel,
        basename=lookup_base,
        limit=cap,
    )
    if exclude_repo_rel:
        exclude_key = _norm_key(exclude_repo_rel)
        rows = [r for r in rows if _norm_key(r["host_repo_rel_path"]) != exclude_key]
    return rows


def _filter_incoming_result(
    incoming: dict[str, Any],
    *,
    exclude_repo_rel: str | None,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    refs = list(incoming.get("refs") or [])
    hosts = list(incoming.get("hosts") or [])
    if not exclude_repo_rel:
        return refs, hosts
    exclude_key = _norm_key(exclude_repo_rel)
    refs = [r for r in refs if _norm_key(r["host_repo_rel_path"]) != exclude_key]
    hosts = [h for h in hosts if _norm_key(h["host_repo_rel_path"]) != exclude_key]
    return refs, hosts


def _merge_incoming_ref_rows(
    direct_rows: list[dict[str, Any]],
    host_entries: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    merged: dict[tuple[str, str], dict[str, Any]] = {}
    for row in direct_rows:
        host = str(row.get("host_repo_rel_path") or "")
        attr = str(row.get("xlink_file_attr") or "")
        merged[(host, attr)] = row
    for entry in host_entries:
        for row in entry.get("direct_refs") or []:
            host = str(row.get("host_repo_rel_path") or "")
            attr = str(row.get("xlink_file_attr") or "")
            merged[(host, attr)] = row
    return list(merged.values())


def resolve_incoming_host_entries(
    repo_root: Path,
    *,
    repo_rel: str | None,
    basename: str | None,
    direct_rows: list[dict[str, Any]],
    transitive: bool = True,
    limit: int = 500,
) -> list[dict[str, Any]]:
    """统一入向宿主列表：可选传递闭包（与 ``search_incoming_refs`` / 改名分析一致）。"""
    cap = max(1, min(int(limit), 2000))
    if not transitive:
        return [
            {
                "host_repo_rel_path": _norm_xref_path(r["host_repo_rel_path"]) or r["host_repo_rel_path"],
                "depth": 0,
                "usage_kind": "direct",
                "via_chain": [],
                "direct_refs": [r],
            }
            for r in direct_rows
        ]

    edges = query_all_bom_xref_edges(repo_root)
    parents = _build_xref_parent_map(edges)
    target_paths = _resolve_incoming_target_paths(
        repo_root,
        repo_rel=repo_rel,
        basename=basename,
        edges=edges,
    )
    if not target_paths:
        for row in direct_rows:
            path = _norm_xref_path(row.get("target_repo_rel_path"))
            if path:
                target_paths.add(path)

    return _transitive_incoming_hosts(
        target_paths=target_paths,
        parents=parents,
        direct_rows=direct_rows,
        limit=cap,
    )


def _transitive_incoming_hosts(
    *,
    target_paths: set[str],
    parents: dict[str, set[str]],
    direct_rows: list[dict[str, Any]],
    limit: int,
) -> list[dict[str, Any]]:
    """沿装配层级向上：子装配引用的零件，总装配也应算作入向宿主。"""
    if not target_paths:
        return []

    hosts_out: list[dict[str, Any]] = []
    visited: set[str] = set()
    queue: list[tuple[str, int, list[str]]] = []

    for target in sorted(target_paths):
        for host in sorted(parents.get(target, set())):
            queue.append((host, 0, []))

    while queue and len(hosts_out) < limit:
        host, depth, via_chain = queue.pop(0)
        host_key = _norm_xref_path(host) or host
        if host_key in visited:
            continue
        visited.add(host_key)

        direct_refs = _direct_refs_for_host(direct_rows, host_key)
        hosts_out.append(
            {
                "host_repo_rel_path": host_key,
                "depth": depth,
                "usage_kind": "direct" if depth == 0 else "indirect",
                "via_chain": list(via_chain),
                "direct_refs": direct_refs,
            }
        )

        for upper in sorted(parents.get(host_key, set())):
            if upper not in visited:
                queue.append((upper, depth + 1, [host_key, *via_chain]))

    return hosts_out


def search_incoming_refs(
    repo_root: Path,
    *,
    repo_rel: str | None = None,
    basename: str | None = None,
    limit: int = 500,
    transitive: bool = True,
) -> dict[str, Any]:
    rel = (repo_rel or "").strip() or None
    base = (basename or "").strip() or None
    if not rel and not base:
        raise ValueError("请提供 repo_rel 或 basename")

    cap = max(1, min(int(limit), 2000))
    direct_rows = fetch_incoming_direct_rows(
        repo_root,
        repo_rel=rel,
        basename=base,
        limit=cap,
    )
    hosts = resolve_incoming_host_entries(
        repo_root,
        repo_rel=rel,
        basename=base,
        direct_rows=direct_rows,
        transitive=transitive,
        limit=cap,
    )

    return {
        "query": {"repo_rel": rel, "basename": base, "transitive": transitive},
        "count": len(hosts),
        "direct_count": sum(1 for h in hosts if h.get("depth", 0) == 0),
        "refs": direct_rows,
        "hosts": hosts,
    }


def search_outgoing_refs(
    repo_root: Path,
    host_repo_rel: str,
    *,
    limit: int = 500,
) -> dict[str, Any]:
    rel = host_repo_rel.strip()
    if not rel:
        raise ValueError("请提供 host_repo_rel")
    rows = query_bom_xrefs_outgoing(repo_root, rel, limit=limit)
    return {
        "host_repo_rel_path": rel,
        "count": len(rows),
        "refs": rows,
    }


def host_ref_groups_from_db(
    repo_root: Path,
    *,
    old_basename: str,
    new_basename: str,
    exclude_repo_rel: str | None = None,
    target_repo_rel: str | None = None,
    new_repo_rel_path: str | None = None,
    transitive: bool = True,
    limit: int = 500,
) -> list[HostRefGroup]:
    """从 ``bom_xref`` 构建改名分析用的宿主分组（与 ``search_incoming_refs`` 同源）。"""
    ensure_bom_xref_built(repo_root)
    base = old_basename.strip()
    if not base:
        return []

    incoming = search_incoming_refs(
        repo_root,
        basename=base,
        repo_rel=None,
        transitive=transitive,
        limit=limit,
    )
    direct_rows, host_entries = _filter_incoming_result(
        incoming,
        exclude_repo_rel=exclude_repo_rel,
    )
    ref_rows = _merge_incoming_ref_rows(direct_rows, host_entries)
    if not ref_rows and not host_entries:
        return []

    canon_old = _find_unique_basename_path(repo_root, base) or _norm_xref_path(target_repo_rel)
    new_target_repo_rel = (
        _norm_xref_path(new_repo_rel_path)
        or _find_unique_basename_path(repo_root, new_basename.strip())
        or _resolve_new_target_repo_rel(
            target_repo_rel=canon_old,
            old_basename=old_basename,
            new_basename=new_basename,
        )
    )
    hit_map = _build_rename_hit_map(
        repo_root,
        ref_rows,
        old_basename=old_basename,
        new_basename=new_basename,
        target_repo_rel=canon_old,
        new_target_repo_rel=new_target_repo_rel,
        list_all_matches=True,
    )

    if not transitive:
        return _host_groups_from_hit_map(hit_map)

    entry_meta = {
        _norm_xref_path(e["host_repo_rel_path"]) or e["host_repo_rel_path"]: e for e in host_entries
    }

    out: list[HostRefGroup] = []
    out_keys: set[str] = set(hit_map.keys())
    for entry in host_entries:
        k = _norm_xref_path(entry["host_repo_rel_path"]) or entry["host_repo_rel_path"]
        out_keys.add(k)

    for host_key in sorted(out_keys):
        hits = hit_map.get(host_key, [])
        meta = entry_meta.get(host_key, {})
        out.append(
            HostRefGroup(
                host_repo_rel_path=host_key,
                host_filename=Path(host_key).name,
                hits=tuple(hits),
                depth=int(meta.get("depth") or 0),
                usage_kind=str(meta.get("usage_kind") or ("direct" if hits else "indirect")),
                via_chain=tuple(meta.get("via_chain") or []),
            )
        )
    return out


def _resolve_new_target_repo_rel(
    *,
    target_repo_rel: str | None,
    old_basename: str,
    new_basename: str,
) -> str | None:
    rel = _norm_xref_path(target_repo_rel)
    old = old_basename.strip()
    new = new_basename.strip()
    if old.casefold() == new.casefold():
        return rel
    if rel and Path(rel).name.casefold() == old.casefold():
        return _norm_xref_path(str(Path(rel).with_name(new)))
    return None


def _build_rename_hit_map(
    repo_root: Path,
    rows: list[dict[str, Any]],
    *,
    old_basename: str,
    new_basename: str,
    target_repo_rel: str | None = None,
    new_target_repo_rel: str | None = None,
    list_all_matches: bool = False,
) -> dict[str, list[XLinkBasenameHit]]:
    """按**文件名**匹配 XLink；目录与目标不一致时也列入待修正（可同时改 basename 与相对路径）。"""
    grouped: dict[str, list[XLinkBasenameHit]] = {}
    old = old_basename.strip()
    new = new_basename.strip()
    renaming = old.casefold() != new.casefold()
    canon = _norm_xref_path(target_repo_rel)
    global_new_target = new_target_repo_rel or (
        _norm_xref_path(str(Path(canon).with_name(new))) if canon and renaming else canon
    )

    for row in rows:
        host = _norm_xref_path(row["host_repo_rel_path"]) or str(row["host_repo_rel_path"])
        old_attr = str(row["xlink_file_attr"])
        attr_base = Path(old_attr.replace("\\", "/")).name
        if attr_base.casefold() != old.casefold():
            continue

        row_target = _norm_xref_path(row.get("target_repo_rel_path"))
        desired_target = global_new_target
        if not desired_target and row_target and renaming:
            desired_target = _norm_xref_path(str(Path(row_target).with_name(new)))
        elif not desired_target:
            desired_target = row_target or canon

        check_target = row_target or canon or desired_target
        proposed: str | None = None

        if desired_target:
            try:
                expected_attr = preferred_xlink_attr_for_target(repo_root, host, desired_target)
            except (OSError, ValueError):
                expected_attr = None
            if expected_attr and expected_attr != old_attr:
                needs_path_fix = (
                    renaming
                    or not check_target
                    or not xlink_attr_matches_target(repo_root, host, old_attr, check_target)
                )
                if needs_path_fix:
                    proposed = expected_attr

        if proposed is None and renaming:
            proposed = replace_basename_in_xlink_attr(old_attr, old, new)

        if not proposed or proposed == old_attr:
            if list_all_matches:
                proposed = old_attr
            else:
                continue

        grouped.setdefault(host, []).append(
            XLinkBasenameHit(
                host_repo_rel_path=host,
                xlink_file_attr=old_attr,
                proposed_new_attr=proposed,
            )
        )
    return grouped


def _host_groups_from_hit_map(hit_map: dict[str, list[XLinkBasenameHit]]) -> list[HostRefGroup]:
    out: list[HostRefGroup] = []
    for host in sorted(hit_map.keys()):
        hits = hit_map[host]
        if not hits:
            continue
        out.append(
            HostRefGroup(
                host_repo_rel_path=host,
                host_filename=Path(host).name,
                hits=tuple(hits),
            )
        )
    return out


def _enrich_tree_node(repo_root: Path, node: dict[str, Any]) -> None:
    from fcdesk.freecad.phoenix_store import connect, format_part_key, infer_part_file_role

    rel = str(node.get("repo_rel_path") or "").strip()
    if not rel:
        return
    rr = repo_root.expanduser().resolve(strict=False)
    with connect(rr) as conn:
        row = conn.execute(
            """
            SELECT fa.filename, fa.part_number, fa.part_version, fa.type_code,
                   fa.model_series, fa.part_name, fa.label, pfl.file_role
            FROM file_asset fa
            LEFT JOIN part_file_link pfl ON pfl.file_asset_id = fa.id
            WHERE fa.repo_rel_path = ?
            LIMIT 1
            """,
            (rel,),
        ).fetchone()
    if row is None:
        node["file_role"] = infer_part_file_role(node.get("basename") or Path(rel).name)
        return
    pn = str(row["part_number"] or "").strip()
    pv = str(row["part_version"] or "").strip()
    node["part_number"] = pn
    node["part_version"] = pv
    node["part_key"] = format_part_key(pn, pv) if pn and pv else ""
    node["TypeCode"] = str(row["type_code"] or "")
    node["ModelSeries"] = str(row["model_series"] or "")
    node["PartName"] = str(row["part_name"] or "")
    node["label"] = str(row["label"] or "")
    node["file_role"] = str(row["file_role"] or infer_part_file_role(str(row["filename"] or "")))


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


def load_assembly_tree(
    repo_root: Path,
    host_repo_rel: str,
    *,
    full: bool = False,
    max_depth: int = 16,
    limit_per_host: int = 500,
) -> dict[str, Any]:
    """从 ``bom_xref`` 读取装配的直接或完整下级树。"""
    ensure_bom_xref_built(repo_root)
    host = normalize_repo_rel_path_for_map(host_repo_rel.strip())
    if not host:
        raise ValueError("请提供 host_repo_rel")

    def build_level(rel: str, depth: int, stack: frozenset[str]) -> list[dict[str, Any]]:
        key = _norm_xref_path(rel) or rel
        if key in stack:
            return []

        rows = query_bom_xrefs_outgoing(repo_root, key, limit=limit_per_host)
        nodes: list[dict[str, Any]] = []
        seen_targets: set[str] = set()
        next_stack = stack | {key}

        for row in rows:
            status = str(row.get("resolve_status") or "")
            if status not in _GRAPH_TARGET_STATUSES:
                continue
            target_rel = _norm_xref_path(row.get("target_repo_rel_path"))
            if not target_rel or target_rel in seen_targets:
                continue
            seen_targets.add(target_rel)

            node: dict[str, Any] = {
                "repo_rel_path": target_rel,
                "basename": str(row.get("target_basename") or Path(target_rel).name),
                "resolve_status": status,
                "xlink_file_attr": str(row.get("xlink_file_attr") or ""),
                "part_number": "",
                "part_version": "",
                "part_key": "",
                "TypeCode": "",
                "ModelSeries": "",
                "PartName": "",
                "label": "",
                "file_role": "",
                "children": [],
            }
            _enrich_tree_node(repo_root, node)

            if full and depth < max_depth:
                child_rows = query_bom_xrefs_outgoing(repo_root, target_rel, limit=limit_per_host)
                has_sub = any(
                    str(r.get("resolve_status") or "") in _GRAPH_TARGET_STATUSES
                    and _norm_xref_path(r.get("target_repo_rel_path"))
                    for r in child_rows
                )
                if has_sub:
                    node["children"] = build_level(target_rel, depth + 1, next_stack)

            nodes.append(node)

        return nodes

    nodes = build_level(host, 0, frozenset())
    _assign_tree_node_ids(nodes)
    return {
        "host_repo_rel_path": host,
        "mode": "full" if full else "first",
        "node_count": _count_tree_nodes(nodes),
        "nodes": nodes,
    }


def ensure_bom_xref_built(repo_root: Path) -> None:
    """若引用表未构建但已有 CAD 索引，则按上次扫描自动重建。"""
    meta = load_bom_xref_meta(repo_root)
    if meta.get("last_bom_xref_at"):
        return
    scan_id = ensure_fcstd_scan_record(repo_root)
    if scan_id is None:
        raise RenameAnalysisError(
            "BOM 引用表尚未构建。请先在「CAD 索引」页执行工程内搜索。"
        )
    try:
        rebuild_bom_xrefs_from_last_scan(repo_root)
    except ValueError as ex:
        raise RenameAnalysisError(str(ex)) from ex


def ensure_bom_xref_index(repo_root: Path) -> None:
    ensure_bom_xref_built(repo_root)


def rebuild_bom_xrefs_from_last_scan(repo_root: Path) -> dict[str, Any]:
    """在已有 CAD 索引扫描记录上，仅重建 BOM 引用表（不重扫 BOM 属性）。"""
    from fcdesk.config.user_prefs import load_workspace_prefs
    from fcdesk.services.fcstd_map_service import resolve_scan_root

    rr = repo_root.expanduser().resolve(strict=False)
    scan_id = ensure_fcstd_scan_record(rr)
    if scan_id is None:
        raise ValueError("请先执行 CAD 索引扫描")
    ws_pref = load_workspace_prefs(rr).get("fcstd_map") or {}
    scan_root = resolve_scan_root(rr, ws_pref.get("scan_root"))
    if not scan_root.is_dir():
        raise ValueError(f"扫描根不是有效目录: {scan_root}")
    return rebuild_bom_xrefs(rr, scan_id=scan_id, scan_root=scan_root)
