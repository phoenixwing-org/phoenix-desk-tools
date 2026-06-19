"""UUID 勾选替换。"""

from __future__ import annotations

import uuid
from pathlib import Path
from typing import Any

from phoenix.code.rename.encoding import choose_write_encoding, detect_and_read, write_text
from phoenix.code.rename.types import empty_uuid_summary
from phoenix.code.rename.uuid_scan import make_hit_id, normalize_uuid_text, parse_hit_id


def _format_uuid_like(template: str, new: uuid.UUID) -> str:
    t = template.strip()
    inner = t.strip("{}")
    use_upper = any(c in "ABCDEF" for c in inner)
    use_braces = t.startswith("{") and t.endswith("}")
    use_hyphens = "-" in inner
    hex32 = new.hex
    if use_hyphens:
        body = f"{hex32[:8]}-{hex32[8:12]}-{hex32[12:16]}-{hex32[16:20]}-{hex32[20:]}"
    else:
        body = hex32
    if use_upper:
        body = body.upper()
    if use_braces:
        return "{" + body + "}"
    return body


def _offset_in_text(text: str, line: int, col: int) -> int | None:
    if line < 1:
        return None
    parts = text.splitlines(keepends=True)
    if line > len(parts):
        return None
    base = sum(len(parts[i]) for i in range(line - 1))
    idx = base + col - 1
    if idx < 0 or idx >= len(text):
        return None
    return idx


def apply_uuid_hits(
    repo_root: Path,
    hit_ids: list[str],
    *,
    strategy: str,
    dry_run: bool,
    target_encoding: str = "utf-8",
) -> dict[str, Any]:
    root = repo_root.expanduser().resolve(strict=False)
    parsed = [parse_hit_id(hid) for hid in hit_ids]

    value_map: dict[str, str] = {}
    per_hit_new: dict[str, str] = {}
    for item in parsed:
        norm = normalize_uuid_text(item["matched_text"])
        if strategy == "fresh_per_hit":
            key = f"{item['repo_rel_path']}:{item['line']}:{item['col']}"
            per_hit_new[key] = _format_uuid_like(item["matched_text"], uuid.uuid4())
        elif norm not in value_map:
            value_map[norm] = _format_uuid_like(item["matched_text"], uuid.uuid4())

    by_file: dict[str, list[dict[str, Any]]] = {}
    for item in parsed:
        by_file.setdefault(item["repo_rel_path"], []).append(item)

    mappings: list[dict[str, str]] = []
    total_replacements = 0
    changed_files = 0
    lines: list[str] = []

    for rel, items in sorted(by_file.items()):
        path = root / rel
        payload = detect_and_read(path)
        if payload is None:
            lines.append(f"  [跳过] {rel}: 无法读取")
            continue

        replacements: list[tuple[int, str, str, dict[str, Any]]] = []
        for item in items:
            old = item["matched_text"]
            if strategy == "fresh_per_hit":
                key = f"{item['repo_rel_path']}:{item['line']}:{item['col']}"
                new = per_hit_new[key]
            else:
                new = value_map[normalize_uuid_text(old)]
            off = _offset_in_text(payload.text, int(item["line"]), int(item["col"]))
            if off is None or payload.text[off : off + len(old)] != old:
                pos = payload.text.find(old)
                if pos < 0:
                    lines.append(f"  [未找到] {rel}:{item['line']} {old}")
                    continue
                off = pos
            replacements.append((off, old, new, item))

        if not replacements:
            continue

        text = payload.text
        for off, old, new, item in sorted(replacements, key=lambda x: x[0], reverse=True):
            if text[off : off + len(old)] != old:
                lines.append(f"  [未找到] {rel}:{item['line']} {old}")
                continue
            text = text[:off] + new + text[off + len(old) :]
            mappings.append(
                {
                    "old": old,
                    "new": new,
                    "hit_id": make_hit_id(rel, int(item["line"]), int(item["col"]), old),
                }
            )
            total_replacements += 1
            lines.append(f"  {'[预检]' if dry_run else '[写盘]'} {rel}:{item['line']} {old} → {new}")

        if not dry_run:
            out_enc = choose_write_encoding(payload, text, target_encoding=target_encoding)
            write_text(path, text, out_enc, had_bom=payload.had_bom)
        changed_files += 1

    summary = empty_uuid_summary()
    summary["total_hits"] = total_replacements
    summary["files_scanned"] = changed_files
    summary["unique_uuids"] = len({m["old"] for m in mappings})

    mode = "预检（未写盘）" if dry_run else "已写盘"
    head = f"{mode}：{changed_files} 个文件，{total_replacements} 处替换"
    lines.insert(0, head)

    return {
        "ok": True,
        "implemented": True,
        "dry_run": dry_run,
        "mappings": mappings,
        "summary": summary,
        "lines": lines,
        "log": "\n".join(lines),
    }
