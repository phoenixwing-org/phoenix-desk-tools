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
    get_recent_workspaces,
    legacy_launcher_prefs_file,
    load_launcher_prefs,
    record_recent_workspace,
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
        "workspace_dotfile": WORKSPACE_DOTFILE_NAME,
        "launcher_config_path": format_absolute_config_path(platform_launcher_prefs_file()),
    }


def launcher_prefs_payload() -> dict[str, Any]:
    launcher = load_launcher_prefs()
    recent = [
        format_absolute_config_path(p)
        for p in get_recent_workspaces()
    ]
    fd = launcher.get("freecad_dir")
    fc_path = format_absolute_config_path(Path(str(fd))) if fd else ""
    sl = launcher.get("shell_layout") or {}
    legacy = legacy_launcher_prefs_file()
    default_fc = default_freecad_install_dir()
    return {
        "version": launcher.get("version", 2),
        "recent_workspaces": recent,
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
