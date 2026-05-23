"""扫描目录中的三维 SolidWorks 模型（图纸不算）。"""

from __future__ import annotations

from pathlib import Path

SW_PART_EXT = frozenset({".sldprt"})
SW_ASM_EXT = frozenset({".sldasm"})


ALL_SW_MODEL_EXT = SW_PART_EXT | SW_ASM_EXT


def sw_doc_type_suffix(name: str) -> int | None:
    """返回 SOLIDWORKS OpenDoc ``Type``：`1` 零件，`2` 装配体；图纸等返回 ``None``。"""
    suf = Path(name).suffix.lower()
    if suf in SW_PART_EXT:
        return 1  # swDocPART
    if suf in SW_ASM_EXT:
        return 2  # swDocASSEMBLY
    return None


def iter_sw_model_paths(
    root: Path | str,
    *,
    recursive: bool = False,
) -> list[Path]:
    """顶层或递归列出 `.sldprt` / `.sldasm`。`.slddrw` 自动排除。"""
    root_p = Path(root).expanduser().resolve()
    if not root_p.is_dir():
        raise NotADirectoryError(str(root_p))
    picks: list[Path] = []
    patterns = ["*.sldprt", "*.sldasm", "*.SLDPRT", "*.SLDASM"]
    for patt in patterns:
        it = root_p.rglob(patt) if recursive else root_p.glob(patt)
        for fp in sorted(it):
            if fp.is_file() and fp.suffix.lower() in ALL_SW_MODEL_EXT:
                picks.append(fp)
    seen: set[Path] = set()
    unique: list[Path] = []
    for fp in picks:
        key = fp.resolve()
        if key not in seen:
            seen.add(key)
            unique.append(fp)
    return sorted(unique)
