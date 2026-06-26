"""从桌面启动器打开 / 关闭 Web 版（本地服务 + 系统浏览器）。"""

from __future__ import annotations

import json
import os
import signal
import subprocess
import sys
import time
import urllib.error
import urllib.request
import webbrowser
from dataclasses import dataclass, field
from pathlib import Path

from phoenix.web.paths import default_static_dir, default_web_port, repo_root

_DEFAULT_WEB_PAGE = "fcstd_map"
_last_spawned_pid: int | None = None


# ═══════════════════════════════════════════════
# 通用服务管理
# ═══════════════════════════════════════════════

@dataclass
class ServiceDef:
    name: str
    port: int
    health_path: str  # e.g. "/api/health" or "/"
    terminal_cmd: str  # 在终端中运行的命令


# 三服务定义
SERVICES: list[ServiceDef] = [
    ServiceDef("Python API", 8765, "/api/health", f"{sys.executable} -m phoenix.web --dev"),
    ServiceDef("CAA Node", 5180, "/api/caa/health", "pnpm dev:caa"),
    ServiceDef("Vite UI", 5173, "/", "pnpm dev:ui"),
]


def _http_ok(url: str, *, timeout: float = 1.5) -> bool:
    try:
        with urllib.request.urlopen(url, timeout=timeout) as resp:
            return 200 <= int(getattr(resp, "status", 0)) < 400
    except (urllib.error.URLError, TimeoutError, ValueError, OSError):
        return False


def check_service(svc: ServiceDef, *, timeout: float = 1.5) -> dict[str, object]:
    """纯 HTTP 健康检查，无子进程（Tkinter 安全）。"""
    url = f"http://127.0.0.1:{svc.port}{svc.health_path}"
    running = _http_ok(url, timeout=timeout)
    pid = None
    if running:
        pids = find_listening_pids(svc.port)
        pid = pids[0] if pids else None
    return {"running": running, "port": svc.port, "url": f"http://127.0.0.1:{svc.port}", "pid": pid}


def _wt_available() -> bool:
    """检查 Windows Terminal 是否可用。"""
    if sys.platform != "win32":
        return False
    try:
        subprocess.run(["where", "wt"], capture_output=True, check=False)
        return True
    except OSError:
        return False


def open_service_terminal(svc: ServiceDef) -> None:
    """弹出终端窗口运行服务（Windows Terminal 优先）。"""
    root = str(repo_root())
    title = f"{svc.name} :{svc.port}"
    if _wt_available():
        subprocess.Popen(
            f'wt -d "{root}" --suppressApplicationTitle --title "{title}" '
            f'cmd /k "echo [{svc.name}] :{svc.port} && {svc.terminal_cmd}"',
            shell=True,
        )
    elif sys.platform == "win32":
        subprocess.Popen(
            f'start "{svc.name}" cmd /k "cd /d {root} && {svc.terminal_cmd}"',
            shell=True,
        )
    else:
        subprocess.Popen(
            ["osascript", "-e",
             f'tell app "Terminal" to do script "cd {root} && echo {title} && {svc.terminal_cmd}"'],
        )


def open_all_terminals() -> None:
    """弹出 Windows Terminal 多 Tab（后端先启动，5s 后启动前端）。"""
    root = str(repo_root())
    _VITE_DELAY = 5  # 秒
    if _wt_available():
        cmd_parts = [f'wt -d "{root}"']
        for i, svc in enumerate(SERVICES):
            if i > 0:
                cmd_parts.append(";")
                cmd_parts.append("new-tab")
                cmd_parts.append(f'-d "{root}"')
            cmd_parts.append("--suppressApplicationTitle")
            cmd_parts.append(f'--title "{svc.name} :{svc.port}"')
            if svc.port == 5173:
                msg = f'echo [{svc.name}] :{svc.port} (waiting {_VITE_DELAY}s for backends...) && timeout /t {_VITE_DELAY} /nobreak >nul && {svc.terminal_cmd}'
            else:
                msg = f'echo [{svc.name}] :{svc.port} && {svc.terminal_cmd}'
            cmd_parts.append(f'cmd /k "{msg}"')
        subprocess.Popen(" ".join(cmd_parts), shell=True)
    elif sys.platform == "win32":
        subprocess.Popen(
            f'start "Phoenix" cmd /k "cd /d {root} && '
            f'echo === Vite + CAA === && pnpm dev"',
            shell=True,
        )
        subprocess.Popen(
            f'start "Python API" cmd /k "cd /d {root} && '
            f'echo === Python API :8765 === && {SERVICES[0].terminal_cmd}"',
            shell=True,
        )
    else:
        for svc in SERVICES:
            subprocess.Popen(
                ["osascript", "-e",
                 f'tell app "Terminal" to do script "cd {root} && echo {svc.name} :{svc.port} && {svc.terminal_cmd}"'],
            )


