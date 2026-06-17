"""零件主键（PartNumber.PartVersion）目录与关联文件。"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from phoenix.config.user_prefs import format_resolved_under_workspace
from phoenix.freecad.phoenix_store import (
    cad_database_path,
    connect,
    format_part_key,
    get_part_key_detail,
    list_part_keys,
    migrate_fcstd_map_json,
    update_part_file_link_record,
    update_part_key_record,
)
from phoenix.freecad.part_naming import PartNamingParser
from phoenix.freecad.fcstd_mapping import normalize_repo_rel_path_for_map
from phoenix.freecad.rename_analysis.types import RenameAnalysisError
from phoenix.services.bom_xref_service import load_assembly_tree


def _ensure_index_loaded(repo_root: Path) -> None:
    migrate_fcstd_map_json(repo_root)


def load_part_keys_payload(repo_root: Path) -> dict[str, Any]:
    rr = repo_root.expanduser().resolve(strict=False)
    _ensure_index_loaded(rr)
    db = cad_database_path(rr)
    entries = list_part_keys(rr)
    total_files = sum(int(e.get("file_count") or 0) for e in entries)
    return {
        "database_path": str(db),
        "database_path_display": format_resolved_under_workspace(db, rr),
        "exists": db.is_file() and bool(entries),
        "entries": entries,
        "stats": {
            "total_keys": len(entries),
            "total_files": total_files,
            "obsolete_keys": sum(1 for e in entries if e.get("status") == "obsolete"),
        },
    }


def load_part_key_detail_payload(
    repo_root: Path,
    part_number: str,
    part_version: str,
) -> dict[str, Any]:
    rr = repo_root.expanduser().resolve(strict=False)
    _ensure_index_loaded(rr)
    detail = get_part_key_detail(rr, part_number, part_version)
    if detail is None:
        raise LookupError(f"未找到零件键: {part_number}.{part_version}")
    return detail


def patch_part_key(
    repo_root: Path,
    part_number: str,
    part_version: str,
    *,
    type_code: str | None = None,
    model_series: str | None = None,
    part_name: str | None = None,
    label: str | None = None,
    notes: str | None = None,
    status: str | None = None,
) -> dict[str, Any]:
    rr = repo_root.expanduser().resolve(strict=False)
    migrate_fcstd_map_json(rr)
    detail = update_part_key_record(
        rr,
        part_number,
        part_version,
        type_code=type_code,
        model_series=model_series,
        part_name=part_name,
        label=label,
        notes=notes,
        status=status,
    )
    if detail is None:
        raise LookupError(f"未找到零件键: {part_number}.{part_version}")
    return detail


def patch_part_file_link(
    repo_root: Path,
    part_number: str,
    part_version: str,
    file_asset_id: int,
    *,
    file_role: str | None = None,
    link_notes: str | None = None,
    link_status: str | None = None,
) -> dict[str, Any]:
    rr = repo_root.expanduser().resolve(strict=False)
    migrate_fcstd_map_json(rr)
    detail = update_part_file_link_record(
        rr,
        part_number,
        part_version,
        file_asset_id,
        file_role=file_role,
        link_notes=link_notes,
        link_status=link_status,
    )
    if detail is None:
        raise LookupError("未找到关联文件")
    return detail


def load_part_assembly_tree_payload(
    repo_root: Path,
    part_number: str,
    part_version: str,
    host_repo_rel: str,
    *,
    full: bool = False,
) -> dict[str, Any]:
    rr = repo_root.expanduser().resolve(strict=False)
    detail = get_part_key_detail(rr, part_number, part_version)
    if detail is None:
        raise LookupError(f"未找到零件键: {part_number}.{part_version}")

    host = normalize_repo_rel_path_for_map(host_repo_rel.strip())
    allowed = {
        normalize_repo_rel_path_for_map(str(f.get("repo_rel_path") or ""))
        for f in detail.get("files", [])
    }
    if host not in allowed:
        raise ValueError("所选装配文件不属于该零件键")

    try:
        return load_assembly_tree(rr, host, full=full)
    except RenameAnalysisError as ex:
        raise LookupError(str(ex)) from ex


def lookup_part_key_in_index(
    repo_root: Path,
    *,
    basename: str = "",
    repo_rel: str = "",
) -> dict[str, str]:
    """在 CAD 索引 ``phoenix_cad_file_asset`` 中按路径或文件名查已登记的 Part Key。"""
    rr = repo_root.expanduser().resolve(strict=False)
    migrate_fcstd_map_json(rr)
    rel_norm = normalize_repo_rel_path_for_map(repo_rel.strip()) if repo_rel.strip() else ""
    name = Path(basename.replace("\\", "/")).name if basename.strip() else ""

    clauses: list[str] = []
    params: list[str] = []
    if rel_norm:
        clauses.append("lower(repo_rel_path) = lower(?)")
        params.append(rel_norm)
    if name:
        clauses.append("lower(filename) = lower(?)")
        params.append(name)
    if not clauses:
        return {}

    where = " OR ".join(clauses)
    sql = f"""
        SELECT part_number, part_version, repo_rel_path
        FROM phoenix_cad_file_asset
        WHERE ({where})
          AND part_number IS NOT NULL AND TRIM(part_number) != ''
          AND part_version IS NOT NULL AND TRIM(part_version) != ''
        ORDER BY CASE file_status WHEN 'present' THEN 0 ELSE 1 END, id DESC
        LIMIT 1
    """
    with connect(rr) as conn:
        row = conn.execute(sql, params).fetchone()
    if row is None:
        return {}
    pn = str(row["part_number"] or "").strip()
    pv = str(row["part_version"] or "").strip()
    if not pn or not pv:
        return {}
    return {
        "part_number": pn,
        "part_version": pv,
        "part_key": format_part_key(pn, pv),
        "repo_rel_path": normalize_repo_rel_path_for_map(str(row["repo_rel_path"] or "")),
    }


def resolve_part_key_from_workspace_rel(repo_root: Path, repo_rel: str) -> dict[str, str | bool]:
    """从工作空间相对路径解析 PartKey：文件名规则 + 索引回退 / 校正。"""
    rel_norm = normalize_repo_rel_path_for_map(repo_rel.strip())
    if not rel_norm:
        raise ValueError("路径为空")
    basename = Path(rel_norm).name
    if not basename.lower().endswith(".fcstd"):
        raise ValueError("仅支持 .FCStd 文件")

    rr = repo_root.expanduser().resolve(strict=False)
    hints = PartNamingParser.part_key_hints_from_basename(basename)
    index_hit = lookup_part_key_in_index(rr, basename=basename, repo_rel=rel_norm)

    pn = hints["part_number"]
    pv = hints["part_version"]
    source = "filename"

    if index_hit.get("part_number") and index_hit.get("part_version"):
        idx_pn = index_hit["part_number"]
        idx_pv = index_hit["part_version"]
        if pn and pv and (idx_pn != pn or idx_pv != pv):
            source = "index"
            pn, pv = idx_pn, idx_pv
        elif not pn or not pv:
            source = "index"
            pn, pv = idx_pn, idx_pv
        elif pn and pv:
            source = "filename+index"

    if not pn or not pv:
        raise ValueError(f"无法从文件名或 CAD 索引推断 PartKey: {basename}")

    part_key = format_part_key(pn, pv)
    return {
        "rel": rel_norm,
        "filename": basename,
        "part_number": pn,
        "part_version": pv,
        "part_key": part_key,
        "source": source,
        "in_catalog": get_part_key_detail(rr, pn, pv) is not None,
    }


def infer_part_key_from_repo_rel(repo_rel: str, repo_root: Path | None = None) -> dict[str, str | bool]:
    """兼容旧调用；``repo_root`` 缺省时仅文件名推断（无索引）。"""
    if repo_root is None:
        hints = PartNamingParser.part_key_hints_from_basename(Path(repo_rel.strip()).name)
        if not hints["part_number"] or not hints["part_version"]:
            raise ValueError(f"无法从文件名推断 PartKey: {hints['basename']}")
        return {
            "rel": normalize_repo_rel_path_for_map(repo_rel.strip()),
            "filename": hints["basename"],
            "part_number": hints["part_number"],
            "part_version": hints["part_version"],
            "part_key": hints["part_key"],
            "source": "filename",
            "in_catalog": False,
        }
    return resolve_part_key_from_workspace_rel(repo_root, repo_rel)
