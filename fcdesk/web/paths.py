"""Web 版路径与启动辅助。"""

from __future__ import annotations

import subprocess
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parents[2]
_DEFAULT_STATIC = _REPO_ROOT / "web-ui" / "dist"
_DEFAULT_PORT = 5173


def repo_root() -> Path:
    return _REPO_ROOT


def default_static_dir() -> Path:
    return _DEFAULT_STATIC


def default_web_port() -> int:
    return _DEFAULT_PORT


def resolve_static_dir(explicit: str | None) -> Path | None:
    if explicit is not None and explicit.strip():
        return Path(explicit).expanduser().resolve()
    cand = default_static_dir()
    return cand if cand.is_dir() else cand


def build_web_ui(*, repo: Path | None = None) -> None:
    """在 ``web-ui`` 下执行 ``pnpm build``。"""
    root = repo or repo_root()
    ui = root / "web-ui"
    if not (ui / "package.json").is_file():
        raise FileNotFoundError(f"未找到前端工程: {ui}")
    subprocess.run(["pnpm", "build"], cwd=str(ui), check=True)


def default_workspace_path() -> Path:
    try:
        from fcdesk.config.user_prefs import get_recent_workspaces

        for p in get_recent_workspaces():
            if p.is_dir():
                return p.resolve()
    except Exception:
        pass
    return Path.cwd().resolve()
