"""各功能页共用的表单标签、页面标题与说明区样式约定。"""

from __future__ import annotations

import customtkinter as ctk

# 左栏字段名像素宽：容纳约 5～7 个中文字，与输入列对齐不乱跳
FORM_LABEL_COLUMN_WIDTH = 118

_HINT_FONT_SIZE = 12
_HINT_TEXT_COLOR = ("gray30", "gray70")

_FIELD_FONT_SIZE = 13
_FIELD_TEXT_COLOR = ("gray38", "gray72")


def page_title(master, *, text: str) -> ctk.CTkLabel:
    """页面主标题。"""
    return ctk.CTkLabel(
        master,
        text=text,
        font=ctk.CTkFont(size=20, weight="bold"),
        anchor="w",
    )


def page_hint_label(
    master,
    text: str,
    *,
    wraplength: int = 900,
) -> ctk.CTkLabel:
    """灰色说明段落（紧贴标题下方）。"""
    return ctk.CTkLabel(
        master,
        text=text,
        anchor="w",
        justify="left",
        font=ctk.CTkFont(size=_HINT_FONT_SIZE),
        text_color=_HINT_TEXT_COLOR,
        wraplength=wraplength,
    )


def form_row_label(master, *, text: str, width: int | None = None) -> ctk.CTkLabel:
    """与输入框同一网格行左侧：固定列宽、左对齐（与「配置」侧栏一致），弱化正文色。"""
    return ctk.CTkLabel(
        master,
        text=text,
        width=FORM_LABEL_COLUMN_WIDTH if width is None else width,
        anchor="w",
        font=ctk.CTkFont(size=_FIELD_FONT_SIZE),
        text_color=_FIELD_TEXT_COLOR,
    )


def inline_field_label(master, *, text: str) -> ctk.CTkLabel:
    """横向工具条内小段标签（Pack 时用）：无固定像素宽。"""
    return ctk.CTkLabel(
        master,
        text=text,
        anchor="w",
        font=ctk.CTkFont(size=12),
        text_color=_FIELD_TEXT_COLOR,
    )


def sidebar_label(master, *, text: str, anchor: str = "w") -> ctk.CTkLabel:
    """配置页等左栏条目名：与表单区同字号与颜色，对齐列宽。"""
    return ctk.CTkLabel(
        master,
        text=text,
        width=FORM_LABEL_COLUMN_WIDTH,
        anchor=anchor,
        font=ctk.CTkFont(size=_FIELD_FONT_SIZE),
        text_color=_FIELD_TEXT_COLOR,
    )


def footer_hint_label(master, text: str, *, wraplength: int = 600) -> ctk.CTkLabel:
    """页底短小提示。"""
    return ctk.CTkLabel(
        master,
        text=text,
        anchor="w",
        justify="left",
        font=ctk.CTkFont(size=_HINT_FONT_SIZE),
        text_color=_HINT_TEXT_COLOR,
        wraplength=wraplength,
    )
