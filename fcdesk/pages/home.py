from __future__ import annotations

from collections.abc import Callable
from pathlib import Path
from typing import Any

import customtkinter as ctk
from tkinter import messagebox

from fcdesk.config.user_prefs import merge_workspace_section
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
        ctk.CTkLabel(
            outer,
            text=(
                "工作空间根与各功能页路径会写入偏好文件 "
                "fcdesk/config/workspace.custom.json；保存后写入磁盘。"
            ),
            anchor="w",
            justify="left",
            text_color=("gray30", "gray70"),
            wraplength=680,
        ).grid(row=r, column=0, columnspan=4, sticky="w", pady=(0, 16))
        r += 1

        # 工作空间根
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

        # FreeCAD 目录
        ctk.CTkLabel(outer, text="FreeCAD 目录", anchor="w").grid(row=r, column=0, sticky="w")
        self._fc_entry = ctk.CTkEntry(outer, placeholder_text="可选：FreeCADCmd 所在安装目录")
        self._fc_entry.grid(row=r, column=1, sticky="ew", padx=(0, 8), pady=(8, 0))
        ctk.CTkButton(
            outer,
            text="浏览…",
            width=88,
            command=self._browse_freecad,
        ).grid(row=r, column=2, padx=(0, 4), pady=(8, 0))
        r += 1

        btn_bar = ctk.CTkFrame(outer, fg_color="transparent")
        btn_bar.grid(row=r, column=0, columnspan=4, sticky="w", pady=(20, 0))
        r += 1

        ctk.CTkButton(btn_bar, text="保存偏好", width=112, command=self._save_prefs).grid(
            row=0, column=0, padx=(0, 10)
        )
        ctk.CTkButton(
            btn_bar,
            text="重载 JSON 配置",
            width=138,
            command=self._reload_clicked,
        ).grid(row=0, column=1, padx=(0, 10))
        ctk.CTkButton(btn_bar, text="关于", width=80, command=self._about_clicked).grid(
            row=0, column=2
        )

        ctk.CTkLabel(outer, text="功能一览", font=ctk.CTkFont(weight="bold"), anchor="w").grid(
            row=r, column=0, columnspan=4, sticky="w", pady=(28, 8)
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

        self._sync_fields_from_state()

    def on_show(self) -> None:
        self._sync_fields_from_state()

    def _sync_fields_from_state(self) -> None:
        self._repo_entry.delete(0, "end")
        self._repo_entry.insert(0, str(self.state.repo_root))
        self._fc_entry.delete(0, "end")
        if self.state.freecad_dir:
            self._fc_entry.insert(0, str(self.state.freecad_dir))

    def _browse_repo(self) -> None:
        path = pick_workspace_directory(
            self,
            title="选择工作空间根目录",
            repo_root=self.state.repo_root,
        )
        if not path:
            return
        rp = Path(path).resolve()
        self.state.repo_root = rp
        self._repo_entry.delete(0, "end")
        self._repo_entry.insert(0, str(rp))
        merge_workspace_section("toolbar", {"repo_root": str(rp)})
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
        merge_workspace_section("toolbar", {"freecad_dir": str(p)})
        self._refresh_window_title()

    def _save_prefs(self) -> None:
        repo_s = self._repo_entry.get().strip()
        fc_s = self._fc_entry.get().strip()
        patch: dict[str, str | None] = {}

        if not repo_s:
            messagebox.showwarning("保存", "请先填写工作空间根目录。", parent=self)
            return

        rp = Path(repo_s).expanduser().resolve()
        if not rp.is_dir():
            messagebox.showerror("保存", "工作空间路径不是有效文件夹。", parent=self)
            return
        self.state.repo_root = rp
        patch["repo_root"] = str(rp)

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
            patch["freecad_dir"] = str(fp)
        else:
            self.state.freecad_dir = None
            patch["freecad_dir"] = None

        merge_workspace_section("toolbar", patch)
        self._refresh_window_title()
        messagebox.showinfo("保存", "已写入 workspace.custom.json。", parent=self)

    def _reload_clicked(self) -> None:
        self._on_reload_config()

    def _about_clicked(self) -> None:
        self._on_about()
