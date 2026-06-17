"""phoenix ↔ FreeCAD GUI 收件箱桥的目录约定（桌面端与监听宏共用同一布局）。"""

from __future__ import annotations

from pathlib import Path


def bridge_root() -> Path:
    return Path.home() / ".phoenix" / "freecad_bridge"


def inbox_dir() -> Path:
    return bridge_root() / "inbox"


def done_dir() -> Path:
    return bridge_root() / "done"


def ensure_bridge_dirs() -> None:
    inbox_dir().mkdir(parents=True, exist_ok=True)
    done_dir().mkdir(parents=True, exist_ok=True)
