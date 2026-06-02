from __future__ import annotations

import itertools
import threading
from collections import defaultdict
from pathlib import Path

import customtkinter as ctk
import tkinter as tk
from tkinter import ttk

from fcdesk.config.user_prefs import format_resolved_under_workspace
from fcdesk.pages.base import BasePage
from fcdesk.pages import form_widgets as fw
from fcdesk.services.fcstd_map_service import (
    get_fcstd_map_prefs,
    load_fcstd_map_payload,
    run_fcstd_map_scan,
    save_fcstd_map_prefs,
)
from fcdesk.shell.state import AppState


class FcstdMapPage(BasePage):
    page_id = "fcstd_map"

    def __init__(self, master, state: AppState, **kwargs) -> None:
        super().__init__(master, state, **kwargs)

        fw.page_title(self, text="CAD 索引").grid(row=0, column=0, columnspan=2, padx=24, pady=(20, 4), sticky="nw")

        fw.page_hint_label(
            self,
            (
                "从当前工作空间根递归扫描 FCStd、MD、PDF、图片、DXF/DWG 等，"
                "写入 .phoenix/cad-database.sqlite；条目路径相对工作空间根（供「链接路径修正」使用）。"
            ),
            wraplength=880,
        ).grid(row=1, column=0, columnspan=2, padx=24, pady=(0, 10), sticky="nw")

        self._force_part_name_var = tk.BooleanVar(value=False)
        ctk.CTkCheckBox(
            self,
            text="强制更新 PartName（智能去前缀，覆盖索引已有值）",
            variable=self._force_part_name_var,
            command=self._persist,
        ).grid(row=2, column=0, columnspan=2, padx=24, pady=(0, 4), sticky="w")

        row3 = ctk.CTkFrame(self, fg_color="transparent")
        row3.grid(row=3, column=0, columnspan=2, padx=24, pady=8, sticky="w")
        ctk.CTkButton(row3, text="创建索引", command=self._run).pack(side="left", padx=(0, 8))
        ctk.CTkButton(row3, text="显示表格", fg_color=("gray42", "gray32"), command=self._show_map_table).pack(
            side="left"
        )

        tree_wrap = ctk.CTkFrame(self, fg_color="transparent")
        tree_wrap.grid(row=4, column=0, columnspan=2, padx=(24, 24), pady=(8, 24), sticky="nsew")
        tree_wrap.grid_rowconfigure(0, weight=1)
        tree_wrap.grid_columnconfigure(0, weight=1)
        self._tree_host = tk.Frame(tree_wrap, highlightthickness=0)
        self._tree_host.grid(row=0, column=0, sticky="nsew")
        self._tree_scroll = ttk.Scrollbar(self._tree_host)
        self._tree = ttk.Treeview(
            self._tree_host,
            columns=("rel", "meta"),
            show="tree headings",
            yscrollcommand=self._tree_scroll.set,
            height=14,
            selectmode="browse",
        )
        self._tree_scroll.config(command=self._tree.yview)
        self._tree.heading("#0", text="名称 / 路径")
        self._tree.heading("rel", text="相对路径（相对工作空间根 · 即 JSON 所在目录）")
        self._tree.heading("meta", text="零件号 · 版本 · 类型 · 型号")
        self._tree.column("#0", width=220, stretch=True)
        self._tree.column("rel", width=360, stretch=True)
        self._tree.column("meta", width=260, stretch=True)
        self._tree.grid(row=0, column=0, sticky="nsew")
        self._tree_scroll.grid(row=0, column=1, sticky="ns")
        self._tree_host.grid_rowconfigure(0, weight=1)
        self._tree_host.grid_columnconfigure(0, weight=1)

        self.grid_rowconfigure(4, weight=2)
        self.grid_columnconfigure(0, weight=1)

        self._apply_fcstd_map_tree_style()
        self._results_tree_placeholder("点击下方「显示表格」加载索引库", "")

    def _apply_fcstd_map_tree_style(self) -> None:
        """ttk.Treeview 大致贴近 CTk 亮/深色。"""
        if ctk.get_appearance_mode() == "Dark":
            dark = True
        elif ctk.get_appearance_mode() == "Light":
            dark = False
        else:
            try:
                from customtkinter import AppearanceModeTracker

                dark = AppearanceModeTracker.detect_appearance_mode() == 1
            except Exception:
                dark = False

        bg = "#2b2b2b" if dark else "#f0f0f0"
        fg = "#e8e8e8" if dark else "#202020"
        sel_bg = "#1f538d" if dark else "#3b8ed0"
        sel_fg = "#ffffff"
        style = ttk.Style()
        try:
            style.theme_use("clam")
        except tk.TclError:
            pass
        style.configure(
            "FcstdMap.Treeview",
            background=bg,
            fieldbackground=bg,
            foreground=fg,
            rowheight=22,
            borderwidth=0,
        )
        style.map(
            "FcstdMap.Treeview",
            background=[("selected", sel_bg)],
            foreground=[("selected", sel_fg)],
        )
        style.configure(
            "FcstdMap.Treeview.Heading",
            background=("#3d3d3d" if dark else "#d9d9d9"),
            foreground=fg,
            relief="flat",
            borderwidth=0,
        )
        self._tree.configure(style="FcstdMap.Treeview")
        try:
            self._tree_host.configure(bg=bg)
        except tk.TclError:
            pass

    def _results_tree_placeholder(self, title: str, detail: str = "") -> None:
        self._tree.delete(*self._tree.get_children(""))
        self._tree.insert("", "end", text=title, values=("", detail))

    @staticmethod
    def _fmt_meta_cell(row: dict) -> str:
        bits: list[str] = []
        for k in ("PartNumber", "PartVersion", "TypeCode", "ModelSeries", "PartName", "label"):
            v = str(row.get(k) or "").strip()
            if v:
                bits.append(v)
        return " · ".join(bits)

    def _populate_fcstd_tree(self, source: Path, rows: list[dict]) -> None:
        rr = self.state.repo_root.expanduser().resolve(strict=False)
        nid = itertools.count()
        ni = lambda: f"fm_{next(nid)}"
        self._tree.delete(*self._tree.get_children(""))

        src_disp = format_resolved_under_workspace(source.resolve(strict=False), rr)
        sec = self._tree.insert(
            "",
            "end",
            iid=ni(),
            text=f"{source.name}（{len(rows)} 条）",
            values=("", src_disp),
            open=True,
        )

        grouped: defaultdict[str, list[dict]] = defaultdict(list)
        for row in rows:
            grouped[row["filename"]].append(row)

        for basename in sorted(grouped.keys()):
            lst = grouped[basename]
            if len(lst) == 1:
                r = lst[0]
                self._tree.insert(
                    sec,
                    "end",
                    iid=ni(),
                    text=basename,
                    values=(r["repo_rel_path"], self._fmt_meta_cell(r)),
                )
            else:
                gnode = self._tree.insert(
                    sec,
                    "end",
                    iid=ni(),
                    text=f"{basename}（{len(lst)}）",
                    values=("", ""),
                    open=True,
                )
                for r in sorted(lst, key=lambda x: x["repo_rel_path"]):
                    self._tree.insert(
                        gnode,
                        "end",
                        iid=ni(),
                        text=r["repo_rel_path"],
                        values=("", self._fmt_meta_cell(r)),
                    )

    def _show_map_table(self) -> None:
        rr = self.state.repo_root.expanduser().resolve(strict=False)
        payload = load_fcstd_map_payload(rr)
        db_disp = payload.get("database_path_display") or ""
        if not payload.get("exists"):
            self._results_tree_placeholder(
                "尚无索引库",
                f"{db_disp} · 请先「创建索引」" if db_disp else "",
            )
            return
        rows = payload.get("entries") or []
        if not rows:
            self._results_tree_placeholder("索引库无条目", db_disp)
            return
        self._populate_fcstd_tree(Path(payload["database_path"]), rows)

    def on_show(self) -> None:
        prefs = get_fcstd_map_prefs(self.state.repo_root)
        self._force_part_name_var.set(bool(prefs.get("force_update_part_name")))
        self._apply_fcstd_map_tree_style()

    def _persist(self) -> None:
        save_fcstd_map_prefs(
            self.state.repo_root,
            force_update_part_name=bool(self._force_part_name_var.get()),
        )

    def _run(self) -> None:
        rr = self.state.repo_root.expanduser().resolve(strict=False)
        self._persist()
        self.append_log(f"工程内搜索：工作空间根 {format_resolved_under_workspace(rr, rr)}")

        def worker() -> None:
            try:
                payload = run_fcstd_map_scan(
                    rr,
                    force_update_part_name=bool(self._force_part_name_var.get()),
                )
                log = payload.get("scan_log") or ""
                self.after(0, lambda lg=log: self.append_log(lg))
            except Exception as e:
                self.after(0, lambda err=str(e): self.append_log(f"异常: {err}"))

        threading.Thread(target=worker, daemon=True).start()
