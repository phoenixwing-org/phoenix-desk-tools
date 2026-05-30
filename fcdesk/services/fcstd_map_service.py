"""FCStd 索引：工程内扫描、属性采集、缺失标记；持久化至 ``.phoenix/cad-database.sqlite``。"""

from __future__ import annotations

import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fcdesk.config.user_prefs import (
    format_resolved_under_workspace,
    format_stored_path_for_display,
    load_workspace_prefs,
    merge_workspace_section,
    resolve_workspace_path_entry,
    shorten_workspace_relative_display,
    store_path_under_repo,
)
from fcdesk.freecad.fcstd_embedded_attrs import FcdeskFcstdEmbeddedError, read_embedded_bom_attrs
from fcdesk.freecad.fcstd_mapping import (
    FILE_STATUS_MISSING,
    FILE_STATUS_PRESENT,
    FcstdMapDocument,
    FcstdMapEntry,
    hints_from_fcstd_location,
    normalize_repo_rel_path_for_map,
)
from fcdesk.freecad.phoenix_store import (
    cad_database_path,
    export_fcstd_map_json,
    fcstd_map_json_path,
    load_fcstd_document,
    migrate_fcstd_map_json,
    save_fcstd_document,
)

_SKIP_DIRS = frozenset(
    {
        ".git",
        "__pycache__",
        ".obsidian",
        ".phoenix",
        "node_modules",
        ".cursor",
        "temp",
        ".venv",
        ".venv-desktop",
        "web-ui",
        "dist",
        "build",
    }
)


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def _norm_path_key(repo_rel_path: str) -> str:
    return normalize_repo_rel_path_for_map(repo_rel_path.replace("\\", "/").strip())


def scan_fcstd_basename_map(
    scan_root: Path,
    *,
    anchor: Path,
) -> dict[str, list[str]]:
    """``扫描根`` 下遍历 ``*.FCStd`` → ``文件名 → 相对 anchor 的路径列表``。"""
    root = scan_root.expanduser().resolve(strict=False)
    base = anchor.expanduser().resolve(strict=False)
    out: dict[str, list[str]] = {}

    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in _SKIP_DIRS]
        for name in filenames:
            if not name.endswith(".FCStd"):
                continue
            abs_path = Path(dirpath, name).resolve()
            try:
                rel = os.path.relpath(abs_path, base).replace(os.sep, "/")
            except ValueError:
                rel = str(abs_path)
            rel = normalize_repo_rel_path_for_map(rel)
            out.setdefault(name, []).append(rel)

    for paths in out.values():
        paths.sort()
    return out


def resolve_scan_root(repo_root: Path, stored_scan_root: str | None) -> Path:
    if stored_scan_root:
        return resolve_workspace_path_entry(stored_scan_root, repo_root)
    return repo_root.expanduser().resolve(strict=False)


def get_fcstd_map_prefs(repo_root: Path) -> dict[str, str]:
    rr = repo_root.expanduser().resolve(strict=False)
    pref = load_workspace_prefs(rr).get("fcstd_map") or {}
    stored = pref.get("scan_root")
    disp = shorten_workspace_relative_display(
        format_stored_path_for_display(stored, rr) if stored else "."
    )
    return {"scan_root": disp}


def save_fcstd_map_prefs(repo_root: Path, scan_root_input: str) -> dict[str, str]:
    rr = repo_root.expanduser().resolve(strict=False)
    s = (scan_root_input or "").strip()
    if not s or s == ".":
        stored = None
    else:
        p = resolve_workspace_path_entry(s, rr)
        stored = None if p.resolve(strict=False) == rr.resolve(strict=False) else store_path_under_repo(p, rr)
    merge_workspace_section("fcstd_map", {"scan_root": stored}, rr)
    return get_fcstd_map_prefs(rr)


def _merge_props_from_disk(entry: FcstdMapEntry, repo_root: Path) -> FcstdMapEntry:
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
                label = emb["label"]
        except FcdeskFcstdEmbeddedError:
            pass

    if not pname and label:
        pname = label

    return FcstdMapEntry(
        repo_rel_path=entry.repo_rel_path,
        filename=entry.filename,
        PartNumber=pn,
        PartVersion=pv,
        TypeCode=tc,
        ModelSeries=ms,
        PartName=pname,
        label=label,
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


def _entry_from_scan_path(repo_root: Path, repo_rel: str, *, now: str) -> FcstdMapEntry:
    rp = normalize_repo_rel_path_for_map(repo_rel)
    name = Path(rp).name
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
        file_status=FILE_STATUS_PRESENT,
        last_seen_at=now,
    )
    return _merge_props_from_disk(entry, repo_root)


