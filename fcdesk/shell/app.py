"""主界面：可选工具条 + 左导航 + 右页面栈；窗口标题含工作空间路径。"""

from __future__ import annotations

import sys
from pathlib import Path
import tkinter as tk
from tkinter import messagebox
from typing import Any

import customtkinter as ctk

from fcdesk.config.loader import load_app_config
from fcdesk.config.user_prefs import (
    apply_toolbar_prefs_to_state,
    load_workspace_prefs,
    merge_workspace_section,
)
from fcdesk.shell.native_dialog import pick_workspace_directory
from fcdesk.pages import (
    FcstdMapPage,
    HomePage,
    PlaceholderPage,
    StepBatchPage,
    SwStepExportPage,
    XLinkFixPage,
)
from fcdesk.shell.nav import NavSidebar
from fcdesk.shell.page_stack import PageStack
from fcdesk.shell.state import AppState
from fcdesk.shell.toolbar import Toolbar

_PYTHON_DIR = Path(__file__).resolve().parents[2]
if str(_PYTHON_DIR) not in sys.path:
    sys.path.insert(0, str(_PYTHON_DIR))


class AppShell(ctk.CTk):
    def __init__(self, config: dict[str, Any] | None = None) -> None:
        self._config_path = Path(__file__).resolve().parents[1] / "config" / "app_config.json"
        self.config = config or load_app_config(self._config_path)
        app_cfg = self.config.get("app", {})

        super().__init__()
        # 勿用 self.state：会遮蔽 Tk/CTk 根窗口的 state()，Windows 下设置标题栏颜色时会崩溃。
        self.app_state = AppState()
        apply_toolbar_prefs_to_state(self.app_state, load_workspace_prefs())

        self._app_title_base = str(app_cfg.get("title") or "FreeCAD 管理工具")

        ctk.set_appearance_mode(app_cfg.get("appearance_mode", "system"))
        ctk.set_default_color_theme(app_cfg.get("color_theme", "blue"))

        tb_items = self.config.get("toolbar", {}).get("items") or []
        nav_items = self.config.get("navigation", [])

        content_row = 0
        self._toolbar: Toolbar | None = None
        if tb_items:
            self.grid_rowconfigure(0, weight=0)
            self.grid_rowconfigure(1, weight=1)
            self._toolbar = Toolbar(
                self,
                tb_items,
                self._toolbar_actions(),
                fg_color=("gray85", "gray17"),
            )
            self._toolbar.grid(row=0, column=0, columnspan=2, sticky="ew")
            content_row = 1
        else:
            self.grid_rowconfigure(0, weight=1)

        self.grid_columnconfigure(1, weight=1)

        self.geometry(app_cfg.get("geometry", "1280x760"))
        self.minsize(
            app_cfg.get("min_width", 960),
            app_cfg.get("min_height", 560),
        )

        self._nav = NavSidebar(
            self,
            nav_items,
            on_select=self._show_page,
            fg_color=("gray90", "gray20"),
        )
        self._nav.grid(row=content_row, column=0, sticky="ns")

        self._stack = PageStack(self)
        self._stack.grid(row=content_row, column=1, sticky="nsew")

        self._register_pages(nav_items)

        # 勿用前缀 _xxx：Tk/CTk 可能把未识别的 _ 属性转到 Tcl，误判为 Tk 选项。
        status_row = content_row + 1
        self.status_bar = ctk.CTkLabel(
            self,
            text=f"工作空间: {self.app_state.repo_root}",
            anchor="w",
            height=24,
            font=ctk.CTkFont(size=12),
        )
        self.status_bar.grid(row=status_row, column=0, columnspan=2, sticky="ew", padx=12, pady=(0, 6))

        self._refresh_window_title()

        first_page = nav_items[0]["page"] if nav_items else "home"
        self.after_idle(lambda p=first_page: self._nav.select(p))

    def _toolbar_actions(self) -> dict:
        return {
            "pick_repo": self._pick_repo,
            "pick_freecad_dir": self._pick_freecad_dir,
            "reload_config": self._reload_config,
            "about": self._about,
        }

    def _refresh_window_title(self) -> None:
        self.title(f"{self._app_title_base} - 【{self.app_state.repo_root}】")

    def _register_pages(self, nav_items: list[dict[str, Any]]) -> None:
        descriptions = {item["page"]: item.get("description", "") for item in nav_items}
        labels = {item["page"]: item.get("label", item["page"]) for item in nav_items}

        self._stack.register(
            "home",
            HomePage(
                self._stack,
                self.app_state,
                nav_items,
                on_reload_config=self._reload_config,
                on_about=self._about,
                refresh_window_title=self._refresh_window_title,
            ),
        )
        self._stack.register("xlink_fix", XLinkFixPage(self._stack, self.app_state))
        self._stack.register("fcstd_map", FcstdMapPage(self._stack, self.app_state))
        self._stack.register("step_batch", StepBatchPage(self._stack, self.app_state))
        self._stack.register(
            "sw_step_export",
            SwStepExportPage(self._stack, self.app_state),
        )

        for page_id in ("bom_export", "bom_apply", "part_dedup"):
            self._stack.register(
                page_id,
                PlaceholderPage(
                    self._stack,
                    self.app_state,
                    page_id=page_id,
                    title=labels.get(page_id, page_id),
                    hint=descriptions.get(page_id, ""),
                ),
            )

    def _show_page(self, page_id: str) -> None:
        self._stack.show(page_id)
        self.status_bar.configure(text=f"当前: {page_id}  |  工作空间: {self.app_state.repo_root}")

    def _pick_repo(self) -> None:
        path = pick_workspace_directory(
            self,
            title="选择工作空间根目录",
            repo_root=self.app_state.repo_root,
        )
        if path:
            rp = Path(path).resolve()
            self.app_state.repo_root = rp
            merge_workspace_section("toolbar", {"repo_root": str(rp)})
            self.status_bar.configure(text=f"工作空间: {self.app_state.repo_root}")
            self._refresh_window_title()

    def _pick_freecad_dir(self) -> None:
        path = pick_workspace_directory(
            self,
            title="选择 FreeCAD 目录",
            repo_root=self.app_state.repo_root,
        )
        if path:
            p = Path(path).resolve()
            self.app_state.freecad_dir = p
            merge_workspace_section("toolbar", {"freecad_dir": str(p)})
            self.status_bar.configure(text=f"FreeCAD 目录: {path}")
            self._refresh_window_title()

    def _reload_config(self) -> None:
        self.config = load_app_config(self._config_path)
        app_cfg = self.config.get("app", {})
        self._app_title_base = str(app_cfg.get("title") or "FreeCAD 管理工具")
        try:
            ctk.set_appearance_mode(app_cfg.get("appearance_mode", "system"))
            ctk.set_default_color_theme(app_cfg.get("color_theme", "blue"))
        except ValueError:
            pass
        self._refresh_window_title()
        messagebox.showinfo(
            "配置",
            "已从 app_config.json 重新载入应用标题与主题。\n"
            "若在 JSON 里增删菜单或工具条，需重启后方可完全生效。",
            parent=self,
        )

    def _about(self) -> None:
        messagebox.showinfo(
            "关于",
            f"{self._app_title_base}\n"
            "UI: CustomTkinter\n"
            "配置: fcdesk/config/app_config.json\n"
            "偏好: fcdesk/config/workspace.custom.json\n"
            "文档: doc/文档索引.md",
            parent=self,
        )


def _patch_scaling_tracker() -> None:
    """避免 CustomTkinter 在部分 macOS Tcl 状态下 check_dpi_scaling 抛 TclError。"""
    from customtkinter.windows.widgets.scaling.scaling_tracker import ScalingTracker

    orig_fn = ScalingTracker.check_dpi_scaling.__func__

    def _reschedule(cls) -> None:
        for app in list(cls.window_widgets_dict.keys()):
            try:
                if app.winfo_exists():
                    app.after(cls.update_loop_interval, cls.check_dpi_scaling)
                    return
            except tk.TclError:
                continue
        cls.update_loop_running = False

    def safe_check(cls):
        try:
            orig_fn(cls)
        except (tk.TclError, RuntimeError, TypeError, ValueError):
            _reschedule(cls)

    ScalingTracker.check_dpi_scaling = classmethod(safe_check)


def run_app() -> None:
    _patch_scaling_tracker()
    print("fcdesk 已启动；关闭窗口后再用终端。", flush=True)
    app = AppShell()

    def _peek() -> None:
        try:
            app.lift()
            app.focus_force()
        except tk.TclError:
            pass

    app.after(80, _peek)
    app.mainloop()


if __name__ == "__main__":
    run_app()
