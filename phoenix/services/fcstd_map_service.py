"""CAD 索引：工程内扫描、属性采集、缺失标记；持久化至 ``.phoenix/phoenix-workspace.sqlite``。"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from phoenix.config.user_prefs import (
    format_resolved_under_workspace,
    load_workspace_prefs,
    merge_workspace_section,
)
from phoenix.freecad.cad_index_types import (
    ASSET_KIND_FCSTD,
    cad_asset_kind,
    is_fcstd_filename,
)
from phoenix.freecad.fcstd_embedded_attrs import PhoenixFcstdEmbeddedError, read_embedded_bom_attrs
from phoenix.freecad.fcstd_mapping import (
    FILE_STATUS_MISSING,
    FILE_STATUS_PRESENT,
    FcstdMapDocument,
    FcstdMapEntry,
    infer_part_name_from_fcstd_filename,
    resolve_label_for_index_scan,
    resolve_part_name_for_scan,
    hints_from_fcstd_location,
    normalize_repo_rel_path_for_map,
)
from phoenix.freecad.phoenix_store import (
    cad_database_path,
    connect,
    delete_missing_file_assets,
    export_fcstd_map_json,
    fcstd_map_json_path,
    load_fcstd_document,
    query_file_asset_entries_paged,
    read_fcstd_map_meta,
    save_fcstd_document,
    update_scan_stats_meta,
)
from phoenix.services.cad_index.bom_xref_index import rebuild_bom_xrefs
from phoenix.services.cad_index.scan_paths import (
    resolve_scan_root,
    scan_cad_basename_map,
    scan_fcstd_basename_map,
)

def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def _norm_path_key(repo_rel_path: str) -> str:
    return normalize_repo_rel_path_for_map(repo_rel_path.replace("\\", "/").strip())


def get_fcstd_map_prefs(repo_root: Path) -> dict[str, bool]:
    """CAD 索引用户选项（扫描范围固定为工作空间根，不再暴露子目录扫描根）。"""
    rr = repo_root.expanduser().resolve(strict=False)
    pref = load_workspace_prefs(rr).get("fcstd_map") or {}
    if pref.get("scan_root") is not None:
        merge_workspace_section("fcstd_map", {"scan_root": None}, rr)
    return {
        "force_update_part_name": bool(pref.get("force_update_part_name")),
    }


def save_fcstd_map_prefs(
    repo_root: Path,
    *,
    force_update_part_name: bool | None = None,
) -> dict[str, bool]:
    rr = repo_root.expanduser().resolve(strict=False)
    patch: dict[str, Any] = {"scan_root": None}
    if force_update_part_name is not None:
        patch["force_update_part_name"] = bool(force_update_part_name)
    merge_workspace_section("fcstd_map", patch, rr)
    return get_fcstd_map_prefs(rr)


def _merge_props_from_disk(
    entry: FcstdMapEntry,
    repo_root: Path,
    *,
    force_update_part_name: bool = False,
) -> FcstdMapEntry:
    """文件名/路径推断 + ``Document.xml`` 嵌入式属性（与属性回写字段一致）。"""
    rel = Path(str(entry.repo_rel_path).lstrip("./"))
    full = repo_root / rel
    hints = hints_from_fcstd_location(entry.filename, entry.repo_rel_path)

    pn = _opt(hints.get("PartNumber")) or entry.PartNumber
    pv = _opt(hints.get("PartVersion")) or entry.PartVersion
    tc = _opt_upper(hints.get("TypeCode")) or entry.TypeCode
    ms = _opt_upper(hints.get("ModelSeries")) or entry.ModelSeries
    pname = entry.PartName
    label = entry.label
    embedded_label: str | None = None

    if full.is_file():
        try:
            emb = read_embedded_bom_attrs(full)
            if emb.get("PartNumber"):
                pn = emb["PartNumber"]
            if emb.get("PartVersion"):
                pv = emb["PartVersion"]
            if emb.get("TypeCode"):
                tc = emb["TypeCode"].upper()
            if emb.get("ModelSeries"):
                ms = emb["ModelSeries"].upper()
            if emb.get("PartName"):
                pname = emb["PartName"]
            if emb.get("label"):
                embedded_label = emb["label"]
        except PhoenixFcstdEmbeddedError:
            pass

    label = resolve_label_for_index_scan(embedded_label, stored_label=label)

    pname = resolve_part_name_for_scan(
        pname,
        label,
        filename=entry.filename,
        repo_rel_path=entry.repo_rel_path,
        part_number=pn,
        part_version=pv,
        type_code=tc,
        model_series=ms,
        force_update=force_update_part_name,
    )

    return FcstdMapEntry(
        repo_rel_path=entry.repo_rel_path,
        filename=entry.filename,
        PartNumber=pn,
        PartVersion=pv,
        TypeCode=tc,
        ModelSeries=ms,
        PartName=pname,
        label=label,
        asset_kind=entry.asset_kind or cad_asset_kind(entry.filename),
        file_status=entry.file_status,
        last_seen_at=entry.last_seen_at,
        extra=dict(entry.extra),
    )


def _opt(v: Any) -> str | None:
    if v is None:
        return None
    s = str(v).strip()
    return s or None


def _opt_upper(v: Any) -> str | None:
    s = _opt(v)
    return s.upper() if s else None


def _finalize_map_entry(
    entry: FcstdMapEntry,
    repo_root: Path,
    *,
    force_update_part_name: bool,
) -> FcstdMapEntry:
    rel = Path(str(entry.repo_rel_path).lstrip("./"))
    if (repo_root / rel).is_file():
        return _merge_props_from_disk(entry, repo_root, force_update_part_name=force_update_part_name)

    pname = resolve_part_name_for_scan(
        entry.PartName,
        entry.label,
        filename=entry.filename,
        repo_rel_path=entry.repo_rel_path,
        part_number=entry.PartNumber,
        part_version=entry.PartVersion,
        type_code=entry.TypeCode,
        model_series=entry.ModelSeries,
        force_update=force_update_part_name,
    )
    return FcstdMapEntry(
        repo_rel_path=entry.repo_rel_path,
        filename=entry.filename,
        PartNumber=entry.PartNumber,
        PartVersion=entry.PartVersion,
        TypeCode=entry.TypeCode,
        ModelSeries=entry.ModelSeries,
        PartName=pname,
        label=entry.label,
        asset_kind=entry.asset_kind or cad_asset_kind(entry.filename),
        file_status=entry.file_status,
        last_seen_at=entry.last_seen_at,
        extra=dict(entry.extra),
    )


def _entry_from_scan_path(
    repo_root: Path,
    repo_rel: str,
    *,
    now: str,
    force_update_part_name: bool = False,
) -> FcstdMapEntry:
    rp = normalize_repo_rel_path_for_map(repo_rel)
    name = Path(rp).name
    kind = cad_asset_kind(name)

    if not is_fcstd_filename(name):
        hints = hints_from_fcstd_location(name, rp)
        pn = _opt(hints.get("PartNumber"))
        pv = _opt(hints.get("PartVersion"))
        tc = _opt_upper(hints.get("TypeCode"))
        ms = _opt_upper(hints.get("ModelSeries"))
        pname = _opt(
            infer_part_name_from_fcstd_filename(
                name,
                part_number=pn,
                part_version=pv,
                type_code=tc,
                model_series=ms,
                repo_rel_path=rp,
            )
        )
        return FcstdMapEntry(
            repo_rel_path=rp,
            filename=name,
            PartNumber=pn,
            PartVersion=pv,
            TypeCode=tc,
            ModelSeries=ms,
            PartName=pname,
            asset_kind=kind,
            file_status=FILE_STATUS_PRESENT,
            last_seen_at=now,
        )

    hints = hints_from_fcstd_location(name, rp)
    entry = FcstdMapEntry(
        repo_rel_path=rp,
        filename=name,
        PartNumber=_opt(hints.get("PartNumber")),
        PartVersion=_opt(hints.get("PartVersion")),
        TypeCode=_opt_upper(hints.get("TypeCode")),
        ModelSeries=_opt_upper(hints.get("ModelSeries")),
        PartName=_opt(hints.get("PartName")),
        label=_opt(hints.get("label")),
        asset_kind=ASSET_KIND_FCSTD,
        file_status=FILE_STATUS_PRESENT,
        last_seen_at=now,
    )
    merged = _merge_props_from_disk(entry, repo_root, force_update_part_name=force_update_part_name)
    return FcstdMapEntry(
        repo_rel_path=merged.repo_rel_path,
        filename=merged.filename,
        PartNumber=merged.PartNumber,
        PartVersion=merged.PartVersion,
        TypeCode=merged.TypeCode,
        ModelSeries=merged.ModelSeries,
        PartName=merged.PartName,
        label=merged.label,
        asset_kind=ASSET_KIND_FCSTD,
        file_status=merged.file_status,
        last_seen_at=merged.last_seen_at,
        extra=dict(merged.extra),
    )


def _entry_to_api_dict(e: FcstdMapEntry) -> dict[str, Any]:
    kind = e.asset_kind or cad_asset_kind(e.filename)
    return {
        "repo_rel_path": e.repo_rel_path,
        "filename": e.filename,
        "asset_kind": kind,
        "PartNumber": e.PartNumber or "",
        "PartVersion": e.PartVersion or "",
        "TypeCode": e.TypeCode or "",
        "ModelSeries": e.ModelSeries or "",
        "PartName": e.PartName or "",
        "label": e.label or "",
        "file_status": e.file_status or FILE_STATUS_PRESENT,
        "last_seen_at": e.last_seen_at or "",
    }


def _compute_stats(entries: list[FcstdMapEntry], basename_map: dict[str, list[str]]) -> dict[str, int]:
    present = sum(1 for e in entries if e.file_status != FILE_STATUS_MISSING)
    missing = sum(1 for e in entries if e.file_status == FILE_STATUS_MISSING)
    dup_kinds = sum(1 for v in basename_map.values() if len(v) > 1)
    cad_count = sum(len(v) for v in basename_map.values())
    fcstd_count = sum(
        len(v) for name, v in basename_map.items() if is_fcstd_filename(name)
    )
    kind_counts: dict[str, int] = {}
    for e in entries:
        if e.file_status == FILE_STATUS_MISSING:
            continue
        k = e.asset_kind or cad_asset_kind(e.filename)
        kind_counts[k] = kind_counts.get(k, 0) + 1
    return {
        "total_entries": len(entries),
        "present": present,
        "missing": missing,
        "unique_filenames": len(basename_map),
        "duplicate_filename_kinds": dup_kinds,
        "cad_file_count": cad_count,
        "fcstd_file_count": fcstd_count,
        "markdown_file_count": kind_counts.get("markdown", 0),
        "pdf_file_count": kind_counts.get("pdf", 0),
        "cad_exchange_file_count": kind_counts.get("cad_exchange", 0),
        "image_file_count": kind_counts.get("image", 0),
    }


def _parse_scan_stats_json(raw: str | None) -> dict[str, int] | None:
    if not raw:
        return None
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        return None
    if not isinstance(parsed, dict):
        return None
    return {k: int(v) for k, v in parsed.items() if isinstance(v, (int, float))}


def search_fcstd_map_entries(
    repo_root: Path,
    *,
    offset: int = 0,
    limit: int = 20,
    status: str | None = None,
    kind: str | None = None,
    search: str | None = None,
) -> dict[str, Any]:
    """分页返回 CAD 索引条目（单次 ``phoenix_cad_file_asset`` 查询，无 JOIN）。"""
    rr = repo_root.expanduser().resolve(strict=False)
    cap = max(1, min(int(limit), 500))
    off = max(0, int(offset))
    st = (status or "").strip().lower()
    if st == "all":
        st = None
    k = (kind or "").strip().lower()
    if k == "all":
        k = None
    rows, total, debug_sql = query_file_asset_entries_paged(
        rr,
        offset=off,
        limit=cap,
        status=st,
        kind=k,
        search=search,
    )
    return {
        "offset": off,
        "limit": cap,
        "total": total,
        "count": len(rows),
        "entries": rows,
        "debug_sql": debug_sql,
    }


def load_fcstd_map_payload(repo_root: Path, *, include_entries: bool = True) -> dict[str, Any]:
    rr = repo_root.expanduser().resolve(strict=False)
    prefs = get_fcstd_map_prefs(rr)
    db = cad_database_path(rr)
    jp = fcstd_map_json_path(rr)
    doc = load_fcstd_document(rr)

    empty_stats = {
        "total_entries": 0,
        "present": 0,
        "missing": 0,
        "unique_filenames": 0,
        "duplicate_filename_kinds": 0,
        "cad_file_count": 0,
        "fcstd_file_count": 0,
        "markdown_file_count": 0,
        "pdf_file_count": 0,
        "cad_exchange_file_count": 0,
        "image_file_count": 0,
    }

    if not db.is_file():
        return {
            "database_path": str(db),
            "database_path_display": format_resolved_under_workspace(db, rr),
            "map_path": str(jp),
            "map_path_display": format_resolved_under_workspace(jp, rr),
            "exists": False,
            "prefs": prefs,
            "last_scan_at": "",
            "scan_root": ".",
            "stats": empty_stats,
            "entries": [],
        }

    with connect(rr) as conn:
        n_row = conn.execute("SELECT COUNT(*) AS n FROM phoenix_cad_file_asset").fetchone()
        row_count = int(n_row["n"]) if n_row else 0
        if row_count == 0:
            return {
                "database_path": str(db),
                "database_path_display": format_resolved_under_workspace(db, rr),
                "map_path": str(jp),
                "map_path_display": format_resolved_under_workspace(jp, rr),
                "exists": False,
                "prefs": prefs,
                "last_scan_at": "",
                "scan_root": ".",
                "stats": empty_stats,
                "entries": [],
            }

        if not include_entries:
            meta = read_fcstd_map_meta(rr)
            stats = _parse_scan_stats_json(meta.get("last_scan_stats_json")) or empty_stats
            return {
                "database_path": str(db),
                "database_path_display": format_resolved_under_workspace(db, rr),
                "map_path": str(jp),
                "map_path_display": format_resolved_under_workspace(jp, rr),
                "exists": True,
                "prefs": prefs,
                "last_scan_at": meta.get("last_scan_at") or "",
                "scan_root": meta.get("scan_root") or ".",
                "stats": stats,
                "entries": [],
            }

    doc = load_fcstd_document(rr)
    if doc is None:
        return {
            "database_path": str(db),
            "database_path_display": format_resolved_under_workspace(db, rr),
            "map_path": str(jp),
            "map_path_display": format_resolved_under_workspace(jp, rr),
            "exists": False,
            "prefs": prefs,
            "last_scan_at": "",
            "scan_root": ".",
            "stats": empty_stats,
            "entries": [],
        }

    stats = doc.scan_stats or _compute_stats(doc.entries, doc.to_legacy_basename_paths())
    return {
        "database_path": str(db),
        "database_path_display": format_resolved_under_workspace(db, rr),
        "map_path": str(jp),
        "map_path_display": format_resolved_under_workspace(jp, rr),
        "exists": True,
        "prefs": prefs,
        "last_scan_at": doc.last_scan_at or "",
        "scan_root": doc.scan_root or ".",
        "stats": stats,
        "entries": [_entry_to_api_dict(e) for e in doc.entries],
    }


def run_fcstd_map_scan(
    repo_root: Path,
    *,
    force_update_part_name: bool | None = None,
) -> dict[str, Any]:
    """从工作空间根递归扫描 CAD 文件，写入 ``.phoenix/phoenix-workspace.sqlite``。"""
    rr = repo_root.expanduser().resolve(strict=False)
    merge_workspace_section("fcstd_map", {"scan_root": None}, rr)

    ws_pref = load_workspace_prefs(rr).get("fcstd_map") or {}
    force_part_name = (
        bool(force_update_part_name)
        if force_update_part_name is not None
        else bool(ws_pref.get("force_update_part_name"))
    )
    scan = resolve_scan_root(rr, None)
    if not scan.is_dir():
        raise ValueError(f"工作空间根不是有效目录: {scan}")

    now = _utc_now_iso()
    basename_map = scan_cad_basename_map(scan, anchor=rr)
    current_keys: set[str] = set()
    present_entries: list[FcstdMapEntry] = []

    for _name, paths in basename_map.items():
        for rp in paths:
            key = _norm_path_key(rp)
            current_keys.add(key)
            present_entries.append(
                _entry_from_scan_path(
                    rr,
                    rp,
                    now=now,
                    force_update_part_name=force_part_name,
                )
            )

    prev = load_fcstd_document(rr)
    prev_by_key: dict[str, FcstdMapEntry] = {}
    if prev:
        for e in prev.entries:
            prev_by_key[_norm_path_key(e.repo_rel_path)] = e

    merged: list[FcstdMapEntry] = list(present_entries)
    for key, old in prev_by_key.items():
        if key in current_keys:
            continue
        merged.append(
            _finalize_map_entry(
                FcstdMapEntry(
                    repo_rel_path=old.repo_rel_path,
                    filename=old.filename,
                    PartNumber=old.PartNumber,
                    PartVersion=old.PartVersion,
                    TypeCode=old.TypeCode,
                    ModelSeries=old.ModelSeries,
                    PartName=old.PartName,
                    label=old.label,
                    asset_kind=old.asset_kind or cad_asset_kind(old.filename),
                    file_status=FILE_STATUS_MISSING,
                    last_seen_at=old.last_seen_at,
                    extra=dict(old.extra),
                ),
                rr,
                force_update_part_name=force_part_name,
            )
        )

    merged.sort(key=lambda e: (_norm_path_key(e.repo_rel_path), e.file_status or ""))
    stats = _compute_stats(merged, basename_map)
    doc = FcstdMapDocument(
        entries=merged,
        last_scan_at=now,
        scan_root=".",
        scan_stats=stats,
    )
    scan_id = save_fcstd_document(rr, doc, scan_root=".", stats=stats)
    xref_stats = rebuild_bom_xrefs(rr, scan_id=scan_id, scan_root=scan)
    xref_log = (xref_stats.get("log") or "").strip()

    payload = load_fcstd_map_payload(rr)
    payload["scan_log"] = (
        f"扫描范围: 工作空间根 {format_resolved_under_workspace(scan, rr)}\n"
        f"数据库: {payload['database_path_display']}\n"
        f"PartName: {'强制智能更新' if force_part_name else '仅填空时智能推断'}\n"
        f"本次: 存在 {stats['present']} · 缺失 {stats['missing']} · "
        f"CAD {stats['cad_file_count']}（FCStd {stats['fcstd_file_count']} · "
        f"MD {stats['markdown_file_count']} · PDF {stats['pdf_file_count']} · "
        f"DXF/DWG {stats['cad_exchange_file_count']} · 图片 {stats['image_file_count']}） · "
        f"重名种类 {stats['duplicate_filename_kinds']}"
        + (f"\n\n{xref_log}" if xref_log else "")
    )
    payload["bom_xref"] = xref_stats
    return payload


def purge_missing_fcstd_map_entries(repo_root: Path) -> dict[str, Any]:
    """从 CAD 索引库删除所有「缺失」条目（上次扫描存在、本次未找到的文件）。"""
    rr = repo_root.expanduser().resolve(strict=False)
    deleted = delete_missing_file_assets(rr)
    doc = load_fcstd_document(rr)
    if doc and doc.entries:
        stats = _compute_stats(doc.entries, doc.to_legacy_basename_paths())
        update_scan_stats_meta(rr, stats)
    payload = load_fcstd_map_payload(rr)
    payload["purge_deleted"] = deleted
    return payload


def export_fcstd_map_to_json(repo_root: Path) -> dict[str, str]:
    rr = repo_root.expanduser().resolve(strict=False)
    out = export_fcstd_map_json(rr)
    return {
        "path": str(out),
        "path_display": format_resolved_under_workspace(out, rr),
    }
