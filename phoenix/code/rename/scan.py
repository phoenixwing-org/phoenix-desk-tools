"""批量改名：预览扫描（文件夹 / 文件 / 文本）。"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from phoenix.code.ignore import load_ignore_config
from phoenix.code.rename.encoding import detect_and_read
from phoenix.code.rename.path_rename import preview_path_rename
from phoenix.code.rename.types import LEVEL_ORDER, RenameScanOptions, empty_rename_summary
from phoenix.code.rename.walk import iter_scannable_files


def _count_line_hits(text: str, needle: str) -> tuple[int, list[int]]:
    if not needle:
        return 0, []
    total = 0
    lines: list[int] = []
    for i, line in enumerate(text.splitlines(), 1):
        n = line.count(needle)
        if n:
            lines.append(i)
            total += n
    return total, lines


def preview_text_rename(repo_root: Path, opts: RenameScanOptions) -> dict[str, Any]:
    root = repo_root.expanduser().resolve(strict=False)
    patterns = load_ignore_config(root)["ignore_patterns"]
    hits: list[dict[str, Any]] = []
    skipped = 0
    text_files = 0
    total_hits = 0

    for path, rel in iter_scannable_files(
        root,
        scope=opts.scope,
        ignore_patterns=patterns,
        include_ignored=opts.include_ignored,
    ):
        payload = detect_and_read(path)
        if payload is None:
            skipped += 1
            continue
        count, line_nums = _count_line_hits(payload.text, opts.old)
        if not count:
            continue
        text_files += 1
        total_hits += count
        hits.append(
            {
                "hit_id": f"text:{rel}",
                "repo_rel_path": rel,
                "level": "text",
                "hits": count,
                "lines": line_nums,
                "encoding_in": payload.encoding,
                "status": "ok",
            }
        )

    summary = empty_rename_summary()
    summary["text_files"] = text_files
    summary["total_hits"] = total_hits
    summary["skipped"] = skipped

    lines = [
        f"文本预览：旧名「{opts.old}」→ 新名「{opts.new}」",
        f"文本文件 {text_files} 个，命中 {total_hits} 处，跳过 {skipped} 个",
    ]
    for h in hits[:40]:
        ln = ",".join(str(x) for x in (h.get("lines") or [])[:8])
        lines.append(f"  · {h['repo_rel_path']} ×{h['hits']} 行 {ln}")
    if len(hits) > 40:
        lines.append(f"  … 另有 {len(hits) - 40} 条")

    return {
        "ok": True,
        "implemented": True,
        "hits": hits,
        "summary": summary,
        "lines": lines,
        "log": "\n".join(lines),
    }


def _merge_summary(into: dict[str, int], part: dict[str, int]) -> None:
    for key in ("dirs", "files", "text_files", "total_hits", "skipped"):
        into[key] = into.get(key, 0) + int(part.get(key, 0))


def preview_rename_all(repo_root: Path, opts: RenameScanOptions) -> dict[str, Any]:
    hits: list[dict[str, Any]] = []
    lines: list[str] = [
        f"预览：旧名「{opts.old}」→ 新名「{opts.new}」",
        f"级别：{', '.join(opts.levels)}",
    ]
    summary = empty_rename_summary()

    for level in LEVEL_ORDER:
        if level not in opts.levels:
            continue
        if level == "text":
            part = preview_text_rename(repo_root, opts)
        else:
            part = preview_path_rename(repo_root, opts, kind=level)
        hits.extend(part.get("hits") or [])
        _merge_summary(summary, part.get("summary") or {})
        lines.extend(part.get("lines") or [])

    if not hits:
        lines.append("无命中")

    return {
        "ok": True,
        "implemented": True,
        "hits": hits,
        "summary": summary,
        "lines": lines,
        "log": "\n".join(lines),
        "levels": opts.levels,
    }
