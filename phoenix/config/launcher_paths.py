"""本机启动器 JSON 路径（与源码树 / git clone 无关）。"""

from __future__ import annotations

import os
import sys
from pathlib import Path

# 与 Gitee 组织 PhoenixWing321 / 仓库 phoenix-freecad-desktop 一致
_VENDOR_ID = "phoenix-wing"
_APP_ID = "phoenix"
_LAUNCHER_FILENAME = "launcher.json"


def _platform_config_root() -> Path:
    if sys.platform == "darwin":
        return Path.home() / "Library" / "Application Support"
    if sys.platform == "win32":
        local = os.environ.get("LOCALAPPDATA", "").strip()
        if local:
            return Path(local)
        return Path.home() / "AppData" / "Local"
    xdg = os.environ.get("XDG_CONFIG_HOME", "").strip()
    if xdg:
        return Path(xdg).expanduser()
    return Path.home() / ".config"


def platform_launcher_prefs_dir() -> Path:
    """``…/phoenix-wing/phoenix/``（本机配置，与仓库路径无关）。"""
    return _platform_config_root() / _VENDOR_ID / _APP_ID


def legacy_vendor_fcdesk_launcher_prefs_file() -> Path:
    """旧版 ``…/phoenix-wing/fcdesk/launcher.json``（import 包名 ``fcdesk`` 时期）。"""
    return _platform_config_root() / _VENDOR_ID / "fcdesk" / _LAUNCHER_FILENAME


def legacy_flat_launcher_prefs_file() -> Path:
    """更旧单层 ``…/fcdesk/launcher.json``（仅迁移读取）。"""
    return _platform_config_root() / "fcdesk" / _LAUNCHER_FILENAME


def platform_launcher_prefs_file() -> Path:
    return platform_launcher_prefs_dir() / _LAUNCHER_FILENAME
