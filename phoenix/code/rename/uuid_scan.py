"""UUID 形态字符串扫描。"""

from __future__ import annotations

import base64
import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from phoenix.code.rename.encoding import detect_and_read
from phoenix.code.rename.types import empty_uuid_summary
from phoenix.code.rename.walk import iter_scannable_files

_UUID_HYPHEN = re.compile(
    r"\{?[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\}?",
)
_UUID_32 = re.compile(r"\b[0-9a-fA-F]{32}\b")
_GIT_HASH = re.compile(r"\b[0-9a-fA-F]{40}\b")

# CAA / COM GUID 字面量：Data1(8) + Data2(4) + Data3(4) + 8×byte(2)
_CAA_BYTE = r"0x([0-9a-fA-F]{2})"
_CAA_GUID_NESTED = re.compile(
    r"0x([0-9a-fA-F]{8})\s*,\s*0x([0-9a-fA-F]{4})\s*,\s*0x([0-9a-fA-F]{4})\s*,\s*\{\s*"
    + r"\s*,\s*".join([_CAA_BYTE] * 8)
    + r"\s*\}",
    re.IGNORECASE | re.DOTALL,
)
_CAA_GUID_FLAT_BRACE = re.compile(
    r"\{\s*0x([0-9a-fA-F]{8})\s*,\s*0x([0-9a-fA-F]{4})\s*,\s*0x([0-9a-fA-F]{4})\s*,\s*"
    + r"\s*,\s*".join([_CAA_BYTE] * 8)
    + r"\s*\}",
    re.IGNORECASE | re.DOTALL,
)
_CAA_GUID_FLAT_RUN = re.compile(
    r"0x([0-9a-fA-F]{8})\s*,\s*0x([0-9a-fA-F]{4})\s*,\s*0x([0-9a-fA-F]{4})\s*,\s*"
    + r"\s*,\s*".join([_CAA_BYTE] * 8)
    + r"(?!\s*,\s*0x|\s*\})",
    re.IGNORECASE | re.DOTALL,
)

# 兼容旧 import
_CAA_GUID_BLOCK = _CAA_GUID_NESTED

CAA_GUID_PATTERNS: tuple[tuple[re.Pattern[str], str], ...] = (
    (_CAA_GUID_NESTED, "nested"),
    (_CAA_GUID_FLAT_BRACE, "flat_brace"),
    (_CAA_GUID_FLAT_RUN, "flat_run"),
)

DEFAULT_KINDS = ("uuid",)


@dataclass(frozen=True)
class UuidScanOptions:
    scope: str = ""
    kinds: tuple[str, ...] = DEFAULT_KINDS
    include_ignored: bool = False
    indexed_paths: frozenset[str] | None = None


def normalize_uuid_text(text: str) -> str:
    parsed = parse_caa_guid_text(text)
    if parsed:
        return parsed
    core = text.strip().strip("{}").replace("-", "").lower()
    return core


def caa_guid_groups_to_normalized(groups: tuple[str, ...]) -> str:
    return (groups[0] + groups[1] + groups[2] + "".join(groups[3:11])).lower()


def parse_caa_guid_text(text: str) -> str | None:
    """从 CAA/COM 十六进制 GUID 字面量提取 32 位 hex（无连字符）。"""
    for pat, _style in CAA_GUID_PATTERNS:
        m = pat.search(text)
        if m:
            return caa_guid_groups_to_normalized(m.groups())
    return None


def detect_caa_guid_style(text: str) -> str | None:
    for pat, style in CAA_GUID_PATTERNS:
        if pat.search(text):
            return style
    return None


def classify_uuid_match(matched: str) -> str:
    core = matched.strip().strip("{}")
    if parse_caa_guid_text(matched):
        return "uuid"
    if core.lower().startswith("0x"):
        return "uuid"
    if "-" in core and len(core.replace("-", "")) == 32:
        return "uuid"
    if len(core) == 32 and "-" not in core:
        return "guid32"
    return "suspicious"


def _line_col_at_offset(text: str, offset: int) -> tuple[int, int]:
    line = text.count("\n", 0, offset) + 1
    last_nl = text.rfind("\n", 0, offset)
    col = offset - last_nl
    return line, col


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


def _span_overlaps(start: int, end: int, spans: list[tuple[int, int]]) -> bool:
    return any(not (end <= s or start >= e) for s, e in spans)


def make_hit_id(repo_rel_path: str, line: int, col: int, matched_text: str) -> str:
    payload = {"p": repo_rel_path, "l": line, "c": col, "t": matched_text}
    raw = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def parse_hit_id(hit_id: str) -> dict[str, Any]:
    pad = "=" * (-len(hit_id) % 4)
    data = json.loads(base64.urlsafe_b64decode(hit_id + pad).decode("utf-8"))
    return {
        "repo_rel_path": str(data["p"]),
        "line": int(data["l"]),
        "col": int(data["c"]),
        "matched_text": str(data["t"]),
    }


