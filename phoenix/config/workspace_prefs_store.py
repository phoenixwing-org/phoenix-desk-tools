"""工作空间偏好 SQLite 存储（``phoenix_workspace_pref``）。"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from phoenix.freecad.phoenix_store import connect
from phoenix.config.workspace_prefs_schema import T_WORKSPACE_PREF

_META_SECTION = "__meta__"


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def _workspace_sections() -> tuple[str, ...]:
    from phoenix.config.user_prefs import _WORKSPACE_SECTIONS

    return _WORKSPACE_SECTIONS


def prefs_table_empty(repo_root: Path) -> bool:
    rr = repo_root.expanduser().resolve(strict=False)
    with connect(rr) as conn:
        row = conn.execute(f"SELECT COUNT(*) AS n FROM {T_WORKSPACE_PREF}").fetchone()
        return int(row["n"] if row else 0) == 0


def load_prefs_from_sqlite(repo_root: Path) -> dict[str, Any]:
    rr = repo_root.expanduser().resolve(strict=False)
    out: dict[str, Any] = {}
    with connect(rr) as conn:
        rows = conn.execute(
            f"SELECT section, value_json FROM {T_WORKSPACE_PREF}"
        ).fetchall()
        for row in rows:
            section = str(row["section"])
            try:
                payload = json.loads(str(row["value_json"]))
            except json.JSONDecodeError:
                continue
            if section == _META_SECTION:
                if isinstance(payload, dict):
                    out.update(payload)
            elif isinstance(payload, dict):
                out[section] = payload
    return out


def save_prefs_to_sqlite(repo_root: Path, data: dict[str, Any]) -> None:
    rr = repo_root.expanduser().resolve(strict=False)
    now = _utc_now_iso()
    meta: dict[str, Any] = {}
    if isinstance(data.get("version"), int):
        meta["version"] = data["version"]
    if "PartVersion" in data:
        meta["PartVersion"] = data["PartVersion"]

    with connect(rr) as conn:
        conn.execute(f"DELETE FROM {T_WORKSPACE_PREF}")
        if meta:
            conn.execute(
                f"""
                INSERT INTO {T_WORKSPACE_PREF}(section, value_json, updated_at)
                VALUES (?, ?, ?)
                """,
                (_META_SECTION, json.dumps(meta, ensure_ascii=False), now),
            )
        for section in _workspace_sections():
            block = data.get(section)
            if not isinstance(block, dict):
                continue
            conn.execute(
                f"""
                INSERT INTO {T_WORKSPACE_PREF}(section, value_json, updated_at)
                VALUES (?, ?, ?)
                """,
                (section, json.dumps(block, ensure_ascii=False), now),
            )


def import_dotfile_to_sqlite_if_needed(repo_root: Path) -> bool:
    """库内无偏好且存在 JSON dotfile 时，导入一次。"""
    from phoenix.config.user_prefs import _read_json, workspace_dotfile_path

    if not prefs_table_empty(repo_root):
        return False
    raw = _read_json(workspace_dotfile_path(repo_root))
    if not raw:
        return False
    to_save: dict[str, Any] = {}
    if isinstance(raw.get("version"), int):
        to_save["version"] = raw["version"]
    if "PartVersion" in raw:
        to_save["PartVersion"] = raw["PartVersion"]
    for section in _workspace_sections():
        block = raw.get(section)
        if isinstance(block, dict):
            to_save[section] = block
    save_prefs_to_sqlite(repo_root, to_save)
    return True
