"""侧栏功能模块（CAD / Code）偏好。"""

from __future__ import annotations

from typing import Any

NAV_MODULE_IDS: tuple[str, ...] = ("cad", "code")
DEFAULT_NAV_MODULES_ENABLED: tuple[str, ...] = ("cad", "code")
MODULE_SCOPES: tuple[str, ...] = ("all", "cad", "code")


def normalize_module_scope(raw: Any) -> str:
    """``all`` = 不指定（CAD+Code）；``cad`` / ``code`` = 仅对应模块。"""
    if isinstance(raw, str):
        key = raw.strip().casefold()
        if key in MODULE_SCOPES:
            return key
    return "all"


def enabled_from_module_scope(scope: str) -> list[str]:
    s = normalize_module_scope(scope)
    if s == "cad":
        return ["cad"]
    if s == "code":
        return ["code"]
    return list(DEFAULT_NAV_MODULES_ENABLED)


def module_scope_from_enabled(enabled: list[str]) -> str:
    norm = normalize_nav_modules_enabled(enabled)
    if norm == ["cad"]:
        return "cad"
    if norm == ["code"]:
        return "code"
    return "all"


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


def normalized_workspace_nav_modules(raw: Any) -> dict[str, Any]:
    """工作空间 ``nav_modules`` 段：``scope`` + 派生 ``enabled``。"""
    if isinstance(raw, dict):
        if raw.get("scope") is not None:
            scope = normalize_module_scope(raw.get("scope"))
            return {"scope": scope, "enabled": enabled_from_module_scope(scope)}
        if raw.get("enabled") is not None:
            enabled = normalize_nav_modules_enabled(raw.get("enabled"))
            return {"scope": module_scope_from_enabled(enabled), "enabled": enabled}
    return {"scope": "all", "enabled": list(DEFAULT_NAV_MODULES_ENABLED)}
