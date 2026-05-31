"""各平台 FreeCAD 默认安装目录（配置页「默认位置」）。"""

from __future__ import annotations

import os
import sys
from pathlib import Path


def default_freecad_install_dir() -> str | None:
    """返回当前平台常用的 FreeCAD 安装目录；Linux 等无约定时返回 ``None``。"""
    if sys.platform == "darwin":
        return "/Applications/FreeCAD.app"
    if sys.platform == "win32":
        program_files = os.environ.get("ProgramFiles", r"C:\Program Files")
        return str(Path(program_files) / "FreeCAD 1.1")
    return None
