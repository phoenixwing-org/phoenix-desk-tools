"""零件主键（PartNumber.PartVersion）目录与关联文件。"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from fcdesk.config.user_prefs import format_resolved_under_workspace
from fcdesk.freecad.phoenix_store import (
    cad_database_path,
    get_part_key_detail,
    list_part_keys,
    migrate_fcstd_map_json,
    update_part_file_link_record,
    update_part_key_record,
)


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
