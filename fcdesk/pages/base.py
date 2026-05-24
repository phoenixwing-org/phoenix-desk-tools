"""页面基类。"""

from __future__ import annotations

from pathlib import Path

import customtkinter as ctk

from fcdesk.shell.state import AppState


class BasePage(ctk.CTkFrame):
    page_id: str = "base"

    def __init__(self, master, state: AppState, **kwargs) -> None:
        super().__init__(master, corner_radius=0, fg_color="transparent", **kwargs)
        self.state = state
        # 主列为可横向拉伸；纵向「吃满剩余高度」由各页对具体行单独设置 grid_rowconfigure(..., weight=)，
        # 避免默认把首行拉大导致标题在中间垂直居中。
        self.grid_columnconfigure(0, weight=1)

    def on_show(self) -> None:
        """切换到本页时调用。"""

    def on_workspace_tree_select(self, rel: Path | None) -> None:
        """全局侧栏「工作空间目录树」选中文件时调用（路径相对当前工作空间根）。"""
        ...

    def append_log(self, text: str) -> None:
        self.state.last_log = text
