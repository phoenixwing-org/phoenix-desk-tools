"""右侧栏统一运行日志面板（桌面壳）。"""

from __future__ import annotations

from collections.abc import Callable

import customtkinter as ctk

_LOG_MIN_H = 80
_MAX_LOG_CHARS = 500_000


class ShellLogPanel(ctk.CTkFrame):
    def __init__(
        self,
        master,
        *,
        page_labels: dict[str, str],
        on_clear: Callable[[], None],
        on_close: Callable[[], None],
        **kwargs,
    ) -> None:
        super().__init__(master, corner_radius=0, fg_color="transparent", **kwargs)
        self._page_labels = page_labels
        self._on_clear = on_clear
        self._on_close = on_close
        self._source: str | None = None

        head = ctk.CTkFrame(self, fg_color="transparent")
        head.pack(fill="x", padx=4, pady=(2, 0))

        self._title = ctk.CTkLabel(head, text="运行日志", anchor="w", font=ctk.CTkFont(size=12, weight="bold"))
        self._title.pack(side="left")

        btn_row = ctk.CTkFrame(head, fg_color="transparent")
        btn_row.pack(side="right")
        ctk.CTkButton(btn_row, text="清空", width=44, height=22, command=self._clear_clicked).pack(
            side="left", padx=(0, 4)
        )
        ctk.CTkButton(btn_row, text="×", width=28, height=22, command=on_close).pack(side="left")

        self._text = ctk.CTkTextbox(self, font=ctk.CTkFont(family="Menlo", size=11))
        self._text.pack(fill="both", expand=True, padx=4, pady=(4, 6))
        self._text.configure(state="disabled")

    def _clear_clicked(self) -> None:
        self.clear()
        self._on_clear()

    def _set_source(self, source: str | None) -> None:
        self._source = source
        if source:
            label = self._page_labels.get(source, source)
            self._title.configure(text=f"运行日志 · {label}")
        else:
            self._title.configure(text="运行日志")

    def append(self, text: str, *, source: str | None = None) -> None:
        if source:
            self._set_source(source)
        if not text:
            return
        chunk = text if text.endswith("\n") else text + "\n"
        self._text.configure(state="normal")
        cur = self._text.get("1.0", "end")
        if len(cur) + len(chunk) > _MAX_LOG_CHARS:
            self._text.delete("1.0", "end")
            self._text.insert("1.0", cur[-(_MAX_LOG_CHARS - len(chunk)) :])
        self._text.insert("end", chunk)
        self._text.see("end")
        self._text.configure(state="disabled")

    def clear(self) -> None:
        self._set_source(None)
        self._text.configure(state="normal")
        self._text.delete("1.0", "end")
        self._text.configure(state="disabled")
