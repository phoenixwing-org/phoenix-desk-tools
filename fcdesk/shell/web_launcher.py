"""从桌面启动器打开 Web 版（启动或连接本地服务 + 系统浏览器）。"""

from __future__ import annotations

import json
import subprocess
import sys
import time
import urllib.error
import urllib.request
import webbrowser
from pathlib import Path

from fcdesk.web.paths import default_static_dir, default_web_port, repo_root

_DEFAULT_WEB_PAGE = "fcstd_map"


def _base_url(host: str = "127.0.0.1", port: int | None = None) -> str:
    p = port if port is not None else default_web_port()
    return f"http://{host}:{p}"


def _app_url(host: str = "127.0.0.1", port: int | None = None, *, page: str = _DEFAULT_WEB_PAGE) -> str:
    base = _base_url(host, port)
    page_id = page.strip() or _DEFAULT_WEB_PAGE
    return f"{base}/?page={page_id}"


def _server_healthy(base: str, *, timeout: float = 1.0) -> bool:
    try:
        with urllib.request.urlopen(f"{base}/api/health", timeout=timeout) as resp:
            return int(getattr(resp, "status", 200)) == 200
    except (urllib.error.URLError, TimeoutError, ValueError, OSError):
        return False


def _spa_available(base: str, *, timeout: float = 1.0) -> bool:
    try:
        with urllib.request.urlopen(base, timeout=timeout) as resp:
            if int(getattr(resp, "status", 200)) != 200:
                return False
            body = resp.read(4096).decode("utf-8", errors="replace")
            return 'id="app"' in body and ("/assets/" in body or "/src/main" in body)
    except (urllib.error.URLError, TimeoutError, ValueError, OSError):
        return False


def _sync_workspace(base: str, workspace: Path) -> None:
    body = json.dumps({"path": str(workspace.expanduser().resolve(strict=False))}).encode("utf-8")
    req = urllib.request.Request(
        f"{base}/api/workspace",
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=5) as resp:
        if int(getattr(resp, "status", 200)) >= 400:
            raise RuntimeError(f"同步工作空间失败: HTTP {resp.status}")


def open_web_ui(
    workspace: Path,
    *,
    host: str = "127.0.0.1",
    port: int | None = None,
    page: str = _DEFAULT_WEB_PAGE,
) -> str:
    """确保 Web 服务可用并打开系统浏览器；返回访问 URL。"""
    ws = workspace.expanduser().resolve(strict=False)
    if not ws.is_dir():
        raise ValueError(f"工作空间不是有效目录: {ws}")

    base = _base_url(host, port)
    url = _app_url(host, port, page=page)
    need_spawn = not (_server_healthy(base) and _spa_available(base))

    if not need_spawn:
        try:
            _sync_workspace(base, ws)
        except (urllib.error.URLError, TimeoutError, OSError, ValueError) as exc:
            raise RuntimeError(f"Web 服务已在运行，但同步工作空间失败: {exc}") from exc
        webbrowser.open(url)
        return url

    cmd = [
        sys.executable,
        "-m",
        "fcdesk.web",
        "-w",
        str(ws),
        "--host",
        host,
        "--port",
        str(port if port is not None else default_web_port()),
        "--no-open",
    ]
    if not default_static_dir().is_dir():
        cmd.append("--build")
    subprocess.Popen(
        cmd,
        cwd=str(repo_root()),
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        start_new_session=True,
    )
    deadline = time.monotonic() + 45.0
    while time.monotonic() < deadline:
        if _server_healthy(base) and _spa_available(base):
            try:
                _sync_workspace(base, ws)
            except (urllib.error.URLError, TimeoutError, OSError, ValueError):
                pass
            webbrowser.open(url)
            return url
        time.sleep(0.35)
    webbrowser.open(url)
    return url
