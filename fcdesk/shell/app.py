"""主界面：可选工具条 + 左图标轨 + 水平分割（中部页面栈 │ 右侧工作区树）+ 底栏。

中 / 右侧用 ``ttk.Panedwindow`` 可拖拽调节宽度（偏好记入 ``workspace.custom.json``）。
右侧「工作空间过滤目录树」启动时挂载一次；切换功能页不重绘侧栏。
主内容区各页在同一 PageStack 注册，实例常驻可复用。窗口标题含工作空间路径。"""

from __future__ import annotations

import sys
from pathlib import Path
import tkinter as tk
from tkinter import messagebox
from typing import Any

import customtkinter as ctk

from collections.abc import Callable

from fcdesk.config.loader import load_app_config
from fcdesk.config.user_prefs import (
    WORKSPACE_DOTFILE_NAME,
    apply_launcher_prefs_to_state,
    format_absolute_config_path,
    load_launcher_prefs,
    migrate_legacy_workspace_prefs,
    save_launcher_freecad_dir,
    save_launcher_shell_layout,
    save_launcher_window_geometry,
    set_active_workspace,
)
from fcdesk.shell.window_geometry import clamp_window_geometry_for_screen
from fcdesk.shell.native_dialog import pick_workspace_directory
from fcdesk.pages import (
    BomApplyPage,
    FcstdMapPage,
    HomePage,
    PartDedupPage,
    PlaceholderPage,
    StepBatchPage,
    SwStepExportPage,
    XLinkFixPage,
)
from fcdesk.shell.nav import NavSidebar
from fcdesk.shell.page_stack import PageStack
from fcdesk.shell.state import AppState
from fcdesk.shell.toolbar import Toolbar
from fcdesk.widgets.filtered_workspace_tree import FilteredWorkspaceTreeFrame

_PYTHON_DIR = Path(__file__).resolve().parents[2]
if str(_PYTHON_DIR) not in sys.path:
    sys.path.insert(0, str(_PYTHON_DIR))

# 中 / 右分割：主内容区与侧栏最小宽度（像素）
_SHELL_MAIN_PANE_MIN_PX = 340
_SHELL_RIGHT_PANE_MIN_PX = 160
_SHELL_RIGHT_DEFAULT_WIDTH_PX = 300

