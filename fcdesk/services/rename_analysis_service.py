"""改名分析 — 服务层（扫描、持久化、写回修正、报告）。"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from fcdesk.config.user_prefs import format_resolved_under_workspace
from fcdesk.freecad.fcstd_mapping import normalize_repo_rel_path_for_map
from fcdesk.freecad.phoenix_store import (
    cad_database_path,
    get_rename_log,
    insert_ref_patch_event,
    list_rename_logs,
    load_ref_hits_for_rename,
    mark_ref_hits_applied,
    replace_ref_hits_for_rename_scan,
)
from fcdesk.freecad.rename_analysis import (
    HostRefGroup,
    RenameAnalysisError,
    XLinkBasenameHit,
    apply_host_xlink_corrections,
    write_rename_analysis_report,
)
from fcdesk.services.bom_xref_service import host_ref_groups_from_db


def list_rename_logs_payload(repo_root: Path, *, limit: int = 50) -> dict[str, Any]:
    rr = repo_root.expanduser().resolve(strict=False)
    entries = list_rename_logs(rr, limit=limit)
    return {
        "database_path": str(cad_database_path(rr)),
        "database_path_display": format_resolved_under_workspace(cad_database_path(rr), rr),
        "entries": entries,
    }


def analyze_rename_references(
    repo_root: Path,
    *,
    rename_log_id: int | None = None,
    old_basename: str | None = None,
    new_basename: str | None = None,
    exclude_repo_rel: str | None = None,
    target_repo_rel: str | None = None,
    transitive: bool = True,
    persist: bool = True,
) -> dict[str, Any]:
    """改名分析：扫描仍引用旧 basename 的 XLink 宿主。"""
    rr = repo_root.expanduser().resolve(strict=False)
    old_basename, new_basename, exclude_repo_rel = _resolve_analysis_names(
        rr,
        rename_log_id=rename_log_id,
        old_basename=old_basename,
        new_basename=new_basename,
        exclude_repo_rel=exclude_repo_rel,
    )

    groups = host_ref_groups_from_db(
        rr,
        old_basename=old_basename,
        new_basename=new_basename,
        exclude_repo_rel=exclude_repo_rel,
        target_repo_rel=target_repo_rel,
        transitive=transitive,
    )
    payload = _groups_to_payload(
        groups,
        rename_log_id=rename_log_id,
        old_basename=old_basename,
        new_basename=new_basename,
        transitive=transitive,
    )

    if persist and rename_log_id is not None:
        flat_hits = _flatten_hosts(payload["hosts"])
        stored = replace_ref_hits_for_rename_scan(rr, rename_log_id=rename_log_id, hits=flat_hits)
        stored["old_basename"] = old_basename
        stored["new_basename"] = new_basename
        return stored

    return payload


def apply_rename_analysis_corrections(
    repo_root: Path,
    *,
    rename_log_id: int | None = None,
    old_basename: str | None = None,
    new_basename: str | None = None,
    exclude_repo_rel: str | None = None,
    target_repo_rel: str | None = None,
    transitive: bool = True,
    host_repo_rel_paths: list[str],
) -> dict[str, Any]:
    """按分析结果，对勾选的宿主文件写回 XLink 修正。"""
    rr = repo_root.expanduser().resolve(strict=False)
    selected = [_norm_host_path(p) for p in host_repo_rel_paths if p.strip()]
    if not selected:
        raise ValueError("请至少选择一个宿主文件")

    if rename_log_id is not None:
        return _apply_from_rename_log(rr, rename_log_id=rename_log_id, selected=selected)

    old_basename, new_basename, exclude_repo_rel = _resolve_analysis_names(
        rr,
        rename_log_id=None,
        old_basename=old_basename,
        new_basename=new_basename,
        exclude_repo_rel=exclude_repo_rel,
    )
    groups = host_ref_groups_from_db(
        rr,
        old_basename=old_basename,
        new_basename=new_basename,
        exclude_repo_rel=exclude_repo_rel,
        target_repo_rel=target_repo_rel,
        transitive=transitive,
    )
    host_map = {_norm_host_path(g.host_repo_rel_path): g for g in groups}

    applied_hosts, failed, total_patches = _apply_hits_for_hosts(
        rr,
        selected=selected,
        host_map=host_map,
    )

    scan_payload = _groups_to_payload(
        groups,
        rename_log_id=None,
        old_basename=old_basename,
        new_basename=new_basename,
        transitive=transitive,
    )
    _mark_applied_in_payload(scan_payload, applied_hosts)

    if applied_hosts:
        insert_ref_patch_event(
            rr,
            stats={
                "mode": "manual",
                "old_basename": old_basename,
                "new_basename": new_basename,
                "hosts": len(applied_hosts),
                "xlink_patches": total_patches,
                "failed": len(failed),
            },
        )

    return {
        "rename_log_id": None,
        "old_basename": old_basename,
        "new_basename": new_basename,
        "applied_hosts": applied_hosts,
        "failed": failed,
        "xlink_patches": total_patches,
        "scan": scan_payload,
    }


def load_rename_analysis(repo_root: Path, rename_log_id: int) -> dict[str, Any]:
    rr = repo_root.expanduser().resolve(strict=False)
    row = get_rename_log(rr, rename_log_id)
    if row is None:
        raise ValueError(f"未找到改名记录 #{rename_log_id}")
    scan = load_ref_hits_for_rename(rr, rename_log_id)
    scan["old_basename"] = row["old_basename"]
    scan["new_basename"] = row["new_basename"]
    return {"rename_log": row, "scan": scan}


def export_rename_analysis_report(
    repo_root: Path,
    *,
    scan: dict[str, Any],
    rename_log_id: int | None = None,
    note: str | None = None,
) -> dict[str, str]:
    rr = repo_root.expanduser().resolve(strict=False)
    rename_log = get_rename_log(rr, rename_log_id) if rename_log_id else None
    return write_rename_analysis_report(
        rr,
        scan=scan,
        rename_log=rename_log,
        old_basename=scan.get("old_basename"),
        new_basename=scan.get("new_basename"),
        note=note,
    )


# 兼容旧 API 名
scan_rename_references = analyze_rename_references
apply_rename_reference_patches = apply_rename_analysis_corrections
load_rename_scan_display = load_rename_analysis


def _resolve_analysis_names(
    repo_root: Path,
    *,
    rename_log_id: int | None,
    old_basename: str | None,
    new_basename: str | None,
    exclude_repo_rel: str | None,
) -> tuple[str, str, str | None]:
    if rename_log_id is not None:
        row = get_rename_log(repo_root, rename_log_id)
        if row is None:
            raise ValueError(f"未找到改名记录 #{rename_log_id}")
        return (
            row["old_basename"],
            row["new_basename"],
            exclude_repo_rel or row["new_repo_rel_path"],
        )
    if not old_basename or not new_basename:
        raise ValueError("请提供 rename_log_id，或同时提供 old_basename 与 new_basename")
    old = old_basename.strip()
    new = new_basename.strip()
    return old, new, exclude_repo_rel


def _apply_from_rename_log(
    repo_root: Path,
    *,
    rename_log_id: int,
    selected: list[str],
) -> dict[str, Any]:
    row = get_rename_log(repo_root, rename_log_id)
    if row is None:
        raise ValueError(f"未找到改名记录 #{rename_log_id}")

    scan = load_ref_hits_for_rename(repo_root, rename_log_id)
    host_map = {h["host_repo_rel_path"]: h for h in scan.get("hosts", [])}

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
            n = apply_host_xlink_corrections(repo_root, host_rel, hits)
            total_patches += n
            applied_hosts.append(host_rel)
        except (RenameAnalysisError, OSError) as ex:
            failed.append({"host_repo_rel_path": host_rel, "error": str(ex)})

    if applied_hosts:
        mark_ref_hits_applied(
            repo_root,
            rename_log_id=rename_log_id,
            host_repo_rel_paths=applied_hosts,
        )
        insert_ref_patch_event(
            repo_root,
            stats={
                "rename_log_id": rename_log_id,
                "hosts": len(applied_hosts),
                "xlink_patches": total_patches,
                "failed": len(failed),
            },
        )

    refreshed = load_ref_hits_for_rename(repo_root, rename_log_id)
    refreshed["old_basename"] = row["old_basename"]
    refreshed["new_basename"] = row["new_basename"]
    return {
        "rename_log_id": rename_log_id,
        "old_basename": row["old_basename"],
        "new_basename": row["new_basename"],
        "applied_hosts": applied_hosts,
        "failed": failed,
        "xlink_patches": total_patches,
        "scan": refreshed,
    }


def _apply_hits_for_hosts(
    repo_root: Path,
    *,
    selected: list[str],
    host_map: dict[str, HostRefGroup],
) -> tuple[list[str], list[dict[str, str]], int]:
    applied_hosts: list[str] = []
    failed: list[dict[str, str]] = []
    total_patches = 0

    for host_rel in selected:
        group = host_map.get(host_rel)
        if group is None:
            failed.append({"host_repo_rel_path": host_rel, "error": "未找到引用命中"})
            continue
        hits = list(group.hits)
        if not hits:
            continue
        try:
            n = apply_host_xlink_corrections(repo_root, host_rel, hits)
            total_patches += n
            applied_hosts.append(host_rel)
        except (RenameAnalysisError, OSError) as ex:
            failed.append({"host_repo_rel_path": host_rel, "error": str(ex)})

    return applied_hosts, failed, total_patches


def _mark_applied_in_payload(scan: dict[str, Any], applied_hosts: list[str]) -> None:
    applied = set(applied_hosts)
    for host in scan.get("hosts") or []:
        if host.get("host_repo_rel_path") in applied:
            for hit in host.get("hits") or []:
                hit["status"] = "applied"


def _flatten_hosts(hosts: list[dict[str, Any]]) -> list[dict[str, str]]:
    flat: list[dict[str, str]] = []
    for host in hosts:
        host_rel = _norm_host_path(host["host_repo_rel_path"])
        for hit in host["hits"]:
            flat.append(
                {
                    "host_repo_rel_path": host_rel,
                    "matched_text": hit["matched_text"],
                    "proposed_text": hit["proposed_text"],
                }
            )
    return flat


def _norm_host_path(path: str) -> str:
    return normalize_repo_rel_path_for_map(path.replace("\\", "/").strip())


def _groups_to_payload(
    groups: list[HostRefGroup],
    *,
    rename_log_id: int | None,
    old_basename: str,
    new_basename: str,
    transitive: bool = True,
) -> dict[str, Any]:
    hosts: list[dict[str, Any]] = []
    for g in groups:
        host_rel = _norm_host_path(g.host_repo_rel_path)
        hosts.append(
            {
                "host_repo_rel_path": host_rel,
                "host_filename": g.host_filename,
                "hit_count": g.hit_count,
                "depth": g.depth,
                "usage_kind": g.usage_kind,
                "via_chain": list(g.via_chain),
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
    direct_host_count = sum(1 for g in groups if g.depth == 0)
    return {
        "rename_log_id": rename_log_id,
        "old_basename": old_basename,
        "new_basename": new_basename,
        "transitive": transitive,
        "host_count": len(hosts),
        "direct_host_count": direct_host_count,
        "hit_count": sum(h["hit_count"] for h in hosts),
        "hosts": hosts,
    }