def stop_service_by_port(port: int) -> bool:
    """按端口终止进程；返回是否成功释放。"""
    pids = find_listening_pids(port)
    if not pids:
        return True
    for pid in pids:
        if _pid_alive(pid):
            try:
                _terminate_pid(pid, force=False)
            except RuntimeError:
                pass
    time.sleep(0.3)
    for pid in pids:
        if _pid_alive(pid):
            try:
                _terminate_pid(pid, force=True)
            except RuntimeError:
                pass
    time.sleep(0.2)
    return not bool(find_listening_pids(port))


def stop_all_services() -> dict[str, bool]:
    """停止全部三服务；返回各服务结果。"""
    results: dict[str, bool] = {}
    for svc in SERVICES:
        results[svc.name] = stop_service_by_port(svc.port)
    return results


# ═══════════════════════════════════════════════
# 原有 Web UI 管理（兼容保留）
# ═══════════════════════════════════════════════


@dataclass
class StopWebResult:
    message: str
    logs: list[str] = field(default_factory=list)
    ok: bool = True


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


def web_server_running(*, host: str = "127.0.0.1", port: int | None = None) -> bool:
    base = _base_url(host, port)
    return _server_healthy(base)


def web_server_status(*, host: str = "127.0.0.1", port: int | None = None) -> dict[str, object]:
    p = port if port is not None else default_web_port()
    base = _base_url(host, p)
    running = _server_healthy(base)
    return {
        "running": running,
        "host": host,
        "port": p,
        "url": base,
        "spa": _spa_available(base) if running else False,
    }


