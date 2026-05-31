"""改名分析 — 服务层（扫描、持久化、写回修正）。"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from fcdesk.freecad.fcstd_mapping import normalize_repo_rel_path_for_map
from fcdesk.freecad.rename_analysis import (
    HostRefGroup,
    RenameAnalysisError,
    XLinkBasenameHit,
    analyze_workspace_xlink_refs,
    apply_host_xlink_corrections,
)
from fcdesk.freecad.phoenix_store import (
    get_rename_log,
    insert_ref_patch_event,
    load_ref_hits_for_rename,
    mark_ref_hits_applied,
    replace_ref_hits_for_rename_scan,
)
from fcdesk.services.fcstd_map_service import get_fcstd_map_prefs, resolve_scan_root


def analyze_rename_references(
    repo_root: Path,
    *,
    rename_log_id: int | None = None,
    old_basename: str | None = None,
    new_basename: str | None = None,
    exclude_repo_rel: str | None = None,
    persist: bool = True,
) -> dict[str, Any]:
    """改名分析：扫描仍引用旧 basename 的 XLink 宿主。

    - 提供 ``rename_log_id``：按改名记录分析，可选写入 ``ref_hit`` 表。
    - 或同时提供 ``old_basename`` / ``new_basename``：预览分析（``persist=False``）。
    """
    rr = repo_root.expanduser().resolve(strict=False)
    if rename_log_id is not None:
        row = get_rename_log(rr, rename_log_id)
        if row is None:
            raise ValueError(f"未找到改名记录 #{rename_log_id}")
        old_basename = row["old_basename"]
        new_basename = row["new_basename"]
        exclude_repo_rel = exclude_repo_rel or row["new_repo_rel_path"]
    else:
        if not old_basename or not new_basename:
            raise ValueError("请提供 rename_log_id，或同时提供 old_basename 与 new_basename")

    prefs = get_fcstd_map_prefs(rr)
    scan_root = resolve_scan_root(rr, prefs.get("scan_root") if isinstance(prefs.get("scan_root"), str) else None)

    groups = analyze_workspace_xlink_refs(
        rr,
        old_basename=old_basename,
        new_basename=new_basename,
        scan_root=scan_root,
        exclude_repo_rel=exclude_repo_rel,
    )

    payload = _groups_to_payload(groups, rename_log_id=rename_log_id)

    if persist and rename_log_id is not None:
        flat_hits = []
        for host in payload["hosts"]:
            host_rel = _norm_host_path(host["host_repo_rel_path"])
            for hit in host["hits"]:
                flat_hits.append(
                    {
                        "host_repo_rel_path": host_rel,
                        "matched_text": hit["matched_text"],
                        "proposed_text": hit["proposed_text"],
                    }
                )
        return replace_ref_hits_for_rename_scan(rr, rename_log_id=rename_log_id, hits=flat_hits)

    return payload


def apply_rename_analysis_corrections(
    repo_root: Path,
    *,
    rename_log_id: int,
    host_repo_rel_paths: list[str],
) -> dict[str, Any]:
    """按分析结果，对勾选的宿主文件写回 XLink 修正。"""
    rr = repo_root.expanduser().resolve(strict=False)
    row = get_rename_log(rr, rename_log_id)
    if row is None:
        raise ValueError(f"未找到改名记录 #{rename_log_id}")

    scan = load_ref_hits_for_rename(rr, rename_log_id)
    host_map = {h["host_repo_rel_path"]: h for h in scan.get("hosts", [])}
    selected = [_norm_host_path(p) for p in host_repo_rel_paths if p.strip()]
    if not selected:
        raise ValueError("请至少选择一个宿主文件")

    applied_hosts: list[str] = []
    failed: list[dict[str, str]] = []
    total_patches = 0

    for host_rel in selected:
        host_data = host_map.get(host_rel)
        if host_data is None:
            failed.append({"host_repo_rel_path": host_rel, "error": "未找到扫描命中"})
            continue
        hits = [
            XLinkBasenameHit(
                host_repo_rel_path=host_rel,
                xlink_file_attr=str(h["matched_text"]),
                proposed_new_attr=str(h["proposed_text"]),
            )
            for h in host_data.get("hits", [])
            if h.get("status") != "applied"
        ]
        if not hits:
            continue
        try:
            n = apply_host_xlink_corrections(rr, host_rel, hits)
            total_patches += n
            applied_hosts.append(host_rel)
        except (RenameAnalysisError, OSError) as ex:
            failed.append({"host_repo_rel_path": host_rel, "error": str(ex)})

    if applied_hosts:
        mark_ref_hits_applied(rr, rename_log_id=rename_log_id, host_repo_rel_paths=applied_hosts)
        insert_ref_patch_event(
            rr,
            stats={
                "rename_log_id": rename_log_id,
                "hosts": len(applied_hosts),
                "xlink_patches": total_patches,
                "failed": len(failed),
            },
        )

    refreshed = load_ref_hits_for_rename(rr, rename_log_id)
    return {
        "rename_log_id": rename_log_id,
        "applied_hosts": applied_hosts,
        "failed": failed,
        "xlink_patches": total_patches,
        "scan": refreshed,
    }


def load_rename_analysis(repo_root: Path, rename_log_id: int) -> dict[str, Any]:
    """读取某次改名的记录与已保存的分析结果。"""
    rr = repo_root.expanduser().resolve(strict=False)
    row = get_rename_log(rr, rename_log_id)
    if row is None:
        raise ValueError(f"未找到改名记录 #{rename_log_id}")
    scan = load_ref_hits_for_rename(rr, rename_log_id)
    return {"rename_log": row, "scan": scan}


# 兼容旧 API 名
scan_rename_references = analyze_rename_references
apply_rename_reference_patches = apply_rename_analysis_corrections
load_rename_scan_display = load_rename_analysis


def _norm_host_path(path: str) -> str:
    return normalize_repo_rel_path_for_map(path.replace("\\", "/").strip())


def _groups_to_payload(groups: list[HostRefGroup], *, rename_log_id: int | None) -> dict[str, Any]:
    hosts: list[dict[str, Any]] = []
    for g in groups:
        host_rel = _norm_host_path(g.host_repo_rel_path)
        hosts.append(
            {
                "host_repo_rel_path": host_rel,
                "host_filename": g.host_filename,
                "hit_count": g.hit_count,
                "hits": [
                    {
                        "matched_text": h.xlink_file_attr,
                        "proposed_text": h.proposed_new_attr,
                        "status": "pending",
                    }
                    for h in g.hits
                ],
            }
        )
    return {
        "rename_log_id": rename_log_id,
        "host_count": len(hosts),
        "hit_count": sum(h["hit_count"] for h in hosts),
        "hosts": hosts,
    }
