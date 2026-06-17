"""BOM XLink 引用关系查询（读 SQLite）；索引构建见 ``fcdesk.services.cad_index``。"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any

from fcdesk.config.user_prefs import format_resolved_under_workspace
from fcdesk.freecad.fcstd_mapping import normalize_repo_rel_path_for_map
from fcdesk.freecad.phoenix_store import (
    cad_database_path,
    get_file_asset_id,
    load_bom_xref_meta,
    query_all_bom_xref_edges,
    query_assembly_bom_hosts,
    query_bom_xref_counts_for_rel,
    query_bom_xref_edges_paged,
    query_bom_xrefs_for_rename_basename,
    query_bom_xrefs_incoming,
    query_bom_xrefs_outgoing,
    query_bom_xrefs_outgoing_enriched,
    find_present_repo_rel_by_filename,
)
from fcdesk.freecad.phoenix_store import _norm_key
from fcdesk.freecad.rename_analysis.types import HostRefGroup, RenameAnalysisError, XLinkBasenameHit
from fcdesk.freecad.rename_analysis.xlink import (
    patch_fcstd_reference_labels_explicit,
    preferred_xlink_attr_for_target,
    replace_basename_in_xlink_attr,
    xlink_attr_matches_target,
)
from fcdesk.services.cad_index import (
    GRAPH_TARGET_STATUSES as _GRAPH_TARGET_STATUSES,
    ensure_bom_xref_built,
    ensure_bom_xref_index,
    norm_xref_path as _norm_xref_path,
    rebuild_bom_xrefs,
    rebuild_bom_xrefs_from_last_scan,
    refresh_bom_xref_index_for_host,
    refresh_bom_xrefs_for_hosts,
)

# 装配树在 resolved/ambiguous/self 之外也展示 missing，便于在层级里对照断链
_ASSEMBLY_TREE_STATUSES = _GRAPH_TARGET_STATUSES | frozenset({"missing"})

__all__ = [
    "apply_explicit_link_labels",
    "ensure_bom_xref_built",
    "ensure_bom_xref_index",
    "host_ref_groups_from_db",
    "load_assembly_bom_catalog",
    "load_assembly_tree",
    "load_bom_xref_payload",
    "rebuild_bom_xrefs",
    "rebuild_bom_xrefs_from_last_scan",
    "refresh_bom_xref_index_for_host",
    "refresh_bom_xrefs_for_hosts",
    "search_bom_xref_edges",
    "search_file_detail_xrefs",
    "search_incoming_refs",
    "search_outgoing_refs",
    "query_xref_counts_for_rel",
]


def load_target_usage_stats(repo_root: Path, target_repo_rel: str) -> dict[str, Any]:
    from fcdesk.services.bom_tree_occurrence import query_target_usage_stats

    ensure_bom_xref_built(repo_root)
    return query_target_usage_stats(repo_root, target_repo_rel)


def load_assembly_bom_catalog(
    repo_root: Path,
    *,
    search: str | None = None,
) -> dict[str, Any]:
    """总成列表：单次 SQL 聚合，不含逐条引用边。"""
    ensure_bom_xref_built(repo_root)
    hosts, total, _ = query_assembly_bom_hosts(repo_root, search=search)
    return {
        "count": total,
        "hosts": hosts,
        "filter": {
            "assembly_only": True,
            "exclude_drawings": True,
            "note": "含 .assy.fcstd 或出向引用≥2；详情请在文件详情·装配结构查看",
        },
    }


def load_bom_xref_payload(repo_root: Path) -> dict[str, Any]:
    rr = repo_root.expanduser().resolve(strict=False)
    meta = load_bom_xref_meta(rr)
    db = cad_database_path(rr)
    return {
        "database_path": str(db),
        "database_path_display": format_resolved_under_workspace(db, rr),
        **meta,
    }


def _looks_like_exact_basename(name: str) -> bool:
    lower = name.casefold()
    return lower.endswith(".fcstd") and "/" not in name and "\\" not in name


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
    rows, _ = query_bom_xrefs_incoming(
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

    edges, _ = query_all_bom_xref_edges(repo_root)
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


def _enrich_xref_row_display(row: dict[str, Any]) -> None:
    """展示字段仅来自 ``bom_xref`` 冗余列（``link_label`` / ``rule_label``），查询不 JOIN、不读盘。"""
    link_label = str(row.get("link_label") or "").strip()
    rule_label = str(row.get("rule_label") or "").strip()
    row["link_label"] = link_label
    row["rule_label"] = rule_label
    row["label_mismatch"] = bool(
        link_label and rule_label and link_label != rule_label
    )


def bom_xref_index_is_built(repo_root: Path) -> bool:
    meta = load_bom_xref_meta(repo_root)
    return bool(meta.get("last_bom_xref_at"))


def query_xref_counts_for_rel(repo_root: Path, repo_rel: str) -> dict[str, int]:
    """文件详情角标：出向 + 直接入向（单条 SQL）。"""
    counts, _ = query_bom_xref_counts_for_rel(repo_root, repo_rel)
    return counts


def empty_xref_counts_payload() -> dict[str, int]:
    return {"outgoing_count": 0, "direct_incoming_count": 0}


def _slim_incoming_hosts(hosts: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """入向列表精简字段（不含 ``direct_refs``，避免重复大块 JSON）。"""
    return [
        {
            "host_repo_rel_path": h["host_repo_rel_path"],
            "depth": h.get("depth", 0),
            "usage_kind": h.get("usage_kind", "direct"),
            "via_chain": list(h.get("via_chain") or []),
        }
        for h in hosts
    ]


def search_file_detail_xrefs(
    repo_root: Path,
    repo_rel: str,
    *,
    limit: int = 500,
    transitive: bool = False,
    refresh_disk: bool = False,
    scope: str = "both",
) -> dict[str, Any]:
    """文件详情「引用」Tab：``scope`` 为 outgoing / incoming / both（可拆分请求）。"""
    rel = repo_rel.strip()
    if not rel:
        raise ValueError("请提供 repo_rel")
    want_out = scope in ("both", "outgoing")
    want_in = scope in ("both", "incoming")
    payload: dict[str, Any] = {
        "rel": rel,
        "incoming": {"count": 0, "direct_count": 0, "hosts": []},
        "outgoing": {"count": 0, "label_mismatch_count": 0, "refs": []},
    }
    if not bom_xref_index_is_built(repo_root):
        return {**payload, "index_pending": True}
    if refresh_disk and want_out:
        refresh_bom_xrefs_for_hosts(repo_root, [rel])
    if want_out:
        outgoing = search_outgoing_refs(
            repo_root, rel, limit=limit, refresh_disk=False
        )
        payload["outgoing"] = {
            "count": outgoing["count"],
            "label_mismatch_count": outgoing.get("label_mismatch_count", 0),
            "refs": outgoing["refs"],
        }
    if want_in:
        incoming = search_incoming_refs(
            repo_root,
            repo_rel=rel,
            transitive=transitive,
            limit=limit,
        )
        payload["incoming"] = {
            "count": incoming["count"],
            "direct_count": incoming.get("direct_count", incoming["count"]),
            "hosts": _slim_incoming_hosts(incoming.get("hosts") or []),
        }
    return payload


def search_outgoing_refs(
    repo_root: Path,
    host_repo_rel: str,
    *,
    limit: int = 500,
    refresh_disk: bool = False,
) -> dict[str, Any]:
    rel = host_repo_rel.strip()
    if not rel:
        raise ValueError("请提供 host_repo_rel")
    if refresh_disk:
        refresh_bom_xrefs_for_hosts(repo_root, [rel])
    rows, _ = query_bom_xrefs_outgoing_enriched(repo_root, rel, limit=limit)
    for row in rows:
        _enrich_xref_row_display(row)
    mismatch_count = sum(1 for r in rows if r.get("label_mismatch"))
    return {
        "host_repo_rel_path": rel,
        "count": len(rows),
        "label_mismatch_count": mismatch_count,
        "refs": rows,
    }


def _enrich_paged_bom_xref_rows(
    _repo_root: Path,
    rows: list[dict[str, Any]],
    *,
    include_labels: bool,
) -> None:
    del include_labels  # 保留 API 参数；链接标签一律来自 bom_xref 索引列
    for row in rows:
        _enrich_xref_row_display(row)


def search_bom_xref_edges(
    repo_root: Path,
    *,
    offset: int = 0,
    limit: int = 100,
    search: str | None = None,
    include_labels: bool = False,
) -> dict[str, Any]:
    """分页返回全部 ``bom_xref`` 引用边（子件快照与标签已冗余在表内）。"""
    ensure_bom_xref_built(repo_root)
    cap = max(1, min(int(limit), 500))
    off = max(0, int(offset))
    rows, total = query_bom_xref_edges_paged(
        repo_root,
        offset=off,
        limit=cap,
        search=search,
    )
    _enrich_paged_bom_xref_rows(repo_root, rows, include_labels=include_labels)
    return {
        "offset": off,
        "limit": cap,
        "total": total,
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
    refresh_disk: bool = False,
    max_depth: int = 16,
    limit_per_host: int = 500,
) -> dict[str, Any]:
    """从预计算的 ``bom_xref`` 邻接表 + JSON 缓存加载装配树（无逐层递归查库）。"""
    del limit_per_host  # 保留参数兼容；构图一次加载全表
    from fcdesk.services.assembly_tree_cache import load_assembly_tree_cached

    ensure_bom_xref_built(repo_root)
    host = normalize_repo_rel_path_for_map(host_repo_rel.strip())
    if refresh_disk and host:
        refresh_bom_xrefs_for_hosts(repo_root, [host])
    if not host:
        raise ValueError("请提供 host_repo_rel")
    return load_assembly_tree_cached(
        repo_root,
        host,
        full=full,
        max_depth=max_depth,
    )


def apply_explicit_link_labels(
    repo_root: Path,
    patches: list[dict[str, str]],
) -> dict[str, Any]:
    """按宿主 + XLink 属性手工写回引用实例 Label。"""
    rr = repo_root.expanduser().resolve(strict=False)
    by_host: dict[str, dict[str, str]] = {}
    for raw in patches:
        host = str(raw.get("host_repo_rel") or "").strip().replace("\\", "/")
        attr = str(raw.get("xlink_file_attr") or "").strip()
        label = str(raw.get("link_label") if raw.get("link_label") is not None else "")
        if not host or not attr:
            continue
        by_host.setdefault(host, {})[attr] = label

    if not by_host:
        raise ValueError("无有效的 Label 修改")

    applied_hosts: list[str] = []
    failed: list[dict[str, str]] = []
    total_patches = 0
    label_changes: list[dict[str, str]] = []
    for host, attr_labels in sorted(by_host.items()):
        path = (rr / host).resolve(strict=False)
        if not path.is_file():
            failed.append({"host_repo_rel": host, "error": "宿主文件不存在"})
            continue
        try:
            n, changes = patch_fcstd_reference_labels_explicit(path, attr_labels)
            if n > 0:
                total_patches += n
                applied_hosts.append(host)
                for ch in changes:
                    label_changes.append(
                        {
                            "host_repo_rel": host,
                            "xlink_file_attr": ch.get("xlink_file_attr", ""),
                            "old_label": ch.get("old_label", ""),
                            "new_label": ch.get("new_label", ""),
                        }
                    )
        except RenameAnalysisError as e:
            failed.append({"host_repo_rel": host, "error": str(e)})

    if applied_hosts:
        refresh_bom_xrefs_for_hosts(rr, applied_hosts)

    return {
        "label_patches": total_patches,
        "applied_hosts": applied_hosts,
        "failed": failed,
        "label_changes": label_changes,
    }

