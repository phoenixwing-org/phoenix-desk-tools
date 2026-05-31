"""CAD 索引：可扫描的文件类型与 ``asset_kind`` 分类。"""

from __future__ import annotations

from pathlib import Path

# 除 .fcstd 外按后缀匹配（大小写不敏感）
_CAD_INDEX_SUFFIXES: frozenset[str] = frozenset(
    {
        ".md",
        ".markdown",
        ".pdf",
        ".dxf",
        ".dwg",
        ".png",
        ".jpg",
        ".jpeg",
        ".gif",
        ".webp",
        ".svg",
        ".bmp",
        ".tif",
        ".tiff",
    }
)

ASSET_KIND_FCSTD = "fcstd"
ASSET_KIND_MARKDOWN = "markdown"
ASSET_KIND_PDF = "pdf"
ASSET_KIND_CAD_EXCHANGE = "cad_exchange"
ASSET_KIND_IMAGE = "image"
ASSET_KIND_OTHER = "other"


def is_fcstd_filename(filename: str) -> bool:
    return Path(filename).name.casefold().endswith(".fcstd")


def is_cad_index_filename(filename: str) -> bool:
    """是否应纳入 CAD 索引扫描。"""
    name = Path(filename).name
    if is_fcstd_filename(name):
        return True
    return Path(name).suffix.casefold() in _CAD_INDEX_SUFFIXES


def cad_asset_kind(filename: str) -> str:
    """索引条目 ``asset_kind``（写入 ``file_asset.asset_kind``）。"""
    name = Path(filename).name
    low = name.casefold()
    if low.endswith(".fcstd"):
        return ASSET_KIND_FCSTD
    ext = Path(name).suffix.casefold()
    if ext in (".md", ".markdown"):
        return ASSET_KIND_MARKDOWN
    if ext == ".pdf":
        return ASSET_KIND_PDF
    if ext in (".dxf", ".dwg"):
        return ASSET_KIND_CAD_EXCHANGE
    if ext in (".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp", ".tif", ".tiff"):
        return ASSET_KIND_IMAGE
    return ASSET_KIND_OTHER


def cad_asset_kind_label(kind: str | None) -> str:
    """界面显示用中文/短标签。"""
    labels = {
        ASSET_KIND_FCSTD: "FCStd",
        ASSET_KIND_MARKDOWN: "MD",
        ASSET_KIND_PDF: "PDF",
        ASSET_KIND_CAD_EXCHANGE: "DXF/DWG",
        ASSET_KIND_IMAGE: "图片",
        ASSET_KIND_OTHER: "其他",
    }
    k = (kind or "").strip()
    if not k:
        return "—"
    return labels.get(k, k)
