"""应用级共享状态（路径等）。工作空间根与工具安装目录分离。"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path


@dataclass
class AppState:
    # 用户 CAD 工作空间根；未配置时为 None（浏览对话框默认「文档」）
    repo_root: Path | None = None
    freecad_dir: Path | None = None
    last_log: str = ""

    def default_freecad_dir(self) -> Path | None:
        """优先用户已选的 FreeCAD 目录，否则 None。"""
        if self.freecad_dir and self.freecad_dir.is_dir():
            return self.freecad_dir
        if self.repo_root and self.repo_root.is_dir():
            return self.repo_root.expanduser().resolve()
        return None
