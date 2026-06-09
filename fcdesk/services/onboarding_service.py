"""新手指引：工作空间 / FreeCAD / CAD 索引等就绪状态（Web API）。"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any

from fcdesk.config.user_prefs import (
    is_ephemeral_workspace_path,
    list_recent_workspace_paths_raw,
    load_launcher_prefs,
)
from fcdesk.services.fcstd_map_service import load_fcstd_map_payload


def _workspace_configured(ws: Path) -> bool:
    """用户曾在配置/工具栏中保存过该工作空间（写入 launcher 最近列表）。"""
    try:
        resolved = ws.expanduser().resolve(strict=False)
    except OSError:
        return False
    for raw in list_recent_workspace_paths_raw():
        if is_ephemeral_workspace_path(raw):
            continue
        try:
            if raw.expanduser().resolve(strict=False) == resolved:
                return True
        except OSError:
            continue
    return False


def onboarding_status_payload(workspace: Path) -> dict[str, Any]:
    ws = workspace.expanduser().resolve(strict=False)
    workspace_ok = (
        ws.is_dir()
        and os.access(ws, os.R_OK)
        and _workspace_configured(ws)
    )

    launcher = load_launcher_prefs()
    fd = launcher.get("freecad_dir")
    freecad_ok = False
    if fd:
        fp = Path(str(fd)).expanduser()
        freecad_ok = fp.is_dir()

    index_scanned = False
    last_scan_at = ""
    if workspace_ok:
        try:
            payload = load_fcstd_map_payload(ws, include_entries=False)
            last_scan_at = (payload.get("last_scan_at") or "").strip()
            stats = payload.get("stats") if isinstance(payload.get("stats"), dict) else {}
            total = int(stats.get("total_entries") or 0)
            index_scanned = bool(last_scan_at) or total > 0
        except OSError:
            pass

    return {
        "workspace_ok": workspace_ok,
        "workspace_path": str(ws),
        "freecad_ok": freecad_ok,
        "index_scanned": index_scanned,
        "last_scan_at": last_scan_at,
    }
