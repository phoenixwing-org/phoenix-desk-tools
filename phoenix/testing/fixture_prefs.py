"""本机测试工程引用偏好（``launcher.json`` → ``test_fixtures``）。

内置开源工程清单见仓库 ``phoenix/config/test_fixture_catalog.json``（随代码提交）；
本文件段仅缓存用户机器上的检出根目录与勾选状态，不提交进 Git。
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from phoenix.config.user_prefs import (
    _normalized_test_fixtures,
    _read_json,
    launcher_prefs_file,
    load_launcher_prefs,
    save_launcher_prefs,
)
def _default_checkout_root() -> Path:
    return Path(__file__).resolve().parent.parent.parent.parent


def _repo_root() -> Path:
    return Path(__file__).resolve().parent.parent.parent


def _normalize_enabled(raw: Any) -> list[str]:
    if not isinstance(raw, list):
        return []
    out: list[str] = []
    seen: set[str] = set()
    for item in raw:
        name = str(item).strip()
        if not name or name in seen:
            continue
        seen.add(name)
        out.append(name)
    return out


def load_test_fixture_prefs() -> dict[str, Any]:
    raw = _read_json(launcher_prefs_file())
    block = _normalized_test_fixtures(
        raw.get("test_fixtures") if isinstance(raw, dict) else None,
    )
    root_raw = block.get("checkout_root")
    checkout_root: Path | None = None
    if root_raw:
        try:
            p = Path(str(root_raw)).expanduser().resolve(strict=False)
            if p.is_dir():
                checkout_root = p
        except OSError:
            checkout_root = None
    return {
        "checkout_root": str(checkout_root) if checkout_root else "",
        "default_checkout_root": str(_default_checkout_root()),
        "enabled": _normalize_enabled(block.get("enabled")),
    }


def save_test_fixture_prefs(
    *,
    checkout_root: str | None = None,
    enabled: list[str] | None = None,
) -> dict[str, Any]:
    launcher = load_launcher_prefs()
    block = dict(launcher.get("test_fixtures") or {})
    if enabled is not None:
        block["enabled"] = _normalize_enabled(enabled)
    if checkout_root is not None:
        raw = checkout_root.strip()
        if raw:
            p = Path(raw).expanduser().resolve(strict=False)
            if not p.is_dir():
                raise ValueError(f"不是有效目录: {p}")
            block["checkout_root"] = str(p)
        else:
            block["checkout_root"] = None
    launcher["test_fixtures"] = block
    save_launcher_prefs(launcher)
    return load_test_fixture_prefs()


def enabled_test_fixture_names() -> set[str]:
    return set(load_test_fixture_prefs()["enabled"])


def resolve_fixture_path(name: str) -> Path:
    """返回已配置的测试工程检出目录下的 ``name`` 路径。

    从 ``launcher.json`` 读取 ``checkout_root``，若未配置则回退到
    ``phoenix-desk-tools`` 同级目录（``_default_checkout_root()``）。
    """
    prefs = load_test_fixture_prefs()
    root_str = prefs.get("checkout_root", "")
    if root_str:
        root = Path(root_str)
        if root.is_dir():
            return root / name
    return _default_checkout_root() / name
