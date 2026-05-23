"""用户偏好：fcdesk/config/workspace.custom.json"""

from __future__ import annotations

import json
from copy import deepcopy
from pathlib import Path
from typing import Any

_DEFAULT: dict[str, Any] = {
    "version": 1,
    "toolbar": {"repo_root": None, "freecad_dir": None},
    "fc_linkfix": {
        # cad_search_root: None → 与各页默认一致「使用当前工作空间根」
        "cad_search_root": None,
        "freecad_batch_dir": None,
        "dry_run": True,
        "all_in_dir": True,
    },
    "fcstd_map": {"scan_root": None},
    "step_batch": {
        "project_relative": None,
        "step_dir": None,
        "out_dir": None,
        "skip_existing": True,
        "view_fit": "none",
        "use_inbox_bridge": False,
        "step_recursive": False,
    },
    "sw_step_export": {
        "source_dir": None,
        "out_step_dir": None,
        "recursive_scan": False,
    },
}


def workspace_prefs_file() -> Path:
    return Path(__file__).resolve().parent / "workspace.custom.json"


def store_path_under_repo(path: Path, repo_root: Path) -> str:
    p = path.expanduser().resolve()
    rr = repo_root.expanduser().resolve()
    try:
        return p.relative_to(rr).as_posix()
    except ValueError:
        return str(p)


def resolve_pref_path(stored: str | None, repo_root: Path) -> Path | None:
    if stored is None or not str(stored).strip():
        return None
    s = str(stored).strip()
    if Path(s).is_absolute():
        return Path(s).expanduser().resolve()
    return (repo_root.expanduser().resolve() / Path(s)).resolve()


def load_workspace_prefs() -> dict[str, Any]:
    data = deepcopy(_DEFAULT)
    path = workspace_prefs_file()
    if not path.is_file():
        return data
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(raw, dict):
            return data
        for key in ("toolbar", "fc_linkfix", "fcstd_map", "step_batch", "sw_step_export"):
            inc = raw.get(key)
            if isinstance(inc, dict) and isinstance(data[key], dict):
                data[key].update(inc)
        if isinstance(raw.get("version"), int):
            data["version"] = raw["version"]
    except (OSError, json.JSONDecodeError):
        pass
    return data


def save_workspace_prefs(data: dict[str, Any]) -> None:
    path = workspace_prefs_file()
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    tmp.replace(path)


def merge_workspace_section(section: str, patch: dict[str, Any]) -> dict[str, Any]:
    dat = load_workspace_prefs()
    cur = dat.get(section)
    if not isinstance(cur, dict):
        cur = {}
        dat[section] = cur
    for k, v in patch.items():
        if v is None:
            cur.pop(k, None)
        else:
            cur[k] = v
    save_workspace_prefs(dat)
    return dat


def apply_toolbar_prefs_to_state(state: Any, dat: dict[str, Any]) -> None:
    tbar = dat.get("toolbar") or {}
    rr = tbar.get("repo_root")
    if rr:
        p = Path(str(rr)).expanduser().resolve()
        if p.is_dir():
            state.repo_root = p
    fd = tbar.get("freecad_dir")
    if fd:
        p = Path(str(fd)).expanduser().resolve()
        if p.is_dir():
            state.freecad_dir = p
