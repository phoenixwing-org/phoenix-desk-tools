"""三服务管理：健康检查、PID 发现、进程终止、终端启动。

纯逻辑层，无 Tkinter 依赖，可单独单元测试。
"""

from __future__ import annotations

import re
import signal
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
import warnings
from dataclasses import dataclass
from typing import Any

from phoenix.web.paths import repo_root

warnings.filterwarnings("ignore", message=".*iCCP.*")


# ═══════════════════════════════════════════════
# 服务定义
# ═══════════════════════════════════════════════

@dataclass
class ServiceDef:
    name: str
    port: int
    health_path: str  # e.g. "/api/health" or "/"
    terminal_cmd: str  # 在终端中运行的命令


SERVICES: list[ServiceDef] = [
    ServiceDef("Python API", 8765, "/api/health", f"{sys.executable} -m phoenix.web --dev"),
    ServiceDef("CAA Node", 5180, "/api/caa/health", "pnpm dev:caa"),
    ServiceDef("Vite UI", 5173, "/", "pnpm dev:ui"),
]


# ═══════════════════════════════════════════════
# HTTP 健康检查
# ═══════════════════════════════════════════════

_host_cache: dict[int, str] = {}


def _http_ok(url: str, *, timeout: float = 1.5) -> bool:
    try:
        with urllib.request.urlopen(url, timeout=timeout) as resp:
            return 200 <= int(getattr(resp, "status", 0)) < 400
    except (urllib.error.URLError, TimeoutError, ValueError, OSError):
        return False


def check_service(svc: ServiceDef, *, timeout: float = 1.5) -> dict[str, Any]:
    """纯 HTTP 健康检查，无子进程。优先用上次成功的 host。"""
    port = svc.port
    cached = _host_cache.get(port, "localhost")
    candidates = [cached] + [h for h in ("localhost", "127.0.0.1") if h != cached]
    for host in candidates:
        url = f"http://{host}:{port}{svc.health_path}"
        if _http_ok(url, timeout=timeout):
            _host_cache[port] = host
            pid = None
            pids = find_listening_pids(port)
            if pids:
                pid = pids[0]
            return {"running": True, "port": port, "url": url, "pid": pid}
    return {"running": False, "port": port, "url": f"http://localhost:{port}", "pid": None}


# ═══════════════════════════════════════════════
# PID 发现（平台适配）
# ═══════════════════════════════════════════════

