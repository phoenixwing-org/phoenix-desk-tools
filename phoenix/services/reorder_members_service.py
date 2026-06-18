"""C++ 类成员排序（Web / CLI 共用）。"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from phoenix.code.reorder_ignore import (
    is_ignored_name,
    is_listable_source_file,
    load_ignore_patterns,
)
from phoenix.code.reorder_members import (
    ReorderMembersRunResult,
    format_changed_file_log_line,
    include_flags_to_legacy_filters,
    iter_source_files,
    normalize_reorder_include_flags,
    read_reorder_include_flags,
    resolve_reorder_include_for_run,
    run_reorder_members,
)
from phoenix.config.user_prefs import (
    format_resolved_under_workspace,
    load_workspace_prefs,
    merge_workspace_section,
    workspace_phoenix_dir,
)

_SECTION = "code_reorder"


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
    patterns, ignore_path, ignore_exists = load_ignore_patterns(rr)
    include_cpp, include_header = read_reorder_include_flags(pv)
    return {
        "workspace_path": str(root),
        "workspace_path_display": format_resolved_under_workspace(root, rr),
        "include_cpp": include_cpp,
        "include_header": include_header,
        "sort_members": bool(pv.get("sort_members", False)),
        "verbose": bool(pv.get("verbose", False)),
        "last_selected": [str(x) for x in last_selected if str(x).strip()],
        "ignore_file": str(ignore_path),
        "ignore_file_display": format_resolved_under_workspace(ignore_path, rr),
        "ignore_file_exists": ignore_exists,
        "ignore_patterns": patterns,
    }


def save_reorder_members_prefs(repo_root: Path, patch: dict[str, Any]) -> dict[str, Any]:
    rr = repo_root.expanduser().resolve(strict=False)
    stored: dict[str, Any] = {}
    include_cpp = patch.get("include_cpp") if "include_cpp" in patch else None
    include_header = patch.get("include_header") if "include_header" in patch else None
    if include_cpp is not None or include_header is not None:
        cur = load_workspace_prefs(rr).get(_SECTION) or {}
        cur_inc = read_reorder_include_flags(cur)
        include_cpp, include_header = normalize_reorder_include_flags(
            bool(include_cpp if include_cpp is not None else cur_inc[0]),
            bool(include_header if include_header is not None else cur_inc[1]),
        )
        stored["include_cpp"] = include_cpp
        stored["include_header"] = include_header
    elif "cpp_only" in patch or "header_only" in patch:
        cur = load_workspace_prefs(rr).get(_SECTION) or {}
        cur_inc = read_reorder_include_flags(cur)
        cpp_only = bool(patch.get("cpp_only", False)) if "cpp_only" in patch else None
        header_only = bool(patch.get("header_only", False)) if "header_only" in patch else None
        if cpp_only is not None or header_only is not None:
            legacy_cpp = cpp_only if cpp_only is not None else include_flags_to_legacy_filters(*cur_inc)[0]
            legacy_hdr = header_only if header_only is not None else include_flags_to_legacy_filters(*cur_inc)[1]
            include_cpp, include_header = read_reorder_include_flags(
                {"cpp_only": legacy_cpp, "header_only": legacy_hdr}
            )
            stored["include_cpp"] = include_cpp
            stored["include_header"] = include_header
    for k in ("sort_members", "verbose"):
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


def _count_filtered_source_files(
    sub: Path,
    *,
    include_cpp: bool,
    include_header: bool,
) -> int:
    cpp_only, header_only = include_flags_to_legacy_filters(include_cpp, include_header)
    return sum(1 for _ in iter_source_files(sub, cpp_only, header_only))


def _file_filter_label(include_cpp: bool, include_header: bool) -> str:
    include_cpp, include_header = normalize_reorder_include_flags(include_cpp, include_header)
    if include_cpp and include_header:
        return ".cpp + 头文件 (.h/.hpp)"
    if include_cpp:
        return ".cpp"
    return "头文件 (.h/.hpp)"


def _zero_scan_hints(
    root: Path,
    *,
    names: list[str],
    include_cpp: bool,
    include_header: bool,
    item_results: list[dict[str, Any]],
) -> list[str]:
    hints = [
        "提示: 未扫描到任何源文件。",
        f"工作空间: {root}",
        f"当前过滤: {_file_filter_label(include_cpp, include_header)}",
    ]
    for ir in item_results:
        name = str(ir["name"])
        target = (root / name).resolve(strict=False)
        if ir["files_scanned"]:
            continue
        if target.is_file():
            hints.append(f"  · {name}: 不是 .cpp/.h/.hpp，或已被过滤")
            continue
        total = _count_source_files(target) if target.is_dir() else 0
        filtered = (
            _count_filtered_source_files(target, include_cpp=include_cpp, include_header=include_header)
            if target.is_dir()
            else 0
        )
        if total == 0:
            hints.append(f"  · {name}: 目录下无 .cpp/.h/.hpp")
        elif filtered == 0:
            hints.append(
                f"  · {name}: 有 {total} 个源文件，但当前勾选类型下为 0（请调整「.cpp / 头文件」勾选）"
            )
        else:
            hints.append(f"  · {name}: 扫描 0（预期 {filtered}，请检查路径或权限）")
    hints.append(
        "若目标工程不在当前工作空间，请先在「配置」切换工作空间（例如 /Users/kathy/sam/KtAlarmClock），"
        "再勾选「源文件」列非 0 的目录（如 KtAlarmClockUI）。"
    )
    return hints


def list_reorder_top_level_entries(repo_root: Path) -> dict[str, Any]:
    rr = repo_root.expanduser().resolve(strict=False)
    root = _workspace_source_root(rr)
    patterns, ignore_path, ignore_exists = load_ignore_patterns(rr)
    phoenix_dir_resolved = workspace_phoenix_dir(rr).resolve(strict=False)

    entries: list[dict[str, Any]] = []
    ignored: list[dict[str, str]] = []

    for p in sorted(root.iterdir(), key=lambda x: x.name.casefold()):
        name = p.name
        if p.is_dir() and p.resolve(strict=False) == phoenix_dir_resolved:
            ignored.append({"name": name, "kind": "dir", "reason": "内置"})
            continue
        if is_ignored_name(name, patterns):
            ignored.append(
                {
                    "name": name,
                    "kind": "dir" if p.is_dir() else "file",
                    "reason": "ignore",
                }
            )
            continue
        if p.is_dir():
            entries.append(
                {
                    "name": name,
                    "kind": "dir",
                    "source_file_count": _count_source_files(p),
                }
            )
        elif is_listable_source_file(p):
            entries.append(
                {
                    "name": name,
                    "kind": "file",
                    "source_file_count": 1,
                }
            )

    return {
        "workspace_path": str(root),
        "workspace_path_display": format_resolved_under_workspace(root, rr),
        "entries": entries,
        "ignored": ignored,
        "ignore_file": str(ignore_path),
        "ignore_file_display": format_resolved_under_workspace(ignore_path, rr),
        "ignore_file_exists": ignore_exists,
        "ignore_patterns": patterns,
    }


# 兼容旧函数名
list_reorder_top_level_dirs = list_reorder_top_level_entries


def _batch_entry_changed_paths(name: str, kind: str, rel_paths: list[str]) -> list[str]:
    if kind == "file":
        return list(rel_paths)
    return [f"{name}/{p}" for p in rel_paths]


def _format_batch_summary(
    *,
    target_count: int,
    dry_run: bool,
    total_cpp: int,
    total_hdr: int,
    total_files: int,
    changed_paths: list[str],
) -> str:
    mode = "预检（未写盘）" if dry_run else "已写盘"
    changed_count = total_cpp + total_hdr
    if changed_count == 0:
        head = f"完成 {target_count} 项 · {mode} · 无变更 · 扫描 {total_files} 个源文件"
    else:
        head = (
            f"完成 {target_count} 项 · {mode} · "
            f"变更 {changed_count} 个文件（{total_cpp} .cpp、{total_hdr} 头文件）· "
            f"扫描 {total_files} 个源文件"
        )
    if not changed_paths:
        return head
    listed = "\n".join(format_changed_file_log_line(p) for p in changed_paths)
    return f"{head}\n{listed}"


def _run_on_target(
    root: Path,
    target: Path,
    *,
    dry_run: bool,
    cpp_only: bool,
    header_only: bool,
    sort_members: bool,
    verbose: bool,
) -> ReorderMembersRunResult:
    if target.is_file():
        if not is_listable_source_file(target):
            raise ValueError(f"不是可排序的源文件: {target.name}")
        return run_reorder_members(
            root,
            files=[target],
            dry_run=dry_run,
            cpp_only=cpp_only,
            header_only=header_only,
            sort_members=sort_members,
            verbose=verbose,
        )
    if target.is_dir():
        return run_reorder_members(
            target,
            dry_run=dry_run,
            cpp_only=cpp_only,
            header_only=header_only,
            sort_members=sort_members,
            verbose=verbose,
        )
    raise ValueError(f"路径不存在: {target.name}")


def run_reorder_members_batch(
    repo_root: Path,
    *,
    targets: list[str],
    dry_run: bool = False,
    patch: dict[str, Any] | None = None,
) -> dict[str, Any]:
    rr = repo_root.expanduser().resolve(strict=False)
    prefs = get_reorder_members_prefs(rr)
    save_patch = dict(patch or {})
    save_patch["last_selected"] = targets
    save_reorder_members_prefs(rr, save_patch)

    root = _workspace_source_root(rr)
    names = [n.strip() for n in targets if n.strip()]
    if not names:
        raise ValueError("请至少勾选一项（目录或源文件）")

    cpp_only, header_only = include_flags_to_legacy_filters(
        *resolve_reorder_include_for_run(save_patch)
    )
    sort_members = bool(
        save_patch["sort_members"] if "sort_members" in save_patch else prefs.get("sort_members")
    )
    verbose = bool(
        save_patch["verbose"] if "verbose" in save_patch else prefs.get("verbose", False)
    )

    all_lines: list[str] = []
    total_cpp = total_hdr = total_files = 0
    all_changed: list[str] = []
    item_results: list[dict[str, Any]] = []

    for name in names:
        target = (root / name).resolve(strict=False)
        try:
            target.relative_to(root)
        except ValueError as e:
            raise ValueError(f"非法路径: {name}") from e

        kind = "file" if target.is_file() else "dir"
        if verbose:
            all_lines.append(f"=== {name} ({kind}) ===")
        result = _run_on_target(
            root,
            target,
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
                "item_results": item_results,
            }
        entry_changed = _batch_entry_changed_paths(name, kind, result.changed_files)
        if verbose:
            all_lines.extend(result.lines)
        elif len(names) > 1:
            n_changed = result.cpp_changed + result.hdr_changed
            change_part = "无变更" if n_changed == 0 else f"变更 {n_changed} 个"
            all_lines.append(f"{name}: {change_part} · 扫描 {result.files_scanned}")
            if n_changed:
                for p in entry_changed:
                    all_lines.append(format_changed_file_log_line(p))
        all_changed.extend(entry_changed)
        total_cpp += result.cpp_changed
        total_hdr += result.hdr_changed
        total_files += result.files_scanned
        item_results.append(
            {
                "name": name,
                "kind": kind,
                "cpp_changed": result.cpp_changed,
                "hdr_changed": result.hdr_changed,
                "files_scanned": result.files_scanned,
                "changed_files": entry_changed,
            }
        )

    summary = _format_batch_summary(
        target_count=len(names),
        dry_run=dry_run,
        total_cpp=total_cpp,
        total_hdr=total_hdr,
        total_files=total_files,
        changed_paths=all_changed,
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
        "changed_files": all_changed,
        "item_results": item_results,
    }
