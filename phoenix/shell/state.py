"""应用级共享状态（路径等）。工作空间根 (`repo_root`) 与 cwd，不使用 Python/包安装路径。"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path


@dataclass
class AppState:
    # 请在工具条中选择工作空间（项目/CAD）根；首轮默认为当前工作目录（运行前可 cd 到项目根）
    repo_root: Path = field(default_factory=lambda: Path.cwd().resolve())
    freecad_dir: Path | None = None
    last_log: str = ""

    def default_freecad_dir(self) -> Path:
        """仅优先用户已选的 FreeCAD 目录，否则退回仓库根（不做子目录猜测）。"""
        if self.freecad_dir and self.freecad_dir.is_dir():
            return self.freecad_dir
        return self.repo_root.expanduser().resolve()
