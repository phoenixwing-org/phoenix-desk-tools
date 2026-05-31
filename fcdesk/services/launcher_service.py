"""启动器配置 API 层（Web / 桌面共用 ``user_prefs``）。"""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Any

from fcdesk.config.loader import load_app_config
from fcdesk.config.launcher_paths import platform_launcher_prefs_file
from fcdesk.config.user_prefs import (
    WORKSPACE_DOTFILE_NAME,
    format_absolute_config_path,
    is_ephemeral_workspace_path,
    legacy_launcher_prefs_file,
    list_recent_workspace_paths_raw,
    load_launcher_prefs,
    prune_recent_workspaces,
    record_recent_workspace,
    remove_recent_workspace,
    save_launcher_freecad_dir,
    save_launcher_shell_layout,
)
from fcdesk.freecad.default_install import default_freecad_install_dir


def app_config_payload() -> dict[str, Any]:
    cfg = load_app_config()
    app = cfg.get("app") or {}
    return {
        "title": str(app.get("title") or "FreeCAD 管理工具"),
        "navigation": cfg.get("navigation") or [],
        "toolbar": cfg.get("toolbar") or {"items": []},
        "workbench": cfg.get("workbench") or {},
        "workspace_dotfile": WORKSPACE_DOTFILE_NAME,
        "launcher_config_path": format_absolute_config_path(platform_launcher_prefs_file()),
    }


def launcher_prefs_payload() -> dict[str, Any]:
    prune_recent_workspaces(persist=True)
    launcher = load_launcher_prefs()
    entries = [
        {
            "path": format_absolute_config_path(p),
            "exists": p.is_dir(),
            "ephemeral": is_ephemeral_workspace_path(p),
        }
        for p in list_recent_workspace_paths_raw()
        if not is_ephemeral_workspace_path(p)
    ]
    recent = [e["path"] for e in entries if e["exists"]]
    fd = launcher.get("freecad_dir")
    fc_path = format_absolute_config_path(Path(str(fd))) if fd else ""
    sl = launcher.get("shell_layout") or {}
    legacy = legacy_launcher_prefs_file()
    default_fc = default_freecad_install_dir()
    return {
        "version": launcher.get("version", 2),
        "recent_workspaces": recent,
        "recent_workspace_entries": entries,
        "freecad_dir": fc_path,
        "default_freecad_dir": default_fc or "",
        "platform": sys.platform,
        "shell_layout": sl,
        "launcher_config_path": format_absolute_config_path(platform_launcher_prefs_file()),
        "legacy_launcher_path": format_absolute_config_path(legacy),
        "legacy_launcher_exists": legacy.is_file(),
    }


def sync_launcher_from_legacy() -> dict[str, Any]:
    """配置页：从旧 ``workspace.custom.json`` 合并最近工作空间等到 Web launcher。"""
    from fcdesk.config.user_prefs import migrate_launcher_prefs

    migrated = migrate_launcher_prefs()
    payload = launcher_prefs_payload()
    payload["migrated_from_legacy"] = migrated
    return payload


def update_launcher_freecad(path: str | None) -> str:
    if path and path.strip():
        p = Path(path.strip()).expanduser().resolve(strict=False)
        if not p.is_dir():
            raise ValueError(f"不是有效目录: {p}")
        save_launcher_freecad_dir(p)
        return format_absolute_config_path(p)
    save_launcher_freecad_dir(None)
    return ""


def update_shell_layout(patch: dict[str, Any]) -> dict[str, Any]:
    save_launcher_shell_layout(
        nav_rail_mode=patch.get("nav_rail_mode"),
        right_panel_open=patch.get("right_panel_open"),
        mid_right_sash_px=patch.get("mid_right_sash_px"),
        right_panel_width_px=patch.get("right_panel_width_px"),
        log_panel_open=patch.get("log_panel_open"),
        log_panel_height_px=patch.get("log_panel_height_px"),
        log_auto_open_on_append=patch.get("log_auto_open_on_append"),
    )
    launcher = load_launcher_prefs()
    return launcher.get("shell_layout") or {}


def activate_workspace(path: Path) -> dict[str, str]:
    p = path.expanduser().resolve(strict=False)
    if not p.is_dir():
        raise ValueError(f"不是有效目录: {p}")
    record_recent_workspace(p)
    return {"path": str(p), "name": p.name or str(p)}


def remove_recent_workspace_entry(path: str) -> dict[str, Any]:
    raw = path.strip()
    if not raw:
        raise ValueError("路径不能为空")
    p = Path(raw).expanduser().resolve(strict=False)
    if not remove_recent_workspace(p):
        raise ValueError("列表中未找到该路径")
    return launcher_prefs_payload()


def prune_recent_workspace_entries() -> dict[str, Any]:
    removed = prune_recent_workspaces(persist=True)
    payload = launcher_prefs_payload()
    payload["pruned_count"] = removed
    return payload
