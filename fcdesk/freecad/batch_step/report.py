"""Markdown 批量报告。"""

from __future__ import annotations

from datetime import datetime
from pathlib import Path
from typing import Iterable, Optional, Tuple

ResultRow = Tuple[str, Optional[str], Optional[str]]


def _escape_md_cell(text: str) -> str:
    return text.replace("|", "\\|").replace("\n", " ").replace("\r", "")


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
    """与旧 ``batch_fcstd_common.write_batch_report_md`` 等价，路径用 pathlib。"""
    report_path = Path(report_path)
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

    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
