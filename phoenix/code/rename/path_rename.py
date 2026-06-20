"""批量改名：文件夹 / 文件 basename 重命名。"""

from __future__ import annotations

from pathlib import Path
from typing import Any, Literal

from phoenix.code.ignore import load_ignore_config
from phoenix.code.rename.types import RenameScanOptions, empty_rename_summary
from phoenix.code.rename.walk import iter_workspace_entries

PathKind = Literal["dir", "file"]
_TMP_SUFFIX = ".__phoenix_rename_tmp__"


def _safe_rename(path: Path, new_name: str) -> Path:
    dest = path.with_name(new_name)
    if dest.exists():
        try:
            if dest.resolve().samefile(path):
                pass  # 大小写-only：继续走临时名路径
            elif dest.resolve() != path.resolve():
                raise FileExistsError(f"目标已存在: {dest}")
            else:
                return path
        except OSError:
            if dest.resolve() != path.resolve():
                raise FileExistsError(f"目标已存在: {dest}") from None
    if path.name == new_name:
        return path
    if path.name.casefold() == new_name.casefold() or (dest.exists() and dest.samefile(path)):
        tmp = path.with_name(path.name + _TMP_SUFFIX)
        if tmp.exists():
            raise FileExistsError(f"临时路径冲突: {tmp}")
        path.rename(tmp)
        tmp.rename(dest)
        return dest
    path.rename(dest)
    return dest


def _collect_matches(repo_root: Path, opts: RenameScanOptions, kind: PathKind) -> list[tuple[Path, str]]:
    root = repo_root.expanduser().resolve(strict=False)
    patterns = load_ignore_config(root)["ignore_patterns"]
    matches: list[tuple[Path, str]] = []
    for path, rel, entry_kind in iter_workspace_entries(
        root,
        scope=opts.scope,
        ignore_patterns=patterns,
        include_ignored=opts.include_ignored,
        dirs=kind == "dir",
        files=kind == "file",
        indexed_paths=opts.indexed_paths,
    ):
        if entry_kind != kind:
            continue
        if path.name != opts.old:
            continue
        matches.append((path, rel))
    if kind == "dir":
        matches.sort(key=lambda item: item[1].count("/"), reverse=True)
    else:
        matches.sort(key=lambda item: (item[1].count("/"), item[1]))
    return matches


def preview_path_rename(repo_root: Path, opts: RenameScanOptions, *, kind: PathKind) -> dict[str, Any]:
    matches = _collect_matches(repo_root, opts, kind)
    hits: list[dict[str, Any]] = []
    for _path, rel in matches:
        parent = rel.rsplit("/", 1)[0] if "/" in rel else "."
        new_rel = f"{parent}/{opts.new}" if parent != "." else opts.new
        hits.append(
            {
                "hit_id": f"{kind}:{rel}",
                "repo_rel_path": rel,
                "level": kind,
                "hits": 1,
                "new_path": new_rel,
                "status": "ok",
            }
        )

    summary = empty_rename_summary()
    if kind == "dir":
        summary["dirs"] = len(hits)
    else:
        summary["files"] = len(hits)
    summary["total_hits"] = len(hits)

    label = "文件夹" if kind == "dir" else "文件"
    lines = [f"{label}预览：「{opts.old}」→「{opts.new}」共 {len(hits)} 个"]
    for h in hits[:40]:
        lines.append(f"  · {h['repo_rel_path']} → {h['new_path']}")
    if len(hits) > 40:
        lines.append(f"  … 另有 {len(hits) - 40} 条")

    return {
        "ok": True,
        "implemented": True,
        "hits": hits,
        "summary": summary,
        "lines": lines,
        "log": "\n".join(lines),
    }


def apply_path_rename(
    repo_root: Path,
    opts: RenameScanOptions,
    *,
    kind: PathKind,
    dry_run: bool,
) -> dict[str, Any]:
    matches = _collect_matches(repo_root, opts, kind)
    changed = 0
    skipped = 0
    hits: list[dict[str, Any]] = []
    lines: list[str] = []
    label = "文件夹" if kind == "dir" else "文件"
    prefix = "[预检]" if dry_run else "[写盘]"

    for path, rel in matches:
        parent = rel.rsplit("/", 1)[0] if "/" in rel else "."
        new_rel = f"{parent}/{opts.new}" if parent != "." else opts.new
        hit = {
            "hit_id": f"{kind}:{rel}",
            "repo_rel_path": rel,
            "level": kind,
            "hits": 1,
            "new_path": new_rel,
            "status": "ok",
        }
        if dry_run:
            changed += 1
            hit["status"] = "dry_run"
            lines.append(f"  {prefix} {rel} → {new_rel}")
            hits.append(hit)
            continue
        try:
            _safe_rename(path, opts.new)
            changed += 1
            lines.append(f"  {prefix} {rel} → {new_rel}")
            hits.append(hit)
        except OSError as e:
            skipped += 1
            hit["status"] = "error"
            hit["error"] = str(e)
            lines.append(f"  [失败] {rel}: {e}")
            hits.append(hit)

    summary = empty_rename_summary()
    if kind == "dir":
        summary["dirs"] = changed
    else:
        summary["files"] = changed
    summary["total_hits"] = changed
    summary["skipped"] = skipped

    mode = "预检（未写盘）" if dry_run else "已写盘"
    lines.insert(0, f"{mode}{label}：改动 {changed} 个，跳过 {skipped} 个")

    return {
        "ok": skipped == 0 or changed > 0,
        "implemented": True,
        "dry_run": dry_run,
        "hits": hits,
        "summary": summary,
        "lines": lines,
        "log": "\n".join(lines),
    }
