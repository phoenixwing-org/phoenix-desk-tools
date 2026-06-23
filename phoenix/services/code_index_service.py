"""Code 工作空间索引 Web API 层。"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from phoenix.code.kinds import CODE_ASSET_KINDS, KIND_LABELS, normalize_index_extension
from phoenix.code.scan_index import discover_unindexed_extensions, list_builtin_index_extensions, scan_code_workspace
from phoenix.code.store import (
    delete_missing_code_files,
    export_code_index_json,
    load_code_index_extra_exts,
    load_code_index_meta,
    query_catdlg_index_files,
    query_code_files,
    save_code_index,
    save_code_index_extra_exts,
)
from phoenix.config.user_prefs import format_resolved_under_workspace


def load_code_index_payload(repo_root: Path) -> dict[str, Any]:
    rr = repo_root.expanduser().resolve(strict=False)
    meta = load_code_index_meta(rr)
    extra = load_code_index_extra_exts(rr)
    return {
        "workspace_path": str(rr),
        "workspace_path_display": format_resolved_under_workspace(rr, rr),
        "last_scan_at": meta.get("last_scan_at"),
        "stats": meta.get("stats"),
        "file_count": meta.get("file_count", 0),
        "present_count": meta.get("present_count", 0),
        "kind_labels": dict(KIND_LABELS),
        "kinds": list(CODE_ASSET_KINDS),
        "builtin_extensions": list_builtin_index_extensions(),
        "extra_extensions": extra,
    }


def discover_code_index_extensions(repo_root: Path) -> dict[str, Any]:
    rr = repo_root.expanduser().resolve(strict=False)
    extra = frozenset(load_code_index_extra_exts(rr))
    return {
        "builtin_extensions": list_builtin_index_extensions(),
        "extra_extensions": sorted(extra),
        "candidates": discover_unindexed_extensions(rr, extra_exts=extra),
    }


def run_code_index_scan(
    repo_root: Path,
    *,
    adopt_extensions: list[str] | None = None,
) -> dict[str, Any]:
    rr = repo_root.expanduser().resolve(strict=False)
    extra = set(load_code_index_extra_exts(rr))
    if adopt_extensions:
        for raw in adopt_extensions:
            norm = normalize_index_extension(raw)
            if norm:
                extra.add(norm)
        save_code_index_extra_exts(rr, list(extra))

    records = scan_code_workspace(rr, extra_exts=frozenset(extra))
    saved = save_code_index(rr, records, scan_root=".")
    extra_note = f" · 自定义后缀 {len(extra)}" if extra else ""
    summary = (
        f"Code 索引完成：{saved['stats']['total']} 个文件 "
        f"（源 {saved['stats'].get('source', 0)} · "
        f"配置 {saved['stats'].get('config', 0)} · "
        f"文档 {saved['stats'].get('doc', 0)} · "
        f"资源 {saved['stats'].get('resource', 0)}{extra_note}）"
    )
    payload = load_code_index_payload(rr)
    payload["summary"] = summary
    payload["scan_id"] = saved["scan_id"]
    return payload


def save_code_index_extra_extensions(repo_root: Path, extensions: list[str]) -> dict[str, Any]:
    rr = repo_root.expanduser().resolve(strict=False)
    saved = save_code_index_extra_exts(rr, extensions)
    return {"extra_extensions": saved}


def load_code_index_catdlg_list(repo_root: Path) -> dict[str, Any]:
    """CAA 对话框主页：一次 SQL 读取 ``.CATDlg`` 列表与索引元数据。"""
    rr = repo_root.expanduser().resolve(strict=False)
    meta = load_code_index_meta(rr)
    entries, total = query_catdlg_index_files(rr)
    return {
        "workspace_path": str(rr),
        "workspace_path_display": format_resolved_under_workspace(rr, rr),
        "last_scan_at": meta.get("last_scan_at"),
        "indexed": bool(meta.get("last_scan_at")),
        "count": total,
        "entries": entries,
    }


def search_code_index_entries(
    repo_root: Path,
    *,
    kind: str | None = None,
    status: str | None = None,
    q: str | None = None,
    search_mode: str | None = None,
    limit: int = 500,
    offset: int = 0,
) -> dict[str, Any]:
    entries, total = query_code_files(
        repo_root,
        kind=kind,
        status=status,
        q=q,
        search_mode=search_mode or "contains",
        limit=limit,
        offset=offset,
    )
    return {"entries": entries, "total": total, "limit": limit, "offset": offset}


def purge_missing_code_index_entries(repo_root: Path) -> dict[str, Any]:
    rr = repo_root.expanduser().resolve(strict=False)
    deleted = delete_missing_code_files(rr)
    payload = load_code_index_payload(rr)
    payload["purge_deleted"] = deleted
    return payload


def export_code_index_to_json(repo_root: Path) -> dict[str, str]:
    rr = repo_root.expanduser().resolve(strict=False)
    out = export_code_index_json(rr)
    return {
        "path": str(out),
        "path_display": format_resolved_under_workspace(out, rr),
    }
