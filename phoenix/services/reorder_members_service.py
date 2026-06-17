"""C++ 类成员排序（Web / CLI 共用）。"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from phoenix.code.reorder_members import (
    SKIP_DIR_NAMES,
    ReorderMembersRunResult,
    iter_source_files,
    run_reorder_members,
)
from phoenix.config.user_prefs import (
    format_resolved_under_workspace,
    load_workspace_prefs,
    merge_workspace_section,
    workspace_phoenix_dir,
)

_SECTION = "code_reorder"

# 工作空间根下列一级目录时额外跳过（与 CAD 数据并列）
_SKIP_TOP_DIR_NAMES = SKIP_DIR_NAMES | {".phoenix", "web-ui", "node_modules"}


def _workspace_source_root(repo_root: Path) -> Path:
    rr = repo_root.expanduser().resolve(strict=False)
    if not rr.is_dir():
        raise ValueError(f"工作空间不是有效目录: {rr}")
    return rr


def get_reorder_members_prefs(repo_root: Path) -> dict[str, Any]:
    rr = repo_root.expanduser().resolve(strict=False)
    pv = load_workspace_prefs(rr).get(_SECTION) or {}
    last_selected = pv.get("last_selected") or []
    if not isinstance(last_selected, list):
        last_selected = []
    root = _workspace_source_root(rr)
    return {
        "workspace_path": str(root),
        "workspace_path_display": format_resolved_under_workspace(root, rr),
        "dry_run": bool(pv.get("dry_run", True)),
        "cpp_only": bool(pv.get("cpp_only", False)),
        "header_only": bool(pv.get("header_only", False)),
        "sort_members": bool(pv.get("sort_members", False)),
        "verbose": bool(pv.get("verbose", True)),
        "last_selected": [str(x) for x in last_selected if str(x).strip()],
    }


def save_reorder_members_prefs(repo_root: Path, patch: dict[str, Any]) -> dict[str, Any]:
    rr = repo_root.expanduser().resolve(strict=False)
    stored: dict[str, Any] = {}
    for k in ("dry_run", "cpp_only", "header_only", "sort_members", "verbose"):
        if k in patch:
            stored[k] = bool(patch[k])
    if "last_selected" in patch:
        sel = patch.get("last_selected") or []
        if not isinstance(sel, list):
            raise ValueError("last_selected 须为字符串数组")
        stored["last_selected"] = [str(x).strip() for x in sel if str(x).strip()]
    merge_workspace_section(_SECTION, stored, rr)
    return get_reorder_members_prefs(rr)


def _count_source_files(sub: Path) -> int:
    return sum(1 for _ in iter_source_files(sub, cpp_only=False, header_only=False))


def list_reorder_top_level_dirs(repo_root: Path) -> dict[str, Any]:
    rr = repo_root.expanduser().resolve(strict=False)
    root = _workspace_source_root(rr)
    dirs: list[dict[str, Any]] = []
    for p in sorted(root.iterdir(), key=lambda x: x.name.casefold()):
        if not p.is_dir():
            continue
        if p.name.startswith(".") or p.name in _SKIP_TOP_DIR_NAMES:
            continue
        if p.resolve(strict=False) == workspace_phoenix_dir(rr).resolve(strict=False):
            continue
        dirs.append(
            {
                "name": p.name,
                "source_file_count": _count_source_files(p),
            }
        )
    return {
        "workspace_path": str(root),
        "workspace_path_display": format_resolved_under_workspace(root, rr),
        "dirs": dirs,
    }


def run_reorder_members_batch(
    repo_root: Path,
    *,
    top_dirs: list[str],
    patch: dict[str, Any] | None = None,
) -> dict[str, Any]:
    rr = repo_root.expanduser().resolve(strict=False)
    prefs = get_reorder_members_prefs(rr)
    if patch:
        prefs = save_reorder_members_prefs(rr, {**patch, "last_selected": top_dirs})
    else:
        save_reorder_members_prefs(rr, {"last_selected": top_dirs})

    root = _workspace_source_root(rr)
    names = [n.strip() for n in top_dirs if n.strip()]
    if not names:
        raise ValueError("请至少勾选一个一级子目录")

    dry_run = bool(prefs.get("dry_run", True))
    cpp_only = bool(prefs.get("cpp_only"))
    header_only = bool(prefs.get("header_only"))
    sort_members = bool(prefs.get("sort_members"))
    verbose = bool(prefs.get("verbose", True))

    all_lines: list[str] = []
    total_cpp = total_hdr = total_files = 0
    dir_results: list[dict[str, Any]] = []

    for name in names:
        sub = (root / name).resolve(strict=False)
        if not sub.is_dir():
            raise ValueError(f"子目录不存在: {name}")
        try:
            sub.relative_to(root)
        except ValueError as e:
            raise ValueError(f"非法子目录名: {name}") from e

        all_lines.append(f"=== {name} ===")
        result: ReorderMembersRunResult = run_reorder_members(
            sub,
            dry_run=dry_run,
            cpp_only=cpp_only,
            header_only=header_only,
            sort_members=sort_members,
            verbose=verbose,
        )
        if not result.ok:
            all_lines.extend(result.lines)
            return {
                "ok": False,
                "log": "\n".join(all_lines),
                "lines": all_lines,
                "dry_run": dry_run,
                "dir_results": dir_results,
            }
        all_lines.extend(result.lines)
        total_cpp += result.cpp_changed
        total_hdr += result.hdr_changed
        total_files += result.files_scanned
        dir_results.append(
            {
                "name": name,
                "cpp_changed": result.cpp_changed,
                "hdr_changed": result.hdr_changed,
                "files_scanned": result.files_scanned,
            }
        )

    mode = "预检（未写盘）" if dry_run else "已写盘"
    summary = (
        f"完成 {len(names)} 个一级目录 · {mode} · "
        f"{total_cpp} 个 .cpp、{total_hdr} 个头文件有变更 · 共扫描 {total_files} 个源文件"
    )
    all_lines.append(summary)
    return {
        "ok": True,
        "log": "\n".join(all_lines),
        "lines": all_lines,
        "summary": summary,
        "dry_run": dry_run,
        "cpp_changed": total_cpp,
        "hdr_changed": total_hdr,
        "files_scanned": total_files,
        "dir_results": dir_results,
    }
