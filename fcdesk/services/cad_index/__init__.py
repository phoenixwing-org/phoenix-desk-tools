"""CAD 索引处理：工程扫描后的引用表构建与按宿主增量更新。

- ``fcstd_map_service``：``file_asset`` 属性扫描（工程内搜索）
- ``cad_index.bom_xref_index``：``bom_xref`` 引用边索引（全量 / 按宿主 / 子树）
- ``bom_xref_service``：引用关系查询与改名分析（只读库表为主）
"""

from fcdesk.services.cad_index.bom_xref_index import (
    bom_xref_edges_for_host,
    discover_fcstd_subtree_hosts,
    ensure_bom_xref_built,
    ensure_bom_xref_index,
    rebuild_bom_xrefs,
    rebuild_bom_xrefs_from_last_scan,
    refresh_bom_xref_index_for_host,
    refresh_bom_xrefs_for_hosts,
)
from fcdesk.services.cad_index.common import GRAPH_TARGET_STATUSES, norm_xref_path
from fcdesk.services.cad_index.context import BomXrefIndexContext, load_bom_xref_index_context
from fcdesk.services.cad_index.scan_paths import (
    resolve_scan_root,
    scan_cad_basename_map,
    scan_fcstd_basename_map,
)

__all__ = [
    "BomXrefIndexContext",
    "GRAPH_TARGET_STATUSES",
    "bom_xref_edges_for_host",
    "discover_fcstd_subtree_hosts",
    "ensure_bom_xref_built",
    "ensure_bom_xref_index",
    "load_bom_xref_index_context",
    "norm_xref_path",
    "rebuild_bom_xrefs",
    "rebuild_bom_xrefs_from_last_scan",
    "refresh_bom_xref_index_for_host",
    "refresh_bom_xrefs_for_hosts",
    "resolve_scan_root",
    "scan_cad_basename_map",
    "scan_fcstd_basename_map",
]
