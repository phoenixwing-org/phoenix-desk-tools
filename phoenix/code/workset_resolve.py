"""工作集路径展开 — 供成员排序 / 批量改名 / UUID 替换 / Code 索引共用。

管线：
  worket paths → normalize_workset_paths (归一化、去嵌套、去重)
                → resolve_workset_to_files (目录展开 + 扩展名筛选)
                → resolve_workset_to_dirs (叶子目录收集)
"""

from __future__ import annotations

import fnmatch
from pathlib import Path
from typing import Iterable


def normalize_workset_paths(paths: list[str]) -> list[str]:
    """归一化工作集路径：统一分隔符、去嵌套、去重、排序。

    去嵌套规则：如果工作集同时有 ``src/`` 和 ``src/sub/``，则去掉 ``src/sub/``
    （父目录已包含子目录，展开时会自然覆盖）。
    """
    # 归一化格式
    normalized: list[str] = []
    seen: set[str] = set()
    for raw in paths:
        p = raw.strip().replace("\\", "/")
        # 去除前后 ./ 和 /
        while p.startswith("./"):
            p = p[2:]
        p = p.strip("/")
        if not p or ".." in p:
            continue
        if p in seen:
            continue
        seen.add(p)
        normalized.append(p)

    # 按路径深度 + 字母序排列（浅在前）
    normalized.sort(key=lambda x: (x.count("/"), x.casefold()))

    # 去嵌套：如果 p 以某个更短的 parent + "/" 开头，说明 p 是 parent 的子目录/文件
    result: list[str] = []
    for p in normalized:
        is_nested = False
        for parent in result:
            if p == parent:
                is_nested = True
                break
            if p.startswith(parent + "/"):
                is_nested = True
                break
        if not is_nested:
            result.append(p)

    return result


def _is_ignored_dir(
    dir_name: str,
    ignore_patterns: list[str],
) -> bool:
    """目录是否命中忽略规则（不区分大小写 fnmatch）。"""
    for pat in ignore_patterns:
        if fnmatch.fnmatch(dir_name.casefold(), pat.casefold()):
            return True
    return False


def _iter_files_matching(
    root: Path,
    file_patterns: list[str],
    ignore_patterns: list[str],
    workspace_root: Path,
) -> Iterable[Path]:
    """在 root 下递归遍历，返回匹配 file_patterns 且不在忽略目录中的文件。

    忽略仅对目录名生效（与 ``iter_source_files`` 一致），不影响文件名。
    """
    scan_root = root.expanduser().resolve(strict=False)
    ws = workspace_root.expanduser().resolve(strict=False)

    for path in scan_root.rglob("*"):
        if not path.is_file():
            continue

        # 检查扩展名匹配
        matched = False
        for pat in file_patterns:
            if pat.startswith("*."):
                ext = pat[1:]  # 如 "*.cpp" → ".cpp"
                if path.suffix == ext:
                    matched = True
                    break
            elif fnmatch.fnmatch(path.name, pat):
                matched = True
                break
        if not matched:
            continue

        # 检查路径中是否有忽略目录
        try:
            rel = path.relative_to(ws)
        except ValueError:
            rel = path.relative_to(scan_root)
        if any(_is_ignored_dir(part, ignore_patterns) for part in rel.parts[:-1]):
            continue

        yield path


def resolve_workset_to_files(
    paths: list[str],
    workspace_root: str,
    file_patterns: list[str],
    ignore_patterns: list[str] | None = None,
) -> list[str]:
    """工作集路径 → 文件列表（repo_rel_path）。

    目录递归扫描匹配的文件，文件直接按扩展名筛选纳入。

    Args:
        paths: 工作集中的路径列表（可能混合目录和文件）
        workspace_root: 工作空间根目录
        file_patterns: 文件匹配模式（如 ``['*.h', '*.hpp', '*.cpp']``）
        ignore_patterns: 忽略目录名模式，默认使用内置列表

    Returns:
        repo_rel_path 列表
    """
    if ignore_patterns is None:
        ignore_patterns = _default_ignore_patterns()

    root = Path(workspace_root).expanduser().resolve(strict=False)
    normalized = normalize_workset_paths(paths)

    file_paths: list[str] = []

    for p in normalized:
        target = root / p
        if not target.exists():
            continue

        if target.is_file():
            # 文件直接筛选
            for pat in file_patterns:
                if pat.startswith("*."):
                    if target.suffix == pat[1:]:
                        file_paths.append(p)
                        break
                elif fnmatch.fnmatch(target.name, pat):
                    file_paths.append(p)
                    break
        elif target.is_dir():
            # 目录递归展开
            for fpath in _iter_files_matching(target, file_patterns, ignore_patterns, root):
                try:
                    rel = fpath.relative_to(root).as_posix()
                except ValueError:
                    continue
                file_paths.append(rel)

    # 去重排序
    seen: set[str] = set()
    result: list[str] = []
    for fp in file_paths:
        if fp not in seen:
            seen.add(fp)
            result.append(fp)
    result.sort(key=lambda x: x.casefold())
    return result


def resolve_workset_to_dirs(
    paths: list[str],
    workspace_root: str,
    ignore_patterns: list[str] | None = None,
) -> list[str]:
    """工作集路径 → 叶子目录列表（repo_rel_path）。

    如果工作集中有目录，保留之；如果目录嵌套已由 ``normalize_workset_paths`` 处理。

    Returns:
        repo_rel_path 列表（目录）
    """
    if ignore_patterns is None:
        ignore_patterns = _default_ignore_patterns()

    root = Path(workspace_root).expanduser().resolve(strict=False)
    normalized = normalize_workset_paths(paths)

    dir_paths: list[str] = []
    for p in normalized:
        target = root / p
        if target.is_dir():
            dir_paths.append(p)

    dir_paths.sort(key=lambda x: x.casefold())
    return dir_paths


def _default_ignore_patterns() -> list[str]:
    """内置忽略目录名模式（与 ``ignore.py`` 的 DEFAULT_BUILTIN_PATTERNS 对齐）。"""
    return [
        ".phoenix",
        ".git",
        ".svn",
        ".hg",
        "__pycache__",
        ".venv",
        "venv",
        "env",
        ".env",
        "node_modules",
        "build",
        "dist",
        "Debug",
        "Release",
        "cmake-build-*",
        "bin",
        "obj",
        ".vs",
        ".idea",
        ".vscode",
        ".cursor",
    ]
