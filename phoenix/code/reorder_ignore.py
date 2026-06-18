"""工作空间一级条目忽略规则（内置 + ``.phoenix/reorder-members.ignore``）。"""

from __future__ import annotations

import fnmatch
from pathlib import Path

from phoenix.config.user_prefs import workspace_phoenix_dir

IGNORE_FILENAME = "reorder-members.ignore"

# 内置：工作空间根下一级目录/文件名（始终生效）
DEFAULT_IGNORE_PATTERNS: tuple[str, ...] = (
    ".phoenix",
    ".git",
    ".vs",
    "build",
    "Build",
    "Debug",
    "Release",
    "dist",
    "node_modules",
    "web-ui",
    "__pycache__",
    ".venv",
    ".venv-desktop",
    "phoenix_freecad_desktop.egg-info",
)

_SOURCE_SUFFIXES = frozenset({".cpp", ".h", ".hpp"})


def ignore_file_path(repo_root: Path) -> Path:
    return workspace_phoenix_dir(repo_root) / IGNORE_FILENAME


def load_ignore_patterns(repo_root: Path) -> tuple[list[str], Path, bool]:
    """返回 ``(patterns, ignore_file_path, file_exists)``。"""
    patterns: list[str] = list(DEFAULT_IGNORE_PATTERNS)
    path = ignore_file_path(repo_root)
    if path.is_file():
        for raw in path.read_text(encoding="utf-8", errors="replace").splitlines():
            line = raw.strip()
            if not line or line.startswith("#"):
                continue
            patterns.append(line)
    # 去重保序
    seen: set[str] = set()
    unique: list[str] = []
    for p in patterns:
        key = p.casefold()
        if key in seen:
            continue
        seen.add(key)
        unique.append(p)
    return unique, path, path.is_file()


def is_ignored_name(name: str, patterns: list[str]) -> bool:
    if name.startswith("."):
        return True
    cf = name.casefold()
    for pat in patterns:
        p = pat.strip()
        if not p:
            continue
        if any(ch in p for ch in "*?[]"):
            if fnmatch.fnmatch(name, p) or fnmatch.fnmatch(cf, p.casefold()):
                return True
        elif cf == p.casefold():
            return True
    return False


def is_listable_source_file(path: Path) -> bool:
    return path.is_file() and path.suffix.lower() in _SOURCE_SUFFIXES
