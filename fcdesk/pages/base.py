"""页面基类。"""

from __future__ import annotations

import customtkinter as ctk

from fcdesk.shell.state import AppState


class BasePage(ctk.CTkFrame):
    page_id: str = "base"

    def __init__(self, master, state: AppState, **kwargs) -> None:
        super().__init__(master, corner_radius=0, fg_color="transparent", **kwargs)
        self.state = state
        self.grid_rowconfigure(0, weight=1)
        self.grid_columnconfigure(0, weight=1)

    def on_show(self) -> None:
        """切换到本页时调用。"""

    def append_log(self, text: str) -> None:
        self.state.last_log = text