def _scan_line(
    line: str,
    line_no: int,
    repo_rel: str,
    kinds: set[str],
) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    seen_spans: list[tuple[int, int]] = []

    def overlaps(start: int, end: int) -> bool:
        return any(not (end <= s or start >= e) for s, e in seen_spans)

    for rx, force_kind in ((_UUID_HYPHEN, None), (_UUID_32, "guid32")):
        for m in rx.finditer(line):
            matched = m.group(0)
            if _GIT_HASH.fullmatch(matched.strip("{}")):
                continue
            kind = force_kind or classify_uuid_match(matched)
            if kind not in kinds:
                continue
            if overlaps(m.start(), m.end()):
                continue
            seen_spans.append((m.start(), m.end()))
            out.append(
                {
                    "hit_id": make_hit_id(repo_rel, line_no, m.start() + 1, matched),
                    "repo_rel_path": repo_rel,
                    "line": line_no,
                    "col": m.start() + 1,
                    "matched_text": matched,
                    "uuid_normalized": normalize_uuid_text(matched),
                    "kind": kind,
                    "file_hits": 0,
                }
            )
    return out


def _scan_caa_guid_blocks(
    text: str,
    repo_rel: str,
    kinds: set[str],
) -> tuple[list[dict[str, Any]], list[tuple[int, int]]]:
    if "uuid" not in kinds:
        return [], []
    out: list[dict[str, Any]] = []
    spans: list[tuple[int, int]] = []
    for pat, style in CAA_GUID_PATTERNS:
        for m in pat.finditer(text):
            start, end = m.start(), m.end()
            if _span_overlaps(start, end, spans):
                continue
            matched = m.group(0)
            spans.append((start, end))
            line, col = _line_col_at_offset(text, start)
            out.append(
                {
                    "hit_id": make_hit_id(repo_rel, line, col, matched),
                    "repo_rel_path": repo_rel,
                    "line": line,
                    "col": col,
                    "matched_text": matched,
                    "uuid_normalized": caa_guid_groups_to_normalized(m.groups()),
                    "kind": "uuid",
                    "caa_style": style,
                    "file_hits": 0,
                }
            )
    return out, spans


def _scan_text_hits(text: str, repo_rel: str, kinds: set[str]) -> list[dict[str, Any]]:
    caa_hits, caa_spans = _scan_caa_guid_blocks(text, repo_rel, kinds)
    line_hits: list[dict[str, Any]] = []
    for i, line in enumerate(text.splitlines(), 1):
        for h in _scan_line(line, i, repo_rel, kinds):
            off = _offset_in_text(text, int(h["line"]), int(h["col"]))
            if off is not None and _span_overlaps(off, off + len(h["matched_text"]), caa_spans):
                continue
            line_hits.append(h)
    return caa_hits + line_hits


def scan_uuid_hits(repo_root: Path, opts: UuidScanOptions) -> dict[str, Any]:
    hits: list[dict[str, Any]] = []
    kinds = set(opts.kinds or DEFAULT_KINDS)
    files_scanned = 0

    for path, rel in iter_scannable_files(
        repo_root,
        scope=opts.scope,
        include_ignored=opts.include_ignored,
    ):
        if opts.indexed_paths is not None and rel not in opts.indexed_paths:
            continue
        payload = detect_and_read(path)
        if payload is None:
            continue
        files_scanned += 1
        file_hits = _scan_text_hits(payload.text, rel, kinds)
        if not file_hits:
            continue
        fh = len(file_hits)
        for h in file_hits:
            h["file_hits"] = fh
        hits.extend(file_hits)

    unique = len({h["uuid_normalized"] for h in hits})
    summary = empty_uuid_summary()
    summary["files_scanned"] = files_scanned
    summary["total_hits"] = len(hits)
    summary["unique_uuids"] = unique

    lines = [
        f"UUID 扫描：{files_scanned} 个文本文件，命中 {len(hits)} 处，去重 {unique} 个",
    ]
    if opts.indexed_paths is not None:
        lines[0] += f"（Code 索引范围内 {len(opts.indexed_paths)} 个 present 文件）"
    for h in hits[:30]:
        lines.append(f"  · {h['repo_rel_path']}:{h['line']} {h['matched_text']}")
    if len(hits) > 30:
        lines.append(f"  … 另有 {len(hits) - 30} 条")

    return {
        "ok": True,
        "implemented": True,
        "scan_id": None,
        "hits": hits,
        "summary": summary,
        "lines": lines,
        "log": "\n".join(lines),
    }