def _run_cmd_no_threads(args: list[str]) -> str:
    """运行命令返回 stdout（无 communicate 线程，Tkinter 安全）。"""
    try:
        p = subprocess.Popen(args, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
        out, _ = p.communicate(timeout=8)
        return out.decode("utf-8", errors="replace")
    except (OSError, subprocess.TimeoutExpired):
        try:
            p.kill()
        except Exception:
            pass
        return ""


def find_listening_pids(port: int) -> list[int]:
    """查找监听指定 TCP 端口的进程 PID。"""
    pids = _find_listening_pids_lsof(port)
    if pids:
        return pids
    if sys.platform == "darwin":
        return _find_listening_pids_netstat_darwin(port)
    if sys.platform == "win32":
        return _find_listening_pids_windows(port)
    return []


def _find_listening_pids_lsof(port: int) -> list[int]:
    if sys.platform == "win32":
        return []
    out = _run_cmd_no_threads(["lsof", "-nP", f"-iTCP:{port}", "-sTCP:LISTEN", "-t"])
    pids: list[int] = []
    for line in out.splitlines():
        s = line.strip()
        if s.isdigit():
            pids.append(int(s))
    return sorted(set(pids))


def _find_listening_pids_netstat_darwin(port: int) -> list[int]:
    out = _run_cmd_no_threads(["netstat", "-anv", "-p", "tcp"])
    needle = f".{port} "
    pids: list[int] = []
    for line in out.splitlines():
        if "LISTEN" not in line or needle not in line:
            continue
        parts = line.split()
        if len(parts) >= 10 and parts[-1].isdigit():
            pids.append(int(parts[-1]))
    return sorted(set(pids))


def _find_listening_pids_windows(port: int) -> list[int]:
    out = _run_cmd_no_threads(["netstat", "-ano", "-p", "tcp"])
    needle = f":{port}"
    pids: list[int] = []
    for line in out.splitlines():
        if "LISTENING" not in line or needle not in line:
            continue
        parts = line.split()
        if parts and parts[-1].isdigit():
            pids.append(int(parts[-1]))
    return sorted(set(pids))


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


def _read_http_error_body(exc: urllib.error.HTTPError) -> str:
    try:
        return exc.read().decode("utf-8", errors="replace")[:240]
    except (OSError, ValueError):
        return ""


def _request_shutdown(base: str, *, timeout: float = 2.0) -> tuple[bool, list[str]]:
    """尝试 POST/GET shutdown；旧版无该路由时会返回 404/405。"""
    notes: list[str] = []
    for method, data in (("POST", b"{}"), ("GET", None)):
        try:
            req = urllib.request.Request(f"{base}/api/shutdown", method=method)
            if data is not None:
                req.data = data
                req.add_header("Content-Type", "application/json")
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                if int(getattr(resp, "status", 200)) < 400:
                    notes.append(f"已通过 {method} /api/shutdown 请求关闭")
                    return True, notes
        except urllib.error.HTTPError as exc:
            body = _read_http_error_body(exc)
            notes.append(f"{method} /api/shutdown → HTTP {exc.code}: {body or exc.reason}")
            if exc.code in (404, 405):
                continue
        except (urllib.error.URLError, TimeoutError, ValueError, OSError) as exc:
            notes.append(f"{method} /api/shutdown 失败: {exc}")
    return False, notes


def push_shell_log(base: str, text: str, *, source: str = "launcher") -> None:
    chunk = str(text).strip()
    if not chunk:
        return
    body = json.dumps({"text": chunk, "source": source}).encode("utf-8")
    req = urllib.request.Request(
        f"{base}/api/shell/log",
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=1.5):
            return
    except (urllib.error.URLError, TimeoutError, ValueError, OSError):
        return


def push_shell_logs(base: str, lines: list[str], *, source: str = "launcher") -> None:
    for line in lines:
        push_shell_log(base, line, source=source)


def _pid_alive(pid: int) -> bool:
    if pid <= 0:
        return False
    try:
        os.kill(pid, 0)
    except OSError:
        return False
    return True


def _terminate_pid(pid: int, *, force: bool = False) -> None:
    sig = signal.SIGKILL if force else signal.SIGTERM
    try:
        os.kill(pid, sig)
    except ProcessLookupError:
        pass
    except OSError as exc:
        raise RuntimeError(f"无法结束进程 {pid}: {exc}") from exc


def _wait_until_stopped(base: str, pids: list[int], *, timeout_s: float = 5.0) -> bool:
    deadline = time.monotonic() + timeout_s
    while time.monotonic() < deadline:
        if not _server_healthy(base, timeout=0.6) and not any(_pid_alive(pid) for pid in pids):
            return True
        time.sleep(0.2)
    return not _server_healthy(base, timeout=0.6)


def stop_web_ui(*, host: str = "127.0.0.1", port: int | None = None) -> StopWebResult:
    """停止本地 Web 服务并释放端口。"""
    global _last_spawned_pid

    p = port if port is not None else default_web_port()
    base = _base_url(host, p)
    logs: list[str] = []

    if not web_server_running(host=host, port=p):
        _last_spawned_pid = None
        return StopWebResult(f"Web 服务未运行（{host}:{p}）", logs=logs)

    pids = find_listening_pids(p)
    if _last_spawned_pid and _last_spawned_pid not in pids and _pid_alive(_last_spawned_pid):
        pids.append(_last_spawned_pid)
    pids = sorted(set(pids))
    if pids:
        logs.append(f"检测到监听进程 PID: {', '.join(str(x) for x in pids)}")
    else:
        logs.append("未检测到监听 PID，将尝试 API 关闭")

    api_ok, api_notes = _request_shutdown(base)
    logs.extend(api_notes)
    push_shell_logs(base, logs)

    wait_s = 3.0 if api_ok else 0.5
    if _wait_until_stopped(base, pids, timeout_s=wait_s):
        _last_spawned_pid = None
        msg = f"Web 服务已关闭（已释放 {host}:{p}）"
        logs.append(msg)
        push_shell_log(base, msg)
        return StopWebResult(msg, logs=logs)

    if not pids:
        msg = (
            f"无法关闭 Web 服务：shutdown API 不可用且未找到 PID。"
            f"请重启本程序或手动结束占用 {host}:{p} 的进程。"
        )
        logs.append(msg)
        push_shell_log(base, msg)
        return StopWebResult(msg, logs=logs, ok=False)

    for pid in pids:
        if _pid_alive(pid):
            logs.append(f"向 PID {pid} 发送 SIGTERM")
            _terminate_pid(pid, force=False)
    push_shell_logs(base, logs)

    if _wait_until_stopped(base, pids, timeout_s=3.0):
        _last_spawned_pid = None
        msg = f"Web 服务已关闭（已释放 {host}:{p}）"
        logs.append(msg)
        push_shell_log(base, msg)
        return StopWebResult(msg, logs=logs)

    for pid in pids:
        if _pid_alive(pid):
            logs.append(f"向 PID {pid} 发送 SIGKILL")
            _terminate_pid(pid, force=True)
    push_shell_logs(base, logs)

    if web_server_running(host=host, port=p):
        msg = f"无法停止占用 {host}:{p} 的进程（PID: {', '.join(str(x) for x in pids)}）"
        logs.append(msg)
        push_shell_log(base, msg)
        return StopWebResult(msg, logs=logs, ok=False)

    _last_spawned_pid = None
    msg = f"Web 服务已关闭（已释放 {host}:{p}）"
    logs.append(msg)
    return StopWebResult(msg, logs=logs)


def open_web_ui(
    workspace: Path,
    *,
    host: str = "127.0.0.1",
    port: int | None = None,
    page: str = _DEFAULT_WEB_PAGE,
) -> str:
    """确保 Web 服务可用并打开系统浏览器；返回访问 URL。"""
    global _last_spawned_pid

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
        "phoenix.web",
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
    proc = subprocess.Popen(
        cmd,
        cwd=str(repo_root()),
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        start_new_session=True,
    )
    _last_spawned_pid = proc.pid
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
