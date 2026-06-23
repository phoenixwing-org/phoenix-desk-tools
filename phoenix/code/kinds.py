"""Code 工作空间文件分类（源文件 / 配置 / 文档 / 资源）。"""

from __future__ import annotations

from pathlib import Path

# 扩展名 → asset_kind（小写）
_EXT_KIND: dict[str, str] = {}

_SOURCE_EXTS = (".cpp", ".c", ".cc", ".cxx", ".h", ".hpp", ".hh", ".hxx", ".m", ".mm")
_CONFIG_EXTS = (
    ".json",
    ".cmake",
    ".yaml",
    ".yml",
    ".toml",
    ".ini",
    ".cfg",
    ".conf",
    ".pro",
    ".pri",
    ".qss",
)
_DOC_EXTS = (".md", ".markdown", ".rst", ".txt")
_RESOURCE_EXTS = (
    ".qrc",
    ".ui",
    ".qml",
    ".catdlg",
    ".catnls",
    ".catrsc",
    ".bmp",
    ".xpm",
    ".png",
    ".jpg",
    ".jpeg",
    ".gif",
    ".svg",
    ".ico",
    ".icns",
    ".wav",
    ".mp3",
    ".ttf",
    ".otf",
    ".woff",
    ".woff2",
)

for ext in _SOURCE_EXTS:
    _EXT_KIND[ext] = "source"
for ext in _CONFIG_EXTS:
    _EXT_KIND[ext] = "config"
for ext in _DOC_EXTS:
    _EXT_KIND[ext] = "doc"
for ext in _RESOURCE_EXTS:
    _EXT_KIND[ext] = "resource"

# 全名（无扩展名类）→ kind
_BASENAME_KIND: dict[str, str] = {
    "cmakelists.txt": "config",
    "makefile": "config",
    "pyproject.toml": "config",
    "package.json": "config",
    "requirements.txt": "config",
}

CODE_ASSET_KINDS: tuple[str, ...] = ("source", "config", "doc", "resource")

KIND_LABELS: dict[str, str] = {
    "source": "源文件",
    "config": "配置",
    "doc": "文档",
    "resource": "资源",
}


def normalize_index_extension(ext: str) -> str | None:
    raw = (ext or "").strip().casefold()
    if not raw:
        return None
    if not raw.startswith("."):
        raw = f".{raw}"
    if len(raw) < 2 or len(raw) > 16:
        return None
    return raw


def builtin_index_extensions() -> frozenset[str]:
    return frozenset(_EXT_KIND.keys())


def code_asset_kind(path: Path, extra_exts: frozenset[str] = frozenset()) -> str | None:
    """返回 ``source`` / ``config`` / ``doc`` / ``resource``，非索引类型返回 ``None``。"""
    name_cf = path.name.casefold()
    if name_cf in _BASENAME_KIND:
        return _BASENAME_KIND[name_cf]
    ext = path.suffix.casefold()
    if ext in extra_exts:
        return "resource"
    if ext in _EXT_KIND:
        kind = _EXT_KIND[ext]
        if ext in (".h", ".hpp", ".hh", ".hxx"):
            return "source"
        return kind
    return None


def is_code_index_filename(path: Path, extra_exts: frozenset[str] = frozenset()) -> bool:
    return code_asset_kind(path, extra_exts) is not None
