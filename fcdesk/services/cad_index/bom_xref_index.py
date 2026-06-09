"""BOM 引用表（``bom_xref``）索引构建：全量重建、按宿主增量、子树多级。"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from fcdesk.config.user_prefs import format_resolved_under_workspace
from fcdesk.freecad.bom_xref.extract import (
    list_fcstd_xlink_attrs_from_file,
    list_xlink_file_attrs,
    read_document_xml_from_fcstd,
)
from fcdesk.freecad.rename_analysis.xlink import read_reference_labels_by_xlink_attr
from fcdesk.freecad.bom_xref.resolve import resolve_xlink_target
from fcdesk.freecad.cad_index_types import is_fcstd_filename
from fcdesk.freecad.fcstd_mapping import normalize_repo_rel_path_for_map
from fcdesk.freecad.phoenix_store import (
    cad_database_path,
    delete_bom_xrefs_for_hosts,
    ensure_fcstd_scan_record,
    get_file_asset_id,
    insert_bom_xref_edges,
    list_present_fcstd_file_assets,
    load_bom_xref_meta,
    query_bom_xrefs_outgoing,
    replace_bom_xrefs,
)
from fcdesk.freecad.rename_analysis.types import RenameAnalysisError
from fcdesk.services.cad_index.common import GRAPH_TARGET_STATUSES, norm_xref_path
from fcdesk.services.cad_index.context import load_bom_xref_index_context
from fcdesk.services.cad_index.scan_paths import scan_cad_basename_map


def _format_bom_xref_rebuild_log(
    *,
    repo_root: Path,
    scan_root: Path,
    scan_id: int,
    host_files: int,
    hosts_with_xlink: int,
    stats: dict[str, int],
    prev_edge_count: int = 0,
    prev_host_count: int = 0,
) -> str:
    """人类可读的 BOM 引用表重建摘要。"""
    rr = repo_root.expanduser().resolve(strict=False)
    root = scan_root.expanduser().resolve(strict=False)
    hosts_no_xlink = max(0, host_files - hosts_with_xlink)
    lines = [
        "重建内容: bom_xref 引用表（清空后按 CAD 索引重写）",
        "提取方式: 读取各 FCStd 的 Document.xml · XLink file 属性",
        f"扫描根: {format_resolved_under_workspace(root, rr)}",
        f"CAD 索引 scan_id: {scan_id}",
        "",
        f"读取 FCStd（present）: {host_files} 个",
        f"  · 含出向 XLink: {hosts_with_xlink} 个宿主",
        f"  · 无出向 XLink: {hosts_no_xlink} 个",
        "",
        f"写入引用边: {stats['edge_count']} 条 · 涉及宿主 {stats['host_count']} 个",
        f"  · 目标已解析: {stats['target_resolved']}",
        f"  · 目标歧义: {stats['target_ambiguous']}",
        f"  · 目标缺失/非 FCStd: {stats['target_missing']}",
    ]
    if prev_edge_count or prev_host_count:
        lines.extend(
            [
                "",
                f"较上次: 边 {prev_edge_count} → {stats['edge_count']}"
                f" · 宿主 {prev_host_count} → {stats['host_count']}",
            ]
        )
    lines.extend(
        [
            "",
            f"数据库: {format_resolved_under_workspace(cad_database_path(rr), rr)}",
        ]
    )
    return "\n".join(lines)


def bom_xref_edges_for_host(
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

    xml = read_document_xml_from_fcstd(host_path)
    if not xml:
        return []
    label_by_attr = read_reference_labels_by_xlink_attr(xml)
    edges: list[dict[str, Any]] = []
    for xlink in list_xlink_file_attrs(xml):
        if not xlink.lower().endswith(".fcstd"):
            continue
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
                "link_label": label_by_attr.get(xlink, ""),
                "target_basename": target_base,
                "target_file_asset_id": target_id,
                "target_repo_rel_path": target_rel,
                "resolve_status": resolved.resolve_status,
                "detail_json": detail,
            }
        )
    return edges


def discover_fcstd_subtree_hosts(
    repo_root: Path,
    root_host: str,
    *,
    basename_map: dict[str, list[str]],
    path_to_id: dict[str, int],
    recursive: bool = True,
    max_hosts: int = 64,
) -> list[str]:
    """自宿主起 BFS：沿磁盘 XLink 收集需刷新 ``bom_xref`` 的 FCStd 宿主（多级引用索引）。"""
    rr = repo_root.expanduser().resolve(strict=False)
    root = norm_xref_path(root_host) or root_host.strip()
    if not root:
        return []

    queue: list[str] = [root]
    seen: set[str] = set()
    order: list[str] = []

    while queue and len(order) < max(1, max_hosts):
        host = queue.pop(0)
        if host in seen:
            continue
        seen.add(host)
        order.append(host)

        if not recursive:
            continue

        host_path = (rr / host).resolve(strict=False)
        if not host_path.is_file() or not is_fcstd_filename(host_path.name):
            continue

        for xlink in list_fcstd_xlink_attrs_from_file(host_path):
            resolved = resolve_xlink_target(
                repo_root=rr,
                host_repo_rel=host,
                xlink_file_attr=xlink,
                basename_map=basename_map,
            )
            target_rel = norm_xref_path(resolved.target_repo_rel_path)
            if not target_rel or not is_fcstd_filename(Path(target_rel).name):
                continue
            if resolved.resolve_status not in GRAPH_TARGET_STATUSES:
                continue
            if target_rel not in seen and target_rel not in queue:
                queue.append(target_rel)

    return order


def rebuild_bom_xrefs(repo_root: Path, *, scan_id: int, scan_root: Path) -> dict[str, Any]:
    """在 CAD 索引扫描后，从各 FCStd 提取 XLink 并写入 ``bom_xref`` 表。"""
    rr = repo_root.expanduser().resolve(strict=False)
    root = scan_root.expanduser().resolve(strict=False)
    prev = load_bom_xref_meta(rr)
    basename_map = scan_cad_basename_map(root, anchor=rr)
    assets = list_present_fcstd_file_assets(rr)
    path_to_id = {a["repo_rel_path"]: a["id"] for a in assets}

    edges: list[dict[str, Any]] = []
    for asset in assets:
        edges.extend(
            bom_xref_edges_for_host(
                rr,
                asset,
                basename_map=basename_map,
                path_to_id=path_to_id,
            )
        )

    hosts_with_xlink = len({e["host_repo_rel_path"] for e in edges})
    stats = replace_bom_xrefs(rr, scan_id=scan_id, edges=edges)
    from fcdesk.services.bom_tree_occurrence import rebuild_bom_tree_occurrences

    occ_stats = rebuild_bom_tree_occurrences(rr)
    stats = {**stats, **occ_stats}
    log = _format_bom_xref_rebuild_log(
        repo_root=rr,
        scan_root=root,
        scan_id=scan_id,
        host_files=len(assets),
        hosts_with_xlink=hosts_with_xlink,
        stats=stats,
        prev_edge_count=int(prev.get("edge_count") or 0),
        prev_host_count=int(prev.get("host_count") or 0),
    )
    return {
        "scan_id": scan_id,
        "database_path": str(cad_database_path(rr)),
        "database_path_display": format_resolved_under_workspace(cad_database_path(rr), rr),
        "host_files_scanned": len(assets),
        "hosts_with_xlink": hosts_with_xlink,
        "hosts_without_xlink": max(0, len(assets) - hosts_with_xlink),
        **stats,
        "log": log,
    }


def refresh_bom_xrefs_for_hosts(repo_root: Path, host_repo_rel_paths: list[str]) -> dict[str, Any]:
    """XLink 写回后，从磁盘重读指定宿主的引用边并更新 ``bom_xref``。"""
    rr = repo_root.expanduser().resolve(strict=False)
    hosts = [norm_xref_path(p) or str(p).strip() for p in host_repo_rel_paths if str(p).strip()]
    hosts = sorted({h for h in hosts if h})
    if not hosts:
        return {"updated_hosts": 0, "edge_count": 0}

    ctx = load_bom_xref_index_context(rr, require_scan_id=False)
    scan_id = ctx.scan_id
    if scan_id is None:
        return {"updated_hosts": 0, "edge_count": 0}

    delete_bom_xrefs_for_hosts(rr, hosts)
    edges: list[dict[str, Any]] = []
    updated = 0
    for host_rel in hosts:
        asset_id = get_file_asset_id(rr, host_rel)
        if asset_id is None:
            continue
        asset = {"id": asset_id, "repo_rel_path": host_rel}
        host_edges = bom_xref_edges_for_host(
            rr,
            asset,
            basename_map=ctx.basename_map,
            path_to_id=ctx.path_to_id,
        )
        if host_edges:
            updated += 1
        edges.extend(host_edges)

    stats = insert_bom_xref_edges(rr, scan_id=scan_id, edges=edges)
    return {"updated_hosts": updated, **stats}


def refresh_bom_xref_index_for_host(
    repo_root: Path,
    host_repo_rel: str,
    *,
    recursive: bool = True,
    max_hosts: int = 64,
) -> dict[str, Any]:
    """仅重建指定宿主（及可选下级 FCStd）的出向引用索引，不重扫 CAD 属性表。"""
    rr = repo_root.expanduser().resolve(strict=False)
    host = normalize_repo_rel_path_for_map(host_repo_rel.strip().replace("\\", "/"))
    if not host:
        raise ValueError("请提供宿主路径")

    host_path = (rr / host).resolve(strict=False)
    if not host_path.is_file():
        raise ValueError(f"宿主文件不存在: {format_resolved_under_workspace(host_path, rr)}")
    if not is_fcstd_filename(host_path.name):
        raise ValueError("宿主须为 .FCStd 文件")

    ensure_bom_xref_built(rr)
    ctx = load_bom_xref_index_context(rr)

    hosts = discover_fcstd_subtree_hosts(
        rr,
        host,
        basename_map=ctx.basename_map,
        path_to_id=ctx.path_to_id,
        recursive=recursive,
        max_hosts=max_hosts,
    )
    refresh_stats = refresh_bom_xrefs_for_hosts(rr, hosts)

    root_rows, _ = query_bom_xrefs_outgoing(rr, host, limit=500)
    status_counts: dict[str, int] = {}
    for row in root_rows:
        st = str(row.get("resolve_status") or "unknown")
        status_counts[st] = status_counts.get(st, 0) + 1

    return {
        "host_repo_rel_path": host,
        "recursive": recursive,
        "hosts_refreshed": len(hosts),
        "hosts": hosts,
        "outgoing_count": len(root_rows),
        "outgoing_missing": status_counts.get("missing", 0),
        "outgoing_ambiguous": status_counts.get("ambiguous", 0),
        "outgoing_resolved": status_counts.get("resolved", 0) + status_counts.get("self", 0),
        "status_counts": status_counts,
        **refresh_stats,
        "log": (
            f"已重建引用索引：宿主 {len(hosts)} 个"
            f"（{'含下级' if recursive else '仅本文件'}）\n"
            f"本文件出向 {len(root_rows)} 条 · "
            f"已解析 {status_counts.get('resolved', 0) + status_counts.get('self', 0)} · "
            f"歧义 {status_counts.get('ambiguous', 0)} · "
            f"缺失 {status_counts.get('missing', 0)}"
        ),
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
    ctx = load_bom_xref_index_context(repo_root, require_scan_id=True)
    scan_id = ctx.scan_id
    if scan_id is None:
        raise ValueError("请先执行 CAD 索引扫描")
    return rebuild_bom_xrefs(ctx.repo_root, scan_id=scan_id, scan_root=ctx.scan_root)
