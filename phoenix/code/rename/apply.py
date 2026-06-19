"""批量改名：写盘执行。"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from phoenix.code.ignore import load_ignore_config
from phoenix.code.rename.encoding import choose_write_encoding, detect_and_read, write_text
from phoenix.code.rename.scan import RenameScanOptions, _count_line_hits, preview_text_rename
from phoenix.code.rename.types import empty_rename_summary
from phoenix.code.rename.walk import iter_scannable_files


def apply_text_rename(
    repo_root: Path,
    opts: RenameScanOptions,
    *,
    dry_run: bool,
    target_encoding: str = "utf-8",
) -> dict[str, Any]:
    preview = preview_text_rename(repo_root, opts)
    if "text" not in opts.levels:
        out = dict(preview)
        out["dry_run"] = dry_run
        out["ok"] = not dry_run
        return out

    root = repo_root.expanduser().resolve(strict=False)
    patterns = load_ignore_config(root)["ignore_patterns"]
    changed_files = 0
    total_replacements = 0
    skipped = 0
    lines: list[str] = list(preview.get("lines") or [])

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
        count, _ = _count_line_hits(payload.text, opts.old)
        if not count:
            continue
        new_text = payload.text.replace(opts.old, opts.new)
        out_enc = choose_write_encoding(payload, new_text, target_encoding=target_encoding)
        if dry_run:
            changed_files += 1
            total_replacements += count
            lines.append(f"  [预检] {rel} ×{count} ({payload.encoding}→{out_enc})")
            continue
        try:
            write_text(path, new_text, out_enc, had_bom=payload.had_bom)
            changed_files += 1
            total_replacements += count
            lines.append(f"  [写盘] {rel} ×{count} ({payload.encoding}→{out_enc})")
        except OSError as e:
            skipped += 1
            lines.append(f"  [失败] {rel}: {e}")

    summary = empty_rename_summary()
    summary["text_files"] = changed_files
    summary["total_hits"] = total_replacements
    summary["skipped"] = skipped

    mode = "预检（未写盘）" if dry_run else "已写盘"
    head = f"{mode}：改动 {changed_files} 个文本文件，替换 {total_replacements} 处"
    lines.insert(0, head)

    return {
        "ok": True,
        "implemented": True,
        "dry_run": dry_run,
        "hits": preview.get("hits") or [],
        "summary": summary,
        "lines": lines,
        "log": "\n".join(lines),
        "pending_levels": preview.get("pending_levels") or [],
    }
