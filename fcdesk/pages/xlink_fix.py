from __future__ import annotations

import itertools
import threading
from pathlib import Path

import customtkinter as ctk
import tkinter as tk
from tkinter import ttk

from fcdesk.config.user_prefs import (
    format_resolved_under_workspace,
    format_stored_path_for_display,
    load_workspace_prefs,
    merge_workspace_section,
    shorten_workspace_relative_display,
    store_path_under_repo,
)
from fcdesk.pages.base import BasePage
from fcdesk.pages import form_widgets as fw
from fcdesk.services.xlink_fix_service import run_xlink_fix
from fcdesk.shell.native_dialog import pick_workspace_directory
from fcdesk.shell.state import AppState

class XLinkFixPage(BasePage):
    page_id = "xlink_fix"

    def __init__(self, master, state: AppState, **kwargs) -> None:
        super().__init__(master, state, **kwargs)
        self._dry_run = ctk.BooleanVar(value=True)
        self._all_in_dir = ctk.BooleanVar(value=True)

        fw.page_title(self, text="链接路径修正").grid(
            row=0, column=0, columnspan=4, padx=24, pady=(20, 8), sticky="nw"
        )

        hint = (
            "映射来自 .phoenix/phoenix-cad.sqlite（由「FCStd 索引」页扫描生成）。"
            "本页只需选择修正目录与脚本选项（偏好 fc_linkfix）。"
        )
        fw.page_hint_label(self, hint, wraplength=920).grid(
            row=1, column=0, columnspan=4, padx=24, pady=(0, 14), sticky="nw"
        )

        dir_row = ctk.CTkFrame(self, fg_color="transparent")
        dir_row.grid(row=2, column=0, columnspan=4, padx=24, pady=6, sticky="ew")
        dir_row.grid_columnconfigure(1, weight=1)
        fw.form_row_label(dir_row, text="修正目录").grid(row=0, column=0, padx=(0, 12), sticky="nw")
        self._batch_dir_entry = ctk.CTkEntry(
            dir_row,
            placeholder_text="如 ./型号/FreeCAD（留空则用工作空间根）",
        )
        self._batch_dir_entry.grid(row=0, column=1, padx=0, pady=0, sticky="ew")
        ctk.CTkButton(dir_row, text="浏览…", width=80, command=self._browse_batch_dir).grid(
            row=0, column=2, padx=(12, 0), pady=0, sticky="e"
        )

        opts = ctk.CTkFrame(self, fg_color="transparent")
        opts.grid(row=3, column=0, columnspan=4, padx=24, sticky="w", pady=(4, 0))
        ctk.CTkCheckBox(opts, text="dry-run", variable=self._dry_run).pack(side="left", padx=(0, 14))
        ctk.CTkCheckBox(opts, text="all-in-dir", variable=self._all_in_dir).pack(side="left")

        btns = ctk.CTkFrame(self, fg_color="transparent")
        btns.grid(row=4, column=0, columnspan=4, padx=24, pady=8, sticky="w")
        ctk.CTkButton(btns, text="保存偏好", fg_color=("gray65", "gray35"), command=self._persist_xlink_fields).pack(
            side="left", padx=(0, 8)
        )
        ctk.CTkButton(btns, text="运行", command=self._run).pack(side="left", padx=(0, 8))
        ctk.CTkButton(btns, text="打开报告目录", fg_color="gray40", command=self._open_report_dir).pack(side="left")

        tree_wrap = ctk.CTkFrame(self, fg_color="transparent")
        tree_wrap.grid(row=5, column=0, columnspan=4, padx=(24, 24), pady=(8, 24), sticky="nsew")
        tree_wrap.grid_rowconfigure(0, weight=1)
        tree_wrap.grid_columnconfigure(0, weight=1)
        self._tree_host = tk.Frame(tree_wrap, highlightthickness=0)
        self._tree_host.grid(row=0, column=0, sticky="nsew")
        self._tree_scroll = ttk.Scrollbar(self._tree_host)
        self._tree = ttk.Treeview(
            self._tree_host,
            columns=("detail",),
            show="tree headings",
            yscrollcommand=self._tree_scroll.set,
            height=14,
            selectmode="browse",
        )
        self._tree_scroll.config(command=self._tree.yview)
        self._tree.heading("#0", text="XLink / 文件")
        self._tree.heading("detail", text="说明 · 路径")
        self._tree.column("#0", width=360, stretch=True)
        self._tree.column("detail", width=440, stretch=True)
        self._tree.grid(row=0, column=0, sticky="nsew")
        self._tree_scroll.grid(row=0, column=1, sticky="ns")
        self._tree_host.grid_rowconfigure(0, weight=1)
        self._tree_host.grid_columnconfigure(0, weight=1)

        self.grid_rowconfigure(5, weight=2)
        self.grid_columnconfigure(1, weight=1)

        self._apply_xlink_fix_tree_style()
        self._results_tree_placeholder("点击「运行」后在此查看分组结果", "")

    def _apply_xlink_fix_tree_style(self) -> None:
        """ttk.Treeview 大致贴近 CTk 亮/深色（与编号查重页一致思路）。"""
        mode = ctk.get_appearance_mode()
        if mode == "Dark":
            dark = True
        elif mode == "Light":
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
            "XLinkFix.Treeview",
            background=bg,
            fieldbackground=bg,
            foreground=fg,
            rowheight=22,
            borderwidth=0,
        )
        style.map(
            "XLinkFix.Treeview",
            background=[("selected", sel_bg)],
            foreground=[("selected", sel_fg)],
        )
        style.configure(
            "XLinkFix.Treeview.Heading",
            background=("#3d3d3d" if dark else "#d9d9d9"),
            foreground=fg,
            relief="flat",
            borderwidth=0,
        )
        self._tree.configure(style="XLinkFix.Treeview")
        try:
            self._tree_host.configure(bg=bg)
        except tk.TclError:
            pass

    def _results_tree_placeholder(self, title: str, detail: str = "") -> None:
        self._tree.delete(*self._tree.get_children(""))
        self._tree.insert("", "end", text=title, values=(detail,))

    def _populate_xlink_tree_from_json(self, data: dict) -> None:
        """由 fix_fcstd_xlink_paths.py --desktop-json-results 载入。"""
        rr = self._repo()
        nid = itertools.count()
        ni = lambda: f"xl_{next(nid)}"
        self._tree.delete(*self._tree.get_children(""))

        total = int(data.get("total_changes") or 0)
        dry = bool(data.get("dry_run"))
        mode = "dry-run（未写回）" if dry else "已写回 FCStd"
        rp = data.get("report_path") or ""
        top_line = f"{mode} · 合计 {total} 条变更"
        self._tree.insert("", "end", iid=ni(), text=top_line, values=(rp,))
        skipped = list(data.get("skipped") or [])
        files = list(data.get("files") or [])

        if skipped:
            sk = self._tree.insert("", "end", iid=ni(), text=f"跳过（不存在）· {len(skipped)} 个", open=True, values=("",))
            for s in sorted(skipped):
                p = Path(s)
                self._tree.insert(sk, "end", iid=ni(), text=p.name, values=(format_resolved_under_workspace(p, rr),))

        if files:
            sec = self._tree.insert("", "end", iid=ni(), text=f"已处理文档（{len(files)} 个）", open=True, values=("",))
            for fi in files:
                p = Path(str(fi.get("path", ""))).expanduser()
                cnt = int(fi.get("change_count") or 0)
                recs = list(fi.get("records") or [])
                loc = format_resolved_under_workspace(p.resolve(), rr) if p.parts else ""
                grp = self._tree.insert(
                    sec,
                    "end",
                    iid=ni(),
                    text=f"{p.name}（{cnt} 处）",
                    values=(loc,),
                    open=bool(recs),
                )
                for r in recs:
                    old_p = str(r.get("old_path", ""))
                    new_p = str(r.get("new_path", ""))
                    c_ct = int(r.get("count") or 1)
                    verdict = str(r.get("verdict", ""))
                    note = str(r.get("note", ""))
                    line0 = f"{old_p} → {new_p}"
                    if c_ct > 1:
                        line0 += f"  ×{c_ct}"
                    det = verdict
                    if note:
                        det = f"{verdict} — {note}" if verdict else note
                    tf = str(r.get("target_file", "")).strip()
                    if tf:
                        tp = Path(tf).expanduser()
                        try:
                            t_disp = format_resolved_under_workspace(tp.resolve(), rr)
                        except OSError:
                            t_disp = tf
                        det = f"目标：{t_disp}" + (f"；{det}" if det else "")
                    self._tree.insert(grp, "end", iid=ni(), text=line0, values=(det,))

        if total == 0 and not skipped and not files:
            self._tree.insert("", "end", iid=ni(), text="（无条目）", values=("",))

    def _repo(self) -> Path:
        """当前工作空间根（工具条所选项目根）；相对路径以此为基准拼接。"""
        return self.state.repo_root.expanduser().resolve()

    def _pv(self) -> dict:
        return load_workspace_prefs(self.state.repo_root).get("fc_linkfix") or {}

    def _canon(self, text: str, *, fb: Path) -> Path:
        raw = (text or "").strip()
        if not raw or raw == ".":
            return fb
        q = Path(raw).expanduser()
        return q.resolve() if q.is_absolute() else (self._repo() / q).resolve()

    def on_show(self) -> None:
        pv = self._pv()
        rr = self._repo()

        self._batch_dir_entry.delete(0, "end")
        disp_bd = shorten_workspace_relative_display(
            format_stored_path_for_display(pv.get("freecad_batch_dir"), self.state.repo_root) or ""
        )
        self._batch_dir_entry.insert(0, disp_bd)

        if "dry_run" in pv:
            self._dry_run.set(bool(pv["dry_run"]))
        if "all_in_dir" in pv:
            self._all_in_dir.set(bool(pv["all_in_dir"]))
        self._apply_xlink_fix_tree_style()

    def _persist_xlink_fields(self) -> None:
        rr = self._repo()
        bd = self._batch_dir_entry.get()

        bd_eff = self._canon(bd, fb=rr)
        bd_sv = (
            None
            if bd_eff.resolve() == rr.resolve()
            else store_path_under_repo(bd_eff, rr)
        )
        patch: dict = {
            "dry_run": self._dry_run.get(),
            "all_in_dir": self._all_in_dir.get(),
            # 已废弃：与 FCStd 索引共用 fcstd_map.json，不再需要单独 CAD 搜索根
            "cad_search_root": None,
            "freecad_batch_dir": bd_sv,
        }
        merge_workspace_section("fc_linkfix", patch, self.state.repo_root)

    def _browse_batch_dir(self) -> None:
        path = pick_workspace_directory(
            self,
            title="修正目录",
            repo_root=self.state.repo_root,
            path_hint=self._batch_dir_entry.get(),
        )
        if path:
            rr = self._repo()
            p = Path(path).expanduser()
            self._batch_dir_entry.delete(0, "end")
            self._batch_dir_entry.insert(
                0,
                shorten_workspace_relative_display(format_resolved_under_workspace(p, rr)),
            )
            self._persist_xlink_fields()

    def _open_report_dir(self) -> None:
        d = self._canon(self._batch_dir_entry.get(), fb=self._repo())
        if d.is_dir():
            os.system(f'open "{d}"' if sys.platform == "darwin" else f'xdg-open "{d}"')

    def _log_line(self, text: str) -> None:
        self.append_log(text)

    def _run(self) -> None:
        rr = self._repo()
        batch_dir = self._canon(self._batch_dir_entry.get(), fb=rr)
        if not batch_dir.is_dir():
            self._log_line(f"错误：修正目录不存在 {batch_dir}")
            self._results_tree_placeholder(
                "错误：修正目录不存在",
                format_resolved_under_workspace(batch_dir, rr),
            )
            return

        self._persist_xlink_fields()
        batch_input = self._batch_dir_entry.get().strip()
        self._results_tree_placeholder("正在运行…", "")
        self._log_line("XLink 路径修正（读取 .phoenix 索引库）…")

        def worker() -> None:
            try:
                data = run_xlink_fix(
                    rr,
                    batch_dir_input=batch_input,
                    dry_run=self._dry_run.get(),
                    all_in_dir=self._all_in_dir.get(),
                )
                self.after(0, lambda d=data: self._finish_xlink_from_service(d))
            except ValueError as e:
                self.after(0, lambda err=str(e): self._finish_xlink_error(err))
            except Exception as e:
                self.after(0, lambda err=str(e): self._finish_xlink_error(err))

        threading.Thread(target=worker, daemon=True).start()

    def _finish_xlink_from_service(self, data: dict) -> None:
        captured = data.get("log") or ""
        returncode = int(data.get("exit_code", 1))
        self.append_log(captured or "(无输出)")
        self._log_line(f"退出码: {returncode}")

        if isinstance(data, dict) and data.get("schema") == 1:
            self._populate_xlink_tree_from_json(data)
        elif returncode != 0:
            self._results_tree_placeholder("脚本未成功退出（详见日志）", f"exit {returncode}")
        else:
            self._results_tree_placeholder("未能解析结构化结果（请查看日志）", "")

    def _finish_xlink_error(self, err: str) -> None:
        self._log_line(err)
        self._results_tree_placeholder("运行失败", err)

