"""左侧导航：二级宽窄 — 窄：仅图标 · 宽：图标 + 导航文字（类飞书侧栏收起/展开）。"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

import tkinter as tk
import customtkinter as ctk

# 窄栏总宽约 36
_NAV_RAIL_NARROW = 36
_NAV_ICON_BTN = 30
_NAV_RAIL_LABEL_W = 144

# 0 窄·仅图标  |  1 宽·图标 + 导航文字

_DEFAULT_PAGE_ICONS: dict[str, str] = {
    "home": "⚙",
    "fcstd_map": "◫",
    "part_catalog": "◉",
    "xlink_fix": "⎘",
    "step_batch": "⇩",
    "sw_step_export": "▣",
    "bom_export": "▤",
    "bom_apply": "✎",
    "part_dedup": "≡",
}


class NavSidebar(ctk.CTkFrame):
    def __init__(
        self,
        master,
        items: list[dict[str, Any]],
        on_select: Callable[[str], None],
        *,
        initial_rail_mode: int | None = None,
        on_toggle_right: Callable[[], None] | None = None,
        on_hover: Callable[[str | None], None] | None = None,
        on_rail_mode_change: Callable[[], None] | None = None,
        **kwargs,
    ) -> None:
        kwargs.setdefault("corner_radius", 0)
        super().__init__(master, width=_NAV_RAIL_NARROW, **kwargs)
        self.grid_propagate(False)
        self._items = items
        self._on_select = on_select
        self._on_toggle_right = on_toggle_right
        self._on_hover = on_hover
        self._on_rail_mode_change = on_rail_mode_change
        self._buttons: dict[str, ctk.CTkButton] = {}
        self._active: str | None = None
        rm = initial_rail_mode
        self._rail_mode: int = 0 if rm is None or int(rm) not in (0, 1) else int(rm)

        self._mode_btn = ctk.CTkButton(
            self,
            text="▶",
            width=_NAV_ICON_BTN,
            height=26,
            font=ctk.CTkFont(size=14),
            corner_radius=6,
            fg_color=("gray70", "gray40"),
            text_color=("gray99", "gray95"),
            hover_color=("gray60", "gray35"),
            command=self._cycle_rail_mode,
        )
        self._mode_btn.grid(row=0, column=0, padx=3, pady=(6, 6), sticky="n")
        self._mode_btn.bind("<Enter>", lambda _e: self._fire_hover("导航：单击切换 窄图标 / 宽（图标+文字）"))
        self._mode_btn.bind("<Leave>", lambda _e: self._fire_hover(None))

        for i, item in enumerate(items):
            page_id = item["page"]
            glyph = item.get("icon") or _DEFAULT_PAGE_ICONS.get(page_id, "•")
            lbl = item.get("label") or page_id
            btn = ctk.CTkButton(
                self,
                text=glyph,
                width=_NAV_ICON_BTN,
                height=_NAV_ICON_BTN,
                font=ctk.CTkFont(size=14),
                corner_radius=6,
                fg_color="transparent",
                text_color=("gray10", "gray90"),
                hover_color=("gray75", "gray25"),
                command=lambda pid=page_id: self.select(pid),
            )
            row = i + 1
            btn.grid(row=row, column=0, padx=3, pady=2, sticky="n")
            self._buttons[page_id] = btn
            btn.bind("<Enter>", lambda _e, t=lbl: self._fire_hover(t))
            btn.bind("<Leave>", lambda _e: self._fire_hover(None))
            setattr(btn, "_nav_glyph", glyph)
            setattr(btn, "_nav_lbl", lbl)

        spacer = len(items) + 1
        self.grid_rowconfigure(spacer, weight=1)

        if on_toggle_right is not None:
            self._dock_btn = ctk.CTkButton(
                self,
                text="»",
                width=_NAV_ICON_BTN,
                height=_NAV_ICON_BTN,
                font=ctk.CTkFont(size=17),
                corner_radius=6,
                fg_color="transparent",
                text_color=("gray30", "gray75"),
                hover_color=("gray75", "gray25"),
                command=on_toggle_right,
            )
            self._dock_btn.grid(row=spacer + 1, column=0, padx=3, pady=(0, 10), sticky="s")
            self._dock_btn.bind("<Enter>", lambda _e: self._fire_hover("全局侧栏：展开 / 收起"))
            self._dock_btn.bind("<Leave>", lambda _e: self._fire_hover(None))

        self.grid_columnconfigure(0, weight=1)
        self._apply_rail_geometry()

    def get_rail_mode(self) -> int:
        return int(self._rail_mode)

    def set_rail_mode(self, mode: int) -> None:
        m = 0 if int(mode) == 0 else 1
        if m == self._rail_mode:
            return
        self._rail_mode = m
        self._apply_rail_geometry()

    def _cycle_rail_mode(self) -> None:
        self._rail_mode = int(not bool(self._rail_mode))
        self._apply_rail_geometry()
        if self._on_rail_mode_change:
            self._on_rail_mode_change()

    def _button_inner_width(self, mode: int) -> int:
        if mode == 1:
            return max(96, _NAV_RAIL_LABEL_W - 20)
        return _NAV_ICON_BTN

    def _apply_rail_geometry(self) -> None:
        mode = int(self._rail_mode)
        outer = _NAV_RAIL_NARROW if mode == 0 else _NAV_RAIL_LABEL_W

        self.configure(width=outer)
        self._mode_btn.configure(width=min(_NAV_ICON_BTN + 14, max(_NAV_ICON_BTN, outer - 8)))
        try:
            self._mode_btn.grid_configure(sticky="ew" if mode else "n", padx=4 if mode else 3)
        except tk.TclError:
            pass

        self._reload_button_labels(mode)

        if hasattr(self, "_dock_btn"):
            if mode == 0:
                self._dock_btn.configure(width=_NAV_ICON_BTN)
                self._dock_btn.grid_configure(sticky="s", padx=3)
            else:
                self._dock_btn.configure(width=self._button_inner_width(mode))
                self._dock_btn.grid_configure(sticky="sew", padx=6)

        glyphs = ("▶", "◀")
        self._mode_btn.configure(text=glyphs[mode])

    def _reload_button_labels(self, mode: int) -> None:
        inner_w = self._button_inner_width(mode)
        sel = self._active
        for pid, btn in self._buttons.items():
            gly = getattr(btn, "_nav_glyph", "•")
            lbl = getattr(btn, "_nav_lbl", pid)
            if mode == 0:
                btn.configure(text=gly, width=_NAV_ICON_BTN, height=_NAV_ICON_BTN, anchor="center")
                try:
                    btn.grid_configure(sticky="n", padx=3)
                except tk.TclError:
                    pass
            else:
                btn.configure(text=f"{gly}  {lbl}", width=inner_w, height=34, anchor="w")
                try:
                    btn.grid_configure(sticky="ew", padx=(6, 8))
                except tk.TclError:
                    pass

            if sel and pid == sel:
                btn.configure(fg_color=("#3b8ed0", "#1f6aa5"))
            else:
                btn.configure(fg_color="transparent")

    def set_right_toggle_chevron(self, panel_open: bool) -> None:
        if hasattr(self, "_dock_btn"):
            self._dock_btn.configure(text="«" if panel_open else "»")

    def _fire_hover(self, tip: str | None) -> None:
        if self._on_hover:
            self._on_hover(tip)

    def select(self, page_id: str) -> None:
        self._active = page_id
        for pid, btn in self._buttons.items():
            if pid == page_id:
                btn.configure(fg_color=("#3b8ed0", "#1f6aa5"))
            else:
                btn.configure(fg_color="transparent")
        self._on_select(page_id)
