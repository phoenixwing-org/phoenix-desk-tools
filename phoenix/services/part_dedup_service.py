"""编号查重 API 层。"""

from __future__ import annotations

import csv
from pathlib import Path
from typing import Any

from phoenix.config.user_prefs import (
    format_resolved_under_workspace,
    format_stored_path_for_display,
    load_workspace_prefs,
    merge_workspace_section,
    resolve_workspace_path_entry,
    shorten_workspace_relative_display,
    store_path_under_repo,
)
from phoenix.part_dedup_scan import run_part_dedup_scan

_DEFAULT_EXT = ".SLDPRT"
_EXT_OPTIONS = (".FCStd", ".SLDPRT", ".SLDASM", ".SLDDRW", ".step", ".stp")


def _coerce_ext(stored: str | None) -> str:
    raw = (stored or "").strip() or _DEFAULT_EXT
    if raw[0] != ".":
        raw = "." + raw
    rk = raw.casefold()
    for opt in _EXT_OPTIONS:
        if opt.casefold() == rk:
            return opt
    return raw


def get_part_dedup_prefs(repo_root: Path) -> dict[str, Any]:
    rr = repo_root.expanduser().resolve(strict=False)
    pv = load_workspace_prefs(rr).get("part_dedup") or {}
    scan_disp = shorten_workspace_relative_display(
        format_stored_path_for_display(pv.get("scan_dir"), rr) or "."
    )
    return {
        "extension": _coerce_ext(pv.get("extension")),
        "code_len": int(pv.get("code_len", 6)),
        "ver_len": int(pv.get("ver_len", 3)),
        "check_code": bool(pv.get("check_code", True)),
        "check_version": bool(pv.get("check_version", True)),
        "code_must_be_digit": bool(pv.get("code_must_be_digit", True)),
        "scan_dir": scan_disp,
    }


def save_part_dedup_prefs(repo_root: Path, patch: dict[str, Any]) -> dict[str, Any]:
    rr = repo_root.expanduser().resolve(strict=False)
    stored: dict[str, Any] = {}
    if "extension" in patch:
        stored["extension"] = str(patch["extension"])
    for k in ("code_len", "ver_len"):
        if k in patch:
            stored[k] = int(patch[k])
    for k in ("check_code", "check_version", "code_must_be_digit"):
        if k in patch:
            stored[k] = bool(patch[k])
    if "scan_dir" in patch:
        s = str(patch["scan_dir"] or "").strip()
        if not s or s == ".":
            stored["scan_dir"] = None
        else:
            p = resolve_workspace_path_entry(s, rr)
            stored["scan_dir"] = (
                None if p.resolve(strict=False) == rr.resolve(strict=False) else store_path_under_repo(p, rr)
            )
    merge_workspace_section("part_dedup", stored, rr)
    return get_part_dedup_prefs(rr)


def _display_paths(repo_root: Path, paths: list[str]) -> list[str]:
    rr = repo_root.expanduser().resolve(strict=False)
    out: list[str] = []
    for ps in paths:
        try:
            out.append(format_resolved_under_workspace(Path(ps).expanduser(), rr))
        except OSError:
            out.append(ps)
    return out


def scan_part_dedup(repo_root: Path, opts: dict[str, Any] | None = None) -> dict[str, Any]:
    rr = repo_root.expanduser().resolve(strict=False)
    if opts:
        save_part_dedup_prefs(rr, opts)
    prefs = get_part_dedup_prefs(rr)
    ws = load_workspace_prefs(rr).get("part_dedup") or {}
    scan = resolve_workspace_path_entry(prefs["scan_dir"], rr)
    if not scan.is_dir():
        raise ValueError(f"扫描目录不是有效文件夹: {format_resolved_under_workspace(scan, rr)}")

    raw = run_part_dedup_scan(
        scan,
        extension=prefs["extension"],
        code_len=prefs["code_len"],
        ver_len=prefs["ver_len"],
        check_code=prefs["check_code"],
        check_version=prefs["check_version"],
        code_must_be_digit=prefs["code_must_be_digit"],
    )

    for key in ("name_dup", "code_dup", "ver_dup"):
        for group in raw["results"][key]:
            group["paths_display"] = _display_paths(rr, group["paths"])

    scan_disp = format_resolved_under_workspace(scan, rr)
    total = raw["stats"]["name_dup"] + raw["stats"]["code_dup"] + raw["stats"]["ver_dup"]
    raw["scan_display"] = scan_disp
    raw["prefs"] = prefs
    raw["summary"] = (
        f"扫描 {scan_disp} · {raw['file_count']} 个 {prefs['extension']} · "
        f"重复组 {total}（文件名 {raw['stats']['name_dup']} · "
        f"编号 {raw['stats']['code_dup']} · 编号+版本 {raw['stats']['ver_dup']}）"
    )
    return raw


def export_part_dedup_csv(repo_root: Path, results: dict[str, Any]) -> dict[str, str]:
    rr = repo_root.expanduser().resolve(strict=False)
    csv_path = rr / "重复文件检查报告.csv"
    res = results.get("results") or results
    with csv_path.open("w", newline="", encoding="utf-8-sig") as f:
        writer = csv.writer(f)
        writer.writerow(["类型", "标识", "文件路径"])
        for item in res.get("name_dup", []):
            for path in item["paths"]:
                writer.writerow(["文件名重复", item.get("label", ""), path])
        for item in res.get("code_dup", []):
            for path in item["paths"]:
                writer.writerow(["编号重复", item.get("label", ""), path])
        for item in res.get("ver_dup", []):
            tag = item.get("csv_fc") or ""
            for path in item["paths"]:
                writer.writerow(
                    ["编号+版本重复", f"{item.get('code', '')}_{item.get('version', '')}{tag}", path]
                )
    return {
        "path": str(csv_path),
        "path_display": format_resolved_under_workspace(csv_path, rr),
    }
