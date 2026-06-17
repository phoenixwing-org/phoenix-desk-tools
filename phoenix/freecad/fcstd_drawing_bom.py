"""纯图纸 FCStd：经 App::Link 解析模型 BOM（只读）。"""

from __future__ import annotations

import re
import zipfile
from dataclasses import dataclass
from pathlib import Path
from xml.etree import ElementTree as ET

from phoenix.freecad.bom_xref.extract import list_fcstd_xlink_attrs_from_file, read_document_xml_from_fcstd
from phoenix.freecad.bom_xref.resolve import resolve_xlink_target
from phoenix.freecad.fcstd_document_bom_props import (
    DOCUMENT_XML,
    EDITABLE_DOCUMENT_ATTRS,
    PhoenixDocumentBomError,
    _first_bom_target_object_name,
    bom_mount_object_type,
    is_drawing_primary_mount_context,
    read_body_bom_from_document,
)
from phoenix.freecad.fcstd_document_kind import classify_document_xml
from phoenix.freecad.fcstd_mapping import normalize_repo_rel_path_for_map
from phoenix.services.fcstd_map_service import scan_cad_basename_map

_BOM_FIELD_KEYS: tuple[str, ...] = ("PartNumber", "PartVersion", "TypeCode", "ModelSeries", "PartName")
_DRAWING_SUFFIX_RE = re.compile(r"\.drawing\.fcstd$", re.IGNORECASE)


def _link_has_bom_mirror(link_vals: dict[str, str], explicit: frozenset[str]) -> bool:
    return any(k in explicit and (link_vals.get(k) or "").strip() for k in _BOM_FIELD_KEYS)


@dataclass(frozen=True)
class DrawingBomResolution:
    values: dict[str, str]
    readonly: bool
    source_repo_rel: str | None
    mount_object_name: str | None
    mount_object_type: str | None
    note: str


def is_drawing_primary_document(xml_text: str) -> bool:
    """无 Body/Part/Assembly 挂载、但含 TechDraw → 图纸-primary。"""
    return is_drawing_primary_mount_context(ET.fromstring(xml_text))


def bom_mount_object_info(doc_el: ET.Element) -> tuple[str | None, str | None]:
    name = _first_bom_target_object_name(doc_el)
    return name, bom_mount_object_type(doc_el, name)


def _load_document_xml(path: Path) -> str:
    try:
        with zipfile.ZipFile(path, "r") as zf:
            if DOCUMENT_XML not in zf.namelist():
                raise PhoenixDocumentBomError(f"ZIP 内缺少 {DOCUMENT_XML!r}：{path}")
            return zf.read(DOCUMENT_XML).decode("utf-8")
    except zipfile.BadZipFile as e:
        raise PhoenixDocumentBomError(f"无效的 FCStd/ZIP：{path}") from e
    except OSError as e:
        raise PhoenixDocumentBomError(str(e)) from e


def _guess_model_path_by_filename(drawing_path: Path) -> Path | None:
    name = drawing_path.name
    if not _DRAWING_SUFFIX_RE.search(name):
        return None
    base = _DRAWING_SUFFIX_RE.sub(".FCStd", name)
    if base == name:
        return None
    candidate = drawing_path.with_name(base)
    if candidate.is_file():
        return candidate
    assy = drawing_path.with_name(base.replace(".FCStd", ".ASSY.FCStd"))
    if assy.is_file():
        return assy
    return None


def _resolve_model_repo_rel(
    repo_root: Path,
    drawing_repo_rel: str,
    drawing_path: Path,
    xlink_attr: str,
    basename_map: dict[str, list[str]],
) -> str | None:
    resolved = resolve_xlink_target(
        repo_root=repo_root,
        host_repo_rel=drawing_repo_rel,
        xlink_file_attr=xlink_attr,
        basename_map=basename_map,
    )
    if resolved.target_repo_rel_path and resolved.resolve_status == "resolved":
        return resolved.target_repo_rel_path
    target = (repo_root / resolved.target_repo_rel_path).resolve(strict=False) if resolved.target_repo_rel_path else None
    if target and target.is_file():
        return normalize_repo_rel_path_for_map(
            str(target.relative_to(repo_root.expanduser().resolve(strict=False)))
        )
    direct = (drawing_path.parent / Path(xlink_attr.replace("\\", "/")).name).resolve(strict=False)
    if direct.is_file() and is_fcstd_model_filename(direct.name):
        try:
            return normalize_repo_rel_path_for_map(str(direct.relative_to(repo_root.expanduser().resolve(strict=False))))
        except ValueError:
            pass
    return None


def is_fcstd_model_filename(name: str) -> bool:
    low = name.casefold()
    if _DRAWING_SUFFIX_RE.search(low):
        return False
    return low.endswith(".fcstd") or low.endswith(".assy.fcstd")


