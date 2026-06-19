"""兼容旧 import 路径；逻辑见 ``phoenix.code.ignore``。"""

from __future__ import annotations

from pathlib import Path

from phoenix.code.ignore import (
    DEFAULT_BUILTIN_PATTERNS as DEFAULT_IGNORE_PATTERNS,
    IGNORE_FILENAME,
    is_ignored_name,
    load_ignore_config,
    merge_ignore_patterns,
    parse_custom_ignore_lines,
)

_SOURCE_SUFFIXES = frozenset({".cpp", ".h", ".hpp"})


def ignore_file_path(repo_root: Path) -> Path:
    from phoenix.code.ignore import ignore_file_path as _path

    return _path(repo_root)


def load_ignore_patterns(repo_root: Path) -> tuple[list[str], Path, bool]:
    """返回 ``(effective_patterns, primary_file_path, primary_exists)``。"""
    cfg = load_ignore_config(repo_root)
    path = Path(cfg["ignore_file"])
    return cfg["ignore_patterns"], path, bool(cfg["ignore_file_exists"])


def is_listable_source_file(path: Path) -> bool:
    return path.is_file() and path.suffix.lower() in _SOURCE_SUFFIXES
