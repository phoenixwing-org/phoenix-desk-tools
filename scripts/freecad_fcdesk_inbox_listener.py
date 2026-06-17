# -*- coding: utf-8 -*-
"""
在「已打开的 FreeCAD UI」内运行：**phoenix ↔ FreeCAD GUI 收件箱桥接**

用法（每台机只需做一次路径配置）：

1. 宏 → Macros… → 「文档」打开宏路径，或直接「添加宏路径」指向本仓库的 ``scripts/``。
2. 在菜单 **宏 → executeMacro**（或快捷键）中选本文件 ``freecad_fcdesk_inbox_listener.py``，
   **执行一次**（或勾选「添加到启动宏」）。
3. 桌面上 phoenix「STEP 批量」勾选 **通过已打开的 FreeCAD**，再点运行。

收件箱：`~/.phoenix/freecad_bridge/inbox/`；结果：`…/done/`。

注意：监听使用 **Qt 定时器在主线程轮询**，与 FreeCAD Gui 在同一进程，避免线程问题。
仅限本机、无口令；不要使用网络暴露。
"""

from __future__ import annotations

import json
import os
import sys
import traceback
from pathlib import Path


def _bridge_paths() -> tuple[Path, Path]:
    root = Path.home() / ".phoenix" / "freecad_bridge"
    return root / "inbox", root / "done"


def _prep_import_paths(repo_root: Path) -> None:
    repo_root = repo_root.expanduser().resolve()
    scripts = repo_root / "scripts"
    for p in (str(repo_root), str(scripts)):
        if p not in sys.path:
            sys.path.insert(0, p)


def _merge_fcd_env(env_updates: dict[str, str]) -> dict[str, str | None]:
    """返回旧值快照，便于恢复。"""
    snap: dict[str, str | None] = {}
    for k, v in env_updates.items():
        snap[k] = os.environ.get(k)
        os.environ[k] = v
    return snap


def _restore_env(snap: dict[str, str | None]) -> None:
    for k, ov in snap.items():
        if ov is None:
            os.environ.pop(k, None)
        else:
            os.environ[k] = ov


def _process_one(queue: Path, done_dir: Path) -> bool:
    files = sorted(queue.glob("*_queued.json"))
    if not files:
        return False
    p = files[0]
    try:
        raw = json.loads(p.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        try:
            p.unlink(missing_ok=True)
        except OSError:
            pass
        return True

    uid = raw.get("id") or p.stem.replace("_queued", "")
    traw = raw.get("fcdesk_clone_root") or raw.get("repo_root")
    if not traw:
        try:
            rsp = done_dir / f"{uid}_result.json"
            rsp.write_text(
                json.dumps({"ok": False, "error": "缺少 fcdesk_clone_root"}, ensure_ascii=False) + "\n",
                encoding="utf-8",
            )
        except OSError:
            pass
        try:
            p.unlink(missing_ok=True)
        except OSError:
            pass
        return True
    toolkit = Path(str(traw)).expanduser().resolve()
    env = raw.get("env") or {}
    if not isinstance(env, dict):
        env = {}
    rsp = done_dir / f"{uid}_result.json"

    def write_result(ok: bool, error: str | None = None) -> None:
        payload = {"ok": ok}
        if error:
            payload["error"] = error
        rsp.write_text(json.dumps(payload, ensure_ascii=False) + "\n", encoding="utf-8")

    snap: dict[str, str | None] = {}
    try:
        p.unlink(missing_ok=True)
    except OSError:
        pass

    try:
        _prep_import_paths(toolkit)
        import freecad_batch_step_fc  # noqa: E402 — 须在 path 后加入

        snap = _merge_fcd_env({str(k): str(v) for k, v in env.items()})
        freecad_batch_step_fc.run_step_batch_from_environ()
        write_result(True)
    except BaseException:
        tb = traceback.format_exc()
        try:
            write_result(False, error=tb)
        except OSError:
            pass
        try:
            import FreeCAD as App

            App.Console.PrintError("[phoenix 桥接] STEP 批量失败\n" + tb + "\n")
        except Exception:
            pass
    finally:
        if snap:
            _restore_env(snap)
    return True


_POLL_ATTACHED = False
_TIMER = None


def start(interval_ms: int = 750) -> None:
    """在 FreeCAD Gui 就绪后调用一次。"""
    global _POLL_ATTACHED, _TIMER
    try:
        import FreeCADGui as Gui
    except ImportError:
        print("phoenix inbox: FreeCADGui 不可用")
        return

    if getattr(Gui, "_fcdesk_listener_timer", None) is not None:
        Gui._fcdesk_listener_timer.start(interval_ms)
        try:
            import FreeCAD as App

            App.Console.PrintMessage("[phoenix 桥接] 收件箱监听已就绪（重启定时器）。\n")
        except Exception:
            pass
        return

    if _POLL_ATTACHED:
        return

    try:
        from PySide2 import QtCore
    except ImportError:
        try:
            from PySide6 import QtCore
        except ImportError:
            print("phoenix inbox: 无法导入 PySide2 / PySide6（请用带 Qt 绑定的 FreeCAD）")
            return

    mw = Gui.getMainWindow()
    if mw is None:
        try:
            import FreeCAD as App

            App.Console.PrintWarning("[phoenix 桥接] 主窗口尚未就绪：请稍后从「宏」再执行一次本脚本。\n")
        except Exception:
            print("phoenix inbox: MainWindow not ready")
        return

    timer = QtCore.QTimer(mw)

    def on_tick() -> None:
        inbox, done_dir = _bridge_paths()
        inbox.mkdir(parents=True, exist_ok=True)
        done_dir.mkdir(parents=True, exist_ok=True)
        while _process_one(inbox, done_dir):
            pass

    timer.timeout.connect(on_tick)
    timer.start(interval_ms)
    _TIMER = timer
    _POLL_ATTACHED = True
    Gui._fcdesk_listener_timer = timer

    try:
        import FreeCAD as App

        App.Console.PrintMessage("[phoenix 桥接] 已启动收件箱监听（phoenix STEP 批量可用）。\n")
    except Exception:
        print("phoenix inbox: timer started")


def stop() -> None:
    try:
        import FreeCADGui as Gui

        t = getattr(Gui, "_fcdesk_listener_timer", None)
        if t is not None:
            t.stop()
    except Exception:
        pass


# 作为宏被 FreeCAD「执行 Python 脚本」载入时通常会跑到底部；
# 若未启动监听，可到 Python 控制台执行：import …; …start()
start()
