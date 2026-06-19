"""Code 批量改名 / UUID 服务层。"""

from __future__ import annotations

from pathlib import Path

from phoenix.code.rename.apply import apply_text_rename
from phoenix.code.rename.scan import RenameScanOptions, preview_text_rename
from phoenix.code.rename.types import RenameLevel
from phoenix.code.rename.uuid_apply import apply_uuid_hits
from phoenix.code.rename.uuid_scan import UuidScanOptions, scan_uuid_hits
from phoenix.services.code_index_service import run_code_index_scan


def _levels(raw: list[str]) -> list[RenameLevel]:
    return [str(x).strip().lower() for x in raw if str(x).strip()]  # type: ignore[misc]


def preview_rename(repo_root: Path, body: dict) -> dict:
    opts = RenameScanOptions(
        old=str(body["old"]),
        new=str(body["new"]),
        levels=_levels(body.get("levels") or ["text"]),
        scope=str(body.get("scope") or ""),
        include_ignored=bool(body.get("include_ignored", False)),
    )
    out = preview_text_rename(repo_root, opts)
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
    out = apply_text_rename(repo_root, opts, dry_run=dry_run, target_encoding=target_encoding)
    out.update(
        {
            k: body[k]
            for k in ("old", "new", "scope", "target_encoding", "include_ignored", "rescan_index", "levels")
            if k in body
        }
    )
    if not dry_run and bool(body.get("rescan_index")) and out.get("summary", {}).get("text_files"):
        try:
            scan_out = run_code_index_scan(repo_root)
            out.setdefault("lines", []).append(f"[Code 索引] {scan_out.get('summary', '重扫完成')}")
        except OSError as e:
            out.setdefault("lines", []).append(f"[Code 索引] 重扫失败: {e}")
    return out


def scan_uuids(repo_root: Path, body: dict) -> dict:
    kinds = tuple(str(k).strip().lower() for k in (body.get("kinds") or ["uuid"]) if str(k).strip())
    opts = UuidScanOptions(
        scope=str(body.get("scope") or ""),
        kinds=kinds or ("uuid",),
        include_ignored=bool(body.get("include_ignored", False)),
    )
    out = scan_uuid_hits(repo_root, opts)
    out["scope"] = opts.scope
    out["kinds"] = list(opts.kinds)
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
    return out
