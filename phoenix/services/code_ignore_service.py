"""Code 模块共用忽略配置（Web API）。"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from phoenix.code.ignore import (
    IGNORE_PRESETS,
    load_custom_ignore_from_prefs,
    load_ignore_config,
    parse_custom_ignore_lines,
)
from phoenix.config.user_prefs import (
    format_resolved_under_workspace,
    load_workspace_prefs,
    merge_workspace_section,
)

_SECTION = "code_ignore"


def _workspace_root(repo_root: Path) -> Path:
    rr = repo_root.expanduser().resolve(strict=False)
    if not rr.is_dir():
        raise ValueError(f"工作空间不是有效目录: {rr}")
    return rr


def get_code_ignore_prefs(repo_root: Path) -> dict[str, Any]:
    rr = repo_root.expanduser().resolve(strict=False)
    root = _workspace_root(rr)
    pv = load_workspace_prefs(rr).get(_SECTION) or {}
    custom, preset = load_custom_ignore_from_prefs(rr)
    ignore_cfg = load_ignore_config(rr, custom)
    preset = str(pv.get("ignore_preset") or preset or "").strip().lower()
    return {
        "workspace_path": str(root),
        "workspace_path_display": format_resolved_under_workspace(root, rr),
        "ignore_preset": preset if preset in IGNORE_PRESETS else "",
        "ignore_presets": [
            {"id": k, "label": k.upper(), "patterns": list(v)} for k, v in IGNORE_PRESETS.items()
        ],
        "custom_ignore": custom,
        "ignore_file": ignore_cfg["ignore_file"],
        "ignore_file_display": format_resolved_under_workspace(Path(ignore_cfg["ignore_file"]), rr),
        "ignore_file_exists": ignore_cfg["ignore_file_exists"],
        "legacy_ignore_sources": ignore_cfg["legacy_ignore_sources"],
        "ignore_builtin": ignore_cfg["ignore_builtin"],
        "ignore_file_patterns": ignore_cfg["ignore_file_patterns"],
        "ignore_custom_patterns": ignore_cfg["ignore_custom_patterns"],
        "ignore_patterns": ignore_cfg["ignore_patterns"],
        "consumers": [
            "code_index",
            "reorder_members",
            "code_rename",
            "code_uuid",
        ],
    }


def save_code_ignore_prefs(repo_root: Path, patch: dict[str, Any]) -> dict[str, Any]:
    rr = repo_root.expanduser().resolve(strict=False)
    stored: dict[str, Any] = {}
    if "custom_ignore" in patch:
        stored["custom_ignore"] = parse_custom_ignore_lines(patch.get("custom_ignore"))
    if "ignore_preset" in patch:
        preset = str(patch.get("ignore_preset") or "").strip().lower()
        if preset and preset not in IGNORE_PRESETS:
            raise ValueError(f"未知 ignore_preset: {preset!r}")
        stored["ignore_preset"] = preset
    merge_workspace_section(_SECTION, stored, rr)
    return get_code_ignore_prefs(rr)
