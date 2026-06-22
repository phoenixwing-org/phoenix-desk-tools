"""Web API：引用测试工程（manifest / git clone / symlink）。"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from phoenix.testing.fixture_links import (
    catalog_path,
    checkout_path_for_link,
    clone_url_for_link,
    default_checkout_root,
    manifest_links,
    repo_root,
    resolve_checkout_root,
    sync_fixture_links,
    symlink_status,
)
from phoenix.testing.fixture_prefs import (
    load_test_fixture_prefs,
    save_test_fixture_prefs,
)


def test_fixtures_payload() -> dict[str, Any]:
    prefs = load_test_fixture_prefs()
    enabled_set = set(prefs["enabled"])
    try:
        checkout_root = resolve_checkout_root(prefs.get("checkout_root") or None)
    except ValueError:
        checkout_root = default_checkout_root()

    items: list[dict[str, Any]] = []
    for link in manifest_links():
        name = str(link.get("name") or "").strip()
        checkout = checkout_path_for_link(link, checkout_root)
        sym = symlink_status(name)
        items.append(
            {
                "name": name,
                "description": str(link.get("description") or ""),
                "clone_url": clone_url_for_link(link),
                "enabled": name in enabled_set,
                "checkout_path": str(checkout),
                "checkout_exists": checkout.is_dir(),
                "link_status": sym["status"],
                "link_detail": sym["detail"],
                "symlink_path": sym["symlink_path"],
                "target_path": sym.get("target_path") or "",
            }
        )

    return {
        **prefs,
        "checkout_root": str(checkout_root),
        "repo_root": str(repo_root()),
        "catalog_path": str(catalog_path()),
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
    if enabled is not None or checkout_root is not None:
        save_test_fixture_prefs(checkout_root=checkout_root, enabled=enabled)
    prefs = load_test_fixture_prefs()
    enabled_set = set(prefs["enabled"])
    if not enabled_set:
        raise ValueError("请至少勾选一个测试工程")
    resolved_root = resolve_checkout_root(prefs.get("checkout_root") or None)
    results = sync_fixture_links(enabled=enabled_set, clone=clone, checkout_root=resolved_root)
    payload = test_fixtures_payload()
    payload["sync_results"] = [
        {"name": r.name, "status": r.status, "detail": r.detail} for r in results
    ]
    return payload
