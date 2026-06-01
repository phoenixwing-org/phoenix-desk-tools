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
from fcdesk.freecad.fcstd_mapping import normalize_repo_rel_path_for_map
from fcdesk.freecad.phoenix_store import (
    cad_database_path,
    migrate_fcstd_map_json,
)

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


def _repo_rel_display(rr: Path, abs_path: str) -> str:
    if not abs_path.strip():
        return ""
    p = Path(abs_path).expanduser()
    try:
        rel = p.resolve(strict=False).relative_to(rr.resolve(strict=False))
        return normalize_repo_rel_path_for_map(rel.as_posix())
    except ValueError:
        return format_resolved_under_workspace(p, rr)


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
    return _run_xlink_script(
        rr,
        batch_dir_input=batch_dir_input,
        dry_run=effective_dry,
        all_in_dir=all_in_dir if all_in_dir is not None else bool(prefs["all_in_dir"]),
        save_prefs_patch=None,
    )
