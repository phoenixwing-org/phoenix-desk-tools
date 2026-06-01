"""将 BOM 可编辑字段写入 ``Document.xml`` 内可挂载对象的 ``Properties``。

挂载对象优先级：**``PartDesign::Body``** → **类型名包含 ``Assembly`` 的对象**（装配/总成工作台）→ **``App::Part``**
（常见于 Part / 总成容器）；若均无且文档含 **TechDraw**（图纸-primary），则取首个 **``App::Link``**。
均按 ``Document.xml`` 中 ``<Objects><Object/>`` **出现顺序**取第一个匹配的 ``name``。

遵循 FreeCAD App 序列化惯例：每条动态 ``App::PropertyString`` 在 Document 中为

  ``<Property name="..." type="App::PropertyString" group="..." doc="" attr="0" …>``
  ``  <String value="…"/>``

子节点语义与 ``PropertyString::Save/Restore`` 一致（见 FreeCAD ``src/App/PropertyStandard.cpp``）。

新建 ``PartNumber`` / ``PartVersion`` / ``TypeCode`` / ``ModelSeries`` / ``PartName`` 时，与 FreeCAD **「添加属性」**对话框一致：
``type="App::PropertyString"``、``group`` 固定为常量 **``FCDESK_EMBEDDED_BOM_PROPERTY_GROUP``**
（默认 **``CustomDefine``**，等价于对话框里的「组」），``doc`` 为工具提示（等价于「工具提示」）。
其它 bitmask（``status``、``attr`` 等）仍优先从同一 Body 上已有的用户字符串属性拷贝（例如 ``TempKevin``），
以贴近当前 FreeCAD 写盘；若无参照则用内置兜底字段集。
不创建 ``FcdeskBomAttrs.xml``；保存时仍会移除旧侧车并完成迁移。
"""

from __future__ import annotations

import os
import tempfile
import zipfile
from pathlib import Path
from typing import Mapping
from xml.etree import ElementTree as ET

DOCUMENT_XML = "Document.xml"
SIDECAR_LEGACY = "FcdeskBomAttrs.xml"

# BOM 四项在 FC「添加属性」里对应「组」名的默认文字（Document.xml 上 ``Property/@group``）。
FCDESK_EMBEDDED_BOM_PROPERTY_GROUP = "CustomDefine"
# 旧版曾用常量名保留为别名。
FCDESK_BOM_PROPERTY_GROUP = FCDESK_EMBEDDED_BOM_PROPERTY_GROUP
PHOENIX_BOM_PROPERTY_GROUP = FCDESK_EMBEDDED_BOM_PROPERTY_GROUP  # deprecated: 原为 "Phoenix"

# 与「添加属性」里「工具提示」对应（写入 ``Property/@doc``）。
_BOM_STRING_PROPERTY_DOC: dict[str, str] = {
    "PartNumber": "零件号",
    "PartVersion": "零件版本",
    "TypeCode": "类型码 (H/S/R)",
    "ModelSeries": "型号系列",
    "PartName": "零件名称",
}

# Body 自带的字符串属性勿作「克隆外壳」模版（与其它动态字符串语义不同）。
_SKIP_STRING_PROP_TEMPLATE_NAMES: frozenset[str] = frozenset({"Label", "Label2"})

_FREECAD_DYNAMIC_STRING_PROPERTY_FALLBACK: dict[str, str] = {
    "type": "App::PropertyString",
    "group": FCDESK_EMBEDDED_BOM_PROPERTY_GROUP,
    "doc": "",
    "attr": "0",
    "ro": "0",
    "hide": "0",
    "status": "2097153",
}

_BOM_STRING_PROPERTY_NAMES: tuple[str, ...] = ("PartNumber", "PartVersion", "TypeCode", "ModelSeries", "PartName")

EDITABLE_DOCUMENT_ATTRS: tuple[str, ...] = (
    "PartNumber",
    "PartVersion",
    "TypeCode",
    "ModelSeries",
    "PartName",
    "label",
)


class FcdeskDocumentBomError(RuntimeError):
    """读取或写回 Document.xml 挂载对象属性失败。"""


