"""属性回写：载入 / 保存 / 推荐文件名 / 改名（无 UI）。"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

from fcdesk.bom_apply_prefs import (
    load_bom_apply_field_defaults,
    recommend_field_fill_values,
    save_bom_apply_field_defaults,
)
from fcdesk.config.user_prefs import format_resolved_under_workspace
from fcdesk.freecad.fcstd_document_kind import (
    FcstdDocumentKinds,
    FcstdKindFilters,
    kinds_match_filters,
    read_fcstd_document_kinds,
    recommend_fcstd_filename_suffix,
)
from fcdesk.freecad.fcstd_embedded_attrs import (
    EDITABLE_ENTRY_ATTRS,
    FcdeskFcstdEmbeddedError,
    read_embedded_bom_attrs,
    write_embedded_bom_attrs,
)
from fcdesk.freecad.fcstd_mapping import (
    FcstdMapEntry,
    compose_fcstd_body_label_display,
    compose_fcstd_recommended_filename,
    format_recommended_filename_hint,
    infer_fcstd_name_suffix,
    rename_workspace_fcstd_file,
    try_load_fcstd_entry_from_workspace_map,
    try_update_fcstd_map_entry_rename,
)

_EDITABLE_FORM_KEYS = frozenset({*EDITABLE_ENTRY_ATTRS, "filename"})


@dataclass
class KindFiltersInput:
    part: bool = True
    assembly: bool = True
    drawing: bool = True
    drawing_and_assembly: bool = True

    @classmethod
    def from_mapping(cls, raw: dict[str, Any] | None) -> KindFiltersInput:
        if not raw:
            return cls()
        return cls(
            part=bool(raw.get("part", True)),
            assembly=bool(raw.get("assembly", True)),
            drawing=bool(raw.get("drawing", True)),
            drawing_and_assembly=bool(raw.get("drawing_and_assembly", True)),
        )

    def to_filters(self) -> FcstdKindFilters:
        return FcstdKindFilters(
            part=self.part,
            assembly=self.assembly,
            drawing=self.drawing,
            drawing_and_assembly=self.drawing_and_assembly,
        )


def _entry_to_plain(e: FcstdMapEntry) -> dict[str, str]:
    return {
        "repo_rel_path": str(e.repo_rel_path or ""),
        "filename": str(e.filename or ""),
        "PartNumber": str(e.PartNumber or ""),
        "PartVersion": str(e.PartVersion or ""),
        "TypeCode": str(e.TypeCode or ""),
        "ModelSeries": str(e.ModelSeries or ""),
        "PartName": str(e.PartName or ""),
        "label": str(e.label or ""),
    }


def _coerce_form_values(values: dict[str, str]) -> dict[str, str]:
    return {k: str(values.get(k, "")).strip() for k in _EDITABLE_FORM_KEYS}


def _merge_embedded_over(base: dict[str, str], embedded: dict[str, str]) -> dict[str, str]:
    out = dict(base)
    for k in EDITABLE_ENTRY_ATTRS:
        if k in embedded:
            out[k] = embedded[k]
    return out


def _merged_with_partname_coerce(row: dict[str, str]) -> dict[str, str]:
    merged = dict(row)
    lb = merged.get("label", "").strip()
    if not merged.get("PartName", "").strip():
        merged["PartName"] = lb
    return merged


def _kinds_to_dict(k: FcstdDocumentKinds | None) -> dict[str, object] | None:
    if k is None:
        return None
    return {
        "part": k.part,
        "assembly": k.assembly,
        "drawing": k.drawing,
        "display": k.display_text(),
        "recommended_suffix": recommend_fcstd_filename_suffix(k),
    }


def _ensure_fcstd_file(repo_root: Path, rel: Path) -> Path:
    rr = repo_root.expanduser().resolve(strict=False)
    full = rr / rel
    if not full.is_file() or full.suffix.casefold() != ".fcstd":
        raise ValueError("仅支持 .FCStd 文件")
    return full


def _ensure_kinds_allow(
    kinds: FcstdDocumentKinds | None,
    filters: FcstdKindFilters,
    op_name: str,
) -> None:
    if kinds is None:
        return
    if kinds_match_filters(kinds, filters):
        return
    raise ValueError(
        f"当前文件识别为「{kinds.display_text()}」，与已勾选的文档类型不一致。"
        f"请调整类型勾选后重试「{op_name}」。"
    )


def _recommended_suffix(
    *,
    full: Path,
    rel: Path,
    kinds: FcstdDocumentKinds | None,
    filters: FcstdKindFilters,
    filename: str,
) -> str:
    if kinds is not None and kinds_match_filters(kinds, filters):
        return recommend_fcstd_filename_suffix(kinds)
    name = filename.strip() or rel.name
    return infer_fcstd_name_suffix(name or "x.FCStd")


@dataclass
class BomPreview:
    rel_path: str
    fields: dict[str, str]
    source_note: str
    abs_path_display: str
    is_fcstd: bool
    document_kinds: dict[str, object] | None
    embedded_warning: str | None


def get_bom_apply_prefs(repo_root: Path) -> dict[str, object]:
    rr = repo_root.expanduser().resolve(strict=False)
    stored = load_bom_apply_field_defaults(rr)
    return {
        "stored": stored,
        "recommended_fill": recommend_field_fill_values(stored),
    }


def load_bom_preview(repo_root: Path, rel: Path) -> BomPreview:
    rr = repo_root.expanduser().resolve(strict=False)
    rel = Path(rel)
    full = rr / rel

    mapped = try_load_fcstd_entry_from_workspace_map(repo_root=rr, rel_workspace=rel)
    if mapped is not None:
        entry = mapped
        note = "CAD 索引库 · Document.xml 可覆盖可编辑字段"
    else:
        entry = FcstdMapEntry.preview_from_workspace_relative(rel)
        note = "文件名/路径推断 · Document.xml 可覆盖可编辑字段"

    plain = _entry_to_plain(entry)
    embedded: dict[str, str] = {}
    warning: str | None = None
    kinds: FcstdDocumentKinds | None = None
    is_fcstd = full.is_file() and full.suffix.casefold() == ".fcstd"

    if is_fcstd:
        kinds = read_fcstd_document_kinds(full)
        try:
            embedded = read_embedded_bom_attrs(full)
            if embedded:
                note += " · 已读 Document.xml / 遗留侧车"
        except FcdeskFcstdEmbeddedError as ex:
            warning = str(ex)

    merged = _merged_with_partname_coerce(_merge_embedded_over(plain, embedded))

    return BomPreview(
        rel_path=rel.as_posix(),
        fields=merged,
        source_note=note,
        abs_path_display=format_resolved_under_workspace(full, rr),
        is_fcstd=is_fcstd,
        document_kinds=_kinds_to_dict(kinds),
        embedded_warning=warning,
    )


def read_document_kinds(repo_root: Path, rel: Path) -> dict[str, object] | None:
    rr = repo_root.expanduser().resolve(strict=False)
    full = _ensure_fcstd_file(rr, rel)
    return _kinds_to_dict(read_fcstd_document_kinds(full))


def fill_empty_fields_from_prefs(
    repo_root: Path,
    values: dict[str, str],
) -> dict[str, object]:
    merged = _coerce_form_values(values)
    fills = recommend_field_fill_values(load_bom_apply_field_defaults(repo_root))
    filled: list[str] = []
    for key in ("PartNumber", "PartVersion", "TypeCode", "ModelSeries"):
        if merged.get(key):
            continue
        val = fills.get(key, "")
        if not val:
            continue
        merged[key] = val
        filled.append(key)
    return {"fields": merged, "filled_keys": filled}


def fill_bom_from_embedded(
    repo_root: Path,
    rel: Path,
    *,
    kind_filters: KindFiltersInput | None = None,
) -> dict[str, object]:
    rr = repo_root.expanduser().resolve(strict=False)
    rel = Path(rel)
    full = _ensure_fcstd_file(rr, rel)
    filters = (kind_filters or KindFiltersInput()).to_filters()
    kinds = read_fcstd_document_kinds(full)
    _ensure_kinds_allow(kinds, filters, "从 ZIP 嵌入读取")

    try:
        embedded = read_embedded_bom_attrs(full)
    except FcdeskFcstdEmbeddedError as ex:
        raise ValueError(str(ex)) from ex

    if not any((embedded.get(k) or "").strip() for k in EDITABLE_ENTRY_ATTRS):
        raise ValueError("当前包内 Document.xml / FcdeskBomAttrs.xml 无可读 BOM 字段")

    mapped = try_load_fcstd_entry_from_workspace_map(repo_root=rr, rel_workspace=rel)
    if mapped is not None:
        plain = _entry_to_plain(mapped)
    else:
        plain = _entry_to_plain(FcstdMapEntry.preview_from_workspace_relative(rel))
    merged = _merged_with_partname_coerce(_merge_embedded_over(plain, embedded))
    return {"fields": merged, "document_kinds": _kinds_to_dict(kinds)}


def fill_bom_from_filename_hints(repo_root: Path, rel: Path) -> dict[str, str]:
    rr = repo_root.expanduser().resolve(strict=False)
    rel = Path(rel)
    _ensure_fcstd_file(rr, rel)
    plain = _entry_to_plain(FcstdMapEntry.preview_from_workspace_relative(rel))
    if not any((plain.get(k) or "").strip() for k in EDITABLE_ENTRY_ATTRS):
        raise ValueError("未能从当前文件名或仓库路径识别出 BOM 字段")
    return _merged_with_partname_coerce(plain)


def apply_label_formula(
    repo_root: Path,
    values: dict[str, str],
    *,
    fill_empty_from_prefs: bool = True,
) -> dict[str, object]:
    merged = _coerce_form_values(values)
    filled: list[str] = []
    if fill_empty_from_prefs:
        payload = fill_empty_fields_from_prefs(repo_root, merged)
        merged = dict(payload["fields"])
        filled = list(payload["filled_keys"])

    built = compose_fcstd_body_label_display(
        part_number=merged.get("PartNumber", ""),
        part_version=merged.get("PartVersion", ""),
        part_name=merged.get("PartName", ""),
        label_fallback=merged.get("label", ""),
    )
    if not built:
        raise ValueError(
            "需要非空的零件号与版本才能拼接 Label。"
            "格式：PartNumber.PartVersion-PartName（PartName 为空则用 label）"
        )
    merged["label"] = built
    return {"fields": merged, "label": built, "filled_keys": filled}


def save_bom_to_fcstd(repo_root: Path, rel: Path, values: dict[str, str]) -> None:
    rr = repo_root.expanduser().resolve(strict=False)
    full = _ensure_fcstd_file(rr, rel)

    vals = {k: str(values.get(k, "")).strip() for k in EDITABLE_ENTRY_ATTRS}
    if not vals.get("PartName") and vals.get("label"):
        vals["PartName"] = vals["label"]

    write_embedded_bom_attrs(full, vals)
    save_bom_apply_field_defaults(
        rr,
        part_number=vals.get("PartNumber", ""),
        part_version=vals.get("PartVersion", ""),
        type_code=vals.get("TypeCode", ""),
        model_series=vals.get("ModelSeries", ""),
    )


def has_unsaved_document_attrs(baseline: dict[str, str], current: dict[str, str]) -> bool:
    for k in EDITABLE_ENTRY_ATTRS:
        if str(current.get(k, "")).strip() != str(baseline.get(k, "")).strip():
            return True
    return False


def recommend_filename_for_values(
    repo_root: Path,
    rel: Path,
    values: dict[str, str],
    *,
    fill_empty_from_prefs: bool = True,
    kind_filters: KindFiltersInput | None = None,
    original_filename: str | None = None,
    persist_prefs: bool = True,
) -> dict[str, object]:
    """推荐文件名；空字段可先填工作空间记忆，并返回详细说明。"""
    rr = repo_root.expanduser().resolve(strict=False)
    rel = Path(rel)
    full = rr / rel
    filters = (kind_filters or KindFiltersInput()).to_filters()
    merged = _coerce_form_values(values)
    filled: list[str] = []

    if fill_empty_from_prefs:
        payload = fill_empty_fields_from_prefs(rr, merged)
        merged = dict(payload["fields"])
        filled = list(payload["filled_keys"])

    kinds: FcstdDocumentKinds | None = None
    if full.is_file() and full.suffix.casefold() == ".fcstd":
        kinds = read_fcstd_document_kinds(full)
        _ensure_kinds_allow(kinds, filters, "推荐文件名")

    orig = (original_filename or merged.get("filename") or rel.name).strip()
    suffix = _recommended_suffix(
        full=full,
        rel=rel,
        kinds=kinds,
        filters=filters,
        filename=merged.get("filename", ""),
    )

    pname = merged.get("PartName", "") or merged.get("label", "")
    built = compose_fcstd_recommended_filename(
        part_number=merged.get("PartNumber", ""),
        part_version=merged.get("PartVersion", ""),
        type_code=merged.get("TypeCode", ""),
        model_series=merged.get("ModelSeries", ""),
        part_name=pname,
        label_fallback=merged.get("label", ""),
        suffix=suffix,
    )
    if not built:
        raise ValueError(
            "需要非空的 PartNumber 与 PartVersion。"
            f"格式：PartNumber.PartVersion[-TypeCode][-ModelSeries]-名称{suffix}"
        )

    if persist_prefs:
        save_bom_apply_field_defaults(
            rr,
            part_number=merged.get("PartNumber", ""),
            part_version=merged.get("PartVersion", ""),
            type_code=merged.get("TypeCode", ""),
            model_series=merged.get("ModelSeries", ""),
        )

    hint = format_recommended_filename_hint(
        original_filename=orig,
        recommended_filename=built,
        part_number=merged.get("PartNumber", ""),
        part_version=merged.get("PartVersion", ""),
        type_code=merged.get("TypeCode", ""),
        model_series=merged.get("ModelSeries", ""),
        part_name=merged.get("PartName", ""),
        label=merged.get("label", ""),
        suffix=suffix,
    )
    if kinds is not None:
        hint += (
            f"\n文档类型：{kinds.display_text()} · "
            f"推荐后缀 {recommend_fcstd_filename_suffix(kinds)}"
        )

    return {
        "recommended_filename": built,
        "suffix": suffix,
        "fields": merged,
        "filled_keys": filled,
        "hint_text": hint,
        "matches_disk_name": built == orig,
        "document_kinds": _kinds_to_dict(kinds),
    }


def rename_bom_fcstd_file(
    repo_root: Path,
    rel: Path,
    new_filename: str,
    *,
    baseline: dict[str, str],
    current: dict[str, str],
) -> dict[str, object]:
    rr = repo_root.expanduser().resolve(strict=False)
    rel = Path(rel)
    _ensure_fcstd_file(rr, rel)

    if has_unsaved_document_attrs(baseline, current):
        raise ValueError("当前有尚未写入 ZIP 的属性，请先保存到 ZIP 再改名")

    new_name = (new_filename or "").strip()
    if not new_name:
        raise ValueError("请先填写目标文件名")
    old_name = rel.name
    if new_name == old_name:
        raise ValueError("文件名与磁盘上当前名称相同，无需重命名")

    old_rel = rel
    try:
        new_rel = rename_workspace_fcstd_file(
            repo_root=rr,
            rel=old_rel,
            new_basename=new_name,
        )
    except FileNotFoundError as ex:
        raise ValueError(str(ex)) from ex
    except FileExistsError as ex:
        raise ValueError(str(ex)) from ex
    except PermissionError as ex:
        raise ValueError(f"没有权限重命名（可能被占用）：{ex}") from ex

    map_updated = try_update_fcstd_map_entry_rename(
        repo_root=rr,
        old_rel=old_rel,
        new_rel=new_rel,
    )
    return {
        "rel_path": new_rel.as_posix(),
        "filename": new_name,
        "map_updated": map_updated,
    }
