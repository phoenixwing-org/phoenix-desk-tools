from __future__ import annotations

import tkinter as tk
import tkinter.filedialog as fd
from pathlib import Path


def resolve_directory_dialog_initialdir(
    repo_root: Path | str, *, path_hint: str = ""
) -> str:
    """选目录对话框的初始位置（与各处「浏览…」、工具条选目录保持一致）。

    - ``path_hint`` 为空或解析后不存在：定为当前 **工作空间根** ``repo_root``（便于去重页等扫描目录空缺时先入工作空间）。
    - 若非空且路径存在：若为目录则用该目录；若为文件则用其父目录。
    - 若工作空间根本身不是有效目录（极少见），退回用户「文档」目录。
    """
    rr = Path(repo_root).expanduser().resolve()
    fallback_ws = (
        str(rr)
        if rr.is_dir()
        else str((Path.home() / "Documents").expanduser().resolve())
    )
    raw = (path_hint or "").strip()
    if not raw:
        return fallback_ws

    q = Path(raw).expanduser()
    cand = q.resolve(strict=False) if q.is_absolute() else (rr / q).resolve(strict=False)

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


def format_directory_picker_title(stem_title: str, workspace_root: Path | str) -> str:
    """在选目录对话框标题中标出当前「工作空间」根路径。"""
    return f"{stem_title} · 工作空间: {_shorten_path_for_dialog_title(workspace_root)}"


def pick_directory(master, *, title: str, initialdir: str) -> str:
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


def pick_workspace_directory(
    master,
    *,
    title: str,
    repo_root: Path | str,
    path_hint: str = "",
) -> str:
    """选目录的统一入口；标题自动附带 ``工作空间`` 路径（入参 repo_root 即工作空间根）。"""
    return pick_directory(
        master,
        title=format_directory_picker_title(title, repo_root),
        initialdir=resolve_directory_dialog_initialdir(repo_root, path_hint=path_hint),
    )