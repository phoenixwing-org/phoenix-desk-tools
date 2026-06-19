"""文本扫描时跳过二进制与不可索引后缀。"""

from __future__ import annotations

from pathlib import Path

_BINARY_SUFFIXES = frozenset(
    {
        ".o",
        ".a",
        ".so",
        ".dylib",
        ".dll",
        ".exe",
        ".fcstd",
        ".zip",
        ".tar",
        ".gz",
        ".bz2",
        ".7z",
        ".rar",
        ".png",
        ".jpg",
        ".jpeg",
        ".gif",
        ".webp",
        ".ico",
        ".icns",
        ".bmp",
        ".ttf",
        ".otf",
        ".woff",
        ".woff2",
        ".eot",
        ".pdf",
        ".pyc",
        ".pyo",
        ".class",
        ".wasm",
    }
)

_PROBE = 8192


def is_binary_suffix(path: Path) -> bool:
    return path.suffix.casefold() in _BINARY_SUFFIXES


def is_probably_binary(raw: bytes) -> bool:
    if not raw:
        return False
    return b"\x00" in raw[:_PROBE]


def is_scannable_text_file(path: Path) -> bool:
    if not path.is_file():
        return False
    if is_binary_suffix(path):
        return False
    try:
        head = path.read_bytes()[:_PROBE]
    except OSError:
        return False
    return not is_probably_binary(head)
