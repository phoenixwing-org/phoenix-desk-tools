"""左侧大功能导航。"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

import customtkinter as ctk


class NavSidebar(ctk.CTkFrame):
    def __init__(
        self,
        master,
        items: list[dict[str, Any]],
        on_select: Callable[[str], None],
        **kwargs,
    ) -> None:
        super().__init__(master, width=200, corner_radius=0, **kwargs)
        self.grid_propagate(False)
        self._on_select = on_select
        self._buttons: dict[str, ctk.CTkButton] = {}
        self._active: str | None = None

        title = ctk.CTkLabel(
            self,
            text="功能",
            font=ctk.CTkFont(size=15, weight="bold"),
            anchor="w",
        )
        title.grid(row=0, column=0, padx=16, pady=(16, 8), sticky="ew")

        for i, item in enumerate(items):
            page_id = item["page"]
            btn = ctk.CTkButton(
                self,
                text=item.get("label", page_id),
                anchor="w",
                height=36,
                fg_color="transparent",
                text_color=("gray10", "gray90"),
                hover_color=("gray75", "gray25"),
                command=lambda pid=page_id: self.select(pid),
            )
            btn.grid(row=i + 1, column=0, padx=12, pady=4, sticky="ew")
            self._buttons[page_id] = btn

        self.grid_columnconfigure(0, weight=1)

    def select(self, page_id: str) -> None:
        self._active = page_id
        for pid, btn in self._buttons.items():
            if pid == page_id:
                btn.configure(fg_color=("#3b8ed0", "#1f6aa5"))
            else:
                btn.configure(fg_color="transparent")
        self._on_select(page_id)
