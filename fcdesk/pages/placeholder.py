from __future__ import annotations

import customtkinter as ctk

from fcdesk.pages.base import BasePage
from fcdesk.shell.state import AppState


class PlaceholderPage(BasePage):
    def __init__(
        self,
        master,
        state: AppState,
        page_id: str,
        title: str,
        hint: str = "",
        **kwargs,
    ) -> None:
        super().__init__(master, state, **kwargs)
        self.page_id = page_id

        box = ctk.CTkFrame(self)
        box.grid(row=0, column=0, padx=32, pady=(32, 32), sticky="nsew")
        self.grid_columnconfigure(0, weight=1)
        self.grid_rowconfigure(0, weight=1)
        box.grid_columnconfigure(0, weight=1)
        box.grid_rowconfigure(1, weight=1)

        ctk.CTkLabel(box, text=title, font=ctk.CTkFont(size=20, weight="bold")).grid(
            row=0, column=0, pady=(0, 8), sticky="nw"
        )
        ctk.CTkLabel(
            box,
            text=hint or "功能规划中，后续接入 FreeCAD / SQLite。",
            text_color=("gray30", "gray70"),
            anchor="w",
            justify="left",
            wraplength=720,
        ).grid(row=1, column=0, sticky="nw", pady=(0, 8))
