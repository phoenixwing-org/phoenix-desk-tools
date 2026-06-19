"""Code 模块共用忽略规则。

三路与合并（所有 Code 工具统一使用）：

1. **内置**：常见 build / VCS / IDE 目录名
2. **文件**：``.phoenix/code.ignore``（兼容旧 ``reorder-members.ignore`` / ``code-rename.ignore``）
3. **自定义**：工作空间偏好 ``code_ignore.custom_ignore``（CAA 等工程差异）
"""

from __future__ import annotations

import fnmatch
from pathlib import Path
from typing import Any

from phoenix.config.user_prefs import load_workspace_prefs, workspace_phoenix_dir

IGNORE_FILENAME = "code.ignore"
LEGACY_IGNORE_FILENAMES: tuple[str, ...] = (
    "reorder-members.ignore",
    "code-rename.ignore",
)

DEFAULT_BUILTIN_PATTERNS: tuple[str, ...] = (
    ".phoenix",
    ".git",
    ".svn",
    ".hg",
    ".vs",
    ".idea",
    ".cursor",
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
    "venv",
    "phoenix_freecad_desktop.egg-info",
    "cmake-build-debug",
    "cmake-build-release",
    "build-*",
    "cmake-build-*",
    "out",
    "bin",
    "obj",
    "x64",
    "x86",
    "Win32",
    "Intermediate",
    "DerivedData",
    ".cache",
    "_build",
)

IGNORE_PRESETS: dict[str, tuple[str, ...]] = {
    "caa": (
        "ImportedInterfaces",
        "LocalGenerated",
        "ProtectedGenerated",
        "PrivateGenerated",
        "intel_a",
        "win_b64",
    ),
}

_PREFS_SECTION = "code_ignore"
_LEGACY_PREFS_SECTION = "code_rename"


def ignore_file_path(repo_root: Path) -> Path:
    return workspace_phoenix_dir(repo_root) / IGNORE_FILENAME


def _dedupe_patterns(patterns: list[str]) -> list[str]:
    seen: set[str] = set()
    unique: list[str] = []
    for p in patterns:
        key = p.casefold()
        if key in seen:
            continue
        seen.add(key)
        unique.append(p)
    return unique


def parse_custom_ignore_lines(raw: Any) -> list[str]:
    if raw is None:
        return []
    if isinstance(raw, str):
        lines = raw.splitlines()
    elif isinstance(raw, list):
        lines = [str(x) for x in raw]
    else:
        raise ValueError("custom_ignore 须为字符串数组或换行分隔文本")
    out: list[str] = []
    for line in lines:
        s = line.strip()
        if not s or s.startswith("#"):
            continue
        out.append(s)
    return out


def _read_pattern_file(path: Path) -> list[str]:
    if not path.is_file():
        return []
    patterns: list[str] = []
    for raw in path.read_text(encoding="utf-8", errors="replace").splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        patterns.append(line)
    return patterns


def read_ignore_file_patterns(repo_root: Path) -> tuple[list[str], Path, bool, list[dict[str, Any]]]:
    """``code.ignore`` 条目；若主文件不存在则合并旧文件名中的条目。

    返回 ``(file_only_patterns, primary_path, primary_exists, legacy_sources)``。
    """
    primary = ignore_file_path(repo_root)
    phoenix = workspace_phoenix_dir(repo_root)
    patterns: list[str] = []
    legacy_sources: list[dict[str, Any]] = []

    if primary.is_file():
        patterns.extend(_read_pattern_file(primary))
    else:
        for legacy_name in LEGACY_IGNORE_FILENAMES:
            legacy_path = phoenix / legacy_name
            legacy_patterns = _read_pattern_file(legacy_path)
            if legacy_patterns:
                legacy_sources.append(
                    {
                        "filename": legacy_name,
                        "patterns": legacy_patterns,
                    }
                )
                patterns.extend(legacy_patterns)

    return _dedupe_patterns(patterns), primary, primary.is_file(), legacy_sources


def load_custom_ignore_from_prefs(repo_root: Path) -> tuple[list[str], str]:
    pv = load_workspace_prefs(repo_root)
    sec = pv.get(_PREFS_SECTION) or {}
    custom = parse_custom_ignore_lines(sec.get("custom_ignore"))
    preset = str(sec.get("ignore_preset") or "").strip().lower()
    if not custom:
        legacy = pv.get(_LEGACY_PREFS_SECTION) or {}
        custom = parse_custom_ignore_lines(legacy.get("custom_ignore"))
        if not preset:
            preset = str(legacy.get("ignore_preset") or "").strip().lower()
    return custom, preset if preset in IGNORE_PRESETS else ""


def merge_ignore_patterns(
    *,
    file_patterns: list[str] | None = None,
    custom_patterns: list[str] | None = None,
    include_builtin: bool = True,
) -> list[str]:
    merged: list[str] = []
    if include_builtin:
        merged.extend(DEFAULT_BUILTIN_PATTERNS)
    if file_patterns:
        merged.extend(file_patterns)
    if custom_patterns:
        merged.extend(custom_patterns)
    return _dedupe_patterns(merged)


def load_ignore_config(repo_root: Path, custom_patterns: list[str] | None = None) -> dict[str, Any]:
    if custom_patterns is None:
        custom_patterns, _ = load_custom_ignore_from_prefs(repo_root)
    file_only, path, primary_exists, legacy_sources = read_ignore_file_patterns(repo_root)
    custom = _dedupe_patterns(list(custom_patterns))
    return {
        "ignore_builtin": list(DEFAULT_BUILTIN_PATTERNS),
        "ignore_file_patterns": file_only,
        "ignore_custom_patterns": custom,
        "ignore_patterns": merge_ignore_patterns(file_patterns=file_only, custom_patterns=custom),
        "ignore_file": str(path),
        "ignore_file_exists": primary_exists,
        "legacy_ignore_sources": legacy_sources,
    }


def is_ignored_name(name: str, patterns: list[str]) -> bool:
    """匹配工作空间一级目录/文件名，或递归扫描时的目录 basename。"""
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


def should_skip_code_dir(name: str, patterns: list[str]) -> bool:
    return is_ignored_name(name, patterns)


def preset_patterns(preset_id: str) -> list[str]:
    key = str(preset_id or "").strip().lower()
    if not key:
        return []
    tpl = IGNORE_PRESETS.get(key)
    if tpl is None:
        raise ValueError(f"未知 ignore_preset: {preset_id!r}，可选 {', '.join(IGNORE_PRESETS)}")
    return list(tpl)
