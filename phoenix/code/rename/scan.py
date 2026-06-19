"""批量改名：预览扫描。"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

from phoenix.code.ignore import load_ignore_config
from phoenix.code.rename.encoding import detect_and_read
from phoenix.code.rename.types import RenameLevel, empty_rename_summary
from phoenix.code.rename.walk import iter_scannable_files


@dataclass
class RenameScanOptions:
    old: str
    new: str
    levels: list[RenameLevel]
    scope: str = ""
    include_ignored: bool = False


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
    pending_levels = [lv for lv in opts.levels if lv in ("dir", "file")]

    if "text" not in opts.levels:
        summary = empty_rename_summary()
        summary["skipped"] = 0
        lines = []
        if pending_levels:
            lines.append("文件夹 / 文件级改名尚未实现（P1）；请勾选「文本内容」。")
        return {
            "ok": True,
            "implemented": True,
            "hits": [],
            "summary": summary,
            "lines": lines or ["未勾选文本级，无扫描结果"],
            "log": "\n".join(lines),
            "pending_levels": pending_levels,
        }

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
        f"预览：旧名「{opts.old}」→ 新名「{opts.new}」",
        f"文本文件 {text_files} 个，命中 {total_hits} 处，跳过 {skipped} 个",
    ]
    if pending_levels:
        lines.append("注：文件夹 / 文件级将在 P1 实现，本次仅扫描文本。")
    for h in hits[:40]:
        if h.get("status") == "ok":
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
        "pending_levels": pending_levels,
    }
