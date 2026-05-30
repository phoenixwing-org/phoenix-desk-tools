"""在 Cursor / VS Code 内置浏览器中打开 URL（非系统 Safari/Chrome）。"""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
from pathlib import Path


def _cursor_cli_candidates() -> list[Path]:
    out: list[Path] = []
    env_cli = os.environ.get("CURSOR_CLI", "").strip()
    if env_cli:
        out.append(Path(env_cli).expanduser())
    for name in ("cursor", "code"):
        found = shutil.which(name)
        if found:
            out.append(Path(found))
    if sys.platform == "darwin":
        out.append(Path("/Applications/Cursor.app/Contents/Resources/app/bin/cursor"))
        out.append(Path("/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code"))
    return out


def find_ide_cli() -> Path | None:
    for cand in _cursor_cli_candidates():
        try:
            if cand.is_file() and os.access(cand, os.X_OK):
                return cand.resolve()
        except OSError:
            continue
    return None


def open_in_ide_browser(url: str) -> bool:
    """通过 ``cursor --open-url`` / ``code --open-url`` 打开内置（集成）浏览器。"""
    cli = find_ide_cli()
    if cli is None:
        return False
    try:
        subprocess.run(
            [str(cli), "--open-url", url],
            check=False,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        return True
    except OSError:
        return False


def print_terminal_link(url: str) -> None:
    """终端 OSC 8 超链接（Cmd+单击可在 Cursor 内置浏览器打开，需 workspace 设置）。"""
    # \033]8;;URL\033\\TEXT\033]8;;\033\\
    print(f"\033]8;;{url}\033\\{url}\033]8;;\033\\", flush=True)