def _linked_object_fcstd_attr(doc_el: ET.Element, link_object_name: str) -> str | None:
    """读取 ``App::Link`` 上 ``LinkedObject`` PropertyXLink 的外部 FCStd ``file`` 属性。"""
    od_root = doc_el.find("ObjectData")
    if od_root is None:
        return None
    for od in od_root.findall("Object"):
        if od.get("name") != link_object_name:
            continue
        props = od.find("Properties")
        if props is None:
            continue
        for p in props.findall("Property"):
            if p.get("name") != "LinkedObject":
                continue
            if (p.get("type") or "") != "App::PropertyXLink":
                continue
            xlink = p.find("XLink")
            if xlink is None:
                continue
            file_attr = (xlink.get("file") or "").strip()
            if not file_attr:
                continue
            name = Path(file_attr.replace("\\", "/")).name
            if is_fcstd_model_filename(name):
                return file_attr
    return None


def _iter_model_xlink_candidates(
    doc_el: ET.Element,
    drawing_path: Path,
    *,
    mount_name: str | None,
    mount_type: str | None,
) -> list[str]:
    """模型 FCStd 候选路径：优先 Link.LinkedObject，再 Document 内其它外部 XLink。"""
    seen: set[str] = set()
    out: list[str] = []

    def add(attr: str | None) -> None:
        if not attr:
            return
        a = attr.strip()
        if not a or a in seen:
            return
        if _DRAWING_SUFFIX_RE.search(Path(a.replace("\\", "/")).name):
            return
        seen.add(a)
        out.append(a)

    if mount_name and mount_type == "App::Link":
        add(_linked_object_fcstd_attr(doc_el, mount_name))

    for attr in list_fcstd_xlink_attrs_from_file(drawing_path):
        add(attr)

    return out


def _read_bom_from_model_path(model_path: Path) -> dict[str, str]:
    vals, _explicit = read_body_bom_from_document(model_path)
    return vals


def resolve_drawing_bom(
    repo_root: Path,
    drawing_repo_rel: str,
    drawing_path: Path,
) -> DrawingBomResolution | None:
    """图纸-primary 时从 Link/XLink/文件名解析模型 BOM；否则返回 None。"""
    rr = repo_root.expanduser().resolve(strict=False)
    drawing_path = drawing_path.expanduser().resolve(strict=False)
    rel = normalize_repo_rel_path_for_map(drawing_repo_rel)

    xml_text = _load_document_xml(drawing_path)
    if not is_drawing_primary_document(xml_text):
        return None

    doc_el = ET.fromstring(xml_text)
    mount_name, mount_type = bom_mount_object_info(doc_el)
    kinds = classify_document_xml(xml_text)

    # 1) Link 对象上已有 BOM 镜像（仅 PartNumber 等，不含单独 Label）
    try:
        link_vals, explicit = read_body_bom_from_document(drawing_path)
        if _link_has_bom_mirror(link_vals, explicit):
            return DrawingBomResolution(
                values=link_vals,
                readonly=True,
                source_repo_rel=None,
                mount_object_name=mount_name,
                mount_object_type=mount_type,
                note="图纸 · App::Link 只读 Property",
            )
    except PhoenixDocumentBomError:
        pass

    # 2) 从 Link.LinkedObject / XLink 指向的模型读取
    scan_root = drawing_path.parent
    basename_map = scan_cad_basename_map(scan_root, anchor=rr)
    model_rel: str | None = None
    for attr in _iter_model_xlink_candidates(
        doc_el, drawing_path, mount_name=mount_name, mount_type=mount_type
    ):
        model_rel = _resolve_model_repo_rel(rr, rel, drawing_path, attr, basename_map)
        if model_rel:
            break

    # 3) 文件名兜底
    if not model_rel:
        guessed = _guess_model_path_by_filename(drawing_path)
        if guessed and guessed.is_file():
            try:
                model_rel = normalize_repo_rel_path_for_map(str(guessed.relative_to(rr)))
            except ValueError:
                model_rel = None

    if not model_rel:
        return DrawingBomResolution(
            values={k: "" for k in EDITABLE_DOCUMENT_ATTRS},
            readonly=True,
            source_repo_rel=None,
            mount_object_name=mount_name,
            mount_object_type=mount_type,
            note=f"图纸 · 未解析到 Link 模型（{kinds.display_text()}）",
        )

    model_path = rr / model_rel
    if not model_path.is_file():
        return DrawingBomResolution(
            values={k: "" for k in EDITABLE_DOCUMENT_ATTRS},
            readonly=True,
            source_repo_rel=model_rel,
            mount_object_name=mount_name,
            mount_object_type=mount_type,
            note=f"图纸 · Link 模型缺失：{model_rel}",
        )

    try:
        model_vals = _read_bom_from_model_path(model_path)
    except PhoenixDocumentBomError as ex:
        return DrawingBomResolution(
            values={k: "" for k in EDITABLE_DOCUMENT_ATTRS},
            readonly=True,
            source_repo_rel=model_rel,
            mount_object_name=mount_name,
            mount_object_type=mount_type,
            note=f"图纸 · 模型无 BOM 挂载：{ex}",
        )

    return DrawingBomResolution(
        values=model_vals,
        readonly=True,
        source_repo_rel=model_rel,
        mount_object_name=mount_name,
        mount_object_type=mount_type,
        note=f"图纸 · 只读 · 来自 Link 模型 {model_rel}",
    )
