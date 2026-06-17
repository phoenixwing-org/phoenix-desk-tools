"""主窗口 WxH+X+Y 解析与钳制：避免复原后超出单屏而无法点到关闭按钮。"""

from __future__ import annotations

import re

_GEOM_RX = re.compile(
    r"^(?P<w>\d{1,5})x(?P<h>\d{1,5})(?:\+(?P<x>-?\d{1,5})\+(?P<y>-?\d{1,5}))?$"
)

# 留出可点到标题栏／边缘的最少可见像素
_MIN_VISIBLE_EDGE = 120
_PAD_X = 16
_PAD_Y = 44


def parse_window_geometry_string(geom: str) -> tuple[int, int, int | None, int | None] | None:
    m = _GEOM_RX.match((geom or "").strip())
    if not m:
        return None
    w, h = int(m["w"]), int(m["h"])
    xv = int(m["x"]) if m.group("x") is not None else None
    yv = int(m["y"]) if m.group("y") is not None else None
    return w, h, xv, yv


def clamp_window_geometry_for_screen(
    geom: str | None,
    *,
    screen_w: int,
    screen_h: int,
    min_w: int,
    min_h: int,
    fallback: str,
) -> str:
    """钳制宽高不超过当前屏预留边距；位置保证窗口有足够边缘留在屏幕内。"""
    if screen_w <= 0 or screen_h <= 0:
        return fallback
    tgt = geom if geom and geom.strip() else fallback
    p = parse_window_geometry_string(tgt)
    if p is None:
        p = parse_window_geometry_string(fallback)
        if p is None:
            return fallback
        w, h, xp, yp = p
    else:
        w, h, xp, yp = p

    max_w = max(min_w + 48, screen_w - _PAD_X * 2)
    max_h = max(min_h + 48, screen_h - _PAD_Y - 40)
    nw = max(200, min(max(min_w, w), max_w))
    nh = max(200, min(max(min_h, h), max_h))

    inner_max_x = screen_w - _PAD_X - _MIN_VISIBLE_EDGE
    inner_min_x = -(nw - _MIN_VISIBLE_EDGE)

    if xp is None:
        xp = max(_PAD_X, (screen_w - nw) // 2)
        xp = min(xp, max(_PAD_X, screen_w - nw - _PAD_X))
    elif inner_max_x < inner_min_x:
        xp = _PAD_X
    else:
        xp = max(inner_min_x, min(xp, inner_max_x))

    if yp is None:
        yp = max(_PAD_Y // 4, min((screen_h - nh) // 2, screen_h - nh - 24))
    else:
        yp = max(0, min(yp, max(0, screen_h - 48)))

    return f"{nw}x{nh}+{int(xp)}+{int(yp)}"
