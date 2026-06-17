"""属性回写：载入 / 保存 / 推荐文件名 / 改名（无 UI）。"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

from phoenix.freecad.cad_index_types import is_fcstd_filename
from phoenix.bom_apply_prefs import (
    load_bom_apply_field_defaults,
    recommend_field_fill_values,
    save_bom_apply_field_defaults,
)
from phoenix.config.user_prefs import format_resolved_under_workspace
from phoenix.freecad.fcstd_document_kind import (
    FcstdDocumentKinds,
    FcstdKindFilters,
    infer_fcstd_document_kinds_from_filename,
    kinds_match_filters,
    read_fcstd_document_kinds,
    recommend_fcstd_filename_suffix,
)
from phoenix.freecad.fcstd_drawing_bom import resolve_drawing_bom
from phoenix.freecad.fcstd_embedded_attrs import (
    EDITABLE_ENTRY_ATTRS,
    PhoenixFcstdEmbeddedError,
    read_embedded_bom_attrs,
    write_embedded_bom_attrs,
)
from phoenix.freecad.fcstd_mapping import (
    FcstdMapEntry,
    compose_fcstd_body_label_display,
    compose_fcstd_recommended_filename,
    coerce_inferred_part_name,
    format_recommended_filename_hint,
    infer_fcstd_name_suffix,
    normalize_repo_rel_path_for_map,
    rename_workspace_fcstd_file,
    resolve_part_name_for_scan,
    strip_accidental_fcstd_suffix_from_name_segment,
    try_load_fcstd_entry_from_workspace_map,
    try_update_fcstd_map_entry_rename,
)
from phoenix.freecad.phoenix_store import (
    find_file_asset_entry,
    get_part_key_detail,
)

_EDITABLE_FORM_KEYS = frozenset({*EDITABLE_ENTRY_ATTRS, "filename"})


@dataclass
class KindFiltersInput:
    part: bool = True
    assembly: bool = True
    drawing: bool = True

    @classmethod
    def from_mapping(cls, raw: dict[str, Any] | None) -> KindFiltersInput:
        if not raw:
            return cls()
        return cls(
            part=bool(raw.get("part", True)),
            assembly=bool(raw.get("assembly", True)),
            drawing=bool(raw.get("drawing", True)),
        )

    def to_filters(self) -> FcstdKindFilters:
        return FcstdKindFilters(
            part=self.part,
            assembly=self.assembly,
            drawing=self.drawing,
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
    inferred = coerce_inferred_part_name(
        merged.get("PartName"),
        merged.get("label"),
        filename=merged.get("filename"),
        repo_rel_path=merged.get("repo_rel_path"),
        part_number=merged.get("PartNumber"),
        part_version=merged.get("PartVersion"),
        type_code=merged.get("TypeCode"),
        model_series=merged.get("ModelSeries"),
    )
    if inferred:
        merged["PartName"] = inferred
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


def _path_is_fcstd(full: Path) -> bool:
    return full.is_file() and is_fcstd_filename(full.name)


def _ensure_fcstd_file(repo_root: Path, rel: Path) -> Path:
    rr = repo_root.expanduser().resolve(strict=False)
    full = rr / rel
    if not _path_is_fcstd(full):
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
    name = filename.strip() or rel.name
    on_disk = infer_fcstd_name_suffix(name or "x.FCStd")
    if on_disk in (".Drawing.FCStd", ".ASSY.FCStd"):
        return on_disk
    if kinds is not None and kinds_match_filters(kinds, filters):
        return recommend_fcstd_filename_suffix(kinds, filename=name)
    return on_disk


def _part_name_for_recommended_filename(
    merged: dict[str, str],
    *,
    original_filename: str,
    rel: Path,
) -> str:
    orig = original_filename.strip() or rel.name
    refined = resolve_part_name_for_scan(
        merged.get("PartName"),
        merged.get("label"),
        filename=orig,
        repo_rel_path=merged.get("repo_rel_path") or rel.as_posix(),
        part_number=merged.get("PartNumber"),
        part_version=merged.get("PartVersion"),
        type_code=merged.get("TypeCode"),
        model_series=merged.get("ModelSeries"),
        force_update=True,
    )
    raw = refined or (merged.get("PartName") or "").strip() or (merged.get("label") or "").strip()
    return strip_accidental_fcstd_suffix_from_name_segment(raw)


def _format_file_size(size: int) -> str:
    if size < 1024:
        return f"{size} B"
    if size < 1024 * 1024:
        return f"{size / 1024:.1f} KB"
    if size < 1024 * 1024 * 1024:
        return f"{size / (1024 * 1024):.2f} MB"
    return f"{size / (1024 * 1024 * 1024):.2f} GB"


def _read_file_size(full: Path) -> tuple[int | None, str | None]:
    if not full.is_file():
        return None, None
    try:
        nbytes = full.stat().st_size
    except OSError:
        return None, None
    return nbytes, _format_file_size(nbytes)


@dataclass
class BomPreview:
    rel_path: str
    fields: dict[str, str]
    source_note: str
    abs_path_display: str
    is_fcstd: bool
    document_kinds: dict[str, object] | None
    embedded_warning: str | None
    file_size_bytes: int | None = None
    file_size_display: str | None = None
    bom_readonly: bool = False
    bom_source_rel: str | None = None


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
    mapped, _ = find_file_asset_entry(rr, rel)
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
    is_fcstd = _path_is_fcstd(full)
    bom_readonly = False
    bom_source_rel: str | None = None

    if is_fcstd:
        kinds = read_fcstd_document_kinds(full)
        drawing_res = resolve_drawing_bom(rr, rel.as_posix(), full)
        if drawing_res is not None:
            embedded = dict(drawing_res.values)
            bom_readonly = drawing_res.readonly
            bom_source_rel = drawing_res.source_repo_rel
            note = drawing_res.note
            if drawing_res.source_repo_rel:
                note += f" · 模型 {drawing_res.source_repo_rel}"
        else:
            try:
                embedded = read_embedded_bom_attrs(full)
                if embedded:
                    note += " · 已读 Document.xml / 遗留侧车"
            except PhoenixFcstdEmbeddedError as ex:
                warning = str(ex)

    merged = _merged_with_partname_coerce(_merge_embedded_over(plain, embedded))
    size_bytes, size_display = _read_file_size(full)

    return BomPreview(
        rel_path=rel.as_posix(),
        fields=merged,
        source_note=note,
        abs_path_display=format_resolved_under_workspace(full, rr),
        is_fcstd=is_fcstd,
        document_kinds=_kinds_to_dict(kinds),
        embedded_warning=warning,
        file_size_bytes=size_bytes,
        file_size_display=size_display,
        bom_readonly=bom_readonly,
        bom_source_rel=bom_source_rel,
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
    _ensure_kinds_allow(kinds, filters, "从文件嵌入读取")

    try:
        embedded = read_embedded_bom_attrs(full)
    except PhoenixFcstdEmbeddedError as ex:
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

    built = _compose_label_from_form(merged, None)
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

    drawing_res = resolve_drawing_bom(rr, rel.as_posix(), full)
    if drawing_res is not None and drawing_res.readonly:
        model_hint = drawing_res.source_repo_rel or "Link 指向的模型 FCStd"
        raise ValueError(
            "当前为图纸文件，BOM 属性只读（挂载于 App::Link）。"
            f"请编辑模型文件：{model_hint}"
        )

    vals = {k: str(values.get(k, "")).strip() for k in EDITABLE_ENTRY_ATTRS}
    inferred = coerce_inferred_part_name(
        vals.get("PartName"),
        vals.get("label"),
        part_number=vals.get("PartNumber"),
        part_version=vals.get("PartVersion"),
        type_code=vals.get("TypeCode"),
        model_series=vals.get("ModelSeries"),
    )
    if inferred and not vals.get("PartName"):
        vals["PartName"] = inferred

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
    """推荐文件名；类型由文件名后缀推断，空字段可先填工作空间记忆（不读 Document.xml）。"""
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

    orig = (original_filename or merged.get("filename") or rel.name).strip()
    kinds: FcstdDocumentKinds | None = None
    if is_fcstd_filename(rel.name):
        kinds = infer_fcstd_document_kinds_from_filename(orig)
        _ensure_kinds_allow(kinds, filters, "推荐文件名")
    suffix = _recommended_suffix(
        full=full,
        rel=rel,
        kinds=kinds,
        filters=filters,
        filename=merged.get("filename", "") or orig,
    )

    pname = _part_name_for_recommended_filename(merged, original_filename=orig, rel=rel)
    built = compose_fcstd_recommended_filename(
        part_number=merged.get("PartNumber", ""),
        part_version=merged.get("PartVersion", ""),
        type_code=merged.get("TypeCode", ""),
        model_series=merged.get("ModelSeries", ""),
        part_name=pname,
        label_fallback="",
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
            f"推荐后缀 {recommend_fcstd_filename_suffix(kinds, filename=orig)}"
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


def _norm_rel_key(rel: Path) -> str:
    return normalize_repo_rel_path_for_map(rel.as_posix().replace("\\", "/"))


def _compose_label_from_form(
    merged: dict[str, str],
    mapped: FcstdMapEntry | None,
    *,
    use_label_fallback: bool = True,
) -> str | None:
    """用表单 + 索引本文件字段拼 Label；不做文件名/路径推断。"""
    pn = (merged.get("PartNumber") or "").strip()
    pv = (merged.get("PartVersion") or "").strip()
    if mapped:
        if not pn and mapped.PartNumber:
            pn = str(mapped.PartNumber).strip()
        if not pv and mapped.PartVersion:
            pv = str(mapped.PartVersion).strip()
    pname = merged.get("PartName", "").strip()
    if not pname and mapped and mapped.PartName:
        pname = str(mapped.PartName).strip()
    fallback = merged.get("label", "") if use_label_fallback else ""
    return compose_fcstd_body_label_display(
        part_number=pn,
        part_version=pv,
        part_name=pname,
        label_fallback=fallback,
    )


def _resolve_part_key_triple(
    merged: dict[str, str],
    mapped: FcstdMapEntry | None,
    rel: Path,
) -> tuple[str | None, str | None]:
    pn = (merged.get("PartNumber") or "").strip()
    pv = (merged.get("PartVersion") or "").strip()
    if pn and pv:
        return pn, pv
    if mapped and mapped.PartNumber and mapped.PartVersion:
        return str(mapped.PartNumber).strip(), str(mapped.PartVersion).strip()
    plain = _entry_to_plain(FcstdMapEntry.preview_from_workspace_relative(rel))
    pn = (plain.get("PartNumber") or "").strip()
    pv = (plain.get("PartVersion") or "").strip()
    return pn or None, pv or None


def _plain_field(plain: dict[str, str], field_key: str) -> str:
    return (plain.get(field_key) or "").strip()


def _collect_index_related(
    repo_root: Path,
    rel: Path,
    field_key: str,
    *,
    part_number: str,
    part_version: str,
    detail: dict[str, Any] | None = None,
) -> list[tuple[str, str]]:
    rr = repo_root.expanduser().resolve(strict=False)
    if detail is None:
        detail = get_part_key_detail(rr, part_number, part_version)
    if not detail:
        return []
    want = _norm_rel_key(rel)
    out: list[tuple[str, str]] = []
    for row in detail.get("files") or []:
        if not isinstance(row, dict):
            continue
        rp = _norm_rel_key(Path(str(row.get("repo_rel_path") or "")))
        if rp == want:
            continue
        val = (row.get(field_key) or "").strip()
        if not val:
            continue
        fn = str(row.get("filename") or "").strip()
        out.append((val, f"索引库 · 同零件键 {part_number}.{part_version} · {fn}"))
    return out


def _collect_filename_hint(rel: Path, field_key: str) -> list[tuple[str, str]]:
    if field_key == "filename":
        return []
    plain = _merged_with_partname_coerce(
        _entry_to_plain(FcstdMapEntry.preview_from_workspace_relative(rel))
    )
    val = _plain_field(plain, field_key)
    if val:
        return [(val, "文件名 / 路径推断")]
    return []


def _collect_prefs(repo_root: Path, field_key: str) -> list[tuple[str, str]]:
    fills = recommend_field_fill_values(load_bom_apply_field_defaults(repo_root))
    return _collect_prefs_from_fills(fills, field_key)


def _collect_prefs_from_fills(fills: dict[str, str], field_key: str) -> list[tuple[str, str]]:
    if field_key not in ("PartNumber", "PartVersion", "TypeCode", "ModelSeries"):
        return []
    val = (fills.get(field_key) or "").strip()
    if val:
        return [(val, "工作空间记忆（上次保存递增）")]
    return []


_RECOMMEND_ALL_FIELD_ORDER: tuple[str, ...] = (
    "PartNumber",
    "PartVersion",
    "TypeCode",
    "ModelSeries",
    "PartName",
    "label",
    "filename",
)


@dataclass
class _RecommendFieldCtx:
    repo_root: Path
    rel: Path
    merged: dict[str, str]
    kind_filters: KindFiltersInput | None
    mapped: FcstdMapEntry | None
    full: Path
    is_fcstd: bool
    prefs_fills: dict[str, str]
    part_detail_cache: dict[tuple[str, str], dict[str, Any] | None]

    @classmethod
    def build(
        cls,
        repo_root: Path,
        rel: Path,
        values: dict[str, str],
        *,
        kind_filters: KindFiltersInput | None = None,
    ) -> _RecommendFieldCtx:
        rr = repo_root.expanduser().resolve(strict=False)
        rel = Path(rel)
        merged = _coerce_form_values(values)
        mapped = try_load_fcstd_entry_from_workspace_map(repo_root=rr, rel_workspace=rel)
        full = rr / rel
        is_fcstd = _path_is_fcstd(full) or is_fcstd_filename(rel.name)
        prefs_fills = recommend_field_fill_values(load_bom_apply_field_defaults(rr))
        return cls(
            repo_root=rr,
            rel=rel,
            merged=merged,
            kind_filters=kind_filters,
            mapped=mapped,
            full=full,
            is_fcstd=is_fcstd,
            prefs_fills=prefs_fills,
            part_detail_cache={},
        )

    def part_detail(self, part_number: str, part_version: str) -> dict[str, Any] | None:
        key = (part_number, part_version)
        if key not in self.part_detail_cache:
            self.part_detail_cache[key] = get_part_key_detail(
                self.repo_root, part_number, part_version
            )
        return self.part_detail_cache[key]


def _recommend_one_field(ctx: _RecommendFieldCtx, field_key: str) -> dict[str, object]:
    key = (field_key or "").strip()
    if key not in _EDITABLE_FORM_KEYS:
        raise ValueError(f"不支持推荐的字段: {field_key}")

    merged = ctx.merged
    mapped = ctx.mapped
    rel = ctx.rel
    rr = ctx.repo_root
    pn, pv = _resolve_part_key_triple(merged, mapped, rel)

    if key == "filename":
        if not ctx.is_fcstd:
            raise ValueError("仅 FCStd 可推荐文件名")
        payload = recommend_filename_for_values(
            rr,
            rel,
            merged,
            fill_empty_from_prefs=False,
            kind_filters=ctx.kind_filters,
            original_filename=merged.get("filename") or rel.name,
            persist_prefs=False,
        )
        name = str(payload.get("recommended_filename") or "").strip()
        if name:
            return {
                "field": key,
                "value": name,
                "source_note": "按命名规则推荐",
                "filled": True,
            }
        return {"field": key, "value": "", "source_note": "未找到可推荐值", "filled": False}

    if key == "label":
        built = _compose_label_from_form(merged, mapped, use_label_fallback=False)
        if built:
            return {
                "field": key,
                "value": built,
                "source_note": "编号公式 PartNumber.PartVersion-PartName",
                "filled": True,
            }
        return {"field": key, "value": "", "source_note": "未找到可推荐值", "filled": False}

    if key == "ModelSeries" and (merged.get("TypeCode") or "").strip().upper() == "S":
        return {
            "field": key,
            "value": "",
            "source_note": "标准件（S）不含型号系列",
            "filled": True,
        }

    candidates: list[tuple[str, str]] = []
    candidates.extend(_collect_index_same(mapped, key))
    if pn and pv:
        candidates.extend(
            _collect_index_related(
                rr,
                rel,
                key,
                part_number=pn,
                part_version=pv,
                detail=ctx.part_detail(pn, pv),
            )
        )
    candidates.extend(_collect_filename_hint(rel, key))
    candidates.extend(_collect_prefs_from_fills(ctx.prefs_fills, key))

    if key == "PartName":
        for val, note in candidates:
            if val:
                refined = resolve_part_name_for_scan(
                    val,
                    merged.get("label"),
                    filename=merged.get("filename") or rel.name,
                    repo_rel_path=merged.get("repo_rel_path") or rel.as_posix(),
                    part_number=pn or merged.get("PartNumber"),
                    part_version=pv or merged.get("PartVersion"),
                    type_code=merged.get("TypeCode"),
                    model_series=merged.get("ModelSeries"),
                    force_update=True,
                )
                out = refined or val
                return {"field": key, "value": out, "source_note": note, "filled": True}
        inferred = resolve_part_name_for_scan(
            merged.get("PartName"),
            merged.get("label"),
            filename=merged.get("filename") or rel.name,
            repo_rel_path=merged.get("repo_rel_path") or rel.as_posix(),
            part_number=pn or merged.get("PartNumber"),
            part_version=pv or merged.get("PartVersion"),
            type_code=merged.get("TypeCode"),
            model_series=merged.get("ModelSeries"),
            force_update=False,
        )
        if inferred:
            return {
                "field": key,
                "value": inferred,
                "source_note": "智能去前缀（label / 文件名）",
                "filled": True,
            }
        return {"field": key, "value": "", "source_note": "未找到可推荐值", "filled": False}

    for val, note in candidates:
        if val:
            return {"field": key, "value": val, "source_note": note, "filled": True}
    return {"field": key, "value": "", "source_note": "未找到可推荐值", "filled": False}


def recommend_bom_field(
    repo_root: Path,
    rel: Path,
    field_key: str,
    values: dict[str, str],
    *,
    kind_filters: KindFiltersInput | None = None,
) -> dict[str, object]:
    """单字段推荐：索引库 → 同零件键 → 文件名推断 → 工作空间记忆（不读 FCStd）。"""
    ctx = _RecommendFieldCtx.build(repo_root, rel, values, kind_filters=kind_filters)
    return _recommend_one_field(ctx, field_key)


def recommend_bom_fields_all(
    repo_root: Path,
    rel: Path,
    values: dict[str, str],
    *,
    kind_filters: KindFiltersInput | None = None,
) -> dict[str, object]:
    """全部可推荐字段一次完成：单次索引上下文 + 文件名推断（不读 FCStd）。"""
    ctx = _RecommendFieldCtx.build(repo_root, rel, values, kind_filters=kind_filters)
    working = dict(ctx.merged)
    results: dict[str, dict[str, object]] = {}
    filled_keys: list[str] = []

    for key in _RECOMMEND_ALL_FIELD_ORDER:
        if key == "filename" and not ctx.is_fcstd:
            continue
        ctx.merged = working
        row = _recommend_one_field(ctx, key)
        results[key] = row
        if row.get("filled"):
            val = str(row.get("value") or "")
            if val or key == "ModelSeries":
                working[key] = val
                filled_keys.append(key)
        if (working.get("TypeCode") or "").strip().upper() == "S":
            working["ModelSeries"] = ""

    return {"results": results, "filled_keys": filled_keys}


def _collect_index_same(mapped: FcstdMapEntry | None, field_key: str) -> list[tuple[str, str]]:
    if mapped is None:
        return []
    plain = _merged_with_partname_coerce(_entry_to_plain(mapped))
    val = _plain_field(plain, field_key)
    if val:
        return [(val, "索引库 · 本文件")]
    return []


def rename_bom_fcstd_file(
    repo_root: Path,
    rel: Path,
    new_filename: str,
    *,
    baseline: dict[str, str],
    current: dict[str, str],
    write_attrs_first: bool = False,
) -> dict[str, object]:
    rr = repo_root.expanduser().resolve(strict=False)
    rel = Path(rel)
    _ensure_fcstd_file(rr, rel)

    unsaved = has_unsaved_document_attrs(baseline, current)
    if unsaved and not write_attrs_first:
        raise ValueError(
            "当前有尚未写入文件的属性（零件号、版本、类型、标签等）。"
            "请先「写入文件」，或选择「写入并改名」。"
        )

    attrs_saved = False
    if unsaved and write_attrs_first:
        save_bom_to_fcstd(rr, rel, current)
        attrs_saved = True

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
        "attrs_saved": attrs_saved,
    }
