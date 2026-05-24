from __future__ import annotations

import itertools
import json
import subprocess
import sys
import threading
from collections import defaultdict
from pathlib import Path

import customtkinter as ctk
import tkinter as tk
from tkinter import ttk

from fcdesk.config.user_prefs import (
    format_resolved_under_workspace,
    format_stored_path_for_display,
    load_workspace_prefs,
    merge_workspace_section,
    resolve_workspace_path_entry,
    shorten_workspace_relative_display,
    store_path_under_repo,
)
from fcdesk.fcstd_mapping import (
    SCHEMA_VERSION,
    FcstdMapDocument,
    coerce_payload_to_basename_rel_paths,
    hints_from_fcstd_location,
)
from fcdesk.pages.base import BasePage
from fcdesk.pages import form_widgets as fw
from fcdesk.shell.native_dialog import pick_workspace_directory
from fcdesk.shell.state import AppState

_SCRIPTS_DIR = Path(__file__).resolve().parents[2] / "scripts"


class FcstdMapPage(BasePage):
    page_id = "fcstd_map"

    def __init__(self, master, state: AppState, **kwargs) -> None:
        super().__init__(master, state, **kwargs)

        fw.page_title(self, text="FCStd 索引").grid(row=0, column=0, columnspan=3, padx=24, pady=(20, 4), sticky="nw")

        fw.page_hint_label(
            self,
            (
                "扫描根下遍历 *.FCStd → 写入工作空间根的 fcstd_map.json；"
                "条目路径相对工作空间根（供「链接路径修正」与同文件共用）。"
            ),
            wraplength=880,
        ).grid(row=1, column=0, columnspan=3, padx=24, pady=(0, 10), sticky="nw")

        fw.form_row_label(self, text="扫描根目录").grid(
            row=2, column=0, padx=(24, 12), pady=8, sticky="nw"
        )
        self._scan_root_entry = ctk.CTkEntry(self, width=420)
        self._scan_root_entry.grid(row=2, column=1, padx=4, pady=6, sticky="ew")
        ctk.CTkButton(self, text="浏览…", width=80, command=self._browse).grid(
            row=2, column=2, padx=(4, 24), pady=6
        )

        row3 = ctk.CTkFrame(self, fg_color="transparent")
        row3.grid(row=3, column=0, columnspan=3, padx=24, pady=8, sticky="w")
        ctk.CTkButton(row3, text="保存偏好", fg_color=("gray65", "gray35"), command=self._persist).pack(
            side="left", padx=(0, 8)
        )
        ctk.CTkButton(row3, text="创建索引", command=self._run).pack(side="left", padx=(0, 8))
        ctk.CTkButton(row3, text="显示表格", fg_color=("gray42", "gray32"), command=self._show_map_table).pack(
            side="left"
        )

        self._log = ctk.CTkTextbox(self, font=ctk.CTkFont(family="Menlo", size=12))
        self._log.grid(row=4, column=0, columnspan=3, padx=24, pady=(8, 6), sticky="nsew")

        tree_wrap = ctk.CTkFrame(self, fg_color="transparent")
        tree_wrap.grid(row=5, column=0, columnspan=3, padx=(24, 24), pady=(0, 24), sticky="nsew")
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

        self.grid_rowconfigure(4, weight=1)
        self.grid_rowconfigure(5, weight=2)
        self.grid_columnconfigure(1, weight=1)

        self._apply_fcstd_map_tree_style()
        self._results_tree_placeholder("点击下方「显示表格」加载 fcstd_map.json", "")

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
        for k in ("part_no", "version", "type_code", "model_series", "label"):
            v = str(row.get(k) or "").strip()
            if v:
                bits.append(v)
        return " · ".join(bits)

    def _rows_from_payload(self, raw: dict) -> list[dict]:
        """Structured entries 优先，否则沿用遗留扁平映射并补推断字段。"""
        try:
            if isinstance(raw.get("entries"), list) and raw["entries"]:
                patched = dict(raw)
                patched.setdefault("schema_version", SCHEMA_VERSION)
                doc = FcstdMapDocument.from_json_mapping(patched)
                return [
                    {
                        "filename": e.filename,
                        "repo_rel_path": e.repo_rel_path,
                        "part_no": e.part_no or "",
                        "version": e.version or "",
                        "type_code": (e.type_code or "").upper(),
                        "model_series": e.model_series or "",
                        "label": e.label or "",
                    }
                    for e in doc.entries
                ]
        except (TypeError, ValueError, KeyError):
            pass

        rows: list[dict] = []
        flat = coerce_payload_to_basename_rel_paths(raw)
        for name in sorted(flat.keys()):
            for rp in flat[name]:
                h = hints_from_fcstd_location(name, rp)
                tc = str(h.get("type_code") or "").strip().upper()
                rows.append(
                    {
                        "filename": name,
                        "repo_rel_path": rp,
                        "part_no": str(h.get("part_no") or "").strip(),
                        "version": str(h.get("version") or "").strip(),
                        "type_code": tc,
                        "model_series": str(h.get("model_series") or "").strip(),
                        "label": str(h.get("label") or "").strip(),
                    }
                )
        return rows

    def _populate_fcstd_tree(self, map_json: Path, rows: list[dict]) -> None:
        rr = self.state.repo_root.expanduser().resolve(strict=False)
        nid = itertools.count()
        ni = lambda: f"fm_{next(nid)}"
        self._tree.delete(*self._tree.get_children(""))

        jp_disp = format_resolved_under_workspace(map_json.resolve(strict=False), rr)
        sec = self._tree.insert(
            "",
            "end",
            iid=ni(),
            text=f"{map_json.name}（{len(rows)} 条）",
            values=("", jp_disp),
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
        jp = (rr / "fcstd_map.json").resolve(strict=False)
        jp_disp = format_resolved_under_workspace(jp, rr)
        if not jp.is_file():
            self._results_tree_placeholder(
                "未找到 fcstd_map.json",
                f"{jp_disp} · 请先「创建索引」",
            )
            return
        try:
            raw = json.loads(jp.read_text(encoding="utf-8"))
        except OSError as e:
            self._results_tree_placeholder("无法读取映射文件", str(e))
            return
        except json.JSONDecodeError as e:
            self._results_tree_placeholder("JSON 解析失败", str(e))
            return

        payload = raw if isinstance(raw, dict) else {}
        rows = self._rows_from_payload(payload)
        if not rows:
            self._results_tree_placeholder("映射文件无条目", jp_disp)
            return
        self._populate_fcstd_tree(jp, rows)

    def on_show(self) -> None:
        pref = load_workspace_prefs(self.state.repo_root).get("fcstd_map") or {}
        rr = self.state.repo_root
        disp = shorten_workspace_relative_display(
            format_stored_path_for_display(pref.get("scan_root"), rr) or ""
        )

        self._scan_root_entry.delete(0, "end")
        self._scan_root_entry.insert(0, disp)
        self._apply_fcstd_map_tree_style()


    def _persist(self) -> None:
        rr = self.state.repo_root.expanduser().resolve(strict=False)
        s = self._scan_root_entry.get().strip()
        if not s:
            stored = None
        else:
            p = resolve_workspace_path_entry(s, rr)
            if p.resolve(strict=False) == rr.resolve(strict=False):
                stored = None
            else:
                stored = store_path_under_repo(p, rr)
        merge_workspace_section("fcstd_map", {"scan_root": stored}, self.state.repo_root)

    def _browse(self) -> None:
        path = pick_workspace_directory(
            self,
            title="扫描根目录",
            repo_root=self.state.repo_root,
            path_hint=self._scan_root_entry.get(),
        )
        if path:
            rr = self.state.repo_root.expanduser().resolve(strict=False)
            self._scan_root_entry.delete(0, "end")
            self._scan_root_entry.insert(
                0,
                shorten_workspace_relative_display(
                    format_resolved_under_workspace(Path(path).expanduser(), rr),
                ),
            )
            self._persist()

    def _run(self) -> None:
        rr = self.state.repo_root.expanduser().resolve(strict=False)
        s = self._scan_root_entry.get().strip()
        scan = resolve_workspace_path_entry(s, rr)
        if not scan.is_dir():
            self._log.delete("1.0", "end")
            self._log.insert("end", f"错误：扫描根不存在 {scan}\n")
            return

        self._persist()
        out = Path(self.state.repo_root) / "fcstd_map.json"
        cmd = [
            sys.executable,
            str(_SCRIPTS_DIR / "fcstd_map.py"),
            "--root",
            str(scan),
            "--relative-to",
            str(rr.resolve(strict=False)),
            "--json",
            str(out.resolve(strict=False)),
        ]
        self._log.delete("1.0", "end")
        self._log.insert("end", "$ " + " ".join(cmd) + "\n")

        def worker() -> None:
            try:
                proc = subprocess.run(
                    cmd, cwd=str(_SCRIPTS_DIR), capture_output=True, text=True, encoding="utf-8"
                )
                t = (proc.stdout or "") + (proc.stderr or "")
                self.after(0, lambda: self._log.insert("end", t + f"\n退出码: {proc.returncode}\n"))
            except Exception as e:
                self.after(0, lambda: self._log.insert("end", f"异常: {e}\n"))

        threading.Thread(target=worker, daemon=True).start()
