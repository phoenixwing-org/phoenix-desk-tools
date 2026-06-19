"""递归扫描工作空间内 Code 相关文件。"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from phoenix.code.ignore import load_ignore_config, should_skip_code_dir
from phoenix.code.kinds import code_asset_kind, is_code_index_filename
from phoenix.code.text_encoding import detect_text_encoding_label

_SKIP_EXTRA = frozenset(
    {
        ".cursor",
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


def scan_code_workspace(repo_root: Path) -> list[CodeFileRecord]:
    """扫描工作空间根下全部可索引 Code 文件。"""
    root = repo_root.expanduser().resolve(strict=False)
    if not root.is_dir():
        return []

    patterns = load_ignore_config(root)["ignore_patterns"]
    out: list[CodeFileRecord] = []

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
                if not is_code_index_filename(ent):
                    continue
                kind = code_asset_kind(ent)
                if not kind:
                    continue
                try:
                    rel = ent.relative_to(root).as_posix()
                    size = ent.stat().st_size
                except (OSError, ValueError):
                    continue
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
            except OSError:
                continue

    walk(root)
    out.sort(key=lambda r: r.repo_rel_path.casefold())
    return out
