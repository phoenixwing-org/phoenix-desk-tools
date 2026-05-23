"""顶部工具条：条目由 JSON 配置。"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

import customtkinter as ctk


class Toolbar(ctk.CTkFrame):
    def __init__(
        self,
        master,
        items: list[dict[str, Any]],
        actions: dict[str, Callable[[], None]],
        **kwargs,
    ) -> None:
        super().__init__(master, height=44, corner_radius=0, **kwargs)
        self.grid_propagate(False)
        self._actions = actions

        col = 0
        for item in items:
            if item.get("separator"):
                sep = ctk.CTkFrame(self, width=2, height=28, fg_color=("gray70", "gray35"))
                sep.grid(row=0, column=col, padx=(8, 4), pady=8, sticky="ns")
                col += 1
                continue

            action = item.get("action", "")
            btn = ctk.CTkButton(
                self,
                text=item.get("label", action),
                width=item.get("width", 90),
                height=30,
                command=lambda a=action: self._invoke(a),
            )
            btn.grid(row=0, column=col, padx=4, pady=7)
            col += 1

        self.grid_columnconfigure(col, weight=1)

    def _invoke(self, action: str) -> None:
        handler = self._actions.get(action)
        if handler:
            handler()