def _run_cmd(args: list[str]) -> str:
    """运行命令返回 stdout。后台线程使用，Tkinter 回调勿调。"""
    try:
        p = subprocess.Popen(args, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
        out, _ = p.communicate(timeout=10)
        return out.decode("utf-8", errors="replace")
    except (OSError, subprocess.TimeoutExpired):
        try:
            p.kill()
        except Exception:
            pass
        return ""


def find_listening_pids(port: int) -> list[int]:
    """查找监听指定 TCP 端口的进程 PID。"""
    pids = _find_pids_lsof(port)
    if pids:
        return pids
    if sys.platform == "darwin":
        return _find_pids_netstat_darwin(port)
    if sys.platform == "win32":
        return _find_pids_windows(port)
    return _find_pids_linux(port)


def _find_pids_lsof(port: int) -> list[int]:
    if sys.platform == "win32":
        return []
    out = _run_cmd(["lsof", "-nP", f"-iTCP:{port}", "-sTCP:LISTEN", "-t"])
    pids: list[int] = []
    for line in out.splitlines():
        s = line.strip()
        if s.isdigit():
            pids.append(int(s))
    return sorted(set(pids))


def _find_pids_netstat_darwin(port: int) -> list[int]:
    out = _run_cmd(["netstat", "-anv", "-p", "tcp"])
    needle = f".{port} "
    pids: list[int] = []
    for line in out.splitlines():
        if "LISTEN" not in line or needle not in line:
            continue
        parts = line.split()
        if len(parts) >= 10 and parts[-1].isdigit():
            pids.append(int(parts[-1]))
    return sorted(set(pids))


def _find_pids_windows(port: int) -> list[int]:
    """Windows: netstat -ano 查监听端口 PID。

    注意：不能用 netstat -ano -p tcp —— Windows 上 -p tcp 只含 IPv4，
    Vite/Node 常监听 [::1] (IPv6)，会被错误排除。
    """
    out = _run_cmd(["netstat", "-ano"])
    needle = f":{port}"
    pids: list[int] = []
    for line in out.splitlines():
        if "LISTENING" not in line or needle not in line:
            continue
        parts = line.split()
        if parts and parts[-1].isdigit():
            pids.append(int(parts[-1]))
    return sorted(set(pids))


def _find_pids_linux(port: int) -> list[int]:
    pids: list[int] = []
    out = _run_cmd(["ss", "-tlnp"])
    for line in out.splitlines():
        if f":{port}" not in line:
            continue
        m = re.search(r"pid=(\d+)", line)
        if m:
            pids.append(int(m.group(1)))
    if pids:
        return sorted(set(pids))
    out = _run_cmd(["netstat", "-tlnp"])
    for line in out.splitlines():
        if f":{port}" not in line or "LISTEN" not in line:
            continue
        parts = line.split()
        if parts and "/" in parts[-1]:
            pid_s = parts[-1].split("/")[0]
            if pid_s.isdigit():
                pids.append(int(pid_s))
    return sorted(set(pids))


# ═══════════════════════════════════════════════
# 进程终止
# ═══════════════════════════════════════════════

def _pid_alive(pid: int) -> bool:
    if pid <= 0:
        return False
    if sys.platform == "win32":
        try:
            r = subprocess.run(
                ["tasklist", "/FI", f"PID eq {pid}", "/NH"],
                capture_output=True, text=True, check=False,
            )
            return str(pid) in r.stdout
        except OSError:
            return True
    # macOS / Linux: signal-0 探活 + ps 兜底
    try:
        os.kill(pid, 0)
        return True
    except Exception:
        pass
    # macOS 上某些进程 os.kill(0) 可能抛非 OSError；ps 兜底
    try:
        r = subprocess.run(
            ["ps", "-p", str(pid), "-o", "pid="],
            capture_output=True, text=True, check=False,
        )
        return str(pid) in r.stdout
    except Exception:
        return False


def _terminate_pid(pid: int) -> None:
    if sys.platform == "win32":
        r = subprocess.run(
            ["taskkill", "/PID", str(pid), "/F", "/T"],  # /T 杀进程树
            capture_output=True, text=True, check=False,
        )
        if r.returncode != 0:
            raise RuntimeError(r.stderr.strip() or r.stdout.strip() or f"exit {r.returncode}")
    else:
        # macOS / Linux：先 os.kill，失败则 fallback 到 /bin/kill
        for sig in (signal.SIGTERM, signal.SIGKILL):
            try:
                os.kill(pid, sig)
            except ProcessLookupError:
                return
            except Exception:
                # macOS 上 os.kill 有时抛非预期异常，fallback 到系统 kill 命令
                sig_name = "KILL" if sig == signal.SIGKILL else "TERM"
                try:
                    subprocess.run(
                        ["/bin/kill", f"-{sig_name}", str(pid)],
                        capture_output=True, check=False,
                    )
                except Exception as exc:
                    raise RuntimeError(f"无法结束进程 {pid}: {exc}") from exc
            time.sleep(0.3)
            if not _pid_alive(pid):
                return


def stop_service_pids(port: int, pids: list[int]) -> bool:
    """终止服务进程（kill_pids 别名）。"""
    return kill_pids(port, pids)


def kill_pids(port: int, pids: list[int]) -> bool:
    """终止指定 PID 列表；返回是否成功释放端口。"""
    print(f"[service_manager] kill port={port} pids={pids}")
    if not pids:
        return True
    for pid in pids:
        if _pid_alive(pid):
            print(f"[service_manager] killing PID {pid}")
            try:
                _terminate_pid(pid)
            except RuntimeError as e:
                print(f"[service_manager] kill failed: {e}")
    time.sleep(0.3)
    for pid in pids:
        if _pid_alive(pid):
            print(f"[service_manager] retry PID {pid}")
            try:
                _terminate_pid(pid)
            except RuntimeError as e:
                print(f"[service_manager] retry failed: {e}")
    time.sleep(0.2)
    ok = not bool(find_listening_pids(port))
    print(f"[service_manager] kill port={port} done ok={ok}")
    return ok


# ═══════════════════════════════════════════════
# 终端启动
# ═══════════════════════════════════════════════

def _wt_available() -> bool:
    if sys.platform != "win32":
        return False
    try:
        subprocess.run(["where", "wt"], capture_output=True, check=False)
        return True
    except OSError:
        return False


def open_service_terminal(svc: ServiceDef) -> None:
    """弹出终端窗口运行服务。"""
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
    elif sys.platform == "darwin":
        subprocess.Popen(
            ["osascript", "-e",
             f'tell app "Terminal" to do script "cd {root} && echo {title} && {svc.terminal_cmd}"'],
        )
    else:
        for term in ("x-terminal-emulator", "gnome-terminal", "konsole", "xfce4-terminal", "xterm"):
            try:
                subprocess.Popen(
                    [term, "-e", f"cd {root} && echo {title} && {svc.terminal_cmd}"],
                    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                )
                break
            except (OSError, FileNotFoundError):
                continue


def open_all_terminals() -> None:
    """弹出 Windows Terminal 多 Tab（后端先启动，5s 后前端）。"""
    root = str(repo_root())
    _VITE_DELAY = 5
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
            f'start "Phoenix" cmd /k "cd /d {root} && echo Vite+CAA && pnpm dev"', shell=True)
        subprocess.Popen(
            f'start "Python API" cmd /k "cd /d {root} && echo Python API :8765 && {SERVICES[0].terminal_cmd}"',
            shell=True)
    elif sys.platform == "darwin":
        for svc in SERVICES:
            subprocess.Popen(
                ["osascript", "-e",
                 f'tell app "Terminal" to do script "cd {root} && echo {svc.name} :{svc.port} && {svc.terminal_cmd}"'],
            )
    else:
        for svc in SERVICES:
            for term in ("x-terminal-emulator", "gnome-terminal", "konsole", "xfce4-terminal", "xterm"):
                try:
                    subprocess.Popen(
                        [term, "-e", f"cd {root} && echo {svc.name} :{svc.port} && {svc.terminal_cmd}"],
                        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                    )
                    break
                except (OSError, FileNotFoundError):
                    continue


