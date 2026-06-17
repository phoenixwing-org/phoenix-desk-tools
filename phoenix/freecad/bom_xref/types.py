"""BOM XLink 引用关系 — 数据类型。"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class BomXrefEdge:
    host_repo_rel_path: str
    host_file_asset_id: int
    xlink_file_attr: str
    target_basename: str
    target_repo_rel_path: str | None
    target_file_asset_id: int | None
    resolve_status: str


@dataclass(frozen=True)
class ResolvedXlinkTarget:
    target_repo_rel_path: str | None
    resolve_status: str
    candidate_paths: tuple[str, ...] = ()
