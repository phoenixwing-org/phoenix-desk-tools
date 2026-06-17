#!/usr/bin/env python3
"""修正 FreeCAD Document.xml 中 XLink 指向的 .FCStd 相对路径。

.FCStd 本质是 ZIP，内含 Document.xml；本脚本可直接改磁盘上的 Document.xml，
也可改 .FCStd 压缩包内的 Document.xml（路径相对 .FCStd 所在目录解析）。

用法:
  python scripts/fix_fcstd_xlink_paths.py myproject/FreeCAD/Document.xml
  python scripts/fix_fcstd_xlink_paths.py ./models/Asm.A.FCStd
  python scripts/fix_fcstd_xlink_paths.py --all-in-dir myproject/FreeCAD \\
      --map-json myrepo/fcstd_map.json --map-anchor myrepo
  python scripts/fix_fcstd_xlink_paths.py --dry-run --all-in-dir myproject/FreeCAD
  （默认若未指定 --map-json 则在 --map-anchor 目录下找 fcstd_map.json；
  桌面 shell：工作空间根的 fcstd_map.json 由「FCStd 索引」生成，`fcstd_map.py` 的 `--relative-to`
  必须为工作空间根（即 JSON 所在目录），`--map-anchor` 与之相同。条目 repo_rel_path 形如 ./…。也可用 --live-scan。）
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import sys
import tempfile
import zipfile
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

from fcstd_map import build_fcstd_map_abs, rel_fcstd_map_to_abs, repo_root

XLINK_RE = re.compile(
    r'(<XLink\s+file=")([^"]*)(")',
    re.MULTILINE,
)

# 文件名中的版本段：100082.002-R-... → 002
_VERSION_IN_NAME = re.compile(r"\.(\d{3})[-.]")


def _freecad_workspace_dir(doc_dir: Path) -> Path | None:
    """Document.xml / .FCStd 所在的 ``…/某工程/FreeCAD`` 目录。"""
    if doc_dir.name == "FreeCAD":
        return doc_dir
    if doc_dir.parent.name == "FreeCAD":
        return doc_dir.parent
    return None


def _folder_three_digit_suffix(doc_dir: Path) -> str | None:
    """从路径片段末尾的三位版本号推断首选版本键（若存在）。"""
    for part in doc_dir.parts:
        m = re.search(r"(\d{3})$", part)
        if m:
            return m.group(1)
    return None


def _file_version_token(path: Path) -> str | None:
    m = _VERSION_IN_NAME.search(path.name)
    return m.group(1) if m else None


def pick_target(
    basename: str,
    candidates: list[Path],
    doc_dir: Path,
) -> Path | None:
    """选一个目标文件：先当前 FreeCAD 目录，再匹配版本号，再在路径重合的工程间过滤。"""
    if not candidates:
        return None

    freecad_dir = _freecad_workspace_dir(doc_dir) or doc_dir
    in_current = [p for p in candidates if p.parent == freecad_dir]
    if len(in_current) == 1:
        return in_current[0]
    if len(in_current) > 1:
        candidates = in_current

    proj_ver = _folder_three_digit_suffix(doc_dir)
    if proj_ver:
        same_ver = [p for p in candidates if _file_version_token(p) == proj_ver]
        if len(same_ver) == 1:
            return same_ver[0]
        if same_ver:
            candidates = same_ver

    doc_markers = {p for p in doc_dir.parts if re.search(r"\d{3}$", p)}
    same_project = [p for p in candidates if doc_markers & {x for x in p.parts if re.search(r"\d{3}$", x)}]
    if len(same_project) == 1:
        return same_project[0]
    if same_project:
        candidates = same_project

    def relpath_len(p: Path) -> int:
        try:
            return len(os.path.relpath(p, doc_dir))
        except ValueError:
            return 10_000

    return min(candidates, key=relpath_len)


def resolve_xlink_path(file_attr: str, doc_dir: Path) -> Path | None:
    if not file_attr or not file_attr.endswith(".FCStd"):
        return None
    target = (doc_dir / file_attr).resolve()
    return target if target.is_file() else None


@dataclass
class XLinkChange:
    source: str
    old_path: str
    new_path: str
    target_file: str
    verdict: str
    note: str
    count: int = 1


def _classify_change(
    basename: str,
    target: Path,
    doc_dir: Path,
    all_candidates: list[Path],
) -> tuple[str, str]:
    """返回 (verdict, note) 供报告说明是否合理。"""
    freecad_dir = _freecad_workspace_dir(doc_dir) or doc_dir
    ver = _file_version_token(target) or "?"

    if target.parent == freecad_dir:
        return "当前目录", f"目标在 `{freecad_dir.name}/`，保持裸文件名"

    lone001 = (
        len(all_candidates) == 1
        and ".001" in basename
        and _file_version_token(all_candidates[0]) == "001"
    )
    if lone001:
        return "共用001件", (
            f"仓库仅有的匹配为 `.001` 版本（`{basename}`）；"
            f"与高版本总成引用同一旧版零件时，改指向该行通常合理"
        )

    if ".002" in basename and _file_version_token(target) == "001":
        return "需人工确认", "文件名含 `.002` 却指向 `.001` 版本实体，建议在 FreeCAD 中核对"

    if ".001" in basename:
        return "跨工程001", f"跨路径引用 `{basename}`（检测到版本令牌 {ver}）"

    return "跨目录", f"目标: `{target}`"


def xlink_path_for_target(target: Path, doc_dir: Path) -> str:
    """目标在当前 FreeCAD 目录下时用裸文件名；跨目录才写相对路径。"""
    freecad_dir = _freecad_workspace_dir(doc_dir) or doc_dir
    if target.parent == freecad_dir:
        return target.name
    rel = os.path.relpath(target, doc_dir)
    return rel.replace(os.sep, "/")


def fix_document_text(
    text: str,
    doc_dir: Path,
    fcstd_map: dict[str, list[Path]],
) -> tuple[str, int, list[str], list[XLinkChange]]:
    """修正 xml 文本，返回 (新文本, 修改次数, 日志行, 变更记录)。"""
    logs: list[str] = []
    records: list[XLinkChange] = []
    record_index: dict[tuple[str, str, str], int] = {}
    logged: set[str] = set()
    changes = 0
    source_label = str(doc_dir)

    def _record(old: str, new: str, target: Path, candidates: list[Path]) -> None:
        verdict, note = _classify_change(os.path.basename(old), target, doc_dir, candidates)
        key = (old, new, verdict)
        if key in record_index:
            records[record_index[key]].count += 1
        else:
            record_index[key] = len(records)
            records.append(
                XLinkChange(
                    source=source_label,
                    old_path=old,
                    new_path=new,
                    target_file=str(target),
                    verdict=verdict,
                    note=note,
                )
            )

    def replacer(match: re.Match[str]) -> str:
        nonlocal changes
        prefix, file_attr, suffix = match.group(1), match.group(2), match.group(3)
        if not file_attr:
            return match.group(0)
        if resolve_xlink_path(file_attr, doc_dir):
            return match.group(0)

        basename = os.path.basename(file_attr)
        local = (_freecad_workspace_dir(doc_dir) or doc_dir) / basename
        if local.is_file():
            if file_attr != basename:
                changes += 1
                _record(file_attr, basename, local, [local])
                if file_attr not in logged:
                    logged.add(file_attr)
                    logs.append(f"  {file_attr} -> {basename}")
                return f"{prefix}{basename}{suffix}"
            return match.group(0)

        candidates = fcstd_map.get(basename, [])
        target = pick_target(basename, candidates, doc_dir)
        if target is None:
            if file_attr not in logged:
                logged.add(file_attr)
                logs.append(f"  未找到: {file_attr}")
                records.append(
                    XLinkChange(
                        source=source_label,
                        old_path=file_attr,
                        new_path="",
                        target_file="",
                        verdict="未找到",
                        note=f"映射表无 `{basename}`",
                    )
                )
            return match.group(0)

        new_path = xlink_path_for_target(target, doc_dir)
        if new_path == file_attr:
            return match.group(0)

        changes += 1
        _record(file_attr, new_path, target, candidates)
        if file_attr not in logged:
            logged.add(file_attr)
            logs.append(f"  {file_attr} -> {new_path}")
        return f"{prefix}{new_path}{suffix}"

    new_text = XLINK_RE.sub(replacer, text)
    return new_text, changes, logs, records


def fix_document_xml(
    doc_path: Path,
    fcstd_map: dict[str, list[Path]],
    *,
    dry_run: bool = False,
) -> tuple[int, list[str], list[XLinkChange]]:
    """修正磁盘上的 Document.xml。"""
    doc_path = doc_path.resolve()
    text = doc_path.read_text(encoding="utf-8")
    new_text, changes, logs, records = fix_document_text(
        text, doc_path.parent, fcstd_map
    )
    for r in records:
        r.source = str(doc_path)
    if changes and not dry_run:
        doc_path.write_text(new_text, encoding="utf-8")
    return changes, logs, records


FCSTD_DOCUMENT_XML = "Document.xml"


def fix_fcstd_file(
    fcstd_path: Path,
    fcstd_map: dict[str, list[Path]],
    *,
    dry_run: bool = False,
) -> tuple[int, list[str], list[XLinkChange]]:
    """修正 .FCStd（ZIP）内的 Document.xml。路径相对 .FCStd 所在目录解析。"""
    fcstd_path = fcstd_path.resolve()
    doc_dir = fcstd_path.parent

    with zipfile.ZipFile(fcstd_path, "r") as zf:
        if FCSTD_DOCUMENT_XML not in zf.namelist():
            raise ValueError(f"{fcstd_path} 中无 {FCSTD_DOCUMENT_XML}")
        text = zf.read(FCSTD_DOCUMENT_XML).decode("utf-8")

    new_text, changes, logs, records = fix_document_text(text, doc_dir, fcstd_map)
    for r in records:
        r.source = str(fcstd_path)
    if not changes or dry_run:
        return changes, logs, records

    fd, tmp_name = tempfile.mkstemp(suffix=".FCStd", dir=doc_dir)
    os.close(fd)
    tmp_path = Path(tmp_name)
    try:
        with zipfile.ZipFile(fcstd_path, "r") as zin:
            with zipfile.ZipFile(tmp_path, "w") as zout:
                for info in zin.infolist():
                    data = (
                        new_text.encode("utf-8")
                        if info.filename == FCSTD_DOCUMENT_XML
                        else zin.read(info.filename)
                    )
                    zout.writestr(info, data)
        shutil.move(str(tmp_path), str(fcstd_path))
    except Exception:
        tmp_path.unlink(missing_ok=True)
        raise

    return changes, logs, records


def fix_path(
    path: Path,
    fcstd_map: dict[str, list[Path]],
    *,
    dry_run: bool = False,
) -> tuple[int, list[str], list[XLinkChange]]:
    """根据扩展名选择修正 Document.xml 或 .FCStd。"""
    if path.suffix.lower() == ".fcstd":
        return fix_fcstd_file(path, fcstd_map, dry_run=dry_run)
    return fix_document_xml(path, fcstd_map, dry_run=dry_run)


def write_report_md(
    report_path: Path,
    *,
    search_root: Path,
    dry_run: bool,
    per_file: list[tuple[Path, int, list[XLinkChange]]],
    not_found_sources: list[str],
    map_source: Path | None = None,
) -> None:
    """将计划修改写入 Markdown，便于核对。"""
    total = sum(n for _, n, _ in per_file)
    all_records = [r for _, _, recs in per_file for r in recs]
    by_verdict: dict[str, int] = {}
    for r in all_records:
        by_verdict[r.verdict] = by_verdict.get(r.verdict, 0) + r.count

    lines = [
        "# XLink 路径修正报告",
        "",
        f"- 生成时间: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}",
        f"- 模式: {'dry-run（未写回）' if dry_run else '已写回 FCStd/Document.xml'}",
        f"- 索引基准: `{search_root}`（repo_rel_path 相对于此目录，应与生成映射时 `--relative-to` / JSON 所在目录一致）",
    ]
    if map_source is not None:
        lines.append(f"- 映射文件: `{map_source}`")
    lines.extend(
        [
            f"- 处理文件数: {len(per_file)}",
            f"- 计划修改 XLink 条数: {total}",
            "",
            "## 结论摘要",
            "",
            "| 判定 | 条数 | 说明 |",
            "| --- | ---: | --- |",
            "| 共用001件 | "
            f"{by_verdict.get('共用001件', 0)} | "
            "映射表仅剩 `.001` 实体；与高版本总成引用同一旧版零件时，改指向该行通常合理 |",
            "| 当前目录 | "
            f"{by_verdict.get('当前目录', 0)} | "
            "目标已在当前 `FreeCAD/`，规范为裸文件名 |",
            "| 跨工程001 | "
            f"{by_verdict.get('跨工程001', 0)} | "
            "跨目录引用 001 文件 |",
            "| 需人工确认 | "
            f"{by_verdict.get('需人工确认', 0)} | "
            "建议打开 FreeCAD 核对 |",
            "| 未找到 | "
            f"{by_verdict.get('未找到', 0)} | "
            "映射表无匹配，未改 |",
            "",
            "**002 本地件**：`file` 已能解析的 `*.002-*.FCStd` 不会出现在下表（未改）。",
            "",
        ]
    )

    need_review = [r for _, _, recs in per_file for r in recs if r.verdict == "需人工确认"]
    if need_review:
        lines.extend(["## 需人工确认", ""])
        for r in need_review:
            lines.append(
                f"- `{Path(r.source).name}`: `{r.old_path}` → `{r.new_path}`（×{r.count}）— {r.note}"
            )
        lines.append("")

    for path, n, recs in per_file:
        if n == 0 and not recs:
            continue
        lines.extend([f"## `{path.name}`", ""])
        if not recs:
            lines.append(f"- 修改条数: {n}")
            lines.append("")
            continue
        lines.extend(
            [
                f"- 源: `{path}`",
                f"- 修改条数: {n}",
                "",
                "| 原路径 | 新路径 | 次数 | 判定 | 说明 |",
                "| --- | --- | ---: | --- | --- |",
            ]
        )
        for r in recs:
            lines.append(
                f"| `{r.old_path}` | `{r.new_path}` | {r.count} | {r.verdict} | {r.note} |"
            )
        lines.append("")

    if not_found_sources:
        lines.extend(["## 跳过（文件不存在）", ""])
        for s in not_found_sources:
            lines.append(f"- `{s}`")
        lines.append("")

    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def collect_paths_in_dir(dir_arg: str, *, cwd: Path) -> tuple[Path, list[Path]]:
    """返回 (目录绝对路径, 该目录下所有 .FCStd 排序列表)。"""
    target_dir = Path(dir_arg).expanduser()
    if not target_dir.is_absolute():
        target_dir = (cwd / target_dir).resolve()
    if not target_dir.is_dir():
        raise SystemExit(f"错误：--all-in-dir 不是目录: {target_dir}")
    fcstd_files = sorted(
        p.resolve()
        for p in target_dir.glob("*.FCStd")
        if p.is_file()
    )
    return target_dir, fcstd_files


def main() -> None:
    parser = argparse.ArgumentParser(description="修正 Document.xml 中 XLink 的 FCStd 路径")
    parser.add_argument(
        "documents",
        nargs="*",
        help="Document.xml 或 .FCStd 路径（可与 --all-in-dir 合用）",
    )
    parser.add_argument(
        "--all-in-dir",
        metavar="DIR",
        default=None,
        help="处理目录下全部 *.FCStd（示例：cad/Asm/FreeCAD）",
    )
    parser.add_argument(
        "--search-root",
        default=None,
        help="配合 --live-scan：当场扫描的根目录（默认当前工作目录或 map-anchor）。仅 JSON 模式下可省略。",
    )
    parser.add_argument(
        "--map-json",
        metavar="FILE",
        default=None,
        help="文件名→路径列表映射 JSON（缺省：<map-anchor>/fcstd_map.json）",
    )
    parser.add_argument(
        "--map-sqlite",
        metavar="DIR",
        default=None,
        help="工作空间根：从 <DIR>/.phoenix/phoenix-workspace.sqlite 读索引（不写 fcstd_map.json）",
    )
    parser.add_argument(
        "--map-anchor",
        metavar="DIR",
        default=None,
        help=(
            "解析映射里 repo_rel_path 的基准目录；必须与 fcstd_map 写入时的 --relative-to 相同"
            "（桌面一般为工作空间根，即 fcstd_map.json 所在目录）。"
            "省略时默认为当前工作目录。"
        ),
    )
    parser.add_argument(
        "--live-scan",
        action="store_true",
        help="不使用 JSON，按 --search-root 即时扫描索引（等价于早期行为）",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="只报告，不写回文件",
    )
    parser.add_argument(
        "--report-out",
        default=None,
        help="将计划修改写入 Markdown（使用 --all-in-dir 时为该目录 xlink_fix_report.md，否则当前工作目录）",
    )
    parser.add_argument(
        "--no-report",
        action="store_true",
        help="不生成 Markdown 报告",
    )
    parser.add_argument(
        "--desktop-json-results",
        metavar="PATH",
        default=None,
        help="将本次运行结构化结果写入 JSON（桌面壳 Treeview）；同时省略逐条控制台日志以便阅读摘要。",
    )
    args = parser.parse_args()

    desktop_json = args.desktop_json_results is not None

    cwd = Path.cwd().resolve()

    anchor = (
        Path(args.map_anchor).expanduser().resolve(strict=False)
        if args.map_anchor
        else cwd
    )

    map_loaded_from: Path | None = None
    map_source_for_report = anchor  # Markdown 中与 JSON 条目一致的「相对路径基准」

    if args.live_scan:
        if args.search_root:
            sr0 = Path(args.search_root).expanduser()
            search_for_scan = (
                sr0.resolve(strict=False)
                if sr0.is_absolute()
                else (cwd / sr0).resolve(strict=False)
            )
        else:
            search_for_scan = anchor
        print(f"[live-scan] 扫描 FCStd: {search_for_scan}")
        fcstd_map = build_fcstd_map_abs(search_for_scan)
        map_source_for_report = search_for_scan
    elif args.map_sqlite:
        repo = Path(args.map_sqlite).expanduser()
        repo = repo.resolve(strict=False) if repo.is_absolute() else (cwd / repo).resolve(strict=False)
        anchor = repo
        map_source_for_report = repo
        sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
        from phoenix.freecad.phoenix_schema import cad_database_path
        from phoenix.freecad.phoenix_store import fcstd_map_json_dict
        db_display = cad_database_path(repo)
        try:
            raw = fcstd_map_json_dict(repo)
        except FileNotFoundError as e:
            print(
                f"\n错误：索引库为空：{db_display}\n"
                "请先在「FCStd 索引」页执行工程内搜索，或使用 --map-json / --live-scan。",
                file=sys.stderr,
            )
            raise SystemExit(2) from e
        fcstd_map = rel_fcstd_map_to_abs(raw, anchor)
        print(f"载入索引库: {db_display}")
        print(f"相对路径基准: {anchor}")
    else:
        map_path_arg = Path(args.map_json).expanduser() if args.map_json else None
        if map_path_arg is None:
            map_path = (anchor / "fcstd_map.json").resolve(strict=False)
        else:
            map_path = (
                map_path_arg.resolve(strict=False)
                if map_path_arg.is_absolute()
                else (cwd / map_path_arg).resolve(strict=False)
            )

        if not map_path.is_file():
            print(
                "\n错误：未找到映射文件：\n  "
                f"{map_path}\n\n"
                "请先在「FCStd 索引」页执行工程内搜索，或执行例如：\n"
                '  python scripts/fcstd_map.py --root "<遍历根>" '
                f'--relative-to "<工作空间根>" '
                f'--json "<工作空间根>/fcstd_map.json"\n\n'
                "亦可使用 --map-sqlite <工作空间根> 直接读 .phoenix/phoenix-workspace.sqlite，"
                "或 --live-scan 即时扫描。",
                file=sys.stderr,
            )
            raise SystemExit(2)

        raw = json.loads(map_path.read_text(encoding="utf-8"))
        if not isinstance(raw, dict):
            raise SystemExit(f"映射 JSON 须为顶层对象：{map_path}")
        fcstd_map = rel_fcstd_map_to_abs(raw, anchor)
        map_loaded_from = map_path
        print(f"载入映射: {map_path}")
        print(f"相对路径基准: {anchor}")

    print(
        f"索引条目数（路径条数之和）: {sum(len(v) for v in fcstd_map.values())}，"
        f"唯一文件名: {len(fcstd_map)}"
    )

    doc_paths: list[Path] = []
    all_in_dir: Path | None = None

    for doc_arg in args.documents:
        p = Path(doc_arg).expanduser()
        if not p.is_absolute():
            p = (cwd / p).resolve()
        doc_paths.append(p)

    if args.all_in_dir:
        all_in_dir, fcstd_list = collect_paths_in_dir(args.all_in_dir, cwd=cwd)
        print(f"--all-in-dir: {all_in_dir}（{len(fcstd_list)} 个 .FCStd）")
        doc_paths.extend(fcstd_list)

    if not doc_paths:
        parser.error("请指定 Document.xml / .FCStd，或使用 --all-in-dir DIR")

    # 去重且保持顺序
    seen: set[Path] = set()
    unique_paths: list[Path] = []
    for p in doc_paths:
        if p not in seen:
            seen.add(p)
            unique_paths.append(p)

    total_changes = 0
    per_file: list[tuple[Path, int, list[XLinkChange]]] = []
    skipped: list[str] = []

    for doc_path in unique_paths:
        if not doc_path.is_file():
            if not desktop_json:
                print(f"跳过（不存在）: {doc_path}")
            skipped.append(str(doc_path))
            continue
        if desktop_json:
            hdr = "[dry-run] " if args.dry_run else ""
            print(f"{hdr}{doc_path}")
        else:
            print(f"\n{'[dry-run] ' if args.dry_run else ''}{doc_path}")
        n, logs, records = fix_path(doc_path, fcstd_map, dry_run=args.dry_run)
        if desktop_json:
            if n > 0:
                suf = " (dry-run)" if args.dry_run else ""
                print(f"  → {n} 条 XLink 待改{suf}")
        else:
            for line in logs:
                print(line)
            print(f"  修改 XLink 条数: {n}")
        total_changes += n
        per_file.append((doc_path, n, records))

    print(f"\n合计修改: {total_changes}")
    if skipped and desktop_json:
        print(f"跳过（不存在）: {len(skipped)} 个路径")

    report_path_out: Path | None = None

    if not args.no_report:
        if args.report_out:
            report_path = Path(args.report_out).expanduser()
            if not report_path.is_absolute():
                report_path = (Path.cwd() / report_path).resolve()
        elif all_in_dir is not None:
            report_path = all_in_dir / "xlink_fix_report.md"
        else:
            report_path = Path.cwd() / "xlink_fix_report.md"
        write_report_md(
            report_path,
            search_root=map_source_for_report,
            dry_run=args.dry_run,
            per_file=per_file,
            not_found_sources=skipped,
            map_source=map_loaded_from,
        )
        print(f"报告已写入: {report_path}")
        report_path_out = report_path

    if args.desktop_json_results:
        outp = Path(args.desktop_json_results).expanduser()
        if not outp.is_absolute():
            outp = (cwd / outp).resolve()
        sr = map_source_for_report
        try:
            sr_disp = str(sr.expanduser().resolve())
        except OSError:
            sr_disp = str(sr)
        payload = {
            "schema": 1,
            "dry_run": bool(args.dry_run),
            "total_changes": int(total_changes),
            "search_root": sr_disp,
            "map_path": str(map_loaded_from.resolve()) if map_loaded_from else None,
            "report_path": str(report_path_out.resolve()) if report_path_out else None,
            "skipped": list(skipped),
            "files": [
                {
                    "path": str(p.resolve()),
                    "change_count": int(n),
                    "records": [
                        {
                            "source": r.source,
                            "old_path": r.old_path,
                            "new_path": r.new_path,
                            "target_file": r.target_file,
                            "verdict": r.verdict,
                            "note": r.note,
                            "count": int(r.count),
                        }
                        for r in recs
                    ],
                }
                for p, n, recs in per_file
            ],
        }
        outp.parent.mkdir(parents=True, exist_ok=True)
        outp.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
