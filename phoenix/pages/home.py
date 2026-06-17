from __future__ import annotations

from collections.abc import Callable
from pathlib import Path

import customtkinter as ctk
from tkinter import messagebox, TclError

from phoenix.config.user_prefs import (
    format_absolute_config_path,
    get_recent_workspaces,
    save_launcher_freecad_dir,
    set_active_workspace,
)
from phoenix.freecad.default_install import default_freecad_install_dir
from phoenix.pages.base import BasePage
from phoenix.pages import form_widgets as fw
from phoenix.shell.native_dialog import pick_workspace_directory
from phoenix.shell.state import AppState
from phoenix.shell.web_launcher import open_web_ui, stop_web_ui, web_server_status

_LABEL_W = 72
_PAD = 12


class HomePage(BasePage):
    """启动器：工作空间 / FreeCAD，打开 Web 版。"""

    page_id = "home"

    def __init__(
        self,
        master,
        state: AppState,
        *,
        on_reload_config: Callable[[], None],
        on_about: Callable[[], None],
        refresh_window_title: Callable[[], None],
        on_workspace_changed: Callable[[], None] | None = None,
        **kwargs,
    ) -> None:
        super().__init__(master, state, **kwargs)
        self._on_reload_config = on_reload_config
        self._on_about = on_about
        self._refresh_window_title = refresh_window_title
        self._on_workspace_changed = on_workspace_changed
        self._recent_path_map: dict[str, Path] = {}
        self._recent_var = ctk.StringVar(value="")

        outer = ctk.CTkFrame(self, fg_color="transparent")
        outer.grid(row=0, column=0, sticky="nsew", padx=_PAD, pady=_PAD)
        self.grid_columnconfigure(0, weight=1)
        self.grid_rowconfigure(0, weight=1)
        outer.grid_columnconfigure(1, weight=1)

        r = 0
        web_row = ctk.CTkFrame(outer, fg_color="transparent")
        web_row.grid(row=r, column=0, columnspan=3, sticky="ew", pady=(0, 4))
        web_row.grid_columnconfigure(0, weight=1)
        web_row.grid_columnconfigure(1, weight=1)
        ctk.CTkButton(
            web_row,
            text="打开 Web 版",
            height=32,
            font=ctk.CTkFont(size=13, weight="bold"),
            command=self._open_web,
        ).grid(row=0, column=0, sticky="ew", padx=(0, 4))
        self._stop_web_btn = ctk.CTkButton(
            web_row,
            text="关闭 Web 服务",
            height=32,
            fg_color=("gray75", "gray35"),
            command=self._stop_web,
        )
        self._stop_web_btn.grid(row=0, column=1, sticky="ew", padx=(4, 0))
        r += 1

        self._web_status = ctk.CTkLabel(
            outer,
            text="",
            anchor="w",
            font=ctk.CTkFont(size=11),
            text_color=("#64748b", "#94a3b8"),
        )
        self._web_status.grid(row=r, column=0, columnspan=3, sticky="ew", pady=(0, 8))
        r += 1

        fw.form_row_label(outer, text="工作空间", width=_LABEL_W).grid(
            row=r, column=0, sticky="w", padx=(0, 6)
        )
        self._repo_entry = ctk.CTkEntry(outer, height=28, placeholder_text="项目根目录")
        self._repo_entry.grid(row=r, column=1, sticky="ew", padx=(0, 6))
        ctk.CTkButton(outer, text="…", width=36, height=28, command=self._browse_repo).grid(
            row=r, column=2
        )
        r += 1

        fw.form_row_label(outer, text="最近", width=_LABEL_W).grid(
            row=r, column=0, sticky="w", padx=(0, 6), pady=(6, 0)
        )
        self._recent_menu = ctk.CTkOptionMenu(
            outer,
            variable=self._recent_var,
            values=["（无记录）"],
            height=28,
            command=self._on_recent_picked,
        )
        self._recent_menu.grid(row=r, column=1, columnspan=2, sticky="ew", pady=(6, 0))
        r += 1

        fw.form_row_label(outer, text="FreeCAD", width=_LABEL_W).grid(
            row=r, column=0, sticky="w", padx=(0, 6), pady=(6, 0)
        )
        self._fc_entry = ctk.CTkEntry(outer, height=28, placeholder_text="可选")
        self._fc_entry.grid(row=r, column=1, sticky="ew", padx=(0, 6), pady=(6, 0))
        fc_btns = ctk.CTkFrame(outer, fg_color="transparent")
        fc_btns.grid(row=r, column=2, sticky="e", pady=(6, 0))
        ctk.CTkButton(fc_btns, text="…", width=36, height=28, command=self._browse_freecad).pack(
            side="left", padx=(0, 4)
        )
        default_fc = default_freecad_install_dir()
        if default_fc:
            ctk.CTkButton(
                fc_btns,
                text="默认",
                width=48,
                height=28,
                fg_color=("gray70", "gray40"),
                command=self._fill_default_freecad,
            ).pack(side="left")
        r += 1

        btn_bar = ctk.CTkFrame(outer, fg_color="transparent")
        btn_bar.grid(row=r, column=0, columnspan=3, sticky="w", pady=(10, 0))
        ctk.CTkButton(btn_bar, text="保存", width=64, height=28, command=self._save_prefs).pack(
            side="left", padx=(0, 6)
        )
        ctk.CTkButton(
            btn_bar,
            text="关于",
            width=64,
            height=28,
            fg_color=("gray75", "gray35"),
            command=self._about_clicked,
        ).pack(side="left")

        self._sync_fields_from_state()
        self._refresh_recent_menu()
        self._refresh_web_status()
        self._schedule_web_status_poll()

    def on_show(self) -> None:
        self._refresh_recent_menu()
        self._sync_fields_from_state()
        self._refresh_web_status()

    def _set_status(self, msg: str) -> None:
        top = self.winfo_toplevel()
        if hasattr(top, "status_bar"):
            top.status_bar.configure(text=msg)

    def _notify_workspace_changed(self) -> None:
        self._refresh_window_title()
        if self._on_workspace_changed:
            self._on_workspace_changed()

    def _refresh_web_status(self) -> None:
        st = web_server_status()
        if st["running"]:
            self._web_status.configure(text=f"Web 服务运行中 · {st['url']}")
            self._stop_web_btn.configure(state="normal")
        else:
            self._web_status.configure(text="Web 服务未运行")
            self._stop_web_btn.configure(state="disabled")

    def _schedule_web_status_poll(self) -> None:
        try:
            if not self.winfo_exists():
                return
        except TclError:
            return
        self._refresh_web_status()
        self.after(3000, self._schedule_web_status_poll)

    def _open_web(self) -> None:
        repo_s = self._repo_entry.get().strip()
        if not repo_s:
            messagebox.showwarning("打开 Web 版", "请先选择工作空间根目录。", parent=self)
            return
        rp = Path(repo_s).expanduser().resolve(strict=False)
        if not rp.is_dir():
            messagebox.showerror("打开 Web 版", "工作空间路径无效。", parent=self)
            return
        set_active_workspace(rp, self.state)
        self._sync_fields_from_state()
        self._refresh_recent_menu()
        self._notify_workspace_changed()
        try:
            url = open_web_ui(rp)
            self._set_status(f"Web 已打开 · {url}")
        except (ValueError, RuntimeError, OSError) as exc:
            messagebox.showerror("打开 Web 版", str(exc), parent=self)
        finally:
            self._refresh_web_status()

    def _stop_web(self) -> None:
        st = web_server_status()
        if not st["running"]:
            self._refresh_web_status()
            return
        if not messagebox.askyesno(
            "关闭 Web 服务",
            f"停止本地 Web 服务并释放端口？\n\n{st['url']}",
            parent=self,
        ):
            return
        try:
            result = stop_web_ui()
            if result.ok:
                self._set_status(result.message)
            else:
                detail = "\n".join(result.logs[-6:]) if result.logs else result.message
                messagebox.showerror("关闭 Web 服务", detail, parent=self)
                self._set_status(result.message)
        except OSError as exc:
            messagebox.showerror("关闭 Web 服务", str(exc), parent=self)
        finally:
            self._refresh_web_status()

    def _refresh_recent_menu(self) -> None:
        recent = get_recent_workspaces()
        current = self.state.repo_root.expanduser().resolve()
        self._recent_path_map.clear()

        if not recent:
            self._recent_menu.configure(values=["（无记录）"], state="disabled")
            self._recent_var.set("（无记录）")
            return

        labels: list[str] = []
        for p in recent:
            try:
                resolved = p.expanduser().resolve()
            except (OSError, RuntimeError):
                continue
            label = format_absolute_config_path(resolved)
            labels.append(label)
            self._recent_path_map[label] = resolved

        if not labels:
            self._recent_menu.configure(values=["（无记录）"], state="disabled")
            self._recent_var.set("（无记录）")
            return

        self._recent_menu.configure(values=labels, state="normal")
        cur_label = format_absolute_config_path(current)
        self._recent_var.set(cur_label if cur_label in labels else labels[0])

    def _on_recent_picked(self, choice: str) -> None:
        if choice == "（无记录）":
            return
        path = self._recent_path_map.get(choice)
        if path is None:
            try:
                path = Path(choice).expanduser().resolve()
            except (OSError, RuntimeError):
                return
        if not path.is_dir():
            messagebox.showwarning("工作空间", "目录不存在或不可访问。", parent=self)
            self._refresh_recent_menu()
            return
        if path == self.state.repo_root.expanduser().resolve():
            return

        set_active_workspace(path, self.state)
        self._sync_fields_from_state()
        self._refresh_recent_menu()
        self._notify_workspace_changed()
        self._set_status(f"已切换 · {format_absolute_config_path(path)}")

    def _sync_fields_from_state(self) -> None:
        self._repo_entry.delete(0, "end")
        self._repo_entry.insert(0, format_absolute_config_path(self.state.repo_root))
        self._fc_entry.delete(0, "end")
        if self.state.freecad_dir:
            self._fc_entry.insert(0, format_absolute_config_path(self.state.freecad_dir))

    def _browse_repo(self) -> None:
        path = pick_workspace_directory(
            self,
            title="选择工作空间根目录",
            repo_root=self.state.repo_root,
            path_hint=self._repo_entry.get(),
        )
        if not path:
            return
        rp = Path(path).expanduser().resolve(strict=False)
        set_active_workspace(rp, self.state)
        self._sync_fields_from_state()
        self._refresh_recent_menu()
        self._notify_workspace_changed()

    def _browse_freecad(self) -> None:
        path = pick_workspace_directory(
            self,
            title="选择 FreeCAD 目录",
            repo_root=self.state.repo_root,
            path_hint=self._fc_entry.get(),
        )
        if not path:
            return
        p = Path(path).expanduser().resolve(strict=False)
        self.state.freecad_dir = p
        self._fc_entry.delete(0, "end")
        self._fc_entry.insert(0, format_absolute_config_path(p))
        save_launcher_freecad_dir(p)
        self._notify_workspace_changed()

    def _fill_default_freecad(self) -> None:
        p = default_freecad_install_dir()
        if not p:
            return
        self._fc_entry.delete(0, "end")
        self._fc_entry.insert(0, p)

    def _save_prefs(self) -> None:
        repo_s = self._repo_entry.get().strip()
        fc_s = self._fc_entry.get().strip()

        if not repo_s:
            messagebox.showwarning("保存", "请填写工作空间根目录。", parent=self)
            return

        rp = Path(repo_s).expanduser().resolve()
        if not rp.is_dir():
            messagebox.showerror("保存", "工作空间路径无效。", parent=self)
            return
        set_active_workspace(rp, self.state)

        if fc_s:
            fp = Path(fc_s).expanduser().resolve()
            if not fp.is_dir():
                messagebox.showerror("保存", "FreeCAD 路径无效。", parent=self)
                return
            self.state.freecad_dir = fp
            save_launcher_freecad_dir(fp)
        else:
            self.state.freecad_dir = None
            save_launcher_freecad_dir(None)

        self._refresh_recent_menu()
        self._notify_workspace_changed()
        self._set_status("偏好已保存")

    def _about_clicked(self) -> None:
        self._on_about()
