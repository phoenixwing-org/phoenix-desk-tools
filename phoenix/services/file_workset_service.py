"""FileWorkset（文件工作集）— 壳层系统模块；持久化至 ``phoenix-workspace.sqlite``。"""

from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from phoenix.config.user_prefs import format_resolved_under_workspace
from phoenix.freecad.phoenix_schema import workspace_database_path
from phoenix.workset.store import load_worksets_from_db, save_worksets_to_db

# 遗留 JSON；首次读库为空时一次性导入，之后以 SQLite 为准
FILE_WORKSETS_BASENAME = "file-worksets.json"
_SCHEMA_VERSION = 1


def _legacy_json_path(repo_root: Path) -> Path:
    return repo_root.expanduser().resolve(strict=False) / ".phoenix" / FILE_WORKSETS_BASENAME


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def _norm_rel_path(raw: Any) -> str | None:
    s = str(raw or "").strip().replace("\\", "/")
    while s.startswith("./"):
        s = s[2:]
    s = s.strip("/")
    if not s or ".." in s.split("/"):
        return None
    return s


def normalize_workset_paths(paths: list[Any] | None) -> list[str]:
    out: list[str] = []
    seen: set[str] = set()
    for item in paths or []:
        rel = _norm_rel_path(item)
        if not rel or rel in seen:
            continue
        seen.add(rel)
        out.append(rel)
    out.sort()
    return out


def _empty_payload() -> dict[str, Any]:
    return {"version": _SCHEMA_VERSION, "worksets": []}


def _normalize_workset(raw: dict[str, Any]) -> dict[str, Any] | None:
    wid = str(raw.get("id") or "").strip()
    if not wid:
        wid = str(uuid.uuid4())
    name = str(raw.get("name") or "").strip() or "未命名"
    paths = normalize_workset_paths(raw.get("paths") if isinstance(raw.get("paths"), list) else [])
    source = str(raw.get("source") or "").strip()
    updated_at = str(raw.get("updated_at") or "").strip() or _utc_now_iso()
    return {
        "id": wid,
        "name": name,
        "paths": paths,
        "source": source,
        "updated_at": updated_at,
    }


def _load_legacy_json(repo_root: Path) -> dict[str, Any]:
    path = _legacy_json_path(repo_root)
    if not path.is_file():
        return _empty_payload()
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return _empty_payload()
    if not isinstance(data, dict):
        return _empty_payload()
    raw_list = data.get("worksets")
    if not isinstance(raw_list, list):
        return _empty_payload()
    worksets: list[dict[str, Any]] = []
    for item in raw_list:
        if not isinstance(item, dict):
            continue
        norm = _normalize_workset(item)
        if norm:
            worksets.append(norm)
    return {"version": _SCHEMA_VERSION, "worksets": worksets}


def _import_legacy_json_if_needed(repo_root: Path) -> None:
    """库内无工作集且存在旧 JSON 时，导入一次。"""
    existing = load_worksets_from_db(repo_root)
    if existing:
        return
    legacy = _load_legacy_json(repo_root)
    if not legacy.get("worksets"):
        return
    save_worksets_to_db(repo_root, legacy["worksets"])


def load_file_worksets(repo_root: Path) -> dict[str, Any]:
    rr = repo_root.expanduser().resolve(strict=False)
    _import_legacy_json_if_needed(rr)
    worksets = load_worksets_from_db(rr)
    return {"version": _SCHEMA_VERSION, "worksets": worksets}


def save_file_worksets(repo_root: Path, body: dict[str, Any]) -> dict[str, Any]:
    rr = repo_root.expanduser().resolve(strict=False)
    if not rr.is_dir():
        raise ValueError(f"工作空间不是有效目录: {rr}")
    raw_list = body.get("worksets")
    if not isinstance(raw_list, list):
        raise ValueError("worksets 须为数组")
    worksets: list[dict[str, Any]] = []
    seen_ids: set[str] = set()
    for item in raw_list:
        if not isinstance(item, dict):
            continue
        norm = _normalize_workset(item)
        if not norm or norm["id"] in seen_ids:
            continue
        seen_ids.add(norm["id"])
        worksets.append(norm)
    save_worksets_to_db(rr, worksets)
    return {"version": _SCHEMA_VERSION, "worksets": worksets}


def get_file_worksets_api(repo_root: Path) -> dict[str, Any]:
    rr = repo_root.expanduser().resolve(strict=False)
    if not rr.is_dir():
        raise ValueError(f"工作空间不是有效目录: {rr}")
    data = load_file_worksets(rr)
    db_path = workspace_database_path(rr)
    return {
        **data,
        "workspace_path": str(rr),
        "workspace_path_display": format_resolved_under_workspace(rr, rr),
        "storage": "sqlite",
        "path": str(db_path),
        "path_display": format_resolved_under_workspace(db_path, rr),
    }


def put_file_worksets_api(repo_root: Path, body: dict[str, Any]) -> dict[str, Any]:
    saved = save_file_worksets(repo_root, body)
    return get_file_worksets_api(repo_root) | {"worksets": saved["worksets"]}


def _path_exists_in_workspace(repo_root: Path, repo_rel: str) -> bool:
    try:
        return (repo_root / repo_rel).is_file()
    except OSError:
        return False


def prune_missing_workset_paths(
    repo_root: Path,
    *,
    workset_id: str | None = None,
) -> dict[str, Any]:
    """从工作集移除磁盘上已不存在的文件路径。"""
    rr = repo_root.expanduser().resolve(strict=False)
    if not rr.is_dir():
        raise ValueError(f"工作空间不是有效目录: {rr}")
    data = load_file_worksets(rr)
    removed = 0
    changed = False
    worksets: list[dict[str, Any]] = []
    for ws in data.get("worksets") or []:
        if not isinstance(ws, dict):
            continue
        if workset_id and str(ws.get("id") or "") != workset_id:
            worksets.append(ws)
            continue
        paths = ws.get("paths") if isinstance(ws.get("paths"), list) else []
        kept: list[str] = []
        for rel in paths:
            rel_s = str(rel or "").strip()
            if not rel_s:
                continue
            if _path_exists_in_workspace(rr, rel_s):
                kept.append(rel_s)
            else:
                removed += 1
        if len(kept) != len(paths):
            changed = True
            ws = {
                **ws,
                "paths": normalize_workset_paths(kept),
                "updated_at": _utc_now_iso(),
            }
        worksets.append(ws)
    if changed:
        save_file_worksets(rr, {"worksets": worksets})
    out = get_file_worksets_api(rr)
    out["prune_removed"] = removed
    return out
