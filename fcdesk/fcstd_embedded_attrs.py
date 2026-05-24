"""FCStd BOM 扩展属性读写（独立于 FreeCAD 进程）。

可读写字段保存在 ``Document.xml`` 内首个 ``PartDesign::Body`` 的 ``Property`` 中，
与你在 FreeCAD 里添加的属性（例如 ``TempKevin``）同一层级；不再创建独立的
``FcdeskBomAttrs.xml``。**保存时会从 ZIP 中移除遗留的 ``FcdeskBomAttrs.xml``**，
以便完成迁移。

若文档正被 FreeCAD 打开，重写 ZIP 常会失败（文件占用），应向用户提示先关闭 FreeCAD。
"""

from __future__ import annotations

import zipfile
from pathlib import Path
from typing import Mapping
from xml.etree import ElementTree as ET

from fcdesk.fcstd_document_bom_props import (
    SIDECAR_LEGACY as EMBEDDED_BOM_XML,
    EDITABLE_DOCUMENT_ATTRS as EDITABLE_ENTRY_ATTRS,
    FcdeskDocumentBomError,
    read_body_bom_from_document,
    write_body_bom_to_document,
)


class FcdeskFcstdEmbeddedError(RuntimeError):
    """读取或写回嵌入式属性失败（损坏的 ZIP / I/O / Document 结构不符等）。"""


def _parse_legacy_sidecar_xml(raw_xml: str) -> dict[str, str]:
    root = ET.fromstring(raw_xml)
    allowed = frozenset(EDITABLE_ENTRY_ATTRS)
    out: dict[str, str] = {}
    for child in root:
        tag = child.tag.split("}")[-1]
        if tag not in allowed:
            continue
        out[tag] = "".join(child.itertext()).strip()
    return out


def read_embedded_bom_attrs(fcstd_path: Path) -> dict[str, str]:
    """从 ``Document.xml`` 读取；若有旧版 ``FcdeskBomAttrs.xml`` 且无对应 Body 字段，则用侧车值补齐。"""
    path = fcstd_path.expanduser().resolve(strict=False)
    if not path.is_file():
        return {}

    legacy: dict[str, str] = {}
    try:
        with zipfile.ZipFile(path, "r") as zf:
            if EMBEDDED_BOM_XML in zf.namelist():
                legacy = _parse_legacy_sidecar_xml(zf.read(EMBEDDED_BOM_XML).decode("utf-8"))
    except zipfile.BadZipFile as e:
        raise FcdeskFcstdEmbeddedError(f"无效的 FCStd/ZIP：{path}") from e
    except (OSError, UnicodeDecodeError) as e:
        raise FcdeskFcstdEmbeddedError(str(e)) from e

    try:
        doc_vals, explicit = read_body_bom_from_document(path)
    except FcdeskDocumentBomError as e:
        raise FcdeskFcstdEmbeddedError(str(e)) from e

    out: dict[str, str] = {}
    for k in EDITABLE_ENTRY_ATTRS:
        if k in explicit:
            out[k] = doc_vals[k]
        else:
            out[k] = legacy.get(k, "").strip()

    return out


def write_embedded_bom_attrs(fcstd_path: Path, values: Mapping[str, str]) -> None:
    """写入 ``Document.xml`` 内的 Body Property，并移除 ZIP 内遗留 ``FcdeskBomAttrs.xml``。"""
    try:
        write_body_bom_to_document(fcstd_path, values)
    except FcdeskDocumentBomError as e:
        raise FcdeskFcstdEmbeddedError(str(e)) from e
