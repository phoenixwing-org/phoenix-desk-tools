"""Code 批量改名 / UUID 服务层。"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

from phoenix.code.rename.apply_batch import apply_rename_all
from phoenix.code.rename.scan import preview_rename_all
from phoenix.code.rename.types import RenameScanOptions
from phoenix.code.rename.uuid_apply import apply_uuid_hits
from phoenix.code.rename.uuid_scan import UuidScanOptions, scan_uuid_hits
from phoenix.code.store import FILE_STATUS_PRESENT, query_code_files
from phoenix.config.user_prefs import workspace_phoenix_dir
from phoenix.services.code_index_service import run_code_index_scan


def _levels(raw: list[str]) -> list[RenameLevel]:
    return [str(x).strip().lower() for x in raw if str(x).strip()]  # type: ignore[misc]


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def _write_report(repo_root: Path, basename: str, payload: dict) -> Path | None:
    try:
        out_dir = workspace_phoenix_dir(repo_root) / "reports"
        out_dir.mkdir(parents=True, exist_ok=True)
        stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
        out = out_dir / f"{basename}-{stamp}.json"
        out.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        return out
    except OSError:
        return None


def _indexed_rel_paths(repo_root: Path) -> set[str]:
    entries, _ = query_code_files(repo_root, status=FILE_STATUS_PRESENT, limit=1_000_000, offset=0)
    return {str(e["repo_rel_path"]) for e in entries}


def preview_rename(repo_root: Path, body: dict) -> dict:
    opts = RenameScanOptions(
        old=str(body["old"]),
        new=str(body["new"]),
        levels=_levels(body.get("levels") or ["text"]),
        scope=str(body.get("scope") or ""),
        include_ignored=bool(body.get("include_ignored", False)),
    )
    out = preview_rename_all(repo_root, opts)
    out["dry_run"] = True
    out.update({k: body[k] for k in ("old", "new", "scope", "target_encoding", "include_ignored", "rescan_index") if k in body})
    if "levels" in body:
        out["levels"] = opts.levels
    return out


def apply_rename(repo_root: Path, body: dict, *, dry_run: bool) -> dict:
    opts = RenameScanOptions(
        old=str(body["old"]),
        new=str(body["new"]),
        levels=_levels(body.get("levels") or ["text"]),
        scope=str(body.get("scope") or ""),
        include_ignored=bool(body.get("include_ignored", False)),
    )
    target_encoding = str(body.get("target_encoding") or "utf-8")
    out = apply_rename_all(repo_root, opts, dry_run=dry_run, target_encoding=target_encoding)
    out.update(
        {
            k: body[k]
            for k in ("old", "new", "scope", "target_encoding", "include_ignored", "rescan_index", "levels")
            if k in body
        }
    )
    summary = out.get("summary") or {}
    changed = int(summary.get("dirs", 0)) + int(summary.get("files", 0)) + int(summary.get("text_files", 0))
    if not dry_run and changed:
        report_path = _write_report(
            repo_root,
            "code-rename-report",
            {
                "exported_at": _utc_now_iso(),
                "old": opts.old,
                "new": opts.new,
                "levels": opts.levels,
                **out,
            },
        )
        if report_path:
            out.setdefault("lines", []).append(f"[报告] {report_path}")
    if not dry_run and bool(body.get("rescan_index")) and changed:
        try:
            scan_out = run_code_index_scan(repo_root)
            out.setdefault("lines", []).append(f"[Code 索引] {scan_out.get('summary', '重扫完成')}")
        except OSError as e:
            out.setdefault("lines", []).append(f"[Code 索引] 重扫失败: {e}")
    return out


def scan_uuids(repo_root: Path, body: dict) -> dict:
    kinds = tuple(str(k).strip().lower() for k in (body.get("kinds") or ["uuid"]) if str(k).strip())
    use_index = bool(body.get("use_index_scope", False))
    indexed_paths: set[str] | None = None
    if use_index:
        indexed_paths = _indexed_rel_paths(repo_root)
    opts = UuidScanOptions(
        scope=str(body.get("scope") or ""),
        kinds=kinds or ("uuid",),
        include_ignored=bool(body.get("include_ignored", False)),
        indexed_paths=frozenset(indexed_paths) if indexed_paths is not None else None,
    )
    out = scan_uuid_hits(repo_root, opts)
    out["scope"] = opts.scope
    out["kinds"] = list(opts.kinds)
    out["use_index_scope"] = use_index
    return out


def apply_uuids(repo_root: Path, body: dict) -> dict:
    hit_ids = [str(x).strip() for x in (body.get("hit_ids") or []) if str(x).strip()]
    dry_run = bool(body.get("dry_run", False))
    strategy = str(body.get("strategy") or "map_per_value")
    out = apply_uuid_hits(
        repo_root,
        hit_ids,
        strategy=strategy,
        dry_run=dry_run,
        target_encoding=str(body.get("target_encoding") or "utf-8"),
    )
    out["hit_ids"] = hit_ids
    out["strategy"] = strategy
    if not dry_run and out.get("summary", {}).get("total_hits"):
        report_path = _write_report(
            repo_root,
            "code-uuid-report",
            {"exported_at": _utc_now_iso(), "strategy": strategy, **out},
        )
        if report_path:
            out.setdefault("lines", []).append(f"[报告] {report_path}")
    return out
