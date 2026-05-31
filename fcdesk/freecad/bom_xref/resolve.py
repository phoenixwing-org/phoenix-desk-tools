"""XLink file 属性 → 工作空间内目标 FCStd 路径（主要靠文件名）。"""

from __future__ import annotations

import os
import re
from pathlib import Path

from fcdesk.freecad.bom_xref.types import ResolvedXlinkTarget
from fcdesk.freecad.fcstd_mapping import normalize_repo_rel_path_for_map

_VERSION_IN_NAME = re.compile(r"\.(\d{3})[-.]")


def _freecad_workspace_dir(doc_dir: Path) -> Path | None:
    if doc_dir.name == "FreeCAD":
        return doc_dir
    if doc_dir.parent.name == "FreeCAD":
        return doc_dir.parent
    return None


def _folder_three_digit_suffix(doc_dir: Path) -> str | None:
    for part in doc_dir.parts:
        m = re.search(r"(\d{3})$", part)
        if m:
            return m.group(1)
    return None


def _file_version_token(path: Path) -> str | None:
    m = _VERSION_IN_NAME.search(path.name)
    return m.group(1) if m else None


def pick_target_path(
    basename: str,
    candidate_rels: list[str],
    *,
    repo_root: Path,
    host_repo_rel: str,
) -> ResolvedXlinkTarget:
    """在多个同名候选中，结合宿主路径启发式选一个目标。"""
    if not candidate_rels:
        return ResolvedXlinkTarget(None, "missing")

    host_abs = (repo_root / host_repo_rel).resolve(strict=False)
    doc_dir = host_abs.parent
    candidates = [(repo_root / rel).resolve(strict=False) for rel in candidate_rels]
    rel_paths = [normalize_repo_rel_path_for_map(r) for r in candidate_rels]

    direct = (doc_dir / basename).resolve(strict=False)
    if direct.is_file():
        try:
            rel = os.path.relpath(direct, repo_root).replace(os.sep, "/")
            return ResolvedXlinkTarget(normalize_repo_rel_path_for_map(rel), "resolved")
        except ValueError:
            pass

    for rel, abs_path in zip(rel_paths, candidates, strict=True):
        attr_try = normalize_repo_rel_path_for_map(
            os.path.relpath(abs_path, doc_dir).replace(os.sep, "/") if doc_dir else rel
        )
        if attr_try and abs_path.is_file():
            pass

    existing = [(rel, p) for rel, p in zip(rel_paths, candidates, strict=True) if p.is_file()]
    if len(existing) == 1:
        return ResolvedXlinkTarget(existing[0][0], "resolved")

    freecad_dir = _freecad_workspace_dir(doc_dir) or doc_dir
    in_current = [(rel, p) for rel, p in existing if p.parent == freecad_dir]
    if len(in_current) == 1:
        return ResolvedXlinkTarget(in_current[0][0], "resolved")
    if len(in_current) > 1:
        existing = in_current

    proj_ver = _folder_three_digit_suffix(doc_dir)
    if proj_ver and existing:
        same_ver = [(rel, p) for rel, p in existing if _file_version_token(p) == proj_ver]
        if len(same_ver) == 1:
            return ResolvedXlinkTarget(same_ver[0][0], "resolved")
        if same_ver:
            existing = same_ver

    doc_markers = {p for p in doc_dir.parts if re.search(r"\d{3}$", p)}
    if doc_markers and existing:
        same_project = [
            (rel, p)
            for rel, p in existing
            if doc_markers & {x for x in p.parts if re.search(r"\d{3}$", x)}
        ]
        if len(same_project) == 1:
            return ResolvedXlinkTarget(same_project[0][0], "resolved")
        if same_project:
            existing = same_project

    if not existing:
        return ResolvedXlinkTarget(
            None,
            "missing",
            candidate_paths=tuple(sorted(rel_paths)),
        )

    if len(existing) > 1:
        def relpath_len(item: tuple[str, Path]) -> int:
            try:
                return len(os.path.relpath(item[1], doc_dir))
            except ValueError:
                return 10_000

        best = min(existing, key=relpath_len)
        return ResolvedXlinkTarget(
            best[0],
            "ambiguous",
            candidate_paths=tuple(sorted(r for r, _ in existing)),
        )

    return ResolvedXlinkTarget(existing[0][0], "resolved")


def resolve_xlink_target(
    *,
    repo_root: Path,
    host_repo_rel: str,
    xlink_file_attr: str,
    basename_map: dict[str, list[str]],
) -> ResolvedXlinkTarget:
    """解析 XLink 指向的工作空间内 FCStd。"""
    rr = repo_root.expanduser().resolve(strict=False)
    attr = xlink_file_attr.replace("\\", "/").strip()
    basename = Path(attr).name
    if not basename.lower().endswith(".fcstd"):
        return ResolvedXlinkTarget(None, "non_fcstd")

    host_key = normalize_repo_rel_path_for_map(host_repo_rel)
    if attr == basename or "/" not in attr.lstrip("./"):
        candidates = basename_map.get(basename, [])
        picked = pick_target_path(
            basename,
            candidates,
            repo_root=rr,
            host_repo_rel=host_key,
        )
        if picked.target_repo_rel_path == host_key:
            return ResolvedXlinkTarget(picked.target_repo_rel_path, "self")
        return picked

    host_abs = (rr / host_key).resolve(strict=False)
    direct = (host_abs.parent / attr).resolve(strict=False)
    if direct.is_file():
        try:
            rel = os.path.relpath(direct, rr).replace(os.sep, "/")
            rel_norm = normalize_repo_rel_path_for_map(rel)
            if rel_norm == host_key:
                return ResolvedXlinkTarget(rel_norm, "self")
            return ResolvedXlinkTarget(rel_norm, "resolved")
        except ValueError:
            pass

    return pick_target_path(
        basename,
        basename_map.get(basename, []),
        repo_root=rr,
        host_repo_rel=host_key,
    )
