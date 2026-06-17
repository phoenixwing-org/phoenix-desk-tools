"""CAD 索引扫描路径：扫描根解析、文件名 → 仓库相对路径映射。"""

from __future__ import annotations

import os
from pathlib import Path

from phoenix.config.user_prefs import resolve_workspace_path_entry
from phoenix.freecad.cad_index_types import is_cad_index_filename
from phoenix.freecad.fcstd_mapping import normalize_repo_rel_path_for_map

_SKIP_DIRS = frozenset(
    {
        ".git",
        "__pycache__",
        ".obsidian",
        ".phoenix",
        "node_modules",
        ".cursor",
        "temp",
        ".venv",
        ".venv-desktop",
        "web-ui",
        "dist",
        "build",
    }
)


def resolve_scan_root(repo_root: Path, stored_scan_root: str | None = None) -> Path:
    """解析 CAD 索引遍历根目录。``stored_scan_root`` 已废弃，请传 ``None``（工作空间根）。"""
    if stored_scan_root:
        return resolve_workspace_path_entry(stored_scan_root, repo_root)
    return repo_root.expanduser().resolve(strict=False)


def scan_cad_basename_map(
    scan_root: Path,
    *,
    anchor: Path,
) -> dict[str, list[str]]:
    """``扫描根`` 下遍历 CAD 索引文件 → ``文件名 → 相对 anchor 的路径列表``。"""
    root = scan_root.expanduser().resolve(strict=False)
    base = anchor.expanduser().resolve(strict=False)
    out: dict[str, list[str]] = {}

    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in _SKIP_DIRS]
        for name in filenames:
            if not is_cad_index_filename(name):
                continue
            abs_path = Path(dirpath, name).resolve()
            try:
                rel = os.path.relpath(abs_path, base).replace(os.sep, "/")
            except ValueError:
                rel = str(abs_path)
            rel = normalize_repo_rel_path_for_map(rel)
            out.setdefault(name, []).append(rel)

    for paths in out.values():
        paths.sort()
    return out


def scan_fcstd_basename_map(
    scan_root: Path,
    *,
    anchor: Path,
) -> dict[str, list[str]]:
    """兼容旧名：等同 ``scan_cad_basename_map``（仍返回全部 CAD 类型）。"""
    return scan_cad_basename_map(scan_root, anchor=anchor)