# ═══════════════════════════════════════════════
# 后台监控器
# ═══════════════════════════════════════════════

class ServiceMonitor:
    """后台线程轮询服务状态，缓存 running + PID，UI 只读缓存。"""

    def __init__(self, poll_interval: float = 3.0):
        self._lock = threading.Lock()
        self._running: dict[int, bool] = {}
        self._pids: dict[int, list[int]] = {}
        self._interval = poll_interval
        self._thread: threading.Thread | None = None

    @property
    def is_running(self) -> dict[int, bool]:
        with self._lock:
            return dict(self._running)

    def get_pids(self, port: int) -> list[int]:
        with self._lock:
            return list(self._pids.get(port, []))

    def start(self) -> None:
        if self._thread and self._thread.is_alive():
            return

        def _loop() -> None:
            while True:
                for svc in SERVICES:
                    try:
                        st = check_service(svc, timeout=1.5)
                        with self._lock:
                            self._running[svc.port] = bool(st["running"])
                            if st["running"] and st["pid"] is not None:
                                self._pids[svc.port] = [st["pid"]]
                            elif not st["running"]:
                                self._pids.pop(svc.port, None)
                    except Exception:
                        pass
                threading.Event().wait(self._interval)

        self._thread = threading.Thread(target=_loop, daemon=True)
        self._thread.start()

    def refresh_ui(self) -> None:
        """供 UI 层轮询调用：读缓存并更新界面。返回 None。"""
