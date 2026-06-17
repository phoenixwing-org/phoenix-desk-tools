"""BOM XLink 引用关系 — 从 FCStd 提取并在索引库中持久化。"""

from phoenix.freecad.bom_xref.extract import list_fcstd_xlink_attrs_from_file
from phoenix.freecad.bom_xref.resolve import resolve_xlink_target
from phoenix.freecad.bom_xref.types import BomXrefEdge, ResolvedXlinkTarget

__all__ = [
    "BomXrefEdge",
    "ResolvedXlinkTarget",
    "list_fcstd_xlink_attrs_from_file",
    "resolve_xlink_target",
]
