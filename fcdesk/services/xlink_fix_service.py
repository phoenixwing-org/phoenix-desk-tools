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
    pv = load_workspace_prefs(rr).get("fc_linkfix") or {}
    batch_dir = _resolve_batch_dir(rr, None)
    if not batch_dir.is_dir():
        raise ValueError(f"修正目录不存在: {format_resolved_under_workspace(batch_dir, rr)}")

    migrate_fcstd_map_json(rr)
    if not cad_database_path(rr).is_file():
        raise ValueError("请先在「FCStd 索引」页执行工程内搜索")

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
            raise ValueError("未找到 Document.xml（请勾选 all-in-dir 或选择含 Document.xml 的目录）")
        cmd.append(str(doc_xml))

    fd_tmp, json_out = tempfile.mkstemp(prefix="fcdesk_xlink_", suffix=".json")
    os.close(fd_tmp)
    cmd += ["--desktop-json-results", json_out]

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
    return out
