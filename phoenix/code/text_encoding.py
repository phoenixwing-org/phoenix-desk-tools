"""文本文件编码检测（索引与改名共用标签）。"""

from __future__ import annotations

from pathlib import Path

from phoenix.code.rename.binary import is_binary_suffix, is_probably_binary

# 写入 phoenix_code_file_asset.text_encoding 的标准字符串
ENC_UTF8 = "utf-8"
ENC_UTF8_BOM = "utf-8-bom"
ENC_ASCII = "ascii"
ENC_GBK = "gbk"
ENC_BINARY = "binary"
ENC_UNKNOWN = "unknown"

_UTF8_BOM = b"\xef\xbb\xbf"

TEXT_ENCODING_LABELS: tuple[str, ...] = (
    ENC_UTF8,
    ENC_UTF8_BOM,
    ENC_ASCII,
    ENC_GBK,
    ENC_BINARY,
    ENC_UNKNOWN,
)


def detect_text_encoding_label(path: Path) -> str:
    """检测文件文本编码标签（不读全文件大文件时仅探测头部）。"""
    if is_binary_suffix(path):
        return ENC_BINARY
    try:
        raw = path.read_bytes()
    except OSError:
        return ENC_UNKNOWN
    if not raw:
        return ENC_UTF8
    if is_probably_binary(raw):
        return ENC_BINARY
    if raw.startswith(_UTF8_BOM):
        body = raw[len(_UTF8_BOM) :]
        try:
            body.decode("utf-8")
            return ENC_UTF8_BOM
        except UnicodeDecodeError:
            return ENC_UNKNOWN
    try:
        text = raw.decode("utf-8")
        if all(ord(c) < 128 for c in text):
            return ENC_ASCII
        return ENC_UTF8
    except UnicodeDecodeError:
        pass
    try:
        raw.decode("gbk")
        return ENC_GBK
    except UnicodeDecodeError:
        return ENC_UNKNOWN


def encoding_label_from_had_bom(encoding: str, had_bom: bool) -> str:
    """将 rename 读写层 encoding + BOM 标志映射为索引标签。"""
    enc = (encoding or "").lower()
    if had_bom and enc in ("utf-8", "utf-8-sig"):
        return ENC_UTF8_BOM
    if enc == "gbk":
        return ENC_GBK
    if enc == "ascii":
        return ENC_ASCII
    if enc == "utf-8":
        return ENC_UTF8
    return enc or ENC_UNKNOWN

def had_bom_from_label(label: str) -> bool:
    return label == ENC_UTF8_BOM
