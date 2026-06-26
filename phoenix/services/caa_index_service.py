"""CAA 对话框轻量索引服务。"""

from __future__ import annotations

from pathlib import Path

from phoenix.caa.store import (
    load_caa_dialog_groups,
    save_caa_index,
    scan_caa_dialog_files,
)


def run_caa_index_scan(repo_root: Path) -> dict:
    records = scan_caa_dialog_files(repo_root)
    meta = save_caa_index(repo_root, records, scan_root=str(repo_root))
    payload = load_caa_index_groups(repo_root)
    coverage = (meta.get("stats") or {}).get("control_type_coverage") or {}
    unknown_types = int(coverage.get("unknown_types") or 0)
    total_types = int(coverage.get("total_types") or 0)
    coverage_note = f" · 类型 {total_types} 种"
    if unknown_types:
        coverage_note += f" · 未登记 {unknown_types} 种"
    payload.update(
        {
            "scan_id": meta["scan_id"],
            "last_scan_at": meta["scanned_at"],
            "stats": meta["stats"],
            "summary": f"[CAA 对话框] 已索引 {len(records)} 个 .CATDlg{coverage_note}",
        }
    )
    return payload


def load_caa_index_groups(repo_root: Path, q: str | None = None) -> dict:
    return load_caa_dialog_groups(repo_root, q=q)
