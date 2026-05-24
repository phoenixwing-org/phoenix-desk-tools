"""右侧页面栈：同一时刻只显示一个面板。"""

from __future__ import annotations

import customtkinter as ctk

from fcdesk.pages.base import BasePage


class PageStack(ctk.CTkFrame):
    def __init__(self, master, **kwargs) -> None:
        super().__init__(master, corner_radius=0, **kwargs)
        self._pages: dict[str, BasePage] = {}
        self._current: str | None = None
        self.grid_rowconfigure(0, weight=1)
        self.grid_columnconfigure(0, weight=1)

    @property
    def current_id(self) -> str | None:
        """当前展示的 page_id。"""
        return self._current

    def get_current_page(self) -> BasePage | None:
        """当前页实例（无当前页时为 ``None``）。"""
        if self._current is None:
            return None
        return self._pages.get(self._current)

    def register(self, page_id: str, page: BasePage) -> None:
        self._pages[page_id] = page
        page.grid(row=0, column=0, sticky="nsew")
        page.grid_remove()

    def show(self, page_id: str) -> None:
        if page_id not in self._pages:
            raise KeyError(f"未注册页面: {page_id}")
        if self._current and self._current in self._pages:
            self._pages[self._current].grid_remove()
        self._pages[page_id].grid()
        self._pages[page_id].on_show()
        self._current = page_id

    def get_page(self, page_id: str) -> BasePage:
        return self._pages[page_id]
