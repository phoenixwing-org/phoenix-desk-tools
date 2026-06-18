"""侧栏功能模块（CAD / Code）偏好。"""

from __future__ import annotations

from typing import Any

NAV_MODULE_IDS: tuple[str, ...] = ("cad", "code")
DEFAULT_NAV_MODULES_ENABLED: tuple[str, ...] = ("cad", "code")


def normalize_nav_modules_enabled(raw: Any) -> list[str]:
    """归一化 ``enabled`` 列表；空则恢复默认全选。"""
    if not isinstance(raw, list):
        return list(DEFAULT_NAV_MODULES_ENABLED)
    allowed = {m.casefold(): m for m in NAV_MODULE_IDS}
    out: list[str] = []
    seen: set[str] = set()
    for item in raw:
        key = str(item).strip().casefold()
        if not key or key in seen:
            continue
        canon = allowed.get(key)
        if canon:
            seen.add(key)
            out.append(canon)
    return out or list(DEFAULT_NAV_MODULES_ENABLED)


def normalized_nav_modules(raw: Any) -> dict[str, list[str]]:
    enabled = normalize_nav_modules_enabled(
        raw.get("enabled") if isinstance(raw, dict) else raw
    )
    return {"enabled": enabled}
