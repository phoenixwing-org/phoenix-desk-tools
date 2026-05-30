"""STEP 批量转换 API 层。"""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path
from typing import Any

from fcdesk.freecad.batch_step.job import StepBatchJob
from fcdesk.freecad.batch_step.step_paths import list_step_paths_for_batch, step_tree_stats
from fcdesk.config.user_prefs import (
    format_resolved_under_workspace,
    format_stored_path_for_display,
    load_launcher_prefs,
    load_workspace_prefs,
    merge_workspace_section,
    resolve_workspace_path_entry,
    shorten_workspace_relative_display,
    store_path_under_repo,
)
from fcdesk.freecad.freecad_exec import resolve_freecad_cmd

_SCRIPTS_DIR = Path(__file__).resolve().parents[2] / "scripts"
_RUNNER = _SCRIPTS_DIR / "freecad_batch_step_runner.py"


def get_step_batch_prefs(repo_root: Path) -> dict[str, Any]:
    rr = repo_root.expanduser().resolve(strict=False)
    pv = load_workspace_prefs(rr).get("step_batch") or {}
    return {
        "step_dir": shorten_workspace_relative_display(
            format_stored_path_for_display(pv.get("step_dir"), rr) or ""
        ),
        "out_dir": shorten_workspace_relative_display(
            format_stored_path_for_display(pv.get("out_dir"), rr) or ""
        ),
        "skip_existing": bool(pv.get("skip_existing", True)),
        "view_fit": str(pv.get("view_fit") or "none"),
        "use_inbox_bridge": bool(pv.get("use_inbox_bridge", False)),
        "step_recursive": bool(pv.get("step_recursive", False)),
    }


def save_step_batch_prefs(repo_root: Path, patch: dict[str, Any]) -> dict[str, Any]:
    rr = repo_root.expanduser().resolve(strict=False)

    def store_path(text: str | None) -> str | None:
        if text is None:
            return None
        s = str(text).strip()
        if not s or s == ".":
            return None
        p = resolve_workspace_path_entry(s, rr)
        return None if p.resolve(strict=False) == rr.resolve(strict=False) else store_path_under_repo(p, rr)

    stored: dict[str, Any] = {"project_relative": None}
    if "step_dir" in patch:
        stored["step_dir"] = store_path(patch.get("step_dir"))
    if "out_dir" in patch:
        stored["out_dir"] = store_path(patch.get("out_dir"))
    for k in ("skip_existing", "use_inbox_bridge", "step_recursive"):
        if k in patch:
            stored[k] = bool(patch[k])
    if "view_fit" in patch:
        vf = str(patch["view_fit"])
        stored["view_fit"] = vf if vf in ("none", "last", "all") else "none"
    merge_workspace_section("step_batch", stored, rr)
    return get_step_batch_prefs(rr)


def _vf_flags(view_fit: str) -> tuple[bool, bool]:
    if view_fit == "all":
        return False, True
    if view_fit == "last":
        return True, False
    return False, False


def _build_job(repo_root: Path, prefs: dict[str, Any]) -> StepBatchJob:
    rr = repo_root.expanduser().resolve(strict=False)
    step_s = prefs.get("step_dir") or ""
    out_s = prefs.get("out_dir") or ""
    if not step_s.strip() or not out_s.strip():
        raise ValueError("请填写 STEP 目录与 FCStd 输出目录")
    step_dir = resolve_workspace_path_entry(step_s, rr)
    out_dir = resolve_workspace_path_entry(out_s, rr)
    if not step_dir.is_dir():
        raise ValueError(f"STEP 目录不存在: {format_resolved_under_workspace(step_dir, rr)}")
    vf_last, vf_all = _vf_flags(prefs.get("view_fit", "none"))
    return StepBatchJob(
        step_dir=step_dir,
        out_dir=out_dir,
        skip_existing=bool(prefs.get("skip_existing", True)),
        view_fit_last=vf_last,
        view_fit_all=vf_all,
        step_recursive=bool(prefs.get("step_recursive", False)),
    )


def preview_step_batch(repo_root: Path, opts: dict[str, Any] | None = None) -> dict[str, Any]:
    rr = repo_root.expanduser().resolve(strict=False)
    if opts:
        save_step_batch_prefs(rr, opts)
    prefs = get_step_batch_prefs(rr)
    step_s = prefs.get("step_dir") or ""
    if not step_s.strip():
        raise ValueError("请先填写 STEP 目录")
    step_dir = resolve_workspace_path_entry(step_s, rr)
    rec = prefs["step_recursive"]
    top, deep = step_tree_stats(step_dir)
    count = len(list_step_paths_for_batch(step_dir, recursive=rec))
    return {
        "step_dir_display": format_resolved_under_workspace(step_dir, rr),
        "top_level": top,
        "deep_total": deep,
        "batch_count": count,
        "recursive": rec,
        "prefs": prefs,
    }


def run_step_batch(repo_root: Path, opts: dict[str, Any] | None = None) -> dict[str, Any]:
    rr = repo_root.expanduser().resolve(strict=False)
    if opts:
        save_step_batch_prefs(rr, opts)
    prefs = get_step_batch_prefs(rr)

    if prefs.get("use_inbox_bridge"):
        raise ValueError("Web 暂不支持 FreeCAD 收件箱桥接，请取消勾选后使用 freecadcmd")

    job = _build_job(rr, prefs)
    fd = load_launcher_prefs().get("freecad_dir")
    fc_home = Path(str(fd)).expanduser() if fd else None
    cmd_exe = resolve_freecad_cmd(fc_home)
    if not cmd_exe:
        raise ValueError("未找到 freecadcmd；请在「配置」页设置 FreeCAD 目录")

    if not _RUNNER.is_file():
        raise ValueError(f"缺少运行脚本: {_RUNNER}")

    cmd = [str(cmd_exe), str(_RUNNER)]
    inner_env = job.subprocess_env()
    merged = {**os.environ, **inner_env}

    proc = subprocess.run(
        cmd,
        cwd=str(rr),
        env=merged,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    text = "\n".join(p for p in [(proc.stdout or ""), (proc.stderr or "")] if p).strip()
    return {
        "exit_code": proc.returncode,
        "log": text or "(无控制台输出)；请查看输出目录 Markdown 报告。",
        "out_dir_display": format_resolved_under_workspace(job.out_dir, rr),
        "prefs": prefs,
    }
