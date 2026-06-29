"""BOM 森林构建 + 引用展开 — 纯函数，可独立单测。

与文件 I/O、数据库无关，仅操作 Python 数据结构。
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from typing import Any


@dataclass
class BomNode:
    """BOM 树中的一个节点（零件或子装配）。"""

    rel: str
    """仓库相对路径"""
    depth: int
    """在 BOM 树中的深度（根为 0）"""
    materialized_path: str
    """组合路径，如 ``总成/子装/零件.FCStd``"""
    part_key: str
    """零件号组合，如 ``8001.001.H``"""
    quantity: int = 1
    cycle_detected: bool = False
    children: list[BomNode] = field(default_factory=list)


@dataclass
class RefEdge:
    """一条引用边（宿主→目标）。"""

    host_rel: str
    target_rel: str
    link_label: str = ""
    is_direct: bool = True


@dataclass
class BomForestResult:
    """BOM 森林构建结果。"""

    roots: dict[str, BomNode]
    """{assembly_root_rel: root_node}"""
    bom_lines: list[dict[str, Any]]
    """展平的 BOM 行表"""
    ref_edges: list[RefEdge]
    """展平的引用边"""
    cycles: list[str]
    """检测到循环的 rel 列表"""


# ---------------------------------------------------------------------------
# 公共入口
# ---------------------------------------------------------------------------


def build_bom_forest(
    all_bom_data: dict[str, dict[str, Any]],
    basename_map: dict[str, list[str]],
) -> BomForestResult:
    """从解析好的 BOM 数据在内存中构建 BOM 森林。

    Parameters
    ----------
    all_bom_data:
        ``{rel: {"bom": {...}, "xlinks": [{"file": ..., "label": ...}, ...]}}``
    basename_map:
        ``{filename: [repo_rel_path, ...]}``（来自 ``scan_cad_basename_map``）

    Returns
    -------
    BomForestResult
        包含根节点、展平行表、引用边和循环检测结果。
    """
    all_refs = _collect_all_ref_targets(all_bom_data, basename_map)
    root_rels = [rel for rel in all_bom_data if rel not in all_refs]

    # 如果没有明确的根（全部互相引用），取第一个有 xlinks 的
    if not root_rels:
        root_rels = [
            rel for rel in all_bom_data if all_bom_data[rel].get("xlinks")
        ][:1]
    if not root_rels and all_bom_data:
        root_rels = [next(iter(all_bom_data))]

    roots: dict[str, BomNode] = {}
    all_lines: list[dict[str, Any]] = []
    cycles: list[str] = []

    for root_rel in root_rels:
        root_name = _basename(root_rel)
        root_node = BomNode(
            rel=root_rel,
            depth=0,
            materialized_path=root_name,
            part_key=_part_key(all_bom_data.get(root_rel, {}).get("bom", {})),
        )
        visited: set[str] = {root_rel}
        _walk_children(
            root_node,
            root_rel,    # root_assembly_rel
            root_rel,    # current_host_rel
            all_bom_data,
            basename_map,
            visited,
            all_lines,
            cycles,
        )
        roots[root_rel] = root_node

    ref_edges = build_ref_edges(all_bom_data, basename_map)

    return BomForestResult(
        roots=roots,
        bom_lines=all_lines,
        ref_edges=ref_edges,
        cycles=cycles,
    )


def build_ref_edges(
    all_bom_data: dict[str, dict[str, Any]],
    basename_map: dict[str, list[str]],
) -> list[RefEdge]:
    """从 xlinks 数据展开所有引用边（纯函数）。"""
    edges: list[RefEdge] = []
    all_rels = set(all_bom_data.keys())

    for host_rel, data in all_bom_data.items():
        for xlink in data.get("xlinks", []):
            file_attr = xlink.get("file", "").strip()
            if not file_attr:
                continue
            target_rel = _resolve_target(file_attr, host_rel, basename_map)
            if not target_rel:
                continue
            edges.append(RefEdge(
                host_rel=host_rel,
                target_rel=target_rel,
                link_label=xlink.get("label", ""),
                is_direct=target_rel in all_rels,
            ))

    return edges


# ---------------------------------------------------------------------------
# 内部实现
# ---------------------------------------------------------------------------


def _walk_children(
    parent_node: BomNode,
    root_assembly_rel: str,
    host_rel: str,
    all_bom_data: dict[str, dict[str, Any]],
    basename_map: dict[str, list[str]],
    visited: set[str],
    out_lines: list[dict[str, Any]],
    out_cycles: list[str],
    depth: int = 1,
) -> None:
    """递归遍历子节点，带循环检测。"""
    data = all_bom_data.get(host_rel)
    if not data:
        return

    xlinks = data.get("xlinks", [])
    if not xlinks:
        return

    for xlink in xlinks:
        file_attr = xlink.get("file", "").strip()
        if not file_attr:
            continue
        target_rel = _resolve_target(file_attr, host_rel, basename_map)
        if not target_rel:
            continue

        child_data = all_bom_data.get(target_rel, {})
        child_bom = child_data.get("bom", {})

        # 循环检测
        cycle_detected = target_rel in visited
        if cycle_detected:
            out_cycles.append(target_rel)

        child_node = BomNode(
            rel=target_rel,
            depth=depth,
            materialized_path=f"{parent_node.materialized_path}/{_basename(target_rel)}",
            part_key=_part_key(child_bom),
            cycle_detected=cycle_detected,
        )

        # 展平行：assembly_rel 始终指向根总成
        out_lines.append({
            "assembly_rel": root_assembly_rel,
            "part_rel": target_rel,
            "depth": depth,
            "bom_path": child_node.materialized_path,
            "part_key": child_node.part_key,
            "quantity": child_node.quantity,
            "cycle_detected": cycle_detected,
        })

        parent_node.children.append(child_node)

        # 遇环截断，不继续递归
        if cycle_detected:
            continue

        visited.add(target_rel)
        _walk_children(
            child_node,
            root_assembly_rel,
            target_rel,
            all_bom_data,
            basename_map,
            visited,
            out_lines,
            out_cycles,
            depth + 1,
        )
        visited.discard(target_rel)


def _collect_all_ref_targets(
    all_bom_data: dict[str, dict[str, Any]],
    basename_map: dict[str, list[str]],
) -> set[str]:
    """收集所有被引用的目标 rel。"""
    targets: set[str] = set()
    for data in all_bom_data.values():
        for xlink in data.get("xlinks", []):
            file_attr = xlink.get("file", "").strip()
            if not file_attr:
                continue
            target = _resolve_target(file_attr, "", basename_map)
            if target:
                targets.add(target)
    return targets


def _resolve_target(
    file_attr: str,
    host_rel: str,
    basename_map: dict[str, list[str]],
) -> str | None:
    """将 XLink file 属性解析为仓库相对路径。

    优先同目录匹配 → 同名路径最短匹配。
    """
    import os.path as _osp
    attr = file_attr.replace("\\", "/").strip()
    basename = _osp.basename(attr)

    if not basename.lower().endswith(".fcstd"):
        return None

    candidates = basename_map.get(basename, [])

    # 单候选直接返回
    if len(candidates) == 1:
        return candidates[0]

    # 多候选：优先与宿主同目录的
    if host_rel and candidates:
        host_dir = _osp.dirname(host_rel.replace("\\", "/"))
        for c in candidates:
            c_dir = _osp.dirname(c.replace("\\", "/"))
            if c_dir == host_dir:
                return c

    # 返回最短路径（最可能是最直接的引用）
    return candidates[0] if candidates else None


def _basename(rel: str) -> str:
    return os.path.basename(rel.replace("\\", "/"))


def _part_key(bom: dict[str, Any]) -> str:
    pn = str(bom.get("PartNumber", "") or "").strip()
    pv = str(bom.get("PartVersion", "") or "").strip()
    if pn and pv:
        return f"{pn}.{pv}"
    return pn or pv or ""
