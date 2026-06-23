"""递归扫描工作空间内 Code 相关文件。"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable

from phoenix.code.ignore import load_ignore_config, should_skip_code_dir
from phoenix.code.kinds import (
    builtin_index_extensions,
    code_asset_kind,
    is_code_index_filename,
)
from phoenix.code.text_encoding import detect_text_encoding_label

_SKIP_EXTRA = frozenset(
    {
        ".cursor",
    }
)

# 工程内搜索发现后缀时排除（CAD / 二进制 / 归档等）
_SKIP_DISCOVER_EXTS = frozenset(
    {
        ".exe",
        ".dll",
        ".so",
        ".dylib",
        ".a",
        ".lib",
        ".o",
        ".obj",
        ".pyc",
        ".pyo",
        ".class",
        ".wasm",
        ".bin",
        ".dat",
        ".sqlite",
        ".db",
        ".zip",
        ".tar",
        ".gz",
        ".7z",
        ".rar",
        ".fcstd",
        ".step",
        ".stp",
        ".iges",
        ".igs",
        ".sldprt",
        ".sldasm",
        ".slddrw",
    }
)


@dataclass(frozen=True)
class CodeFileRecord:
    repo_rel_path: str
    filename: str
    asset_kind: str
    file_ext: str
    size_bytes: int
    text_encoding: str


def _should_skip_dir(name: str, patterns: list[str]) -> bool:
    cf = name.casefold()
    if cf in _SKIP_EXTRA:
        return True
    return should_skip_code_dir(name, patterns)


def _walk_workspace_files(
    repo_root: Path,
    patterns: list[str],
    *,
    on_file: Callable[[Path], None],
) -> None:
    root = repo_root.expanduser().resolve(strict=False)
    if not root.is_dir():
        return

    def walk(cur: Path) -> None:
        try:
            entries = sorted(cur.iterdir(), key=lambda p: (not p.is_dir(), p.name.lower()))
        except OSError:
            return
        for ent in entries:
            try:
                if ent.is_symlink():
                    continue
                if ent.is_dir():
                    if _should_skip_dir(ent.name, patterns):
                        continue
                    walk(ent)
                    continue
                if not ent.is_file():
                    continue
                on_file(ent)
            except OSError:
                continue

    walk(root)


def discover_unindexed_extensions(
    repo_root: Path,
    extra_exts: frozenset[str] = frozenset(),
) -> list[dict[str, Any]]:
    """统计工作空间内尚未纳入 Code 索引的后缀（含计数）。"""
    root = repo_root.expanduser().resolve(strict=False)
    if not root.is_dir():
        return []

    patterns = load_ignore_config(root)["ignore_patterns"]
    counts: dict[str, int] = {}

    def on_file(ent: Path) -> None:
        ext = ent.suffix.casefold()
        if not ext or ext in _SKIP_DISCOVER_EXTS:
            return
        if is_code_index_filename(ent, extra_exts):
            return
        counts[ext] = counts.get(ext, 0) + 1

    _walk_workspace_files(root, patterns, on_file=on_file)
    return [
        {"ext": ext, "count": count}
        for ext, count in sorted(counts.items(), key=lambda x: (-x[1], x[0]))
    ]


def scan_code_workspace(
    repo_root: Path,
    extra_exts: frozenset[str] = frozenset(),
) -> list[CodeFileRecord]:
    """扫描工作空间根下全部可索引 Code 文件。"""
    root = repo_root.expanduser().resolve(strict=False)
    if not root.is_dir():
        return []

    patterns = load_ignore_config(root)["ignore_patterns"]
    out: list[CodeFileRecord] = []

    def on_file(ent: Path) -> None:
        if not is_code_index_filename(ent, extra_exts):
            return
        kind = code_asset_kind(ent, extra_exts)
        if not kind:
            return
        try:
            rel = ent.relative_to(root).as_posix()
            size = ent.stat().st_size
        except (OSError, ValueError):
            return
        out.append(
            CodeFileRecord(
                repo_rel_path=rel,
                filename=ent.name,
                asset_kind=kind,
                file_ext=ent.suffix.casefold(),
                size_bytes=int(size),
                text_encoding=detect_text_encoding_label(ent),
            )
        )

    _walk_workspace_files(root, patterns, on_file=on_file)
    out.sort(key=lambda r: r.repo_rel_path.casefold())
    return out


def list_builtin_index_extensions() -> list[str]:
    return sorted(builtin_index_extensions())
