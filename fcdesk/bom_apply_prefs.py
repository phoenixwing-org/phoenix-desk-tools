"""属性回写页：零件号 / 版本 / 类型 / 型号等字段的默认值与上次填写记忆（工作空间级）。"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any

from fcdesk.config.user_prefs import load_workspace_prefs, merge_workspace_section

DEFAULT_PART_VERSION = "001"
DEFAULT_TYPE_CODE = "H"

_PART_NUMBER_LEADING_DIGITS = re.compile(r"^(\d+)(.*)$")

_PREF_KEYS = (
    "last_part_number",
    "last_part_version",
    "last_type_code",
    "last_model_series",
)


def default_bom_apply_prefs() -> dict[str, str]:
    return {
        "last_part_number": "",
        "last_part_version": DEFAULT_PART_VERSION,
        "last_type_code": DEFAULT_TYPE_CODE,
        "last_model_series": "",
    }


def load_bom_apply_field_defaults(repo_root: Path) -> dict[str, str]:
    """从 ``.phoenix-freecad-desktop.json`` 的 ``bom_apply`` 小节读取。"""
    out = default_bom_apply_prefs()
    raw = load_workspace_prefs(repo_root).get("bom_apply")
    if not isinstance(raw, dict):
        return out
    for key in _PREF_KEYS:
        val = raw.get(key)
        if val is not None and str(val).strip():
            out[key] = str(val).strip()
    if not out["last_part_version"]:
        out["last_part_version"] = DEFAULT_PART_VERSION
    if not out["last_type_code"]:
        out["last_type_code"] = DEFAULT_TYPE_CODE
    return out


def next_part_number_after(last: str) -> str:
    """在上次零件号基础上 +1； leading 数字段保留至少原宽度（如 ``100001`` → ``100002``）。"""
    s = (last or "").strip()
    if not s:
        return ""
    m = _PART_NUMBER_LEADING_DIGITS.match(s)
    if not m:
        return s
    num_s, suffix = m.group(1), m.group(2)
    n = int(num_s) + 1
    num_out = str(n)
    if len(num_out) < len(num_s):
        num_out = num_out.zfill(len(num_s))
    return num_out + suffix


def recommend_field_fill_values(prefs: dict[str, str]) -> dict[str, str]:
    """推荐文件名等操作：空字段时建议填入的值（零件号为 **上次 +1**）。"""
    last_pn = (prefs.get("last_part_number") or "").strip()
    return {
        "PartNumber": next_part_number_after(last_pn),
        "PartVersion": (prefs.get("last_part_version") or DEFAULT_PART_VERSION).strip()
        or DEFAULT_PART_VERSION,
        "TypeCode": (prefs.get("last_type_code") or DEFAULT_TYPE_CODE).strip().upper()
        or DEFAULT_TYPE_CODE,
        "ModelSeries": (prefs.get("last_model_series") or "").strip(),
    }


def save_bom_apply_field_defaults(
    repo_root: Path,
    *,
    part_number: str,
    part_version: str,
    type_code: str,
    model_series: str,
) -> None:
    """将当前表单中有意义的值写回工作空间偏好。"""
    patch: dict[str, Any] = {}
    pn = (part_number or "").strip()
    if pn:
        patch["last_part_number"] = pn
    pv = (part_version or "").strip() or DEFAULT_PART_VERSION
    patch["last_part_version"] = pv
    tc = (type_code or "").strip().upper() or DEFAULT_TYPE_CODE
    patch["last_type_code"] = tc
    ms = (model_series or "").strip()
    if ms:
        patch["last_model_series"] = ms
    merge_workspace_section("bom_apply", patch, repo_root)
