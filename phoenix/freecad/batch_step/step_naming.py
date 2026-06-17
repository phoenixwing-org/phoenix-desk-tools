"""STEP 文本解析与 Body 显示名（不依赖 FreeCAD）。"""

from __future__ import annotations

import re
from pathlib import Path


def decode_step_x2_utf16_string(s: str) -> str:
    """将 STEP 字符串中的 \\X2\\hhhh…\\X0\\ 段解码为 Unicode。"""
    out: list[str] = []
    i = 0
    tag2 = "\\X2\\"
    tag0 = "\\X0\\"
    while i < len(s):
        if s.startswith(tag2, i):
            j = s.find(tag0, i + len(tag2))
            if j == -1:
                out.append(s[i:])
                break
            hexpart = s[i + len(tag2) : j].replace(" ", "")
            try:
                out.append(bytes.fromhex(hexpart).decode("utf-16-be"))
            except Exception:
                out.append(s[i : j + len(tag0)])
            i = j + len(tag0)
        else:
            out.append(s[i])
            i += 1
    return "".join(out)


def first_product_fields_from_step_file(step_path: str | Path):
    """首个 PRODUCT 行 (id, name, description)，name/desc 已解码。"""
    product_re = re.compile(
        r"^#\d+=PRODUCT\s*\(\s*'([^']*)'\s*,\s*'([^']*)'\s*,\s*'([^']*)'",
        re.IGNORECASE,
    )
    try:
        with open(step_path, "r", encoding="utf-8", errors="replace") as f:
            for line in f:
                line = line.strip()
                if "PRODUCT(" not in line:
                    continue
                m = product_re.match(line)
                if not m:
                    continue
                pid, name_raw, desc_raw = m.group(1), m.group(2), m.group(3)
                return (
                    pid,
                    decode_step_x2_utf16_string(name_raw),
                    decode_step_x2_utf16_string(desc_raw),
                )
    except OSError:
        pass
    return None, None, None


def part_number_version_from_stem(stem: str) -> str | None:
    m = re.match(r"^(\d+\.\d+)", stem)
    return m.group(1) if m else None


def body_label_from_file_stem_and_step(stem: str, step_path: str | Path) -> str:
    part_ver = part_number_version_from_stem(stem)
    _pid, step_name, step_desc = first_product_fields_from_step_file(step_path)
    node_title = (step_name or "").strip() or (step_desc or "").strip()

    if part_ver and node_title:
        return f"{part_ver}-{node_title}"
    if part_ver and not node_title:
        suffix = re.sub(r"^\d+\.\d+-?", "", stem).strip("-") or stem
        return f"{part_ver}-{suffix}" if suffix else part_ver
    if node_title:
        return node_title
    return stem


def internal_name_from_stem(stem: str) -> str:
    s = stem.replace(".", "_").replace("-", "_")
    s = re.sub(r"[^0-9A-Za-z_]", "_", s)
    s = re.sub(r"_+", "_", s).strip("_")
    if not s:
        return "Body"
    if s[0].isdigit():
        s = "P_" + s
    return s
