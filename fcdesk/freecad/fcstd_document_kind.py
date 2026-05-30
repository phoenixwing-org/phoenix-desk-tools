"""从 FCStd 内 ``Document.xml`` 推断文档类别：零件 / 装配 / 图纸（可组合）。"""

from __future__ import annotations

import re
import zipfile
from dataclasses import dataclass
from pathlib import Path
from xml.etree import ElementTree as ET

from fcdesk.freecad.fcstd_document_bom_props import DOCUMENT_XML

_XLINK_TAG_RE = re.compile(r"<XLink\s+file=", re.IGNORECASE)


@dataclass(frozen=True)
class FcstdDocumentKinds:
    """文档内识别到的类型标记（可同时为真，如装配内含 Body 与 TechDraw）。"""

    part: bool = False
    assembly: bool = False
    drawing: bool = False

    @property
    def drawing_and_assembly(self) -> bool:
        return self.drawing and self.assembly

    def label_parts(self) -> list[str]:
        out: list[str] = []
        if self.part:
            out.append("零件")
        if self.assembly:
            out.append("装配")
        if self.drawing:
            out.append("图纸")
        return out

    def display_text(self) -> str:
        parts = self.label_parts()
        if not parts:
            return "未识别"
        if self.drawing_and_assembly:
            return "、".join(parts) + "（图纸+装配）"
        return "、".join(parts)


@dataclass
class FcstdKindFilters:
    """属性回写页勾选：仅当与文档识别类型有交集时才执行读取/推荐等操作。"""

    part: bool = True
    assembly: bool = True
    drawing: bool = True
    drawing_and_assembly: bool = True

    def any_enabled(self) -> bool:
        return self.part or self.assembly or self.drawing or self.drawing_and_assembly


def classify_document_xml(xml_text: str) -> FcstdDocumentKinds:
    """根据 ``Objects/Object/@type`` 与 XLink 出现情况推断类别。"""
    root = ET.fromstring(xml_text)
    types: list[str] = []
    for obj in root.findall("Objects/Object"):
        ctype = (obj.get("type") or "").strip()
        name = (obj.get("name") or "").strip()
        if name:
            types.append(ctype)

    has_body = any(t == "PartDesign::Body" for t in types)
    has_assembly_type = any("assembly" in t.lower() for t in types)
    has_techdraw = any(t.startswith("TechDraw::") for t in types)
    xlink_count = len(_XLINK_TAG_RE.findall(xml_text))

    assembly = has_assembly_type or (xlink_count > 0 and not has_body)
    part = has_body

    if not part and not assembly and not has_techdraw:
        if any(t == "App::Part" for t in types):
            part = True
        elif any(t.startswith("Part::") for t in types):
            part = True

    drawing = has_techdraw
    return FcstdDocumentKinds(part=part, assembly=assembly, drawing=drawing)


def read_fcstd_document_kinds(fcstd_path: Path) -> FcstdDocumentKinds:
    """读取 ZIP 内 ``Document.xml`` 并分类；损坏或缺失时返回全 ``False``。"""
    path = fcstd_path.expanduser().resolve(strict=False)
    if not path.is_file():
        return FcstdDocumentKinds()
    try:
        with zipfile.ZipFile(path, "r") as zf:
            if DOCUMENT_XML not in zf.namelist():
                return FcstdDocumentKinds()
            xml_text = zf.read(DOCUMENT_XML).decode("utf-8")
    except (OSError, zipfile.BadZipFile, UnicodeDecodeError):
        return FcstdDocumentKinds()
    try:
        return classify_document_xml(xml_text)
    except ET.ParseError:
        return FcstdDocumentKinds()


def kinds_match_filters(kinds: FcstdDocumentKinds, filters: FcstdKindFilters) -> bool:
    if not filters.any_enabled():
        return True
    if filters.part and kinds.part:
        return True
    if filters.assembly and kinds.assembly:
        return True
    if filters.drawing and kinds.drawing:
        return True
    if filters.drawing_and_assembly and kinds.drawing_and_assembly:
        return True
    return False


def recommend_fcstd_filename_suffix(kinds: FcstdDocumentKinds) -> str:
    """按文档类别推荐 FCStd 族后缀：装配 → ``.ASSY.FCStd``，图纸 → ``.Drawing.FCStd``，否则 ``.FCStd``。"""
    if kinds.assembly:
        return ".ASSY.FCStd"
    if kinds.drawing:
        return ".Drawing.FCStd"
    return ".FCStd"
