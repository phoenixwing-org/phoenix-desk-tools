"""FCStd BOM 扩展属性读写（独立于 FreeCAD 进程）。

可读写字段保存在 ``Document.xml`` 内 BOM 挂载对象的 ``Property`` 中。
若文档正被 FreeCAD 打开，重写 ZIP 常会失败（文件占用），应向用户提示先关闭 FreeCAD。
"""

from __future__ import annotations

from pathlib import Path
from typing import Mapping

from phoenix.freecad.fcstd_document_bom_props import (
    EDITABLE_DOCUMENT_ATTRS as EDITABLE_ENTRY_ATTRS,
    PhoenixDocumentBomError,
    read_body_bom_from_document,
    write_body_bom_to_document,
)


class PhoenixFcstdEmbeddedError(RuntimeError):
    """读取或写回嵌入式属性失败（损坏的 ZIP / I/O / Document 结构不符等）。"""


def read_embedded_bom_attrs(fcstd_path: Path) -> dict[str, str]:
    """从 ``Document.xml`` 读取 BOM 挂载对象上的可编辑字段。"""
    path = fcstd_path.expanduser().resolve(strict=False)
    if not path.is_file():
        return {}
    try:
        doc_vals, explicit = read_body_bom_from_document(path)
    except PhoenixDocumentBomError as e:
        raise PhoenixFcstdEmbeddedError(str(e)) from e
    return {k: doc_vals[k] for k in EDITABLE_ENTRY_ATTRS if k in explicit}


def write_embedded_bom_attrs(fcstd_path: Path, values: Mapping[str, str]) -> None:
    """写入 ``Document.xml`` 内的 BOM 挂载对象 Property。"""
    try:
        write_body_bom_to_document(fcstd_path, values)
    except PhoenixDocumentBomError as e:
        raise PhoenixFcstdEmbeddedError(str(e)) from e
