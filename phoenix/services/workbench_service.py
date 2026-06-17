"""Web Workbench 会话 — Tab 与页内状态持久化（``ui_session`` 表）。"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from phoenix.config.user_prefs import format_resolved_under_workspace
from phoenix.freecad.phoenix_store import (
    cad_database_path,
    load_ui_session,
    save_ui_session,
    ui_session_updated_at,
)

SESSION_VERSION = 1


def get_workbench_session_payload(repo_root: Path) -> dict[str, Any]:
    rr = repo_root.expanduser().resolve(strict=False)
    session = load_ui_session(rr)
    updated_at = ui_session_updated_at(rr)
    return {
        "version": SESSION_VERSION,
        "session": session,
        "updated_at": updated_at,
        "database_path": str(cad_database_path(rr)),
        "database_path_display": format_resolved_under_workspace(cad_database_path(rr), rr),
    }


def save_workbench_session(repo_root: Path, session: dict[str, Any] | None) -> dict[str, Any]:
    rr = repo_root.expanduser().resolve(strict=False)
    if session is None:
        updated_at = save_ui_session(rr, {"version": SESSION_VERSION, "active_tab_id": "", "tabs": []})
    else:
        body = dict(session)
        body["version"] = SESSION_VERSION
        updated_at = save_ui_session(rr, body)
    return {
        "version": SESSION_VERSION,
        "session": load_ui_session(rr),
        "updated_at": updated_at,
        "database_path_display": format_resolved_under_workspace(cad_database_path(rr), rr),
    }
