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
from phoenix.shell.web_launcher import (
    SERVICES,
    check_service,
    open_service_terminal,
    open_all_terminals,
)

_LABEL_W = 72
_PAD = 12

# 列宽（服务表）
_COL_NAME = 120
_COL_STATUS = 60
_COL_PORT = 56
# 操作列自动填充

# 颜色
_GREEN = "#22c55e"
_GRAY = "#94a3b8"
_RED = "#ef4444"


def _status_dot(running: bool) -> str:
    return "●" if running else "○"


def _status_color(running: bool) -> str:
    return _GREEN if running else _GRAY


def _status_text(running: bool) -> str:
    return "运行中" if running else "已停止"


class HomePage(BasePage):
    """启动器：服务管理 + 工作空间 / FreeCAD。"""

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

        # 服务行 widgets（按 port 索引）
        self._svc_dot: dict[int, ctk.CTkLabel] = {}
        self._svc_label: dict[int, ctk.CTkLabel] = {}
        self._svc_btn: dict[int, ctk.CTkButton] = {}

        outer = ctk.CTkFrame(self, fg_color="transparent")
        outer.grid(row=0, column=0, sticky="nsew", padx=_PAD, pady=_PAD)
        self.grid_columnconfigure(0, weight=1)
        self.grid_rowconfigure(0, weight=1)
        outer.grid_columnconfigure(3, weight=1)

        r = 0

        # ════ 服务状态表 ════
        svc_section = ctk.CTkFrame(outer)
        svc_section.grid(row=r, column=0, columnspan=4, sticky="ew", pady=(0, 12))
        svc_section.grid_columnconfigure(3, weight=1)

        # 表头
        _hdr_font = ctk.CTkFont(size=11, weight="bold")
        _hdr_color = ("#475569", "#94a3b8")
        headers = [("服务", _COL_NAME), ("状态", _COL_STATUS), ("端口", _COL_PORT), ("", 0)]
        for ci, (text, w) in enumerate(headers):
            lbl = ctk.CTkLabel(svc_section, text=text, font=_hdr_font, text_color=_hdr_color, anchor="w")
            if w:
                lbl.grid(row=0, column=ci, sticky="w", padx=(10 if ci == 0 else 4, 4), pady=(10, 4))
            else:
                lbl.grid(row=0, column=ci, sticky="w", padx=(4, 10), pady=(10, 4))

        # 分隔线
        sep1 = ctk.CTkFrame(svc_section, height=1, fg_color=("#e2e8f0", "#334155"))
        sep1.grid(row=1, column=0, columnspan=4, sticky="ew", padx=10, pady=(0, 2))

        # 服务行
        self._svc_rows: dict[int, int] = {}  # port → row index
        for i, svc in enumerate(SERVICES):
            row = 2 + i
            self._svc_rows[svc.port] = row

            # 服务名
            ctk.CTkLabel(svc_section, text=svc.name, font=ctk.CTkFont(size=12), anchor="w").grid(
                row=row, column=0, sticky="w", padx=(10, 4), pady=5
            )

            # 状态：指示灯 + 文字
            dot = ctk.CTkLabel(svc_section, text="○", font=ctk.CTkFont(size=14),
                               text_color=_GRAY, width=20, anchor="center")
            dot.grid(row=row, column=1, sticky="w", padx=(0, 2), pady=5)
            self._svc_dot[svc.port] = dot

            st_label = ctk.CTkLabel(svc_section, text="已停止", font=ctk.CTkFont(size=11),
                                     text_color=_GRAY, anchor="w")
            st_label.grid(row=row, column=1, sticky="w", padx=(22, 4), pady=5)
            self._svc_label[svc.port] = st_label

            # 端口
            ctk.CTkLabel(svc_section, text=str(svc.port), font=ctk.CTkFont(size=12),
                         text_color=("#64748b", "#94a3b8"), anchor="w").grid(
                row=row, column=2, sticky="w", padx=(4, 4), pady=5
            )

            # 操作按钮（始终弹终端，状态由轮询自动更新）
            btn = ctk.CTkButton(svc_section, text="▶ 终端", width=72, height=26,
                                font=ctk.CTkFont(size=11),
                                command=lambda s=svc: open_service_terminal(s))
            btn.grid(row=row, column=3, sticky="e", padx=(4, 10), pady=5)
            self._svc_btn[svc.port] = btn

        # 分隔线
        sep2 = ctk.CTkFrame(svc_section, height=1, fg_color=("#e2e8f0", "#334155"))
        sep2.grid(row=5, column=0, columnspan=4, sticky="ew", padx=10, pady=(4, 0))

        # 统一操作行
        # BUG: 全部停止待改为按端口查询进程，再询问勾选关闭
        action_row = ctk.CTkFrame(svc_section, fg_color="transparent")
        action_row.grid(row=6, column=0, columnspan=4, sticky="ew", padx=10, pady=(8, 10))
        action_row.grid_columnconfigure(1, weight=1)

        ctk.CTkButton(action_row, text="▶  全部启动 (3 Tab)", width=140, height=28,
                       font=ctk.CTkFont(size=12), command=self._start_all).grid(
            row=0, column=0, padx=(0, 6)
        )
        ctk.CTkButton(action_row, text="🌐 打开浏览器", width=110, height=28,
                       font=ctk.CTkFont(size=11),
                       fg_color=("gray75", "gray35"),
                       command=self._open_browser).grid(
            row=0, column=2, sticky="e"
        )

        r += 1

        # ════ 工作空间配置 ════
        ws_section = ctk.CTkFrame(outer)
        ws_section.grid(row=r, column=0, columnspan=4, sticky="ew", pady=(0, 0))
        ws_section.grid_columnconfigure(1, weight=1)

        wsr = 0
        # 工作空间路径
        fw.form_row_label(ws_section, text="工作空间", width=_LABEL_W).grid(
            row=wsr, column=0, sticky="w", padx=(10, 6), pady=(10, 4)
        )
        self._repo_entry = ctk.CTkEntry(ws_section, height=28, placeholder_text="项目根目录")
        self._repo_entry.grid(row=wsr, column=1, sticky="ew", padx=(0, 6), pady=(10, 4))
        ctk.CTkButton(ws_section, text="…", width=36, height=28, command=self._browse_repo).grid(
            row=wsr, column=2, padx=(0, 10), pady=(10, 4)
        )
        wsr += 1

        # 最近
        fw.form_row_label(ws_section, text="最近", width=_LABEL_W).grid(
            row=wsr, column=0, sticky="w", padx=(10, 6), pady=(2, 4)
        )
        self._recent_menu = ctk.CTkOptionMenu(
            ws_section,
            variable=self._recent_var,
            values=["（无记录）"],
            height=28,
            command=self._on_recent_picked,
        )
        self._recent_menu.grid(row=wsr, column=1, columnspan=2, sticky="ew", padx=(0, 10), pady=(2, 4))
        wsr += 1

        # FreeCAD
        fw.form_row_label(ws_section, text="FreeCAD", width=_LABEL_W).grid(
            row=wsr, column=0, sticky="w", padx=(10, 6), pady=(2, 4)
        )
        self._fc_entry = ctk.CTkEntry(ws_section, height=28, placeholder_text="可选")
        self._fc_entry.grid(row=wsr, column=1, sticky="ew", padx=(0, 6), pady=(2, 4))
        fc_btns = ctk.CTkFrame(ws_section, fg_color="transparent")
        fc_btns.grid(row=wsr, column=2, sticky="e", padx=(0, 10), pady=(2, 4))
        ctk.CTkButton(fc_btns, text="…", width=36, height=28, command=self._browse_freecad).pack(
            side="left", padx=(0, 4)
        )
        default_fc = default_freecad_install_dir()
        if default_fc:
            ctk.CTkButton(
                fc_btns, text="默认", width=48, height=28,
                fg_color=("gray70", "gray40"), command=self._fill_default_freecad,
            ).pack(side="left")
        wsr += 1

        # 按钮栏
        btn_bar = ctk.CTkFrame(ws_section, fg_color="transparent")
        btn_bar.grid(row=wsr, column=0, columnspan=3, sticky="w", padx=(10, 10), pady=(6, 10))
        ctk.CTkButton(btn_bar, text="保存", width=64, height=28, command=self._save_prefs).pack(
            side="left", padx=(0, 6)
        )
        ctk.CTkButton(btn_bar, text="关于", width=64, height=28,
                       fg_color=("gray75", "gray35"), command=self._about_clicked).pack(side="left")

        # 初始化
        self._sync_fields_from_state()
        self._refresh_recent_menu()
        self._refresh_all_services()
        self._schedule_status_poll()

    # ── 服务管理 ──

    def _start_all(self) -> None:
        open_all_terminals()
        self._set_status("已打开终端（3 Tab）")

    def _open_browser(self) -> None:
        vite = next((s for s in SERVICES if s.port == 5173), None)
        if vite and check_service(vite)["running"]:
            import webbrowser
            webbrowser.open("http://127.0.0.1:5173")
            self._set_status("浏览器已打开 · http://127.0.0.1:5173")
        else:
            messagebox.showwarning("打开浏览器", "Vite UI 未运行，请先启动服务。", parent=self)

    def _refresh_all_services(self) -> None:
        for svc in SERVICES:
            st = check_service(svc, timeout=1.0)
            running = bool(st["running"])
            port = svc.port
            # 指示灯
            dot = self._svc_dot.get(port)
            if dot:
                dot.configure(text=_status_dot(running), text_color=_status_color(running))
            # 状态文字
            lbl = self._svc_label.get(port)
            if lbl:
                lbl.configure(text=_status_text(running), text_color=_status_color(running))
            # 按钮始终是 "▶ 终端"（不做启停切换）

    def _schedule_status_poll(self) -> None:
        try:
            if not self.winfo_exists():
                return
        except TclError:
            return
        self._refresh_all_services()
        self.after(3000, self._schedule_status_poll)

    # ── 工作空间 ──

    def on_show(self) -> None:
        self._refresh_recent_menu()
        self._sync_fields_from_state()
        self._refresh_all_services()

    def _set_status(self, msg: str) -> None:
        top = self.winfo_toplevel()
        if hasattr(top, "status_bar"):
            top.status_bar.configure(text=msg)

    def _notify_workspace_changed(self) -> None:
        self._refresh_window_title()
        if self._on_workspace_changed:
            self._on_workspace_changed()

    def _refresh_recent_menu(self) -> None:
        recent = get_recent_workspaces()
        current = self.state.repo_root
        if current is not None:
            try:
                current = current.expanduser().resolve()
            except (OSError, RuntimeError):
                current = None
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
        cur_label = format_absolute_config_path(current) if current else ""
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
        current = self.state.repo_root
        try:
            if path == current.expanduser().resolve():
                return
        except (OSError, RuntimeError):
            pass
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
            self, title="选择工作空间根目录",
            repo_root=self.state.repo_root, path_hint=self._repo_entry.get(),
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
            self, title="选择 FreeCAD 目录",
            repo_root=self.state.repo_root, path_hint=self._fc_entry.get(),
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
        try:
            set_active_workspace(rp, self.state)
        except ValueError as exc:
            messagebox.showerror("保存", str(exc), parent=self)
            return
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
