"""Code 工作空间索引 Web API 层。"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from phoenix.code.kinds import CODE_ASSET_KINDS, KIND_LABELS
from phoenix.code.scan_index import scan_code_workspace
from phoenix.code.store import load_code_index_meta, query_code_files, save_code_index
from phoenix.config.user_prefs import format_resolved_under_workspace


def load_code_index_payload(repo_root: Path) -> dict[str, Any]:
    rr = repo_root.expanduser().resolve(strict=False)
    meta = load_code_index_meta(rr)
    return {
        "workspace_path": str(rr),
        "workspace_path_display": format_resolved_under_workspace(rr, rr),
        "last_scan_at": meta.get("last_scan_at"),
        "stats": meta.get("stats"),
        "file_count": meta.get("file_count", 0),
        "present_count": meta.get("present_count", 0),
        "kind_labels": dict(KIND_LABELS),
        "kinds": list(CODE_ASSET_KINDS),
    }


def run_code_index_scan(repo_root: Path) -> dict[str, Any]:
    rr = repo_root.expanduser().resolve(strict=False)
    records = scan_code_workspace(rr)
    saved = save_code_index(rr, records, scan_root=".")
    summary = (
        f"Code 索引完成：{saved['stats']['total']} 个文件 "
        f"（源 {saved['stats'].get('source', 0)} · "
        f"配置 {saved['stats'].get('config', 0)} · "
        f"文档 {saved['stats'].get('doc', 0)} · "
        f"资源 {saved['stats'].get('resource', 0)}）"
    )
    payload = load_code_index_payload(rr)
    payload["summary"] = summary
    payload["scan_id"] = saved["scan_id"]
    return payload


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