def _iter_objects_typename_ordered(doc_el: ET.Element) -> list[tuple[str, str]]:
    """``(ctype, name)`` 列表，顺序与 FC ``Objects`` 中声明一致。"""
    out: list[tuple[str, str]] = []
    for obj in doc_el.findall("Objects/Object"):
        ctype = obj.get("type") or ""
        n = obj.get("name") or ""
        if n.strip():
            out.append((ctype, n))
    return out


def _has_standard_bom_mount(objs: list[tuple[str, str]]) -> bool:
    for ctype, _ in objs:
        if ctype == "PartDesign::Body":
            return True
        if "assembly" in ctype.lower():
            return True
        if ctype == "App::Part":
            return True
    return False


def _document_has_techdraw(objs: list[tuple[str, str]]) -> bool:
    return any(ctype.startswith("TechDraw::") for ctype, _ in objs)


def is_drawing_primary_mount_context(doc_el: ET.Element) -> bool:
    """无 Body/Part/Assembly 挂载、但含 TechDraw → 图纸-primary。"""
    objs = _iter_objects_typename_ordered(doc_el)
    if _has_standard_bom_mount(objs):
        return False
    return _document_has_techdraw(objs)


def _first_bom_target_object_name(doc_el: ET.Element) -> str | None:
    """选择写入 BOM / Label 挂载到的 DocumentObject 名称。"""
    objs = _iter_objects_typename_ordered(doc_el)

    for ctype, n in objs:
        if ctype == "PartDesign::Body":
            return n

    for ctype, n in objs:
        if "assembly" in ctype.lower():
            return n

    for ctype, n in objs:
        if ctype == "App::Part":
            return n

    if is_drawing_primary_mount_context(doc_el):
        for ctype, n in objs:
            if ctype == "App::Link":
                return n

    return None


def bom_mount_object_type(doc_el: ET.Element, mount_name: str | None) -> str | None:
    if not mount_name:
        return None
    for ctype, n in _iter_objects_typename_ordered(doc_el):
        if n == mount_name:
            return ctype
    return None


def is_link_bom_mount(mount_type: str | None) -> bool:
    return mount_type == "App::Link"


def _no_bom_mount_error(path: Path, objs: list[tuple[str, str]]) -> FcdeskDocumentBomError:
    sample = ", ".join(f"{t}" for t, _ in objs[:12])
    extra = f" 已列出部分 Object.type：{sample}" if sample else ""
    return FcdeskDocumentBomError(
        "未发现可挂载 BOM 的对象（依次尝试 PartDesign::Body → type 中含 assembly → App::Part"
        " → 图纸-primary 时 App::Link）："
        f"{path}.{extra}"
    )


def _body_properties_el(doc_el: ET.Element, body_name: str) -> ET.Element | None:
    od_root = doc_el.find("ObjectData")
    if od_root is None:
        return None
    for od in od_root.findall("Object"):
        if od.get("name") == body_name:
            return od.find("Properties")
    return None


def _get_property_string(properties_el: ET.Element | None, fc_name: str) -> tuple[str, bool]:
    """返回 ``(取值, XML 节点是否存在)``；``String`` 以 ``value`` 属性为准。"""
    if properties_el is None:
        return "", False
    for p in properties_el.findall("Property"):
        if p.get("name") != fc_name:
            continue
        s_el = p.find("String")
        if s_el is None:
            return "", True
        v = (s_el.get("value") or "").strip()
        if v != "":
            return v, True
        text = "".join(s_el.itertext()).strip()
        return (text if text else "", True)
    return "", False


def _recount_regular_properties(properties_el: ET.Element) -> None:
    n = sum(1 for c in properties_el if c.tag == "Property")
    properties_el.set("Count", str(n))


def _candidate_user_property_string(p_el: ET.Element) -> bool:
    if p_el.get("type") != "App::PropertyString":
        return False
    nm = (p_el.get("name") or "").strip()
    return bool(nm) and nm not in _SKIP_STRING_PROP_TEMPLATE_NAMES


def _reference_dynamic_property_string(properties_el: ET.Element) -> ET.Element | None:
    """取同一 ``Properties`` 下已存在的 FC 序列化样本，以保证新结点的外壳与 FreeCAD 写盘一致。"""
    for pname in _BOM_STRING_PROPERTY_NAMES:
        for p_el in properties_el.findall("Property"):
            if p_el.get("name") == pname and _candidate_user_property_string(p_el):
                return p_el
    for p_el in properties_el.findall("Property"):
        if _candidate_user_property_string(p_el):
            return p_el
    return None


