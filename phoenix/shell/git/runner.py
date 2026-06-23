from __future__ import annotations

import shutil
import subprocess
from pathlib import Path


def git_executable() -> str | None:
    return shutil.which("git")


def run_git(git_root: Path, *args: str) -> subprocess.CompletedProcess[str]:
    exe = git_executable()
    if not exe:
        raise RuntimeError("未找到 git 可执行文件，请先安装 Git")
    return subprocess.run(
        [exe, "-C", str(git_root), *args],
        capture_output=True,
        text=True,
        check=False,
    )
