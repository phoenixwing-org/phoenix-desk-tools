"""解析 FreeCADCmd / freecadcmd 路径（不 import FreeCAD）。"""

from __future__ import annotations

import os
import sys
from collections.abc import Iterable
from pathlib import Path


def _try_executable(candidates: Iterable[Path]) -> Path | None:
    for c in candidates:
        try:
            if not c.is_file():
                continue
        except OSError:
            continue
        if os.name == "nt":
            return c.resolve()
        try:
            if os.access(c, os.X_OK):
                return c.resolve()
        except OSError:
            continue
        # 少数卷上无执行位仍可实际运行 cmd；Darwin 上对 bundle 内真实 ELF/Mach-O 兜底
        if sys.platform == "darwin" and os.path.getsize(c) > 32:
            return c.resolve()
    return None


def resolve_freecad_cmd(freecad_home: Path | str | None) -> Path | None:
    """在用户选择的 FreeCAD「安装目录」下查找命令行批次解释器。

    macOS DMG **常见两处**：

    - ``*.app/Contents/Resources/bin/freecadcmd``（新版本常见）
    - ``*.app/Contents/MacOS/FreeCADCmd``（部分旧安装）

    ``MacOS/FreeCAD`` 多为 GUI 启动器，不负责跑 ``*.py`` 批处理。

    若误选 ``…/*.app/Contents`` 或 ``…/Contents/Resources``，也会顺带尝试。
    """
    if not freecad_home:
        return None
    fh = Path(freecad_home).expanduser().resolve()

    candidates: list[Path] = []

    def add_ordered(paths: Iterable[Path]) -> None:
        for p in paths:
            if p not in candidates:
                candidates.append(p)

    add_ordered(
        [
            fh / "Contents" / "Resources" / "bin" / "freecadcmd",
            fh / "Contents" / "MacOS" / "FreeCADCmd",
            fh / "Contents" / "Resources" / "bin" / "FreeCADCmd",
            fh / "bin" / "freecadcmd",
            fh / "bin" / "FreeCADCmd",
            fh / "FreeCADCmd",
        ]
    )

    # 用户选深了：…/*.app/Contents/Resources
    if fh.name == "Resources" and fh.parent.name == "Contents":
        rb = fh / "bin"
        add_ordered([rb / "freecadcmd", rb / "FreeCADCmd"])

    # 用户选深了：…/*.app/Contents
    if fh.name == "Contents" and fh.parent.suffix.lower() == ".app":
        add_ordered(
            [
                fh / "Resources" / "bin" / "freecadcmd",
                fh / "Resources" / "bin" / "FreeCADCmd",
                fh / "MacOS" / "FreeCADCmd",
            ]
        )

    if os.name == "nt":
        add_ordered([fh / "FreeCADCmd.exe", fh / "bin" / "FreeCADCmd.exe"])

    uniq_key: list[Path] = []
    seen: set[str] = set()
    for p in candidates:
        s = str(p)
        if s in seen:
            continue
        seen.add(s)
        uniq_key.append(p)

    return _try_executable(uniq_key)
