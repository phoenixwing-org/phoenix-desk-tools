"""文本文件编码检测与读写。"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from phoenix.code.rename.types import DEFAULT_TARGET_ENCODING

_UTF8_BOM = b"\xef\xbb\xbf"


@dataclass(frozen=True)
class TextPayload:
    text: str
    encoding: str
    had_bom: bool


def detect_and_read(path: Path) -> TextPayload | None:
    try:
        raw = path.read_bytes()
    except OSError:
        return None
    if not raw:
        return TextPayload(text="", encoding="utf-8", had_bom=False)
    had_bom = raw.startswith(_UTF8_BOM)
    payload = raw[_UTF8_BOM.__len__() :] if had_bom else raw
    try:
        return TextPayload(text=payload.decode("utf-8"), encoding="utf-8", had_bom=had_bom)
    except UnicodeDecodeError:
        pass
    try:
        return TextPayload(text=payload.decode("gbk"), encoding="gbk", had_bom=False)
    except UnicodeDecodeError:
        return None


def choose_write_encoding(
    payload: TextPayload,
    new_text: str,
    *,
    target_encoding: str = DEFAULT_TARGET_ENCODING,
) -> str:
    enc = payload.encoding
    if enc == "utf-8" and payload.had_bom:
        return "utf-8"
    try:
        payload.text.encode(enc)
    except UnicodeEncodeError:
        enc = target_encoding if target_encoding in ("utf-8", "gbk") else DEFAULT_TARGET_ENCODING
    if enc in ("utf-8", "ascii") and any(ord(c) > 127 for c in new_text):
        return target_encoding if target_encoding in ("utf-8", "gbk") else DEFAULT_TARGET_ENCODING
    if enc == "ascii" and all(ord(c) < 128 for c in new_text):
        return "utf-8"
    return enc


def write_text(path: Path, text: str, encoding: str, *, had_bom: bool = False) -> None:
    enc = encoding
    if enc == "utf-8" and had_bom:
        path.write_bytes(_UTF8_BOM + text.encode("utf-8"))
        return
    path.write_text(text, encoding=enc, errors="strict", newline="")
