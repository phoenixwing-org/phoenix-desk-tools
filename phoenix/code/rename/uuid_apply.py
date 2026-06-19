"""UUID 勾选替换。"""

from __future__ import annotations

import re
import uuid
from pathlib import Path
from typing import Any

from phoenix.code.rename.encoding import choose_write_encoding, detect_and_read, write_text
from phoenix.code.rename.types import empty_uuid_summary
from phoenix.code.rename.uuid_scan import (
    detect_caa_guid_style,
    make_hit_id,
    normalize_uuid_text,
    parse_hit_id,
)


def _uses_uppercase_hex(template: str) -> bool:
    """True 当模板中含大写十六进制字母 A–F（小写 a–f 与数字不算）。"""
    return bool(re.search(r"[A-F]", template))


def _group_hex_uppercase(matched_texts: list[str]) -> bool:
    """同值组大小写：全为大写 → 大写；否则（全小写或混用）→ 小写。"""
    flags = [_uses_uppercase_hex(t) for t in matched_texts]
    return bool(flags) and all(flags)


def _format_uuid_like(template: str, new: uuid.UUID, *, use_upper: bool | None = None) -> str:
    t = template.strip()
    inner = t.strip("{}")
    if use_upper is None:
        use_upper = _uses_uppercase_hex(template)
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


def _format_caa_guid_like(
    template: str,
    new: uuid.UUID,
    *,
    style: str | None = None,
    use_upper: bool | None = None,
) -> str:
    style = style or detect_caa_guid_style(template) or "nested"
    if use_upper is None:
        use_upper = _uses_uppercase_hex(template)
    h = new.hex.upper() if use_upper else new.hex
    d1, d2, d3 = h[:8], h[8:12], h[12:16]
    bs = [h[i : i + 2] for i in range(16, 32, 2)]
    byte_list = ", ".join(f"0x{b}" for b in bs)
    if style == "flat_brace":
        return f"{{0x{d1}, 0x{d2}, 0x{d3}, {byte_list}}}"
    if style == "flat_run":
        return f"0x{d1}, 0x{d2}, 0x{d3}, {byte_list}"
    if "\n" in template:
        indent_match = re.search(r"\n(\s+)0x", template)
        indent = indent_match.group(1) if indent_match else "                 "
        return (
            f"0x{d1},\n{indent}0x{d2},\n{indent}0x{d3},\n{indent}{{{byte_list}}}"
        )
    return f"0x{d1}, 0x{d2}, 0x{d3}, {{{byte_list}}}"


def _format_replacement(template: str, new: uuid.UUID, *, use_upper: bool | None = None) -> str:
    style = detect_caa_guid_style(template)
    if style:
        return _format_caa_guid_like(template, new, style=style, use_upper=use_upper)
    return _format_uuid_like(template, new, use_upper=use_upper)


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


def _norm_key(matched_text: str) -> str:
    return normalize_uuid_text(matched_text)


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

    by_norm_texts: dict[str, list[str]] = {}
    for item in parsed:
        norm = _norm_key(item["matched_text"])
        by_norm_texts.setdefault(norm, []).append(item["matched_text"])
    case_upper_by_norm = {norm: _group_hex_uppercase(texts) for norm, texts in by_norm_texts.items()}

    # 同一归一化旧值 → 一个 uuid4；各命中按原文写法分别格式化（.iid 连字符 vs CAA 0x 块）
    uuid_map: dict[str, uuid.UUID] = {}
    per_hit_uuid: dict[str, uuid.UUID] = {}
    per_hit_upper: dict[str, bool] = {}
    for item in parsed:
        norm = _norm_key(item["matched_text"])
        if strategy == "fresh_per_hit":
            key = f"{item['repo_rel_path']}:{item['line']}:{item['col']}"
            per_hit_uuid[key] = uuid.uuid4()
            per_hit_upper[key] = _uses_uppercase_hex(item["matched_text"])
        elif norm not in uuid_map:
            uuid_map[norm] = uuid.uuid4()

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
                new_uuid = per_hit_uuid[key]
                use_upper = per_hit_upper[key]
            else:
                norm = _norm_key(old)
                new_uuid = uuid_map[norm]
                use_upper = case_upper_by_norm[norm]
            new = _format_replacement(old, new_uuid, use_upper=use_upper)
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
    if strategy == "map_per_value":
        summary["unique_new_uuids"] = len(uuid_map)

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
