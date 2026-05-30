"""编号查重扫描（无 UI，桌面 / Web 共用）。"""

from __future__ import annotations

from collections import defaultdict
from pathlib import Path
from typing import Any

_FCSTD_DUP_TAG_DRAWING = "::fcd_draw"
_FCSTD_DUP_TAG_MODEL = "::fcd_model"


def freecad_fcstd_dup_tag(filename: str) -> str:
    n = Path(filename).name.casefold()
    if not n.endswith(".fcstd"):
        return ""
    if n.endswith(".drawing.fcstd"):
        return _FCSTD_DUP_TAG_DRAWING
    return _FCSTD_DUP_TAG_MODEL


def split_fcstd_group_key(full: str) -> tuple[str, str]:
    if full.endswith(_FCSTD_DUP_TAG_DRAWING):
        return full[: -len(_FCSTD_DUP_TAG_DRAWING)], _FCSTD_DUP_TAG_DRAWING
    if full.endswith(_FCSTD_DUP_TAG_MODEL):
        return full[: -len(_FCSTD_DUP_TAG_MODEL)], _FCSTD_DUP_TAG_MODEL
    return full, ""


def fcstd_dup_csv_suffix(tag: str) -> str:
    if tag == _FCSTD_DUP_TAG_DRAWING:
        return "|图纸.DrawingFCStd"
    if tag == _FCSTD_DUP_TAG_MODEL:
        return "|构件.FCStd"
    return ""


def parse_part_filename(
    name: str,
    *,
    code_len: int,
    ver_len: int,
    check_version: bool,
    code_must_be_digit: bool,
) -> tuple[str | None, str | None]:
    stem = Path(name).stem
    if len(stem) < code_len:
        return None, None
    code = stem[:code_len]
    if code_must_be_digit and not code.isdigit():
        return None, None
    if check_version and len(stem) >= code_len + 1 + ver_len:
        ver = stem[code_len + 1 : code_len + 1 + ver_len]
        return code, ver
    return code, None


def run_part_dedup_scan(
    scan_path: Path,
    *,
    extension: str,
    code_len: int = 6,
    ver_len: int = 3,
    check_code: bool = True,
    check_version: bool = True,
    code_must_be_digit: bool = True,
) -> dict[str, Any]:
    raw_ext = (extension or "").strip()
    if not raw_ext.startswith("."):
        raw_ext = "." + raw_ext.lstrip(".")
    ext_cf = raw_ext.casefold()

    files: list[Path] = []
    for fp in scan_path.rglob("*"):
        try:
            if fp.is_file() and fp.suffix.casefold() == ext_cf:
                files.append(fp)
        except OSError:
            continue
    files.sort(key=lambda p: str(p.resolve()))

    name_groups: dict[str, list[Path]] = defaultdict(list)
    code_groups: dict[str, list[Path]] = defaultdict(list)
    ver_groups: dict[str, list[Path]] = defaultdict(list)

    for fp in files:
        name_groups[fp.name].append(fp)
        fcstd_tag = freecad_fcstd_dup_tag(fp.name) if ext_cf == ".fcstd" else ""
        if check_code:
            code, ver = parse_part_filename(
                fp.name,
                code_len=code_len,
                ver_len=ver_len,
                check_version=check_version,
                code_must_be_digit=code_must_be_digit,
            )
            if code:
                if not ver:
                    code_groups[f"{code}{fcstd_tag}"].append(fp)
                if ver and check_version:
                    ver_groups[f"{code}_{ver}{fcstd_tag}"].append(fp)

    results: dict[str, list[dict[str, Any]]] = {
        "name_dup": [],
        "code_dup": [],
        "ver_dup": [],
    }

    for name, paths in sorted(name_groups.items()):
        if len(paths) > 1:
            results["name_dup"].append({"label": name, "paths": [str(p) for p in paths]})

    if check_code:
        for grp_key, paths in sorted(code_groups.items()):
            if len(paths) > 1:
                base, suf = split_fcstd_group_key(grp_key)
                csv_suf = fcstd_dup_csv_suffix(suf)
                results["code_dup"].append(
                    {"label": f"{base}{csv_suf}", "paths": [str(p) for p in paths]}
                )

    if check_code and check_version:
        for ver_key, paths in sorted(ver_groups.items()):
            if len(paths) > 1:
                stripped, suf = split_fcstd_group_key(ver_key)
                parts_g = stripped.split("_", 1)
                cod = parts_g[0]
                ver_part = parts_g[1] if len(parts_g) > 1 else ""
                csv_suf = fcstd_dup_csv_suffix(suf)
                results["ver_dup"].append(
                    {
                        "label": f"{cod}_{ver_part}",
                        "code": cod,
                        "version": ver_part,
                        "csv_fc": csv_suf,
                        "paths": [str(p) for p in paths],
                    }
                )

    return {
        "file_count": len(files),
        "extension": raw_ext,
        "results": results,
        "stats": {
            "name_dup": len(results["name_dup"]),
            "code_dup": len(results["code_dup"]),
            "ver_dup": len(results["ver_dup"]),
        },
    }
