"""加载 BOM 引用索引构建所需的扫描上下文（basename 映射、file_asset id）。"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

from fcdesk.freecad.phoenix_store import (
    ensure_fcstd_scan_record,
    get_last_fcstd_scan_id,
    list_present_fcstd_file_assets,
)
from fcdesk.services.cad_index.scan_paths import resolve_scan_root, scan_cad_basename_map


@dataclass(frozen=True)
class BomXrefIndexContext:
    repo_root: Path
    scan_root: Path
    scan_id: int | None
    basename_map: dict[str, list[str]]
    path_to_id: dict[str, int]


def load_bom_xref_index_context(
    repo_root: Path,
    *,
    require_scan_id: bool = False,
) -> BomXrefIndexContext:
    """从工作区偏好与 CAD 索引库组装引用边解析上下文。"""
    rr = repo_root.expanduser().resolve(strict=False)
    scan_root = resolve_scan_root(rr, None)
    if not scan_root.is_dir():
        raise ValueError(f"工作空间根不是有效目录: {scan_root}")

    scan_id = ensure_fcstd_scan_record(rr) or get_last_fcstd_scan_id(rr)
    if require_scan_id and scan_id is None:
        raise ValueError("请先执行 CAD 索引扫描")

    basename_map = scan_cad_basename_map(scan_root, anchor=rr)
    path_to_id = {a["repo_rel_path"]: a["id"] for a in list_present_fcstd_file_assets(rr)}
    return BomXrefIndexContext(
        repo_root=rr,
        scan_root=scan_root,
        scan_id=scan_id,
        basename_map=basename_map,
        path_to_id=path_to_id,
    )
