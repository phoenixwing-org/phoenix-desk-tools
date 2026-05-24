"""FCStd ZIP 内嵌 BOM 扩展属性读写（独立于 FreeCAD 进程）。

在 ``.FCStd`` ZIP 根目录写入 ``FcdeskBomAttrs.xml``（与 ``Document.xml`` 平级）。
FreeCAD 一般忽略未声明的 ZIP 成员，因而可在不启动 GUI 的前提下维护少量元数据。

若文档正被 FreeCAD 打开，重写 ZIP 常会失败（文件占用），应向用户提示先关闭 FreeCAD。
"""

from __future__ import annotations

import os
import tempfile
import zipfile
from pathlib import Path
from typing import Mapping
from xml.etree import ElementTree as ET


EMBEDDED_BOM_XML = "FcdeskBomAttrs.xml"

EDITABLE_ENTRY_ATTRS: tuple[str, ...] = (
    "part_no",
    "version",
    "type_code",
    "model_series",
    "label",
)


class FcdeskFcstdEmbeddedError(RuntimeError):
    """读取或写回嵌入式属性失败（损坏的 ZIP / I/O 等）。"""


def read_embedded_bom_attrs(fcstd_path: Path) -> dict[str, str]:
    """读出 ZIP 内的可编辑字段；无 ``FcdeskBomAttrs.xml`` 返回空字典。"""
    path = fcstd_path.expanduser().resolve(strict=False)
    if not path.is_file():
        return {}
    try:
        with zipfile.ZipFile(path, "r") as zf:
            if EMBEDDED_BOM_XML not in zf.namelist():
                return {}
            raw = zf.read(EMBEDDED_BOM_XML).decode("utf-8")
    except (zipfile.BadZipFile, OSError, UnicodeDecodeError) as e:
        raise FcdeskFcstdEmbeddedError(str(e)) from e

    root = ET.fromstring(raw)
    allowed = frozenset(EDITABLE_ENTRY_ATTRS)
    out: dict[str, str] = {}
    for child in root:
        tag = child.tag.split("}")[-1]
        if tag not in allowed:
            continue
        blob = "".join(child.itertext()).strip()
        out[tag] = blob
    return out


def _attrs_to_xml(data: Mapping[str, str]) -> bytes:
    root = ET.Element("FcdeskBomAttrs")
    root.set("version", "1")
    for k in EDITABLE_ENTRY_ATTRS:
        s = (data.get(k) or "").strip()
        if not s:
            continue
        el = ET.SubElement(root, k)
        el.text = s
    return ET.tostring(root, encoding="utf-8", xml_declaration=True)


def write_embedded_bom_attrs(fcstd_path: Path, values: Mapping[str, str]) -> None:
    """写回嵌入式 XML；若无任何非空可编辑字段则删除 ZIP 内该成员。"""
    path = fcstd_path.expanduser().resolve(strict=False)
    if not path.is_file():
        raise FcdeskFcstdEmbeddedError(f"不存在或不可访问: {path}")

    trimmed = {k: str(values.get(k, "")).strip() for k in EDITABLE_ENTRY_ATTRS}
    nonempty = {k: trimmed[k] for k in EDITABLE_ENTRY_ATTRS if trimmed[k]}

    payload: bytes | None
    payload = _attrs_to_xml(nonempty) if nonempty else None
    _rewrite_zip_member(path, EMBEDDED_BOM_XML, payload)


def _rewrite_zip_member(fcstd_path: Path, member: str, new_bytes: bytes | None) -> None:
    fcstd_path = fcstd_path.expanduser().resolve(strict=False)
    directory = fcstd_path.parent

    try:
        with zipfile.ZipFile(fcstd_path, "r") as zin:
            infos = zin.infolist()
            cached: list[tuple[zipfile.ZipInfo, bytes]] = []
            for info in infos:
                cached.append((info, zin.read(info.filename)))
    except zipfile.BadZipFile as e:
        raise FcdeskFcstdEmbeddedError(f"无效的 FCStd/ZIP：{fcstd_path}") from e

    present = any(i.filename == member for i, _b in cached)
    if new_bytes is None and not present:
        return

    fd, tmp_name = tempfile.mkstemp(prefix=".fcdesk_", suffix=".partial", dir=str(directory))
    os.close(fd)
    tmp_path = Path(tmp_name)

    try:
        with zipfile.ZipFile(tmp_path, "w") as zout:
            skipped_member = False
            for info, blob in cached:
                if info.filename == member:
                    skipped_member = True
                    if new_bytes is None:
                        continue
                    zout.writestr(info, new_bytes)
                    continue
                zout.writestr(info, blob)
            if new_bytes is not None and not skipped_member:
                zout.writestr(member, new_bytes)
        os.replace(tmp_path, fcstd_path)
    except BaseException:
        tmp_path.unlink(missing_ok=True)
        raise

