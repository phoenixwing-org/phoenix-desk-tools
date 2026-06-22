from __future__ import annotations

import json
import subprocess
import sys
import tkinter as tk
import tkinter.filedialog as fd
from pathlib import Path

from phoenix.config.user_prefs import default_browse_directory


def resolve_directory_dialog_initialdir(
    repo_root: Path | str | None, *, path_hint: str = ""
) -> str:
    """选目录对话框的初始位置（与各处「浏览…」、工具条选目录保持一致）。

    - ``path_hint`` 为空且未配置工作空间：定为用户 **文档** 目录。
    - ``path_hint`` 为空且已有工作空间：定为工作空间根。
    - 若非空且路径存在：若为目录则用该目录；若为文件则用其父目录。
    """
    browse_fallback = str(default_browse_directory())
    rr: Path | None = None
    if repo_root is not None and str(repo_root).strip():
        try:
            cand_root = Path(repo_root).expanduser().resolve(strict=False)
            if cand_root.is_dir():
                rr = cand_root
        except (OSError, RuntimeError):
            rr = None
    fallback_ws = str(rr) if rr is not None else browse_fallback
    raw = (path_hint or "").strip()
    if not raw:
        return fallback_ws

    q = Path(raw).expanduser()
    if q.is_absolute():
        cand = q.resolve(strict=False)
    elif rr is not None:
        cand = (rr / q).resolve(strict=False)
    else:
        cand = q.resolve(strict=False)

    try:
        if cand.is_dir():
            return str(cand)
        if cand.is_file():
            parent = cand.parent
            return str(parent) if parent.is_dir() else fallback_ws
    except OSError:
        pass
    return fallback_ws


def _shorten_path_for_dialog_title(path: Path | str, max_len: int = 96) -> str:
    p = Path(path).expanduser().resolve(strict=False)
    s = str(p)
    if len(s) <= max_len:
        return s
    # 单行标题：保留末尾路径段便于辨认
    return "…" + s[-(max_len - 1) :]


def format_directory_picker_title(stem_title: str, workspace_root: Path | str | None) -> str:
    """在选目录对话框标题中标出当前「工作空间」根路径。"""
    if workspace_root is None or not str(workspace_root).strip():
        ws_label = "未设置"
    else:
        ws_label = _shorten_path_for_dialog_title(workspace_root)
    return f"{stem_title} · 工作空间: {ws_label}"


def pick_directory(
    master,
    *,
    title: str,
    initialdir: str,
) -> str:
    """底层目录选择框（需自备 ``initialdir``）。"""
    root = master.winfo_toplevel()
    root.update_idletasks()
    kw: dict[str, object] = {"parent": root, "title": title}
    if initialdir:
        kw["initialdir"] = initialdir
    try:
        sel = fd.askdirectory(**kw)
    except tk.TclError:
        sel = fd.askdirectory(parent=root, title=title)
    return sel or ""


def _applescript_escape(value: str) -> str:
    return value.replace("\\", "\\\\").replace('"', '\\"')


def _pick_directory_macos_osascript(*, title: str, initialdir: str = "") -> str:
    """macOS 原生选目录（可在 uvicorn 工作线程安全调用）。"""
    prompt = _applescript_escape(title)
    script = f'POSIX path of (choose folder with prompt "{prompt}"'
    init = (initialdir or "").strip()
    if init:
        p = Path(init).expanduser()
        try:
            resolved = p.resolve(strict=False)
        except OSError:
            resolved = p
        if resolved.is_dir():
            script += f' default location POSIX file "{_applescript_escape(str(resolved))}"'
    script += ")"
    try:
        proc = subprocess.run(
            ["osascript", "-e", script],
            capture_output=True,
            text=True,
            timeout=3600,
        )
    except subprocess.TimeoutExpired:
        return ""
    if proc.returncode != 0:
        err = (proc.stderr or proc.stdout or "").strip()
        if not err or "User canceled" in err or "(-128)" in err:
            return ""
        raise RuntimeError(err)
    return (proc.stdout or "").strip()


def _pick_directory_subprocess_tk(*, title: str, initialdir: str = "") -> str:
    """在子进程内用 Tk 选目录，避免 Web 服务线程直接初始化 Tk。"""
    payload = json.dumps(
        {"title": title, "initialdir": initialdir},
        ensure_ascii=False,
    )
    code = (
        "import json,sys\n"
        "from phoenix.shell.native_dialog import pick_directory_standalone\n"
        "args=json.loads(sys.stdin.read())\n"
        "path=pick_directory_standalone("
        "title=args.get('title') or '选择目录', "
        "initialdir=args.get('initialdir') or ''"
        ")\n"
        "json.dump({'path': path}, sys.stdout, ensure_ascii=False)\n"
    )
    proc = subprocess.run(
        [sys.executable, "-c", code],
        input=payload,
        capture_output=True,
        text=True,
        timeout=3600,
    )
    if proc.returncode != 0:
        err = (proc.stderr or proc.stdout or "").strip()
        raise RuntimeError(err or f"选目录子进程失败（退出码 {proc.returncode}）")
    try:
        data = json.loads((proc.stdout or "").strip() or "{}")
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"选目录返回无效: {(proc.stdout or '')!r}") from exc
    return str(data.get("path") or "")


def pick_directory_isolated(*, title: str, initialdir: str = "") -> str:
    """Web/API 选目录：与桌面 Tk 主窗口解耦，避免 macOS 上 Internal Server Error。"""
    if sys.platform == "darwin":
        return _pick_directory_macos_osascript(title=title, initialdir=initialdir)
    return _pick_directory_subprocess_tk(title=title, initialdir=initialdir)


def pick_directory_standalone(*, title: str, initialdir: str = "") -> str:
    """无桌面主窗口时弹出系统选目录框（Web 配置页等）。"""
    import sys

    root = tk.Tk()
    root.withdraw()
    try:
        root.update_idletasks()
        if sys.platform == "darwin":
            root.lift()
            root.attributes("-topmost", True)
    except tk.TclError:
        pass
    try:
        kw: dict[str, object] = {"parent": root, "title": title}
        if initialdir:
            kw["initialdir"] = initialdir
        try:
            sel = fd.askdirectory(**kw)
        except tk.TclError:
            sel = fd.askdirectory(parent=root, title=title)
    finally:
        root.destroy()
    return sel or ""


def pick_workspace_directory(
    master,
    *,
    title: str,
    repo_root: Path | str | None,
    path_hint: str = "",
) -> str:
    """选目录的统一入口；标题自动附带 ``工作空间`` 路径（入参 repo_root 即工作空间根）。"""
    return pick_directory(
        master,
        title=format_directory_picker_title(title, repo_root),
        initialdir=resolve_directory_dialog_initialdir(repo_root, path_hint=path_hint),
    )