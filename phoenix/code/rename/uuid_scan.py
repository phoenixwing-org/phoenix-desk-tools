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

DEFAULT_KINDS = ("uuid",)


@dataclass(frozen=True)
class UuidScanOptions:
    scope: str = ""
    kinds: tuple[str, ...] = DEFAULT_KINDS
    include_ignored: bool = False


def normalize_uuid_text(text: str) -> str:
    core = text.strip().strip("{}").replace("-", "").lower()
    return core


def classify_uuid_match(matched: str) -> str:
    core = matched.strip().strip("{}")
    if "-" in core and len(core.replace("-", "")) == 32:
        return "uuid"
    if len(core) == 32 and "-" not in core:
        return "guid32"
    return "suspicious"


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


def scan_uuid_hits(repo_root: Path, opts: UuidScanOptions) -> dict[str, Any]:
    hits: list[dict[str, Any]] = []
    kinds = set(opts.kinds or DEFAULT_KINDS)
    files_scanned = 0

    for path, rel in iter_scannable_files(
        repo_root,
        scope=opts.scope,
        include_ignored=opts.include_ignored,
    ):
        payload = detect_and_read(path)
        if payload is None:
            continue
        files_scanned += 1
        file_hits: list[dict[str, Any]] = []
        for i, line in enumerate(payload.text.splitlines(), 1):
            file_hits.extend(_scan_line(line, i, rel, kinds))
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
