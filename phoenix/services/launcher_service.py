"""启动器配置 API 层（Web / 桌面共用 ``user_prefs``）。"""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Any

from phoenix.config.loader import DEFAULT_APP_TITLE, load_app_config
from phoenix.config.launcher_paths import platform_launcher_prefs_file
from phoenix.config.user_prefs import (
    WORKSPACE_DOTFILE_NAME,
    format_absolute_config_path,
    is_ephemeral_workspace_path,
    list_recent_workspace_paths_raw,
    load_launcher_prefs,
    prune_recent_workspaces,
    record_recent_workspace,
    remove_recent_workspace,
    save_launcher_freecad_dir,
    save_launcher_nav_modules,
    save_launcher_shell_layout,
)
from phoenix.freecad.default_install import default_freecad_install_dir


def app_config_payload() -> dict[str, Any]:
    cfg = load_app_config()
    app = cfg.get("app") or {}
    return {
        "title": str(app.get("title") or DEFAULT_APP_TITLE),
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
    default_fc = default_freecad_install_dir()
    return {
        "version": launcher.get("version", 2),
        "recent_workspaces": recent,
        "recent_workspace_entries": entries,
        "freecad_dir": fc_path,
        "default_freecad_dir": default_fc or "",
        "platform": sys.platform,
        "shell_layout": sl,
        "nav_modules": launcher.get("nav_modules") or {"enabled": ["cad", "code"]},
        "launcher_config_path": format_absolute_config_path(platform_launcher_prefs_file()),
    }


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
        ribbon_mode=patch.get("ribbon_mode"),
        right_panel_open=patch.get("right_panel_open"),
        mid_right_sash_px=patch.get("mid_right_sash_px"),
        right_panel_width_px=patch.get("right_panel_width_px"),
        log_panel_open=patch.get("log_panel_open"),
        log_panel_height_px=patch.get("log_panel_height_px"),
        log_auto_open_on_append=patch.get("log_auto_open_on_append"),
    )
    launcher = load_launcher_prefs()
    return launcher.get("shell_layout") or {}


def update_nav_modules(enabled: list[str]) -> dict[str, Any]:
    return save_launcher_nav_modules(enabled)


def activate_workspace(path: Path) -> dict[str, str]:
    p = path.expanduser().resolve(strict=False)
    if not p.is_dir():
        raise ValueError(f"不是有效目录: {p}")
    record_recent_workspace(p)
    return {"path": str(p), "name": p.name or str(p)}


def add_recent_workspace_entry(path: str) -> dict[str, Any]:
    """仅写入最近工作空间列表，不切换当前活动工作空间。"""
    raw = path.strip()
    if not raw:
        raise ValueError("路径不能为空")
    p = Path(raw).expanduser().resolve(strict=False)
    if not p.is_dir():
        raise ValueError(f"不是有效目录: {p}")
    record_recent_workspace(p)
    return launcher_prefs_payload()


def pick_workspace_directory_via_dialog(
    *,
    current_workspace: Path,
    path_hint: str = "",
) -> dict[str, Any]:
    """本机原生选目录（配置页「浏览…」）。"""
    from phoenix.shell.native_dialog import (
        pick_directory_isolated,
        resolve_directory_dialog_initialdir,
    )

    hint = (path_hint or "").strip() or str(current_workspace)
    initial = resolve_directory_dialog_initialdir(current_workspace, path_hint=hint)
    sel = pick_directory_isolated(
        title="选择工作空间根目录",
        initialdir=initial,
    )
    if not sel:
        return {"cancelled": True, "path": ""}
    p = Path(sel).expanduser().resolve(strict=False)
    if not p.is_dir():
        raise ValueError(f"不是有效目录: {p}")
    return {"cancelled": False, "path": str(p)}


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