def _new_property_wrapper_attribs(properties_el: ET.Element, fc_name: str) -> dict[str, str]:
    ref = _reference_dynamic_property_string(properties_el)
    if ref is None:
        out = dict(_FREECAD_DYNAMIC_STRING_PROPERTY_FALLBACK)
    else:
        out = dict(ref.attrib)
        out.pop("name", None)
        out["type"] = "App::PropertyString"
    out["group"] = FCDESK_EMBEDDED_BOM_PROPERTY_GROUP
    out["doc"] = _BOM_STRING_PROPERTY_DOC.get(fc_name, "")
    out["name"] = fc_name
    return out


def read_body_bom_from_document(fcstd_path: Path) -> tuple[dict[str, str], frozenset[str]]:
    """从 ``Document.xml`` 读出可编辑字典，以及哪些键已有对应 XML 字段（便于与旧侧车合并）。

    挂载对象见 `_first_bom_target_object_name`（Body → type 中含 assembly → ``App::Part``）。
    """
    path = fcstd_path.expanduser().resolve(strict=False)
    if not path.is_file():
        return {k: "" for k in EDITABLE_DOCUMENT_ATTRS}, frozenset()

    try:
        with zipfile.ZipFile(path, "r") as zf:
            if DOCUMENT_XML not in zf.namelist():
                raise FcdeskDocumentBomError(f"ZIP 内缺少 {DOCUMENT_XML!r}：{path}")
            raw = zf.read(DOCUMENT_XML).decode("utf-8")
    except (zipfile.BadZipFile, OSError, UnicodeDecodeError) as e:
        raise FcdeskDocumentBomError(str(e)) from e

    doc_el = ET.fromstring(raw)
    objs = _iter_objects_typename_ordered(doc_el)
    body_name = _first_bom_target_object_name(doc_el)
    if body_name is None:
        raise _no_bom_mount_error(path, objs)
    props_el = _body_properties_el(doc_el, body_name)
    if props_el is None:
        raise FcdeskDocumentBomError(
            f"ObjectData 中缺少挂载对象 {body_name!r} 的 <Properties>：{path}"
        )

    out: dict[str, str] = {}
    explicit: set[str] = set()
    fc_map_label = {"label": "Label"}
    for k in EDITABLE_DOCUMENT_ATTRS:
        fc_kind = fc_map_label.get(k, k)
        val, exists = _get_property_string(props_el, fc_kind)
        out[k] = val
        if exists:
            explicit.add(k)
    return out, frozenset(explicit)


def _set_or_remove_custom_string_prop(
    properties_el: ET.Element,
    fc_name: str,
    value: str,
    *,
    readonly: bool = False,
) -> None:
    """写入 / 清空自定义 ``App::PropertyString``（非原生 ``Label``）。

    **五项 BOM 自定义字段**（非 ``Label``）：``group``、``doc``（工具提示）与常量 ``FCDESK_EMBEDDED_BOM_PROPERTY_GROUP``及
    内置映射（``_BOM_STRING_PROPERTY_DOC``，与「添加属性」里「工具提示」一致）在新建与每次写入时校正；
    其余 attrib（bitmask）尽量保留 FC 原有值，``String/@value`` 随表单更新。
    """
    existing: ET.Element | None = None
    for p in properties_el.findall("Property"):
        if p.get("name") == fc_name:
            existing = p
            break
    trimmed = value.strip()
    if not trimmed:
        if existing is not None:
            properties_el.remove(existing)
        return
    if existing is None:
        attribs = _new_property_wrapper_attribs(properties_el, fc_name)
        if readonly and fc_name in _BOM_STRING_PROPERTY_NAMES:
            attribs["ro"] = "1"
        existing = ET.SubElement(properties_el, "Property", attribs)
        s_el = ET.SubElement(existing, "String")
        s_el.set("value", trimmed)
        return
    if fc_name in _BOM_STRING_PROPERTY_NAMES:
        existing.set("group", FCDESK_EMBEDDED_BOM_PROPERTY_GROUP)
        doc_tip = _BOM_STRING_PROPERTY_DOC.get(fc_name, "")
        existing.set("doc", doc_tip)
        if readonly:
            existing.set("ro", "1")
    s_el = existing.find("String")
    if s_el is None:
        s_el = ET.SubElement(existing, "String")
    s_el.set("value", trimmed)


