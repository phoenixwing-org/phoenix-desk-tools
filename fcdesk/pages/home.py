from __future__ import annotations

from collections.abc import Callable
from pathlib import Path
from typing import Any

import customtkinter as ctk
from tkinter import messagebox

from fcdesk.config.user_prefs import (
    WORKSPACE_DOTFILE_NAME,
    get_recent_workspaces,
    save_launcher_freecad_dir,
    set_active_workspace,
)
from fcdesk.pages.base import BasePage
from fcdesk.shell.native_dialog import pick_workspace_directory
from fcdesk.shell.state import AppState


class HomePage(BasePage):
    """应用配置页：工作空间、FreeCAD 目录、偏好保存与全局操作。"""

    page_id = "home"

    def __init__(
        self,
        master,
        state: AppState,
        nav_items: list[Any],
        *,
        on_reload_config: Callable[[], None],
        on_about: Callable[[], None],
        refresh_window_title: Callable[[], None],
        **kwargs,
    ) -> None:
        super().__init__(master, state, **kwargs)
        self._nav_items = nav_items
        self._on_reload_config = on_reload_config
        self._on_about = on_about
        self._refresh_window_title = refresh_window_title

        outer = ctk.CTkScrollableFrame(self, label_text="配置")
        outer.grid(row=0, column=0, sticky="nsew", padx=24, pady=24)
        outer.grid_columnconfigure(1, weight=1)

        r = 0
        ctk.CTkLabel(outer, text="当前工作空间", width=108, anchor="w").grid(
            row=r, column=0, sticky="nw", padx=(0, 8)
        )
        self._current_repo_label = ctk.CTkLabel(
            outer,
            text="",
            anchor="w",
            justify="left",
            wraplength=560,
            font=ctk.CTkFont(size=13, weight="bold"),
        )
        self._current_repo_label.grid(row=r, column=1, columnspan=3, sticky="ew", pady=(0, 8))
        r += 1

        ctk.CTkLabel(outer, text="工作空间根", width=108, anchor="w").grid(
            row=r, column=0, sticky="w", padx=(0, 8)
        )
        self._repo_entry = ctk.CTkEntry(outer, placeholder_text="项目 / CAD 根目录")
        self._repo_entry.grid(row=r, column=1, sticky="ew", padx=(0, 8))
        ctk.CTkButton(
            outer,
            text="浏览…",
            width=88,
            command=self._browse_repo,
        ).grid(row=r, column=2, padx=(0, 4))
        r += 1

        ctk.CTkLabel(outer, text="FreeCAD 目录", anchor="w").grid(row=r, column=0, sticky="w")
        self._fc_entry = ctk.CTkEntry(outer, placeholder_text="可选：FreeCADCmd 所在目录")
        self._fc_entry.grid(row=r, column=1, sticky="ew", padx=(0, 8), pady=(8, 0))
        ctk.CTkButton(
            outer,
            text="浏览…",
            width=88,
            command=self._browse_freecad,
        ).grid(row=r, column=2, padx=(0, 4), pady=(8, 0))
        r += 1

        btn_bar = ctk.CTkFrame(outer, fg_color="transparent")
        btn_bar.grid(row=r, column=0, columnspan=4, sticky="w", pady=(12, 0))
        r += 1

        ctk.CTkButton(btn_bar, text="保存偏好", width=112, command=self._save_prefs).grid(
            row=0, column=0, padx=(0, 10)
        )
        ctk.CTkButton(
            btn_bar,
            text="重载 JSON",
            width=100,
            command=self._reload_clicked,
        ).grid(row=0, column=1, padx=(0, 10))
        ctk.CTkButton(btn_bar, text="关于", width=80, command=self._about_clicked).grid(
            row=0, column=2
        )

        ctk.CTkLabel(outer, text="最近打开", width=108, anchor="nw").grid(
            row=r, column=0, sticky="nw", padx=(0, 8), pady=(20, 4)
        )
        recent_col = ctk.CTkFrame(outer, fg_color="transparent")
        recent_col.grid(row=r, column=1, columnspan=3, sticky="ew", pady=(20, 8))
        recent_col.grid_columnconfigure(0, weight=1)
        self._recent_list = ctk.CTkScrollableFrame(
            recent_col,
            height=120,
            label_text="点击路径可切换（将询问确认）",
        )
        self._recent_list.grid(row=0, column=0, sticky="ew")
        self._recent_list.grid_columnconfigure(0, weight=1)
        ctk.CTkButton(recent_col, text="刷新", width=70, command=self._refresh_recent_list).grid(
            row=1, column=0, sticky="w", pady=(6, 0)
        )
        r += 1

        ctk.CTkLabel(outer, text="功能一览", font=ctk.CTkFont(weight="bold"), anchor="w").grid(
            row=r, column=0, columnspan=4, sticky="w", pady=(20, 8)
        )
        r += 1
        for item in self._nav_items:
            if item.get("page") == "home":
                continue
            line = f"· {item.get('label')} — {item.get('description', '')}"
            ctk.CTkLabel(outer, text=line, anchor="w", justify="left").grid(
                row=r, column=0, columnspan=4, sticky="w", pady=2
            )
            r += 1

        ctk.CTkLabel(
            outer,
            text=(
                f"各功能页路径与选项写入当前工作空间根下的 {WORKSPACE_DOTFILE_NAME}；"
                "最近打开的工作空间列表保存在 fcdesk/config/workspace.custom.json。"
            ),
            anchor="w",
            justify="left",
            text_color=("gray30", "gray70"),
            wraplength=680,
        ).grid(row=r, column=0, columnspan=4, sticky="w", pady=(20, 0))

        self._sync_fields_from_state()

    def on_show(self) -> None:
        self._refresh_recent_list()
        self._sync_fields_from_state()

    def _refresh_recent_list(self) -> None:
        for child in self._recent_list.winfo_children():
            child.destroy()

        current = self.state.repo_root.expanduser().resolve()
        self._current_repo_label.configure(text=str(current))

        recent = get_recent_workspaces()
        if not recent:
            ctk.CTkLabel(
                self._recent_list,
                text="（尚无记录，浏览或保存工作空间根后会出现在此）",
                anchor="w",
                text_color=("gray40", "gray60"),
            ).grid(row=0, column=0, sticky="ew", pady=4)
            return

        for i, p in enumerate(recent):
            resolved = p.resolve()
            is_current = resolved == current
            prefix = "● 当前 · " if is_current else ""
            btn = ctk.CTkButton(
                self._recent_list,
                text=f"{prefix}{resolved}",
                anchor="w",
                height=32,
                fg_color=("gray78", "gray28") if is_current else ("gray88", "gray22"),
                hover_color=("gray70", "gray32"),
                command=lambda path=resolved: self._ask_switch_workspace(path),
            )
            btn.grid(row=i, column=0, sticky="ew", pady=2)

    def _ask_switch_workspace(self, target: Path) -> None:
        try:
            rp = target.expanduser().resolve()
        except (OSError, RuntimeError):
            return
        if not rp.is_dir():
            messagebox.showwarning(
                "工作空间",
                f"目录不存在或不可访问：\n{rp}",
                parent=self,
            )
            self._refresh_recent_list()
            return

        current = self.state.repo_root.expanduser().resolve()
        if rp == current:
            messagebox.showinfo(
                "工作空间",
                f"当前已是该工作空间，无需切换：\n{rp}",
                parent=self,
            )
            return

        if not messagebox.askyesno(
            "切换工作空间",
            f"是否切换到以下工作空间？\n\n{rp}\n\n"
            f"当前：{current}\n\n"
            "切换后各功能页将读取该目录下的 "
            f"{WORKSPACE_DOTFILE_NAME}。",
            parent=self,
        ):
            return

        set_active_workspace(rp, self.state)
        self._sync_fields_from_state()
        self._refresh_recent_list()
        self._refresh_window_title()

    def _sync_fields_from_state(self) -> None:
        self._repo_entry.delete(0, "end")
        self._repo_entry.insert(0, str(self.state.repo_root))
        self._fc_entry.delete(0, "end")
        if self.state.freecad_dir:
            self._fc_entry.insert(0, str(self.state.freecad_dir))
        self._current_repo_label.configure(text=str(self.state.repo_root.expanduser().resolve()))

    def _browse_repo(self) -> None:
        path = pick_workspace_directory(
            self,
            title="选择工作空间根目录",
            repo_root=self.state.repo_root,
        )
        if not path:
            return
        rp = Path(path).resolve()
        set_active_workspace(rp, self.state)
        self._sync_fields_from_state()
        self._refresh_recent_list()
        self._refresh_window_title()

    def _browse_freecad(self) -> None:
        path = pick_workspace_directory(
            self,
            title="选择 FreeCAD 目录",
            repo_root=self.state.repo_root,
        )
        if not path:
            return
        p = Path(path).resolve()
        self.state.freecad_dir = p
        self._fc_entry.delete(0, "end")
        self._fc_entry.insert(0, str(p))
        save_launcher_freecad_dir(p)
        self._refresh_window_title()

    def _save_prefs(self) -> None:
        repo_s = self._repo_entry.get().strip()
        fc_s = self._fc_entry.get().strip()

        if not repo_s:
            messagebox.showwarning("保存", "请先填写工作空间根目录。", parent=self)
            return

        rp = Path(repo_s).expanduser().resolve()
        if not rp.is_dir():
            messagebox.showerror("保存", "工作空间路径不是有效文件夹。", parent=self)
            return
        set_active_workspace(rp, self.state)

        if fc_s:
            fp = Path(fc_s).expanduser().resolve()
            if not fp.is_dir():
                messagebox.showerror(
                    "保存",
                    "FreeCAD 路径不是有效文件夹；可为空跳过。",
                    parent=self,
                )
                return
            self.state.freecad_dir = fp
            save_launcher_freecad_dir(fp)
        else:
            self.state.freecad_dir = None
            save_launcher_freecad_dir(None)

        self._refresh_recent_list()
        self._refresh_window_title()
        messagebox.showinfo(
            "保存",
            f"已记录最近工作空间。\nFreeCAD 目录已写入启动器配置。\n"
            f"工作空间内各页偏好请在各功能页保存，或已存在于\n{WORKSPACE_DOTFILE_NAME}",
            parent=self,
        )

    def _reload_clicked(self) -> None:
        self._on_reload_config()

    def _about_clicked(self) -> None:
        self._on_about()
