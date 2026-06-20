"""在工作空间内递归遍历可扫描文本文件。"""

from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path
from typing import Literal

from phoenix.code.ignore import is_ignored_name, load_ignore_config
from phoenix.code.rename.binary import is_scannable_text_file

EntryKind = Literal["dir", "file"]


def scan_root(repo_root: Path, scope: str) -> Path:
    root = repo_root.expanduser().resolve(strict=False)
    if not scope or scope in (".", "/"):
        return root
    sub = (root / scope.strip().lstrip("/")).resolve(strict=False)
    if not str(sub).startswith(str(root)):
        raise ValueError("scope 须在工作空间内")
    if not sub.is_dir():
        raise ValueError(f"scope 不是有效目录: {scope}")
    return sub


def _scan_root(repo_root: Path, scope: str) -> Path:
    return scan_root(repo_root, scope)


def _rel_blocked(rel: str, patterns: list[str], *, include_ignored: bool) -> bool:
    if include_ignored:
        return False
    parts = rel.replace("\\", "/").split("/")
    return any(is_ignored_name(part, patterns) for part in parts)


def _indexed_subtree(rel_dir: str, indexed_paths: frozenset[str]) -> bool:
    prefix = rel_dir + "/"
    return any(p == rel_dir or p.startswith(prefix) for p in indexed_paths)


def _rel_in_indexed_scope(rel: str, indexed_paths: frozenset[str] | None, *, kind: EntryKind) -> bool:
    if indexed_paths is None:
        return True
    if kind == "dir":
        return _indexed_subtree(rel, indexed_paths)
    return rel in indexed_paths


def iter_workspace_entries(
    repo_root: Path,
    *,
    scope: str = "",
    ignore_patterns: list[str] | None = None,
    include_ignored: bool = False,
    dirs: bool = True,
    files: bool = True,
    indexed_paths: frozenset[str] | None = None,
) -> Iterator[tuple[Path, str, EntryKind]]:
    """yield ``(absolute_path, repo_rel_posix, kind)``；不含符号链接。"""
    root = repo_root.expanduser().resolve(strict=False)
    if not root.is_dir():
        return
    patterns = ignore_patterns if ignore_patterns is not None else load_ignore_config(root)["ignore_patterns"]
    start = scan_root(root, scope)

    def walk(cur: Path) -> Iterator[tuple[Path, str, EntryKind]]:
        try:
            entries = sorted(cur.iterdir(), key=lambda p: (not p.is_dir(), p.name.casefold()))
        except OSError:
            return
        for ent in entries:
            try:
                if ent.is_symlink():
                    continue
                rel = ent.relative_to(root).as_posix()
                if _rel_blocked(rel, patterns, include_ignored=include_ignored):
                    continue
                if ent.is_dir():
                    if indexed_paths is not None and not _indexed_subtree(rel, indexed_paths):
                        continue
                    if dirs and _rel_in_indexed_scope(rel, indexed_paths, kind="dir"):
                        yield ent, rel, "dir"
                    if not include_ignored and is_ignored_name(ent.name, patterns):
                        continue
                    yield from walk(ent)
                    continue
                if files and _rel_in_indexed_scope(rel, indexed_paths, kind="file"):
                    yield ent, rel, "file"
            except (OSError, ValueError):
                continue

    if start == root:
        yield from walk(root)
    elif start.is_dir():
        rel = start.relative_to(root).as_posix()
        if not _rel_blocked(rel, patterns, include_ignored=include_ignored):
            if indexed_paths is None or _indexed_subtree(rel, indexed_paths):
                if dirs and _rel_in_indexed_scope(rel, indexed_paths, kind="dir"):
                    yield start, rel, "dir"
                yield from walk(start)
    elif start.is_file() and files:
        rel = start.relative_to(root).as_posix()
        if not _rel_blocked(rel, patterns, include_ignored=include_ignored):
            if _rel_in_indexed_scope(rel, indexed_paths, kind="file"):
                yield start, rel, "file"


def iter_scannable_files(
    repo_root: Path,
    *,
    scope: str = "",
    ignore_patterns: list[str] | None = None,
    include_ignored: bool = False,
    indexed_paths: frozenset[str] | None = None,
) -> Iterator[tuple[Path, str]]:
    """yield ``(absolute_path, repo_rel_posix)``。"""
    root = repo_root.expanduser().resolve(strict=False)
    if not root.is_dir():
        return
    patterns = ignore_patterns if ignore_patterns is not None else load_ignore_config(root)["ignore_patterns"]
    start = scan_root(root, scope)

    def walk(cur: Path) -> Iterator[tuple[Path, str]]:
        try:
            entries = sorted(cur.iterdir(), key=lambda p: (not p.is_dir(), p.name.casefold()))
        except OSError:
            return
        for ent in entries:
            try:
                if ent.is_symlink():
                    continue
                if ent.is_dir():
                    rel = ent.relative_to(root).as_posix()
                    if indexed_paths is not None and not _indexed_subtree(rel, indexed_paths):
                        continue
                    if not include_ignored and is_ignored_name(ent.name, patterns):
                        continue
                    yield from walk(ent)
                    continue
                if not is_scannable_text_file(ent):
                    continue
                rel = ent.relative_to(root).as_posix()
                if indexed_paths is not None and rel not in indexed_paths:
                    continue
                if not include_ignored:
                    parts = rel.split("/")
                    if any(is_ignored_name(part, patterns) for part in parts[:-1]):
                        continue
                yield ent, rel
            except (OSError, ValueError):
                continue

    if start == root:
        yield from walk(root)
    else:
        if start.is_file() and is_scannable_text_file(start):
            rel = start.relative_to(root).as_posix()
            if indexed_paths is None or rel in indexed_paths:
                if include_ignored or not _rel_blocked(rel, patterns, include_ignored=False):
                    yield start, rel
        elif start.is_dir():
            rel = start.relative_to(root).as_posix()
            if indexed_paths is None or _indexed_subtree(rel, indexed_paths):
                yield from walk(start)
