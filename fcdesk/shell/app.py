"""桌面启动器：工作空间配置 + 打开 Web 版（Tk 功能页已废弃）。"""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Any

import customtkinter as ctk
import tkinter as tk
from tkinter import messagebox

from fcdesk.config.loader import load_app_config
from fcdesk.config.user_prefs import (
    apply_launcher_prefs_to_state,
    migrate_legacy_workspace_prefs,
    save_launcher_window_geometry,
)
from fcdesk.pages.home import HomePage
from fcdesk.shell.state import AppState
from fcdesk.shell.window_geometry import clamp_window_geometry_for_screen

_PYTHON_DIR = Path(__file__).resolve().parents[2]
if str(_PYTHON_DIR) not in sys.path:
    sys.path.insert(0, str(_PYTHON_DIR))


class AppShell(ctk.CTk):
    def __init__(self, config: dict[str, Any] | None = None) -> None:
        self._config_path = Path(__file__).resolve().parents[1] / "config" / "app_config.json"
        self.config = config or load_app_config(self._config_path)
        app_cfg = self.config.get("app", {})

        super().__init__()
        self.app_state = AppState()
        migrate_legacy_workspace_prefs()
        apply_launcher_prefs_to_state(self.app_state)

        self._app_title_base = str(app_cfg.get("title") or "FreeCAD 管理工具")

        ctk.set_appearance_mode(app_cfg.get("appearance_mode", "system"))
        ctk.set_default_color_theme(app_cfg.get("color_theme", "blue"))

        min_width = int(app_cfg.get("min_width", 520))
        min_height = int(app_cfg.get("min_height", 420))
        self.minsize(min_width, min_height)

        fallback_geo = str(app_cfg.get("geometry", "640x520"))
        from fcdesk.config.user_prefs import load_launcher_prefs

        wg_save = load_launcher_prefs().get("window_geometry")
        candidate_geo = wg_save if isinstance(wg_save, str) and wg_save.strip() else fallback_geo

        self.update_idletasks()
        sw = int(self.winfo_screenwidth())
        sh = int(self.winfo_screenheight())
        self.geometry(
            clamp_window_geometry_for_screen(
                candidate_geo,
                screen_w=sw,
                screen_h=sh,
                min_w=min_width,
                min_h=min_height,
                fallback=fallback_geo,
            )
        )

        self.protocol("WM_DELETE_WINDOW", self._quit_with_saved_geometry)

        self.grid_rowconfigure(0, weight=1)
        self.grid_rowconfigure(1, weight=0)
        self.grid_columnconfigure(0, weight=1)

        self._main = ctk.CTkFrame(self, fg_color="transparent")
        self._main.grid(row=0, column=0, sticky="nsew")

        self._home = HomePage(
            self._main,
            self.app_state,
            on_reload_config=self._reload_config,
            on_about=self._about,
            refresh_window_title=self._refresh_window_title,
            on_workspace_changed=self._render_status_bar,
        )
        self._home.pack(fill="both", expand=True)

        self.status_bar = ctk.CTkLabel(
            self,
            text="",
            anchor="w",
            height=22,
            font=ctk.CTkFont(size=11),
            text_color=("#64748b", "#94a3b8"),
        )
        self.status_bar.grid(row=1, column=0, sticky="ew", padx=12, pady=(0, 4))

        self._refresh_window_title()
        self._render_status_bar()

    def _quit_with_saved_geometry(self) -> None:
        try:
            if self.wm_state() == "normal":
                save_launcher_window_geometry(self.winfo_geometry())
        except tk.TclError:
            pass
        self.destroy()

    def _refresh_window_title(self) -> None:
        from fcdesk.config.user_prefs import format_absolute_config_path

        self.title(f"{self._app_title_base} — {self.app_state.repo_root.name}")

    def _render_status_bar(self) -> None:
        from fcdesk.config.user_prefs import format_absolute_config_path

        fc = self.app_state.freecad_dir
        ws = format_absolute_config_path(self.app_state.repo_root)
        if fc and fc.is_dir():
            fc_s = format_absolute_config_path(fc)
            self.status_bar.configure(text=f"{ws}  ·  FreeCAD: {fc_s}")
        else:
            self.status_bar.configure(text=ws)

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

    def _about(self) -> None:
        from fcdesk.config.launcher_paths import platform_launcher_prefs_file
        from fcdesk.config.user_prefs import format_absolute_config_path

        messagebox.showinfo(
            "关于",
            f"{self._app_title_base}\n\n"
            "桌面窗口为启动器；功能请用 Web 版。\n"
            f"python -m fcdesk.web\n\n"
            f"配置: {format_absolute_config_path(platform_launcher_prefs_file())}",
            parent=self,
        )


def _patch_scaling_tracker() -> None:
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
