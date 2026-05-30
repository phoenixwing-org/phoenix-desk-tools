"""工作空间内按扩展名递归扫描（无 Tk 依赖，供 Web / 侧栏树共用）。"""

from __future__ import annotations

from pathlib import Path

_SKIP_DIR_NAMES_CI = frozenset(
    {
        ".git",
        ".svn",
        ".hg",
        "__pycache__",
        ".venv",
        "venv",
        "node_modules",
        ".idea",
        ".vs",
        ".bundle",
        "Pods",
        "$recycle.bin",
        "system volume information",
        "recovery",
        "windowsapps",
        "program files",
        "program files (x86)",
        "programdata",
    }
)

FCSTD_SUFFIX = ".fcstd"
SW_PART_SUFFIX = ".sldprt"


def should_skip_scan_dir(dirname: str) -> bool:
    cf = dirname.casefold()
    if cf in _SKIP_DIR_NAMES_CI:
        return True
    if cf.startswith("."):
        return True
    return False


def iter_filtered_files(workspace: Path, *, want_fcstd: bool, want_sw_part: bool) -> list[Path]:
    """递归列出工作空间内匹配扩展名的文件（相对路径）。"""
    exts: set[str] = set()
    if want_fcstd:
        exts.add(FCSTD_SUFFIX)
    if want_sw_part:
        exts.add(SW_PART_SUFFIX)
    if not exts:
        return []

    root = workspace.expanduser().resolve(strict=False)
    if not root.is_dir():
        return []

    matched: list[Path] = []

    def walk(cur: Path) -> None:
        try:
            entries = sorted(cur.iterdir(), key=lambda p: (not p.is_dir(), p.name.lower()))
        except OSError:
            return
        for ent in entries:
            try:
                is_dir = ent.is_dir()
                is_symlink = ent.is_symlink()
            except OSError:
                continue
            if is_dir:
                if should_skip_scan_dir(ent.name):
                    continue
                if is_symlink:
                    continue
                walk(ent)
                continue
            suf = ent.suffix.casefold()
            if suf in exts:
                try:
                    matched.append(ent.relative_to(root))
                except ValueError:
                    pass

    walk(root)
    matched.sort(key=lambda p: p.as_posix().lower())
    return matched
