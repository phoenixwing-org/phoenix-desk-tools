"""XLink 路径修正 API 层。"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
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
from fcdesk.freecad.fcstd_mapping import (
    FILE_STATUS_PRESENT,
    infer_part_key_from_filename,
    normalize_repo_rel_path_for_map,
)
from fcdesk.freecad.phoenix_store import (
    cad_database_path,
    connect,
    format_part_key,
    get_part_key_detail,
    migrate_fcstd_map_json,
)
from fcdesk.freecad.rename_analysis.types import RenameAnalysisError
from fcdesk.freecad.rename_analysis.xlink import (
    patch_fcstd_xlink_attrs,
    preferred_xlink_attr_for_target,
)
from fcdesk.services.cad_index import refresh_bom_xrefs_for_hosts

_SCRIPTS_DIR = Path(__file__).resolve().parents[2] / "scripts"


def get_xlink_prefs(repo_root: Path) -> dict[str, Any]:
    rr = repo_root.expanduser().resolve(strict=False)
    pv = load_workspace_prefs(rr).get("fc_linkfix") or {}
    disp = shorten_workspace_relative_display(
        format_stored_path_for_display(pv.get("freecad_batch_dir"), rr) or "."
    )
    return {
        "batch_dir": disp,
        "dry_run": bool(pv.get("dry_run", True)),
        "all_in_dir": bool(pv.get("all_in_dir", True)),
    }


def save_xlink_prefs(repo_root: Path, patch: dict[str, Any]) -> dict[str, Any]:
    rr = repo_root.expanduser().resolve(strict=False)
    stored: dict[str, Any] = {}
    if "dry_run" in patch:
        stored["dry_run"] = bool(patch["dry_run"])
    if "all_in_dir" in patch:
        stored["all_in_dir"] = bool(patch["all_in_dir"])
    if "batch_dir" in patch:
        s = str(patch["batch_dir"] or "").strip()
        if not s or s == ".":
            stored["freecad_batch_dir"] = None
        else:
            p = resolve_workspace_path_entry(s, rr)
            stored["freecad_batch_dir"] = (
                None if p.resolve(strict=False) == rr.resolve(strict=False) else store_path_under_repo(p, rr)
            )
    stored["cad_search_root"] = None
    merge_workspace_section("fc_linkfix", stored, rr)
    return get_xlink_prefs(rr)


def _resolve_batch_dir(repo_root: Path, batch_dir_input: str | None) -> Path:
    rr = repo_root.expanduser().resolve(strict=False)
    if batch_dir_input is not None:
        s = batch_dir_input.strip()
        if not s or s == ".":
            return rr
        return resolve_workspace_path_entry(s, rr)
    pv = load_workspace_prefs(rr).get("fc_linkfix") or {}
    stored = pv.get("freecad_batch_dir")
    if stored:
        return resolve_workspace_path_entry(
            format_stored_path_for_display(stored, rr) or ".",
            rr,
        )
    return rr


def _run_xlink_script(
    rr: Path,
    *,
    batch_dir_input: str | None = None,
    dry_run: bool,
    all_in_dir: bool | None = None,
    save_prefs_patch: dict[str, Any] | None = None,
) -> dict[str, Any]:
    if save_prefs_patch:
        save_xlink_prefs(rr, save_prefs_patch)

    prefs = get_xlink_prefs(rr)
    prefs = {**prefs, "dry_run": bool(dry_run)}
    if all_in_dir is not None:
        prefs = {**prefs, "all_in_dir": all_in_dir}

    batch_dir = _resolve_batch_dir(rr, batch_dir_input)
    if not batch_dir.is_dir():
        raise ValueError(f"修正目录不存在: {format_resolved_under_workspace(batch_dir, rr)}")

    migrate_fcstd_map_json(rr)
    if not cad_database_path(rr).is_file():
        raise ValueError("请先在「CAD 索引」页执行工程内搜索")

    cmd = [
        sys.executable,
        str(_SCRIPTS_DIR / "fix_fcstd_xlink_paths.py"),
        "--map-anchor",
        str(rr),
        "--map-sqlite",
        str(rr),
    ]
    if prefs["dry_run"]:
        cmd.append("--dry-run")
    if prefs["all_in_dir"]:
        cmd += ["--all-in-dir", str(batch_dir)]
    else:
        doc_xml = batch_dir / "Document.xml"
        if not doc_xml.is_file():
            raise ValueError("未找到 Document.xml（请勾选扫描目录内全部 FCStd 或选择含 Document.xml 的目录）")
        cmd.append(str(doc_xml))

    fd_tmp, json_out = tempfile.mkstemp(prefix="fcdesk_xlink_", suffix=".json")
    os.close(fd_tmp)
    cmd += ["--desktop-json-results", json_out]
    cmd.append("--no-report")

    proc = subprocess.run(
        cmd,
        cwd=str(_SCRIPTS_DIR),
        capture_output=True,
        text=True,
        encoding="utf-8",
    )
    captured = (proc.stdout or "") + (proc.stderr or "")

    data: dict[str, Any] | None = None
    jp = Path(json_out)
    try:
        if jp.is_file():
            data = json.loads(jp.read_text(encoding="utf-8"))
    finally:
        jp.unlink(missing_ok=True)

    out: dict[str, Any] = {
        "exit_code": proc.returncode,
        "log": captured,
        "prefs": prefs,
        "batch_dir_display": format_resolved_under_workspace(batch_dir, rr),
        "map_path_display": format_resolved_under_workspace(cad_database_path(rr), rr),
    }
    if isinstance(data, dict) and data.get("schema") == 1:
        out.update(data)
    return _enrich_xlink_result(rr, out)


def part_hints_from_xlink_old_path(old_path: str) -> dict[str, str]:
    """从 XLink ``file`` 属性值推断 Part Key（与 CAD 索引文件名规则一致）。"""
    basename = Path(old_path.replace("\\", "/")).name
    pn, pv = infer_part_key_from_filename(basename)
    return {
        "basename": basename,
        "part_number": pn,
        "part_version": pv,
        "part_key": format_part_key(pn, pv) if pn and pv else "",
    }


def _fcstd_file_candidate_row(rr: Path, row: Any) -> dict[str, Any]:
    rel = normalize_repo_rel_path_for_map(str(row["repo_rel_path"]))
    return {
        "id": int(row["id"]),
        "repo_rel_path": rel,
        "filename": str(row["filename"] or ""),
        "part_number": str(row["part_number"] or ""),
        "part_version": str(row["part_version"] or ""),
        "part_key": format_part_key(str(row["part_number"] or ""), str(row["part_version"] or ""))
        if row["part_number"] and row["part_version"]
        else "",
        "file_status": str(row["file_status"] or FILE_STATUS_PRESENT),
    }


def _list_present_fcstd_by_basename(rr: Path, basename: str) -> list[dict[str, Any]]:
    """索引中按文件名 / 主干前缀匹配 present 的 FCStd（Part Key 推断失败时的回退）。"""
    name = Path(basename.replace("\\", "/")).name
    if not name:
        return []
    from fcdesk.freecad.fcstd_mapping import normalize_fcstd_filename_stem

    stem = normalize_fcstd_filename_stem(name)
    like_prefix = f"{stem}%"
    with connect(rr) as conn:
        rows = conn.execute(
            """
            SELECT id, repo_rel_path, filename, part_number, part_version, file_status
            FROM file_asset
            WHERE file_status = ?
              AND lower(filename) LIKE '%.fcstd'
              AND (
                lower(filename) = lower(?)
                OR lower(filename) LIKE lower(?)
              )
            ORDER BY filename, repo_rel_path
            LIMIT 40
            """,
            (FILE_STATUS_PRESENT, name, like_prefix),
        ).fetchall()
    return [_fcstd_file_candidate_row(rr, r) for r in rows]


def list_xlink_fix_candidates(
    repo_root: Path,
    *,
    basename: str,
    part_number: str | None = None,
    part_version: str | None = None,
) -> dict[str, Any]:
    """未找到 XLink 的手选候选：优先 Part Key 关联 FCStd，否则按文件名查索引。"""
    rr = repo_root.expanduser().resolve(strict=False)
    migrate_fcstd_map_json(rr)
    base = Path(basename.replace("\\", "/")).name

    pn = (part_number or "").strip()
    pv = (part_version or "").strip()
    if not pn or not pv:
        pn, pv = infer_part_key_from_filename(base)

    part_key = format_part_key(pn, pv) if pn and pv else ""
    files: list[dict[str, Any]] = []
    seen: set[str] = set()

    def add_unique(items: list[dict[str, Any]]) -> None:
        for item in items:
            rel = item["repo_rel_path"]
            if rel in seen:
                continue
            seen.add(rel)
            files.append(item)

    if pn and pv:
        detail = get_part_key_detail(rr, pn, pv)
        if detail:
            for f in detail.get("files") or []:
                if str(f.get("file_status") or "") != FILE_STATUS_PRESENT:
                    continue
                fn = str(f.get("filename") or "")
                if not fn.lower().endswith(".fcstd"):
                    continue
                add_unique(
                    [
                        {
                            "id": int(f["id"]),
                            "repo_rel_path": normalize_repo_rel_path_for_map(str(f["repo_rel_path"])),
                            "filename": fn,
                            "part_number": str(f.get("PartNumber") or pn),
                            "part_version": str(f.get("PartVersion") or pv),
                            "part_key": part_key,
                            "file_status": FILE_STATUS_PRESENT,
                        }
                    ]
                )

    if base:
        add_unique(_list_present_fcstd_by_basename(rr, base))

    return {
        "basename": base,
        "part_number": pn,
        "part_version": pv,
        "part_key": part_key,
        "files": files,
    }


def _repo_rel_display(rr: Path, abs_path: str) -> str:
    if not abs_path.strip():
        return ""
    p = Path(abs_path).expanduser()
    try:
        rel = p.resolve(strict=False).relative_to(rr.resolve(strict=False))
        return normalize_repo_rel_path_for_map(rel.as_posix())
    except ValueError:
        return format_resolved_under_workspace(p, rr)


def _hosts_with_xlink_disk_changes(rr: Path, raw: dict[str, Any]) -> list[str]:
    hosts: set[str] = set()
    for fi in raw.get("files") or []:
        if int(fi.get("changes") or 0) < 1:
            continue
        rel = _repo_rel_display(rr, str(fi.get("path") or ""))
        if rel:
            hosts.add(rel)
    return sorted(hosts)


def _enrich_xlink_result(rr: Path, raw: dict[str, Any]) -> dict[str, Any]:
    issue_rows: list[dict[str, Any]] = []
    fixable = 0
    not_found = 0
    hosts_with_issues: set[str] = set()

    for fi in raw.get("files") or []:
        host_abs = str(fi.get("path") or "")
        host_rel = _repo_rel_display(rr, host_abs)
        host_name = Path(host_abs).name if host_abs else ""
        for rec in fi.get("records") or []:
            verdict = str(rec.get("verdict") or "")
            old_path = str(rec.get("old_path") or "")
            new_path = str(rec.get("new_path") or "")
            if not old_path:
                continue
            is_not_found = verdict == "未找到"
            is_fixable = bool(new_path) and new_path != old_path
            if not is_not_found and not is_fixable:
                continue
            if is_not_found:
                not_found += int(rec.get("count") or 1)
            if is_fixable:
                fixable += int(rec.get("count") or 1)
            hosts_with_issues.add(host_rel or host_abs)
            hints = part_hints_from_xlink_old_path(old_path)
            issue_rows.append(
                {
                    "host_repo_rel": host_rel,
                    "host_filename": host_name,
                    "host_display": host_rel or host_name,
                    "old_path": old_path,
                    "new_path": new_path,
                    "target_file": str(rec.get("target_file") or ""),
                    "target_display": _repo_rel_display(rr, str(rec.get("target_file") or "")),
                    "verdict": verdict,
                    "note": str(rec.get("note") or ""),
                    "count": int(rec.get("count") or 1),
                    "status": "not_found" if is_not_found and not is_fixable else "fixable",
                    "basename": hints["basename"],
                    "part_number": hints["part_number"],
                    "part_version": hints["part_version"],
                    "part_key": hints["part_key"],
                }
            )

    raw["issue_rows"] = issue_rows
    raw["stats"] = {
        "host_count": len(raw.get("files") or []),
        "hosts_with_issues": len(hosts_with_issues),
        "issue_count": len(issue_rows),
        "fixable_count": fixable,
        "not_found_count": not_found,
        "skipped_count": len(raw.get("skipped") or []),
        "total_changes": int(raw.get("total_changes") or 0),
    }
    return raw


def analyze_xlink_fix(
    repo_root: Path,
    *,
    batch_dir_input: str | None = None,
    all_in_dir: bool | None = None,
) -> dict[str, Any]:
    """dry-run 扫描：列出失效/可修正 XLink，不写盘。"""
    rr = repo_root.expanduser().resolve(strict=False)
    patch: dict[str, Any] = {"dry_run": True}
    if batch_dir_input is not None:
        patch["batch_dir"] = batch_dir_input
    if all_in_dir is not None:
        patch["all_in_dir"] = all_in_dir
    return _run_xlink_script(rr, batch_dir_input=batch_dir_input, dry_run=True, all_in_dir=all_in_dir, save_prefs_patch=patch)


def apply_xlink_fix_override(
    repo_root: Path,
    *,
    host_repo_rel: str,
    old_path: str,
    target_repo_rel: str,
) -> dict[str, Any]:
    """手选目标：将宿主 FCStd 内一条 XLink ``file`` 写回为可解析路径。"""
    rr = repo_root.expanduser().resolve(strict=False)
    host_rel = normalize_repo_rel_path_for_map(host_repo_rel.strip().replace("\\", "/"))
    if not host_rel:
        raise ValueError("缺少宿主路径")
    target_rel = normalize_repo_rel_path_for_map(target_repo_rel.strip().replace("\\", "/"))
    if not target_rel:
        raise ValueError("缺少目标路径")

    host_path = (rr / host_rel).resolve(strict=False)
    if not host_path.is_file():
        raise ValueError(f"宿主文件不存在: {format_resolved_under_workspace(host_path, rr)}")
    if host_path.suffix.lower() != ".fcstd":
        raise ValueError("宿主须为 .FCStd 文件")

    target_path = (rr / target_rel).resolve(strict=False)
    if not target_path.is_file():
        raise ValueError(f"目标文件不存在: {format_resolved_under_workspace(target_path, rr)}")

    old_attr = old_path.strip()
    if not old_attr:
        raise ValueError("缺少原 XLink 路径")

    new_attr = preferred_xlink_attr_for_target(rr, host_rel, target_rel)
    if new_attr == old_attr:
        return {
            "patches": 0,
            "new_path": new_attr,
            "host_repo_rel": host_rel,
            "target_repo_rel": target_rel,
            "target_display": _repo_rel_display(rr, str(target_path)),
            "unchanged": True,
        }

    try:
        patches = patch_fcstd_xlink_attrs(host_path, {old_attr: new_attr})
    except RenameAnalysisError as e:
        raise ValueError(str(e)) from e

    if patches < 1:
        raise ValueError(f"宿主内未匹配到 XLink file=\"{old_attr}\"，请重新分析")

    xref_refresh = refresh_bom_xrefs_for_hosts(rr, [host_rel])

    return {
        "patches": patches,
        "new_path": new_attr,
        "host_repo_rel": host_rel,
        "old_path": old_attr,
        "target_repo_rel": target_rel,
        "target_display": _repo_rel_display(rr, str(target_path)),
        "unchanged": False,
        "bom_xref_refresh": xref_refresh,
    }


def run_xlink_fix(
    repo_root: Path,
    *,
    batch_dir_input: str | None = None,
    dry_run: bool | None = None,
    all_in_dir: bool | None = None,
) -> dict[str, Any]:
    rr = repo_root.expanduser().resolve(strict=False)
    patch: dict[str, Any] = {}
    if batch_dir_input is not None:
        patch["batch_dir"] = batch_dir_input
    if dry_run is not None:
        patch["dry_run"] = dry_run
    if all_in_dir is not None:
        patch["all_in_dir"] = all_in_dir
    if patch:
        save_xlink_prefs(rr, patch)
    prefs = get_xlink_prefs(rr)
    effective_dry = bool(prefs["dry_run"]) if dry_run is None else bool(dry_run)
    result = _run_xlink_script(
        rr,
        batch_dir_input=batch_dir_input,
        dry_run=effective_dry,
        all_in_dir=all_in_dir if all_in_dir is not None else bool(prefs["all_in_dir"]),
        save_prefs_patch=None,
    )
    if not effective_dry:
        touched = _hosts_with_xlink_disk_changes(rr, result)
        if touched:
            result["bom_xref_refresh"] = refresh_bom_xrefs_for_hosts(rr, touched)
    return result
