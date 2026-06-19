"""构建 / 生成物等「过程目录」启发式（用于忽略推荐与内置通配）。"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from phoenix.code.ignore import is_ignored_name, load_ignore_config

# 内置通配：与精确名 ``build`` / ``web-ui`` 互补，覆盖 build-ui、cmake-build-foo 等
PROCESS_DIR_GLOB_PATTERNS: tuple[str, ...] = (
    "build-*",
    "cmake-build-*",
    "CMakeFiles",
    "out",
    "bin",
    "obj",
    "x64",
    "x86",
    "Win32",
    "Intermediate",
    "ipch",
    "DerivedData",
    ".cache",
    "_build",
    "bld",
)

# 精确名（非通配），常见于 CAA / MSVC / Qt
PROCESS_DIR_EXACT_NAMES: frozenset[str] = frozenset(
    {
        "build",
        "Build",
        "Debug",
        "Release",
        "RelWithDebInfo",
        "MinSizeRel",
        "xcodebuild",
        "artifacts",
        "target",
    }
)


def is_process_dir_name(name: str, *, extra_patterns: list[str] | None = None) -> bool:
    """目录 basename 是否像构建 / 生成过程目录。"""
    if not name or name in {".", ".."}:
        return False
    if name.startswith("."):
        return True
    cf = name.casefold()
    if cf in {n.casefold() for n in PROCESS_DIR_EXACT_NAMES}:
        return True
    patterns = list(PROCESS_DIR_GLOB_PATTERNS)
    if extra_patterns:
        patterns.extend(extra_patterns)
    return is_ignored_name(name, patterns)


def _scan_level1_dirs(repo_root: Path) -> list[tuple[str, Path]]:
    root = repo_root.expanduser().resolve(strict=False)
    if not root.is_dir():
        return []
    out: list[tuple[str, Path]] = []
    try:
        for ent in sorted(root.iterdir(), key=lambda p: p.name.casefold()):
            if ent.is_symlink() or not ent.is_dir():
                continue
            out.append((ent.name, ent))
    except OSError:
        pass
    return out


def suggest_process_dir_ignores(repo_root: Path) -> list[dict[str, Any]]:
    """列出工作空间一级目录中、像过程目录但尚未被当前忽略规则覆盖的项。"""
    cfg = load_ignore_config(repo_root)
    patterns = cfg["ignore_patterns"]
    suggestions: list[dict[str, Any]] = []
    seen: set[str] = set()

    for name, path in _scan_level1_dirs(repo_root):
        if not is_process_dir_name(name):
            continue
        if is_ignored_name(name, patterns):
            continue
        key = name.casefold()
        if key in seen:
            continue
        seen.add(key)
        suggestions.append(
            {
                "name": name,
                "kind": "dir",
                "reason": "process_dir",
                "repo_rel_path": name,
                "suggested_pattern": _suggest_pattern_for_name(name),
            }
        )
    return suggestions


def _suggest_pattern_for_name(name: str) -> str:
    lower = name.casefold()
    if lower.startswith("build-") or lower.startswith("cmake-build-"):
        prefix = "build-" if lower.startswith("build-") else "cmake-build-"
        return f"{prefix}*"
    return name


def patterns_to_seed_from_suggestions(suggestions: list[dict[str, Any]]) -> list[str]:
    """合并为可写入 custom_ignore 的去重模式（优先通配）。"""
    out: list[str] = []
    seen: set[str] = set()
    for item in suggestions:
        pat = str(item.get("suggested_pattern") or item.get("name") or "").strip()
        if not pat:
            continue
        key = pat.casefold()
        if key in seen:
            continue
        seen.add(key)
        out.append(pat)
    return out
