"""成员排序 · 从工作集 path 推导一级目录/文件条目名。"""

from __future__ import annotations


def derive_reorder_top_level_from_workset(
    workset_paths: list[str],
    valid_top_level_names: list[str],
) -> list[str]:
    """与 Web ``deriveReorderTopLevelFromWorkset`` 规则一致。"""
    valid = {n for n in valid_top_level_names}
    derived: set[str] = set()
    for raw in workset_paths:
        p = raw.strip().replace("\\", "/").lstrip("./")
        if not p or ".." in p:
            continue
        top = p.split("/")[0]
        if top and top in valid:
            derived.add(top)
    return sorted(derived, key=lambda x: x.casefold())
