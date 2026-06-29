"""Web API：引用测试工程（检出状态展示，不再管理 symlink）。"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from phoenix.testing.fixture_prefs import (
    load_test_fixture_prefs,
    save_test_fixture_prefs,
)


def _catalog_path() -> Path:
    return Path(__file__).resolve().parent.parent / "config" / "test_fixture_catalog.json"


def _repo_root() -> Path:
    return Path(__file__).resolve().parent.parent.parent


def _default_checkout_root() -> Path:
    return _repo_root().parent


def _load_catalog() -> dict[str, Any]:
    with open(_catalog_path(), encoding="utf-8") as fh:
        return json.load(fh)


def test_fixtures_payload() -> dict[str, Any]:
    prefs = load_test_fixture_prefs()
    enabled_set = set(prefs["enabled"])
    checkout_root = _default_checkout_root()
    if prefs.get("checkout_root"):
        cr = Path(prefs["checkout_root"]).expanduser().resolve()
        if cr.is_dir():
            checkout_root = cr

    catalog = _load_catalog()
    items: list[dict[str, Any]] = []
    for entry in catalog.get("projects", []):
        name = str(entry.get("name") or "").strip()
        target = checkout_root / name
        items.append({
            "name": name,
            "description": str(entry.get("description") or ""),
            "clone_url": str(entry.get("clone_url") or ""),
            "enabled": name in enabled_set,
            "checkout_path": str(target),
            "checkout_exists": target.is_dir(),
            "link_status": "ok" if target.is_dir() else "missing",
            "link_detail": f"检出到 {target}" if target.is_dir() else f"未检出：clone 到 phoenix-desk-tools 同级目录",
            "symlink_path": "",
            "target_path": str(target),
        })

    return {
        **prefs,
        "checkout_root": str(checkout_root),
        "repo_root": str(_repo_root()),
        "catalog_path": str(_catalog_path()),
        "catalog_kind": "builtin",
        "user_prefs_path_hint": "launcher.json → test_fixtures",
        "items": items,
    }


def update_test_fixture_prefs(
    *,
    checkout_root: str | None = None,
    enabled: list[str] | None = None,
) -> dict[str, Any]:
    save_test_fixture_prefs(checkout_root=checkout_root, enabled=enabled)
    return test_fixtures_payload()


def sync_test_fixtures(
    *,
    clone: bool = True,
    checkout_root: str | None = None,
    enabled: list[str] | None = None,
) -> dict[str, Any]:
    """废弃：不再执行 git clone / symlink。仅保存偏好并返回状态。"""
    if enabled is not None or checkout_root is not None:
        save_test_fixture_prefs(checkout_root=checkout_root, enabled=enabled)
    payload = test_fixtures_payload()
    payload["sync_results"] = []
    return payload
