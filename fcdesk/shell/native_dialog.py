from __future__ import annotations

import tkinter as tk
import tkinter.filedialog as fd
from pathlib import Path


def resolve_directory_dialog_initialdir(
    repo_root: Path | str, *, path_hint: str = ""
) -> str:
    """选目录对话框的初始位置（与各处「浏览…」、工具条选目录保持一致）。

    - ``path_hint`` 为空：用户「文档」目录（如 ~/Documents），避免落在程序 cwd。
    - 非空：在 ``repo_root``（工作空间根）语境下解析路径，从自身向上找第一个已存在的目录。
    """
    docs = str((Path.home() / "Documents").expanduser().resolve())
    raw = (path_hint or "").strip()
    if not raw:
        return docs

    rr = Path(repo_root).expanduser().resolve()
    q = Path(raw).expanduser()
    cand = q.resolve(strict=False) if q.is_absolute() else (rr / q).resolve(strict=False)

    p = cand
    while True:
        try:
            if p.is_dir():
                return str(p)
            if p.is_file():
                return str(p.parent)
        except OSError:
            pass
        parent = p.parent
        if parent == p:
            return docs
        p = parent


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