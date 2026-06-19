"""Code 工作空间批量改名（Web API）。"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from phoenix.code.rename.service import apply_rename, preview_rename
from phoenix.code.rename.types import (
    DEFAULT_RENAME_LEVELS,
    DEFAULT_TARGET_ENCODING,
    RENAME_LEVELS,
    TARGET_ENCODINGS,
)
from phoenix.config.user_prefs import (
    format_resolved_under_workspace,
    load_workspace_prefs,
    merge_workspace_section,
)

_SECTION = "code_rename"


def _workspace_root(repo_root: Path) -> Path:
    rr = repo_root.expanduser().resolve(strict=False)
    if not rr.is_dir():
        raise ValueError(f"工作空间不是有效目录: {rr}")
    return rr


def _normalize_levels(raw: Any) -> list[str]:
    if not raw:
        return list(DEFAULT_RENAME_LEVELS)
    if not isinstance(raw, list):
        raise ValueError("levels 须为字符串数组")
    out: list[str] = []
    for item in raw:
        level = str(item).strip().lower()
        if level not in RENAME_LEVELS:
            raise ValueError(f"未知级别: {item!r}，可选 {', '.join(RENAME_LEVELS)}")
        if level not in out:
            out.append(level)
    if not out:
        raise ValueError("至少勾选一种改名级别")
    return out


def _normalize_encoding(raw: Any) -> str:
    enc = str(raw or DEFAULT_TARGET_ENCODING).strip().lower()
    if enc not in TARGET_ENCODINGS:
        raise ValueError(f"target_encoding 须为 {', '.join(TARGET_ENCODINGS)} 之一")
    return enc


def get_code_rename_prefs(repo_root: Path) -> dict[str, Any]:
    rr = repo_root.expanduser().resolve(strict=False)
    pv = load_workspace_prefs(rr).get(_SECTION) or {}
    root = _workspace_root(rr)
    levels = _normalize_levels(pv.get("levels"))
    return {
        "workspace_path": str(root),
        "workspace_path_display": format_resolved_under_workspace(root, rr),
        "old": str(pv.get("old") or ""),
        "new": str(pv.get("new") or ""),
        "levels": levels,
        "scope": str(pv.get("scope") or ""),
        "target_encoding": _normalize_encoding(pv.get("target_encoding")),
        "include_ignored": bool(pv.get("include_ignored", False)),
        "rescan_index": bool(pv.get("rescan_index", False)),
        "implemented": True,
    }


def save_code_rename_prefs(repo_root: Path, patch: dict[str, Any]) -> dict[str, Any]:
    rr = repo_root.expanduser().resolve(strict=False)
    stored: dict[str, Any] = {}
    if "old" in patch:
        stored["old"] = str(patch.get("old") or "")
    if "new" in patch:
        stored["new"] = str(patch.get("new") or "")
    if "levels" in patch:
        stored["levels"] = _normalize_levels(patch.get("levels"))
    if "scope" in patch:
        stored["scope"] = str(patch.get("scope") or "").strip()
    if "target_encoding" in patch:
        stored["target_encoding"] = _normalize_encoding(patch.get("target_encoding"))
    for k in ("include_ignored", "rescan_index"):
        if k in patch:
            stored[k] = bool(patch[k])
    merge_workspace_section(_SECTION, stored, rr)
    return get_code_rename_prefs(rr)


def _validate_rename_request(body: dict[str, Any]) -> dict[str, Any]:
    old = str(body.get("old") or "").strip()
    new = str(body.get("new") or "").strip()
    if not old:
        raise ValueError("请填写旧名")
    if not new:
        raise ValueError("请填写新名")
    if old == new:
        raise ValueError("旧名与新名相同")
    levels = _normalize_levels(body.get("levels"))
    scope = str(body.get("scope") or "").strip()
    target_encoding = _normalize_encoding(body.get("target_encoding"))
    include_ignored = bool(body.get("include_ignored", False))
    rescan_index = bool(body.get("rescan_index", False))
    return {
        "old": old,
        "new": new,
        "levels": levels,
        "scope": scope,
        "target_encoding": target_encoding,
        "include_ignored": include_ignored,
        "rescan_index": rescan_index,
    }


def preview_code_rename(repo_root: Path, body: dict[str, Any]) -> dict[str, Any]:
    rr = repo_root.expanduser().resolve(strict=False)
    req = _validate_rename_request(body)
    save_code_rename_prefs(rr, req)
    return preview_rename(rr, req)


def apply_code_rename(repo_root: Path, body: dict[str, Any]) -> dict[str, Any]:
    rr = repo_root.expanduser().resolve(strict=False)
    req = _validate_rename_request(body)
    save_code_rename_prefs(rr, req)
    return apply_rename(rr, req, dry_run=False)
