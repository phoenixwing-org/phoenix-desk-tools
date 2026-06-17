"""工作空间文件扫描与目录树（复用 ``filtered_workspace_tree``）。"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from phoenix.workspace_scan import FCSTD_SUFFIX, SW_PART_SUFFIX, iter_filtered_files


def scan_workspace_files(
    repo_root: Path,
    *,
    want_fcstd: bool = True,
    want_sw_part: bool = False,
) -> list[Path]:
    """返回相对工作空间根的路径列表（已排序）。"""
    return iter_filtered_files(repo_root, want_fcstd=want_fcstd, want_sw_part=want_sw_part)


def _file_kind(suffix: str) -> str:
    s = suffix.casefold()
    if s == FCSTD_SUFFIX:
        return "FC"
    if s == SW_PART_SUFFIX:
        return "SW"
    return s.lstrip(".") or "file"


class _DirNode:
    __slots__ = ("name", "path", "dirs", "files")

    def __init__(self, name: str, path: str) -> None:
        self.name = name
        self.path = path
        self.dirs: dict[str, _DirNode] = {}
        self.files: list[dict[str, Any]] = []

    def to_dict(self) -> dict[str, Any]:
        children: list[dict[str, Any]] = []
        for d in sorted(self.dirs.values(), key=lambda x: x.name.lower()):
            children.append(d.to_dict())
        for f in sorted(self.files, key=lambda x: x["name"].lower()):
            children.append(f)
        return {
            "name": self.name,
            "path": self.path,
            "type": "dir",
            "children": children,
        }


def build_workspace_tree(
    repo_root: Path,
    rel_files: list[Path],
) -> dict[str, Any]:
    """嵌套 JSON 树：根 ``type=dir``，叶子 ``type=file`` + ``kind``。"""
    root_path = repo_root.expanduser().resolve(strict=False)
    root_label = root_path.name or str(root_path)
    root_node = _DirNode(root_label, "")

    for rf in rel_files:
        parts = rf.parts
        if not parts:
            continue
        cur = root_node
        for i, part in enumerate(parts[:-1]):
            if part not in cur.dirs:
                cur.dirs[part] = _DirNode(part, "/".join(parts[: i + 1]))
            cur = cur.dirs[part]
        cur.files.append(
            {
                "name": rf.name,
                "path": rf.as_posix(),
                "type": "file",
                "kind": _file_kind(rf.suffix),
            }
        )

    return {
        "workspace": str(root_path),
        "workspace_name": root_label,
        "file_count": len(rel_files),
        "tree": root_node.to_dict(),
    }
