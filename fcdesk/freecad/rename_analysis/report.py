"""改名分析报告（Markdown）。"""

from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Mapping

from fcdesk.config.user_prefs import format_resolved_under_workspace
from fcdesk.freecad.phoenix_store import phoenix_reports_dir


def write_rename_analysis_report(
    repo_root: Path,
    *,
    scan: Mapping[str, Any],
    rename_log: Mapping[str, Any] | None = None,
    old_basename: str | None = None,
    new_basename: str | None = None,
    note: str | None = None,
) -> dict[str, str]:
    """用户主动「导出报告」时写入 ``.phoenix/reports/rename-analysis-*.md``（非分析/修正默认流程）。"""
    rr = repo_root.expanduser().resolve(strict=False)
    reports = phoenix_reports_dir(rr)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    path = reports / f"rename-analysis-{stamp}.md"

    ob = old_basename or (rename_log or {}).get("old_basename") or "?"
    nb = new_basename or (rename_log or {}).get("new_basename") or "?"
    host_count = int(scan.get("host_count") or 0)
    hit_count = int(scan.get("hit_count") or 0)

    lines = [
        "# 改名分析报告",
        "",
        f"- 生成时间（UTC）: {datetime.now(timezone.utc).replace(microsecond=0).isoformat()}",
        f"- 旧 basename: `{ob}`",
        f"- 新 basename: `{nb}`",
        f"- 宿主文件数: {host_count}",
        f"- XLink 命中数: {hit_count}",
    ]
    if rename_log:
        lines.append(f"- 改名记录 ID: {rename_log.get('id')}")
        lines.append(f"- 旧路径: `{rename_log.get('old_repo_rel_path')}`")
        lines.append(f"- 新路径: `{rename_log.get('new_repo_rel_path')}`")
    if note:
        lines.extend(["", note])

    lines.extend(["", "## 宿主与替换", ""])
    hosts = scan.get("hosts") or []
    if not hosts:
        lines.append("_未发现仍引用旧 basename 的 XLink。_")
    else:
        lines.append("| 宿主 | 状态 | 原 file 属性 | 建议新值 |")
        lines.append("| --- | --- | --- | --- |")
        for host in hosts:
            hname = host.get("host_filename") or host.get("host_repo_rel_path")
            for hit in host.get("hits") or []:
                status = hit.get("status") or "pending"
                lines.append(
                    f"| `{hname}` | {status} | `{hit.get('matched_text', '')}` | `{hit.get('proposed_text', '')}` |"
                )

    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return {
        "report_path": str(path),
        "report_path_display": format_resolved_under_workspace(path, rr),
    }
