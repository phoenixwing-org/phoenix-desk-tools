"""CAD 索引子系统共用常量与路径规范化。"""

from __future__ import annotations

from fcdesk.freecad.fcstd_mapping import normalize_repo_rel_path_for_map

GRAPH_TARGET_STATUSES = frozenset({"resolved", "ambiguous", "self"})


def norm_xref_path(path: str | None) -> str | None:
    if not path:
        return None
    return normalize_repo_rel_path_for_map(str(path).replace("\\", "/").strip())
