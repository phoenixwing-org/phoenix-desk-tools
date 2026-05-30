"""SolidWorks → STEP 批量导出 API 层。"""

from __future__ import annotations

import sys
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
from fcdesk.solidworks.com import attach_solidworks, batch_export_models_to_step, windows_only
from fcdesk.solidworks.models import iter_sw_model_paths


def get_sw_step_prefs(repo_root: Path) -> dict[str, Any]:
    rr = repo_root.expanduser().resolve(strict=False)
    pv = load_workspace_prefs(rr).get("sw_step_export") or {}
    return {
        "source_dir": shorten_workspace_relative_display(
            format_stored_path_for_display(pv.get("source_dir"), rr) or ""
        ),
        "out_step_dir": shorten_workspace_relative_display(
            format_stored_path_for_display(pv.get("out_step_dir"), rr) or ""
        ),
        "recursive_scan": bool(pv.get("recursive_scan", False)),
        "com_available": windows_only(),
        "platform": sys.platform,
    }


def save_sw_step_prefs(repo_root: Path, patch: dict[str, Any]) -> dict[str, Any]:
    rr = repo_root.expanduser().resolve(strict=False)

    def store_path(text: str | None) -> str | None:
        if text is None:
            return None
        s = str(text).strip()
        if not s:
            return None
        p = resolve_workspace_path_entry(s, rr)
        return store_path_under_repo(p, rr)

    stored: dict[str, Any] = {}
    if "source_dir" in patch:
        stored["source_dir"] = store_path(patch.get("source_dir"))
    if "out_step_dir" in patch:
        stored["out_step_dir"] = store_path(patch.get("out_step_dir"))
    if "recursive_scan" in patch:
        stored["recursive_scan"] = bool(patch["recursive_scan"])
    merge_workspace_section("sw_step_export", stored, rr)
    return get_sw_step_prefs(rr)


def _resolve_dirs(repo_root: Path, prefs: dict[str, Any]) -> tuple[Path, Path]:
    rr = repo_root.expanduser().resolve(strict=False)
    src = resolve_workspace_path_entry(prefs.get("source_dir") or "", rr)
    dst = resolve_workspace_path_entry(prefs.get("out_step_dir") or "", rr)
    if not src.is_dir():
        raise ValueError(f"模型目录不存在: {format_resolved_under_workspace(src, rr)}")
    return src, dst


def preview_sw_step_export(repo_root: Path, opts: dict[str, Any] | None = None) -> dict[str, Any]:
    rr = repo_root.expanduser().resolve(strict=False)
    if opts:
        save_sw_step_prefs(rr, opts)
    prefs = get_sw_step_prefs(rr)
    src, _dst = _resolve_dirs(rr, prefs)
    n = len(iter_sw_model_paths(src, recursive=prefs["recursive_scan"]))
    return {
        "source_display": format_resolved_under_workspace(src, rr),
        "model_count": n,
        "prefs": prefs,
    }


def run_sw_step_export(repo_root: Path, opts: dict[str, Any] | None = None) -> dict[str, Any]:
    rr = repo_root.expanduser().resolve(strict=False)
    if opts:
        save_sw_step_prefs(rr, opts)
    prefs = get_sw_step_prefs(rr)

    if not windows_only():
        raise ValueError("批量导出 STEP 需要 Windows + SolidWorks + pywin32")

    try:
        import pythoncom  # noqa: F401
        import win32com.client  # noqa: F401
    except ImportError as e:
        raise ValueError("未检测到 pywin32，请 pip install pywin32") from e

    src, dst = _resolve_dirs(rr, prefs)
    paths = list(iter_sw_model_paths(src, recursive=prefs["recursive_scan"]))
    if not paths:
        raise ValueError("未发现 .sldprt / .sldasm")

    logs: list[str] = []

    def clog(m: str) -> None:
        logs.append(m)

    import pythoncom

    pythoncom.CoInitialize()
    try:
        sw_app = attach_solidworks()
        outcome = batch_export_models_to_step(
            sw_app,
            paths=paths,
            out_step_dir=dst,
            log=clog,
        )
    finally:
        try:
            pythoncom.CoUninitialize()
        except Exception:
            pass

    failed_preview = [
        {"path": str(fp), "error": err} for fp, err in outcome.failed[:50]
    ]
    return {
        "ok_count": len(outcome.ok),
        "failed_count": len(outcome.failed),
        "failed": failed_preview,
        "log": "\n".join(logs),
        "out_display": format_resolved_under_workspace(dst, rr),
        "prefs": prefs,
    }