def _entry_to_api_dict(e: FcstdMapEntry) -> dict[str, Any]:
    return {
        "repo_rel_path": e.repo_rel_path,
        "filename": e.filename,
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
    return {
        "total_entries": len(entries),
        "present": present,
        "missing": missing,
        "unique_filenames": len(basename_map),
        "duplicate_filename_kinds": dup_kinds,
        "fcstd_file_count": sum(len(v) for v in basename_map.values()),
    }


def _ensure_index_loaded(repo_root: Path) -> None:
    migrate_fcstd_map_json(repo_root)


def load_fcstd_map_payload(repo_root: Path) -> dict[str, Any]:
    rr = repo_root.expanduser().resolve(strict=False)
    _ensure_index_loaded(rr)
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
        "fcstd_file_count": 0,
    }

    if doc is None:
        return {
            "database_path": str(db),
            "database_path_display": format_resolved_under_workspace(db, rr),
            "map_path": str(jp),
            "map_path_display": format_resolved_under_workspace(jp, rr),
            "exists": False,
            "prefs": prefs,
            "last_scan_at": "",
            "scan_root": prefs.get("scan_root") or ".",
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
        "scan_root": doc.scan_root or prefs.get("scan_root") or ".",
        "stats": stats,
        "entries": [_entry_to_api_dict(e) for e in doc.entries],
    }


def run_fcstd_map_scan(repo_root: Path, *, scan_root_input: str | None = None) -> dict[str, Any]:
    """扫描工程内 FCStd，写入 ``.phoenix/cad-database.sqlite``。"""
    rr = repo_root.expanduser().resolve(strict=False)
    if scan_root_input is not None:
        save_fcstd_map_prefs(rr, scan_root_input)

    _ensure_index_loaded(rr)

    prefs = get_fcstd_map_prefs(rr)
    ws_pref = load_workspace_prefs(rr).get("fcstd_map") or {}
    scan = resolve_scan_root(rr, ws_pref.get("scan_root"))
    if not scan.is_dir():
        raise ValueError(f"扫描根不是有效目录: {scan}")

    now = _utc_now_iso()
    basename_map = scan_fcstd_basename_map(scan, anchor=rr)
    current_keys: set[str] = set()
    present_entries: list[FcstdMapEntry] = []

    for _name, paths in basename_map.items():
        for rp in paths:
            key = _norm_path_key(rp)
            current_keys.add(key)
            present_entries.append(_entry_from_scan_path(rr, rp, now=now))

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
            FcstdMapEntry(
                repo_rel_path=old.repo_rel_path,
                filename=old.filename,
                PartNumber=old.PartNumber,
                PartVersion=old.PartVersion,
                TypeCode=old.TypeCode,
                ModelSeries=old.ModelSeries,
                PartName=old.PartName,
                label=old.label,
                file_status=FILE_STATUS_MISSING,
                last_seen_at=old.last_seen_at,
                extra=dict(old.extra),
            )
        )

    merged.sort(key=lambda e: (_norm_path_key(e.repo_rel_path), e.file_status or ""))
    stats = _compute_stats(merged, basename_map)
    scan_root_stored = prefs.get("scan_root") or "."

    doc = FcstdMapDocument(
        entries=merged,
        last_scan_at=now,
        scan_root=scan_root_stored,
        scan_stats=stats,
    )
    save_fcstd_document(rr, doc, scan_root=scan_root_stored, stats=stats)

    payload = load_fcstd_map_payload(rr)
    payload["scan_log"] = (
        f"扫描根: {format_resolved_under_workspace(scan, rr)}\n"
        f"数据库: {payload['database_path_display']}\n"
        f"本次: 存在 {stats['present']} · 缺失 {stats['missing']} · "
        f"FCStd {stats['fcstd_file_count']} · 重名种类 {stats['duplicate_filename_kinds']}"
    )
    return payload


def export_fcstd_map_to_json(repo_root: Path) -> dict[str, str]:
    rr = repo_root.expanduser().resolve(strict=False)
    out = export_fcstd_map_json(rr)
    return {
        "path": str(out),
        "path_display": format_resolved_under_workspace(out, rr),
    }
