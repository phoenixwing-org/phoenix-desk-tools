"""Markdown 批量报告。"""

from __future__ import annotations

import re
from datetime import datetime
from pathlib import Path
from typing import Iterable, Optional, Tuple

ResultRow = Tuple[str, Optional[str], Optional[str]]

_BATCH_STATS_RE = re.compile(r"统计：成功 (\d+)，跳过 (\d+)，失败 (\d+)，合计 (\d+)")
_FCD_STDERR_STATS_RE = re.compile(
    r"\[phoenix\]\s*OK=(\d+)\s+skip=(\d+)\s+fail=(\d+)\s+total=(\d+)",
    re.IGNORECASE,
)


def parse_batch_step_stderr_summary(text: str) -> dict[str, int] | None:
    """从 freecadcmd stderr 末尾 ``[phoenix] OK=…`` 行解析统计。"""
    match = _FCD_STDERR_STATS_RE.search(text or "")
    if not match:
        return None
    return {
        "ok": int(match.group(1)),
        "skip": int(match.group(2)),
        "fail": int(match.group(3)),
        "total": int(match.group(4)),
    }


def parse_batch_step_report_summary(report_path: Path | str) -> dict[str, int] | None:
    """从 ``write_batch_step_report_md`` 生成的报告中解析统计行。"""
    path = Path(report_path)
    if not path.is_file():
        return None
    try:
        text = path.read_text(encoding="utf-8")
    except OSError:
        return None
    match = _BATCH_STATS_RE.search(text)
    if not match:
        return None
    return {
        "ok": int(match.group(1)),
        "skip": int(match.group(2)),
        "fail": int(match.group(3)),
        "total": int(match.group(4)),
    }


def _escape_md_cell(text: str) -> str:
    return text.replace("|", "\\|").replace("\n", " ").replace("\r", "")


def render_batch_step_report_md(
    *,
    step_dir: Path | str,
    out_dir: Path | str,
    results: Iterable[ResultRow],
    ok: int,
    skip: int,
    fail: int,
    project_tag: str = "",
) -> str:
    """生成 Markdown 报告正文（不写盘）。"""
    step_s = str(Path(step_dir).resolve())
    out_s = str(Path(out_dir).resolve())
    results = list(results)
    lines = [
        "# STEP → FCStd 批量转换结果",
        "",
        f"- 工程标识：`{project_tag or '（未填）'}`",
        f"- 生成时间（本地）：{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}",
        f"- STEP 目录：`{step_s}`",
        f"- 输出目录：`{out_s}`",
        f"- 统计：成功 {ok}，跳过 {skip}，失败 {fail}，合计 {len(results)}",
        "",
        "| 文件名 | 结果 |",
        "| --- | --- |",
    ]
    for step_path, _out_path, err in results:
        name = Path(step_path).name
        if err == "skip_existing":
            status = "跳过（FCStd 已存在）"
        elif err:
            status = f"失败：{_escape_md_cell(err)}"
        else:
            status = "成功"
        lines.append(f"| {_escape_md_cell(name)} | {status} |")

    lines.extend(
        [
            "",
            "说明见仓库 `doc/STEP批量转FCStd.md`；由桌面「STEP 批量」或 FreeCADCmd 运行。",
        ]
    )
    return "\n".join(lines) + "\n"


def write_batch_step_report_md(
    report_path: Path | str,
    *,
    step_dir: Path | str,
    out_dir: Path | str,
    results: Iterable[ResultRow],
    ok: int,
    skip: int,
    fail: int,
    project_tag: str = "",
) -> None:
    """写入 Markdown 报告（``FCD_BATCH_WRITE_REPORT=1`` 时由批处理脚本调用）。"""
    report_path = Path(report_path)
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(
        render_batch_step_report_md(
            step_dir=step_dir,
            out_dir=out_dir,
            results=results,
            ok=ok,
            skip=skip,
            fail=fail,
            project_tag=project_tag,
        ),
        encoding="utf-8",
    )