class AppShell(ctk.CTk):
    def __init__(self, config: dict[str, Any] | None = None) -> None:
        self._config_path = Path(__file__).resolve().parents[1] / "config" / "app_config.json"
        self.config = config or load_app_config(self._config_path)
        app_cfg = self.config.get("app", {})

        super().__init__()
        # 勿用 self.state：会遮蔽 Tk/CTk 根窗口的 state()，Windows 下设置标题栏颜色时会崩溃。
        self.app_state = AppState()
        migrate_legacy_workspace_prefs()
        apply_launcher_prefs_to_state(self.app_state)

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

        # 左：导航轨 · 右：整块内容区（内嵌水平 Panedwindow：中段页面栈 │ 全局侧栏树）
        self.grid_columnconfigure(0, weight=0, minsize=0)
        self.grid_columnconfigure(1, weight=1)

        min_width = int(app_cfg.get("min_width", 960))
        min_height = int(app_cfg.get("min_height", 560))
        self.minsize(min_width, min_height)

        fallback_geo = str(app_cfg.get("geometry", "1280x760"))
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

        self._content_row = content_row
        self._page_labels: dict[str, str] = {
            item["page"]: item.get("label", item["page"]) for item in nav_items
        }
        self._current_page_id: str | None = nav_items[0]["page"] if nav_items else None
        self._nav_hover_tip: str | None = None

        _launcher0 = load_launcher_prefs()
        _sl0 = _launcher0.get("shell_layout") or {}
        self._last_mid_right_sash_px: int | None = None
        _spx = _sl0.get("mid_right_sash_px")
        if isinstance(_spx, int) and _spx > 0:
            self._last_mid_right_sash_px = int(_spx)
        _ro = _sl0.get("right_panel_open")
        self._shell_right_open: bool = True if not isinstance(_ro, bool) else bool(_ro)
        _initial_rail = _sl0.get("nav_rail_mode")
        _initial_rail_arg: int | None = int(_initial_rail) if _initial_rail in (0, 1) else None

        self._shell_layout_snap_job: str | None = None
        self._shell_split_programmatic = False

        self.workspace_tree_sidebar: FilteredWorkspaceTreeFrame | None = None

        self._nav = NavSidebar(
            self,
            nav_items,
            on_select=self._show_page,
            fg_color=("gray90", "gray20"),
            initial_rail_mode=_initial_rail_arg,
            on_toggle_right=self._toggle_shell_right,
            on_hover=self._on_nav_hover_tip,
            on_rail_mode_change=self._on_nav_rail_persist,
        )
        self._nav.grid(row=content_row, column=0, sticky="nsew")

        self._mid_right_pw = tk.PanedWindow(
            self,
            orient=tk.HORIZONTAL,
            borderwidth=0,
            relief=tk.FLAT,
            sashwidth=6,
            sashrelief=tk.RAISED,
            opaqueresize=False,
        )
        self._mid_right_pw.grid(row=content_row, column=1, sticky="nsew")

        self._stack = PageStack(self._mid_right_pw)

        self._shell_right = ctk.CTkFrame(self._mid_right_pw, fg_color=("gray92", "gray18"), corner_radius=0)
        self._shell_right.grid_rowconfigure(0, weight=1)
        self._shell_right.grid_columnconfigure(0, weight=1)
        self.shell_right = self._shell_right
        self._shell_right_body = ctk.CTkFrame(self._shell_right, fg_color="transparent")
        self._shell_right_body.grid(row=0, column=0, sticky="nsew", padx=8, pady=(8, 6))
        self.shell_right_body = self._shell_right_body
        self._ensure_workspace_tree_sidebar()

        self._mid_right_pw.add(self._stack)
        self._mid_right_pw.add(self._shell_right)
        try:
            self._mid_right_pw.paneconfigure(self._stack, minsize=_SHELL_MAIN_PANE_MIN_PX, stretch="always")
            self._mid_right_pw.paneconfigure(self._shell_right, minsize=_SHELL_RIGHT_PANE_MIN_PX, stretch="always")
        except tk.TclError:
            pass

        self._mid_right_pw.bind("<ButtonRelease-1>", self._schedule_shell_layout_snap)

        self._nav.set_right_toggle_chevron(self._shell_right_open)

        self._register_pages(nav_items)

        # 勿用前缀 _xxx：Tk/CTk 可能把未识别的 _ 属性转到 Tcl，误判为 Tk 选项。
        status_row = content_row + 1
        self.status_bar = ctk.CTkLabel(
            self,
            text="",
            anchor="w",
            height=24,
            font=ctk.CTkFont(size=12),
        )
        self.status_bar.grid(row=status_row, column=0, columnspan=2, sticky="ew", padx=12, pady=(0, 6))

        self._refresh_window_title()
        self._render_status_bar()

        first_page = nav_items[0]["page"] if nav_items else "home"
        self.after_idle(lambda p=first_page: self._nav.select(p))
        self.after(60, self._defer_apply_shell_layout_sash)

    def _quit_with_saved_geometry(self) -> None:
        try:
            if self.wm_state() == "normal":
                save_launcher_window_geometry(self.winfo_geometry())
        except tk.TclError:
            pass
        self._flush_shell_layout_for_quit()
        self.destroy()

    def _toolbar_actions(self) -> dict:
        return {
            "pick_repo": self._pick_repo,
            "pick_freecad_dir": self._pick_freecad_dir,
            "reload_config": self._reload_config,
            "about": self._about,
        }

    def _refresh_window_title(self) -> None:
        self.title(
            f"{self._app_title_base} - 【{format_absolute_config_path(self.app_state.repo_root)}】"
        )

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
        self._stack.register("part_dedup", PartDedupPage(self._stack, self.app_state))

        self._stack.register(
            "bom_apply",
            BomApplyPage(self._stack, self.app_state),
        )

        self._stack.register(
            "bom_export",
            PlaceholderPage(
                self._stack,
                self.app_state,
                page_id="bom_export",
                title=labels.get("bom_export", "bom_export"),
                hint=descriptions.get("bom_export", ""),
            ),
        )

    def _ensure_workspace_tree_sidebar(self) -> None:
        """挂载全局「工作空间过滤目录树」一次：切换功能页不重绘、不复建侧栏正文。"""
        if self.workspace_tree_sidebar is not None:
            try:
                if self.workspace_tree_sidebar.winfo_exists():
                    return
            except tk.TclError:
                pass
            self.workspace_tree_sidebar = None

        self.workspace_tree_sidebar = FilteredWorkspaceTreeFrame(
            self._shell_right_body,
            self.app_state,
            on_select=self._relay_workspace_pick,
            single_column_tree=True,
            sidebar_layout=True,
            tree_style_suffix="ShellWsTree",
        )
        self.workspace_tree_sidebar.pack(fill="both", expand=True)

    def _relay_workspace_pick(self, rel: Path | None) -> None:
        pg = self._stack.get_current_page()
        if pg is None:
            return
        pg.on_workspace_tree_select(rel)

    def _peek_mid_right_sash0(self) -> int | None:
        try:
            x, _y = self._mid_right_pw.sash_coord(0)
            return int(x)
        except (tk.TclError, TypeError, ValueError):
            return None

    def _mid_right_sash_set_x_px(self, x: int) -> None:
        """水平分割条 X 像素；Python 3.13 起 ``tk.PanedWindow`` 无 ``sashpos``，须用 ``sash_place``。"""
        pw = self._mid_right_pw
        try:
            _ox, oy = pw.sash_coord(0)
        except tk.TclError:
            oy = 0
        pw.sash_place(0, int(x), int(oy))

    def _mid_right_pw_inner_width(self) -> int:
        try:
            self.update_idletasks()
            return max(240, int(self._mid_right_pw.winfo_width()))
        except (tk.TclError, TypeError, ValueError):
            return 960

    def _set_mid_right_sash_programmatic(self, fn: Callable[[], None]) -> None:
        self._shell_split_programmatic = True
        try:
            fn()
        finally:
            self._shell_split_programmatic = False

    def _defer_apply_shell_layout_sash(self, attempt: int = 0) -> None:
        if not getattr(self, "_mid_right_pw", None):
            return
        ww = self._mid_right_pw_inner_width()
        need = _SHELL_MAIN_PANE_MIN_PX + _SHELL_RIGHT_PANE_MIN_PX + 24
        if ww < need and attempt < 16:
            self.after(96, lambda: self._defer_apply_shell_layout_sash(attempt + 1))
            return

        prefs_open = self._shell_right_open
        saved = self._last_mid_right_sash_px
        lo = _SHELL_MAIN_PANE_MIN_PX
        hi = max(lo + 2, ww - _SHELL_RIGHT_PANE_MIN_PX)

        if prefs_open:
            if isinstance(saved, int) and saved > 0:
                target = min(max(int(saved), lo), hi)
            else:
                target = max(lo, min(hi, ww - _SHELL_RIGHT_DEFAULT_WIDTH_PX))
            self._set_mid_right_sash_programmatic(lambda t=target: self._mid_right_sash_set_x_px(int(t)))
            self._last_mid_right_sash_px = int(target)
        else:
            pos = max(120, ww - 8)
            self._set_mid_right_sash_programmatic(lambda p=pos: self._mid_right_sash_set_x_px(int(p)))

        self._nav.set_right_toggle_chevron(prefs_open)

    def _schedule_shell_layout_snap(self, *_ignored: object) -> None:
        if self._shell_split_programmatic:
            return
        if not self._shell_right_open:
            return
        jid = self._shell_layout_snap_job
        if jid is not None:
            try:
                self.after_cancel(jid)
            except tk.TclError:
                pass
        self._shell_layout_snap_job = self.after(220, self._persist_mid_right_sash_px)

    def _persist_mid_right_sash_px(self) -> None:
        self._shell_layout_snap_job = None
        if self._shell_split_programmatic or not self._shell_right_open:
            return
        px = self._peek_mid_right_sash0()
        if px is None:
            return
        ww = self._mid_right_pw_inner_width()
        if ww - px < 64:
            return
        self._last_mid_right_sash_px = px
        save_launcher_shell_layout(mid_right_sash_px=px)

    def _flush_shell_layout_for_quit(self) -> None:
        jid = self._shell_layout_snap_job
        if jid is not None:
            try:
                self.after_cancel(jid)
            except tk.TclError:
                pass
            self._shell_layout_snap_job = None
        if self._shell_right_open:
            px = self._peek_mid_right_sash0()
            ww = self._mid_right_pw_inner_width()
            if px is not None and ww - px > 56:
                self._last_mid_right_sash_px = px
        save_launcher_shell_layout(
            nav_rail_mode=self._nav.get_rail_mode(),
            right_panel_open=self._shell_right_open,
            mid_right_sash_px=self._last_mid_right_sash_px,
        )

    def _on_nav_rail_persist(self) -> None:
        save_launcher_shell_layout(nav_rail_mode=self._nav.get_rail_mode())

    def _render_status_bar(self) -> None:
        lab = self._page_labels.get(self._current_page_id or "", self._current_page_id or "—")
        chunks: list[str] = [
            f"当前: {lab}",
            f"工作空间: {format_absolute_config_path(self.app_state.repo_root)}",
        ]
        fc = self.app_state.freecad_dir
        if fc and fc.is_dir():
            chunks.append(f"FreeCAD: {format_absolute_config_path(fc)}")
        text = "  |  ".join(chunks)
        if self._nav_hover_tip:
            text += f"  │  （{self._nav_hover_tip}）"
        self.status_bar.configure(text=text)

    def _on_nav_hover_tip(self, tip: str | None) -> None:
        self._nav_hover_tip = tip
        self._render_status_bar()

    def _set_shell_right_open(self, open_: bool) -> None:
        """显式设定右侧栏开合（移动 Panedwindow 首根 sash，与 «/» 同步）。"""
        want = bool(open_)
        if want == self._shell_right_open:
            return
        self.update_idletasks()
        ww = self._mid_right_pw_inner_width()

        if not want:
            cur = self._peek_mid_right_sash0()
            if cur is not None and ww - cur >= 56:
                self._last_mid_right_sash_px = cur
            self._shell_right_open = False
            pos = max(120, ww - 8)
            self._set_mid_right_sash_programmatic(lambda p=pos: self._mid_right_sash_set_x_px(int(p)))
            self._nav.set_right_toggle_chevron(False)
            save_launcher_shell_layout(
                right_panel_open=False,
                mid_right_sash_px=self._last_mid_right_sash_px,
            )
            return

        self._shell_right_open = True
        lo = _SHELL_MAIN_PANE_MIN_PX
        hi = max(lo + 2, ww - _SHELL_RIGHT_PANE_MIN_PX)
        t = self._last_mid_right_sash_px
        if not isinstance(t, int) or int(t) < lo:
            tgt = max(lo, min(hi, ww - _SHELL_RIGHT_DEFAULT_WIDTH_PX))
        else:
            tgt = min(max(int(t), lo), hi)
        self._set_mid_right_sash_programmatic(lambda p=tgt: self._mid_right_sash_set_x_px(int(p)))
        self._last_mid_right_sash_px = int(tgt)
        self._nav.set_right_toggle_chevron(True)
        save_launcher_shell_layout(
            right_panel_open=True,
            mid_right_sash_px=self._last_mid_right_sash_px,
        )

    def _toggle_shell_right(self) -> None:
        self._set_shell_right_open(not self._shell_right_open)

    def _show_page(self, page_id: str) -> None:
        self._current_page_id = page_id
        self._nav_hover_tip = None
        self._stack.show(page_id)
        self._render_status_bar()

    def _pick_repo(self) -> None:
        path = pick_workspace_directory(
            self,
            title="选择工作空间根目录",
            repo_root=self.app_state.repo_root,
            path_hint=format_absolute_config_path(self.app_state.repo_root),
        )
        if path:
            rp = Path(path).expanduser().resolve(strict=False)
            set_active_workspace(rp, self.app_state)
            self._refresh_window_title()
            self._render_status_bar()

    def _pick_freecad_dir(self) -> None:
        fc = self.app_state.freecad_dir
        path = pick_workspace_directory(
            self,
            title="选择 FreeCAD 目录",
            repo_root=self.app_state.repo_root,
            path_hint=format_absolute_config_path(fc) if fc else "",
        )
        if path:
            p = Path(path).expanduser().resolve(strict=False)
            self.app_state.freecad_dir = p
            save_launcher_freecad_dir(p)
            self._refresh_window_title()
            self._render_status_bar()

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
            f"工作区偏好: {WORKSPACE_DOTFILE_NAME}（工作空间根目录）\n"
            "最近工作空间: fcdesk/config/workspace.custom.json\n"
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