def _set_label_string(properties_el: ET.Element, value: str) -> None:
    label_prop: ET.Element | None = None
    for p in properties_el.findall("Property"):
        if p.get("name") == "Label":
            label_prop = p
            break
    if label_prop is None:
        raise FcdeskDocumentBomError("挂载对象缺少原生 Label Property，无法写入标签。")
    s_el = label_prop.find("String")
    if s_el is None:
        s_el = ET.SubElement(label_prop, "String")
    s_el.set("value", value.strip())


def _rewrite_fcstd_zip(
    fcstd_path: Path,
    *,
    document_xml_bytes: bytes,
    drop_sidecar_legacy: bool,
) -> None:
    fcstd_path = fcstd_path.expanduser().resolve(strict=False)
    directory = fcstd_path.parent
    try:
        with zipfile.ZipFile(fcstd_path, "r") as zin:
            cached: list[tuple[zipfile.ZipInfo, bytes]] = []
            for info in zin.infolist():
                cached.append((info, zin.read(info.filename)))
    except zipfile.BadZipFile as e:
        raise FcdeskDocumentBomError(f"无效的 FCStd/ZIP：{fcstd_path}") from e

    fd, tmp_name = tempfile.mkstemp(prefix=".fcdesk_", suffix=".partial", dir=str(directory))
    os.close(fd)
    tmp_path = Path(tmp_name)
    doc_written = False
    try:
        with zipfile.ZipFile(tmp_path, "w") as zout:
            for info, blob in cached:
                fname = info.filename
                if drop_sidecar_legacy and fname == SIDECAR_LEGACY:
                    continue
                if fname == DOCUMENT_XML:
                    zout.writestr(info, document_xml_bytes)
                    doc_written = True
                    continue
                zout.writestr(info, blob)
            if not doc_written:
                raise FcdeskDocumentBomError(f"ZIP 内缺少将被替换的 {DOCUMENT_XML!r}：{fcstd_path}")
        os.replace(tmp_path, fcstd_path)
    except BaseException:
        tmp_path.unlink(missing_ok=True)
        raise


def write_body_bom_to_document(fcstd_path: Path, values: Mapping[str, str]) -> None:
    """把可编辑字段写入 ``Document.xml`` 的 BOM 挂载对象，并移除包内 ``FcdeskBomAttrs.xml``（若有）。

    挂载规则与 `read_body_bom_from_document` 一致。
    """
    path = fcstd_path.expanduser().resolve(strict=False)
    if not path.is_file():
        raise FcdeskDocumentBomError(f"不存在或不可访问: {path}")

    try:
        with zipfile.ZipFile(path, "r") as zf:
            if DOCUMENT_XML not in zf.namelist():
                raise FcdeskDocumentBomError(f"ZIP 内缺少 {DOCUMENT_XML!r}：{path}")
            raw = zf.read(DOCUMENT_XML).decode("utf-8")
    except (zipfile.BadZipFile, OSError, UnicodeDecodeError) as e:
        raise FcdeskDocumentBomError(str(e)) from e

    doc_el = ET.fromstring(raw)
    objs = _iter_objects_typename_ordered(doc_el)
    body_name = _first_bom_target_object_name(doc_el)
    if body_name is None:
        raise _no_bom_mount_error(path, objs)
    props_el = _body_properties_el(doc_el, body_name)
    if props_el is None:
        raise FcdeskDocumentBomError(f"缺少挂载对象 {body_name!r} 的 <Properties>：{path}")

    trimmed = {k: str(values.get(k, "")).strip() for k in EDITABLE_DOCUMENT_ATTRS}

    for name in ("PartNumber", "PartVersion", "TypeCode", "ModelSeries", "PartName"):
        _set_or_remove_custom_string_prop(props_el, name, trimmed[name])
    _set_label_string(props_el, trimmed["label"])

    _recount_regular_properties(props_el)

    new_doc = ET.tostring(doc_el, encoding="utf-8", xml_declaration=True)
    _rewrite_fcstd_zip(path, document_xml_bytes=new_doc, drop_sidecar_legacy=True)
