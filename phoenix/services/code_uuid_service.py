"""Code 工作空间 UUID 扫描与勾选替换（Web API）。"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from phoenix.code.rename.service import apply_uuids, scan_uuids
from phoenix.services.code_ignore_service import get_code_ignore_prefs

UUID_KINDS = ("uuid", "guid32", "suspicious")
DEFAULT_UUID_KINDS = ("uuid",)


def _normalize_kinds(raw: Any) -> list[str]:
    if not raw:
        return list(DEFAULT_UUID_KINDS)
    if not isinstance(raw, list):
        raise ValueError("kinds 须为字符串数组")
    out: list[str] = []
    for item in raw:
        kind = str(item).strip().lower()
        if kind not in UUID_KINDS:
            raise ValueError(f"未知 kind: {item!r}，可选 {', '.join(UUID_KINDS)}")
        if kind not in out:
            out.append(kind)
    return out


def _normalize_strategy(raw: Any) -> str:
    strategy = str(raw or "map_per_value").strip()
    if strategy not in ("map_per_value", "fresh_per_hit"):
        raise ValueError("strategy 须为 map_per_value 或 fresh_per_hit")
    return strategy


def scan_code_uuids(repo_root: Path, body: dict[str, Any]) -> dict[str, Any]:
    rr = repo_root.expanduser().resolve(strict=False)
    if not rr.is_dir():
        raise ValueError(f"工作空间不是有效目录: {rr}")
    scope = str(body.get("scope") or "").strip()
    kinds = _normalize_kinds(body.get("kinds"))
    use_index = bool(body.get("use_index_scope", False))
    repo_rel_paths = body.get("repo_rel_paths")
    ignore = get_code_ignore_prefs(rr)
    out = scan_uuids(rr, {
        "scope": scope,
        "kinds": kinds,
        "use_index_scope": use_index,
        "repo_rel_paths": repo_rel_paths,
        "include_ignored": bool(body.get("include_ignored", False)),
    })
    out["ignore_file_display"] = ignore.get("ignore_file_display")
    out["ignore_file_exists"] = ignore.get("ignore_file_exists")
    out["ignore_file_patterns"] = ignore.get("ignore_file_patterns")
    out["ignore_custom_patterns"] = ignore.get("ignore_custom_patterns")
    out["legacy_ignore_sources"] = ignore.get("legacy_ignore_sources")
    return out


def apply_code_uuids(repo_root: Path, body: dict[str, Any]) -> dict[str, Any]:
    rr = repo_root.expanduser().resolve(strict=False)
    if not rr.is_dir():
        raise ValueError(f"工作空间不是有效目录: {rr}")
    hit_ids = body.get("hit_ids") or []
    if not isinstance(hit_ids, list):
        raise ValueError("hit_ids 须为字符串数组")
    ids = [str(x).strip() for x in hit_ids if str(x).strip()]
    if not ids:
        raise ValueError("请至少勾选一条 UUID 命中")
    strategy = _normalize_strategy(body.get("strategy"))
    dry_run = bool(body.get("dry_run", False))
    return apply_uuids(rr, {"hit_ids": ids, "strategy": strategy, "dry_run": dry_run})
