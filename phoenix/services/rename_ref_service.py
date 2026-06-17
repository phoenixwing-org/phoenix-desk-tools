"""文件改名 — 执行磁盘重命名与改名记录（分析见 ``rename_analysis_service``）。"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from phoenix.freecad.phoenix_store import insert_rename_log
from phoenix.services.bom_apply_service import (
    has_unsaved_document_attrs,
    load_bom_preview,
    rename_bom_fcstd_file,
)
from phoenix.services.rename_analysis_service import (
    analyze_rename_references,
    apply_rename_analysis_corrections,
    load_rename_analysis,
)

# 兼容旧 import 路径
scan_rename_references = analyze_rename_references
apply_rename_reference_patches = apply_rename_analysis_corrections
load_rename_scan_display = load_rename_analysis


def load_file_rename_context(repo_root: Path, rel: Path) -> dict[str, Any]:
    rr = repo_root.expanduser().resolve(strict=False)
    preview = load_bom_preview(rr, rel)
    return {
        "rel_path": rel.as_posix(),
        "preview": preview,
    }


def execute_file_rename(
    repo_root: Path,
    rel: Path,
    *,
    new_filename: str,
    baseline: dict[str, str],
    current: dict[str, str],
    write_attrs_first: bool = False,
) -> dict[str, Any]:
    rr = repo_root.expanduser().resolve(strict=False)
    old_rel = rel
    out = rename_bom_fcstd_file(
        rr,
        old_rel,
        new_filename,
        baseline=baseline,
        current=current,
        write_attrs_first=write_attrs_first,
    )
    new_rel = Path(str(out["rel_path"]))
    rename_log = insert_rename_log(rr, old_rel=old_rel, new_rel=new_rel, source="web")
    return {
        **out,
        "rename_log": rename_log,
        "rename_log_id": rename_log.get("id"),
    }


def preview_rename_unsaved(*, baseline: dict[str, str], current: dict[str, str]) -> dict[str, bool]:
    return {"has_unsaved_document_attrs": has_unsaved_document_attrs(baseline, current)}
