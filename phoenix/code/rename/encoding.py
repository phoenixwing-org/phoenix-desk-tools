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


def normalize_newlines(text: str) -> str:
    """将各类换行统一为 LF，便于比较内容是否实质相同。"""
    return text.replace("\r\n", "\n").replace("\r", "\n")


def text_content_equivalent(left: str, right: str) -> bool:
    """True 当两段文本至多仅换行符风格不同（LF / CRLF / CR）。"""
    return normalize_newlines(left) == normalize_newlines(right)


def dominant_newline_style(text: str) -> str:
    """返回源文本主导换行风格：``crlf``、``lf`` 或 ``cr``。"""
    if not text:
        return "lf"
    crlf = text.count("\r\n")
    cr_only = text.count("\r") - crlf
    lf_only = text.count("\n") - crlf
    if crlf >= lf_only and crlf >= cr_only and crlf > 0:
        return "crlf"
    if cr_only > lf_only and cr_only > 0:
        return "cr"
    return "lf"


def apply_newline_style(text: str, style: str) -> str:
    """按给定换行风格格式化文本（先归一化为 LF 再转换）。"""
    base = normalize_newlines(text)
    if style == "crlf":
        return base.replace("\n", "\r\n")
    if style == "cr":
        return base.replace("\n", "\r")
    return base


def encode_text_bytes(text: str, encoding: str, *, had_bom: bool = False) -> bytes:
    body = text.encode(encoding, errors="strict")
    if had_bom and encoding == "utf-8":
        return _UTF8_BOM + body
    return body


def would_change_on_disk(
    path: Path,
    payload: TextPayload,
    new_text: str,
    *,
    encoding: str | None = None,
) -> bool:
    """True 若写回 *new_text* 会改变磁盘字节（忽略仅换行符差异）。"""
    if text_content_equivalent(payload.text, new_text):
        return False
    enc = encoding or choose_write_encoding(payload, new_text)
    try:
        on_disk = path.read_bytes()
    except OSError:
        return bool(new_text)
    styled = apply_newline_style(new_text, dominant_newline_style(payload.text))
    return encode_text_bytes(styled, enc, had_bom=payload.had_bom) != on_disk


def write_text_if_changed(
    path: Path,
    payload: TextPayload,
    new_text: str,
    *,
    encoding: str | None = None,
) -> bool:
    """仅在内容实质变更时写盘，并保留源文件换行风格。返回是否已写入。"""
    enc = encoding or choose_write_encoding(payload, new_text)
    if not would_change_on_disk(path, payload, new_text, encoding=enc):
        return False
    styled = apply_newline_style(new_text, dominant_newline_style(payload.text))
    write_text(path, styled, enc, had_bom=payload.had_bom)
    return True
