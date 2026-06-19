"""批量改名：写盘执行（文件夹 → 文件 → 文本）。"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from phoenix.code.rename.path_rename import apply_path_rename
from phoenix.code.rename.scan import preview_rename_all
from phoenix.code.rename.types import LEVEL_ORDER, RenameScanOptions, empty_rename_summary

# 复用文本 apply 逻辑
from phoenix.code.rename.apply import apply_text_rename


def _merge_summary(into: dict[str, int], part: dict[str, int]) -> None:
    for key in ("dirs", "files", "text_files", "total_hits", "skipped"):
        into[key] = into.get(key, 0) + int(part.get(key, 0))


def apply_rename_all(
    repo_root: Path,
    opts: RenameScanOptions,
    *,
    dry_run: bool,
    target_encoding: str = "utf-8",
) -> dict[str, Any]:
    preview = preview_rename_all(repo_root, opts)
    hits: list[dict[str, Any]] = []
    lines: list[str] = [
        f"{'预检（未写盘）' if dry_run else '写盘'}：旧名「{opts.old}」→ 新名「{opts.new}」",
        f"级别：{', '.join(opts.levels)}",
    ]
    summary = empty_rename_summary()
    ok = True

    for level in LEVEL_ORDER:
        if level not in opts.levels:
            continue
        if level == "text":
            part = apply_text_rename(
                repo_root,
                opts,
                dry_run=dry_run,
                target_encoding=target_encoding,
            )
        else:
            part = apply_path_rename(repo_root, opts, kind=level, dry_run=dry_run)
        hits.extend(part.get("hits") or [])
        _merge_summary(summary, part.get("summary") or {})
        body = part.get("lines") or []
        if body:
            lines.extend(body[1:] if len(body) > 1 else body)
        if not part.get("ok", True):
            ok = False

    lines.insert(1, f"汇总：文件夹 {summary['dirs']} · 文件 {summary['files']} · 文本 {summary['text_files']} · 替换 {summary['total_hits']} 处")

    return {
        "ok": ok,
        "implemented": True,
        "dry_run": dry_run,
        "hits": hits or preview.get("hits") or [],
        "summary": summary,
        "lines": lines,
        "log": "\n".join(lines),
        "levels": opts.levels,
    }
