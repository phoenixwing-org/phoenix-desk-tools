from __future__ import annotations

import os
import subprocess
import sys
import threading
from pathlib import Path

import customtkinter as ctk
from tkinter import messagebox

from fcdesk.config.user_prefs import (
    load_workspace_prefs,
    merge_workspace_section,
    resolve_pref_path,
    store_path_under_repo,
)
from fcdesk.pages.base import BasePage
from fcdesk.shell.native_dialog import pick_workspace_directory
from fcdesk.shell.state import AppState

_SCRIPTS_DIR = Path(__file__).resolve().parents[2] / "scripts"
FC_LINKFIX_MAP_NAME = "fc_linkfix_fcstd_map.json"


class XLinkFixPage(BasePage):
    page_id = "xlink_fix"

    def __init__(self, master, state: AppState, **kwargs) -> None:
        super().__init__(master, state, **kwargs)
        self._dry_run = ctk.BooleanVar(value=True)
        self._all_in_dir = ctk.BooleanVar(value=True)

        ctk.CTkLabel(
            self, text="链接路径修正", font=ctk.CTkFont(size=20, weight="bold"), anchor="w"
        ).grid(row=0, column=0, columnspan=4, padx=24, pady=(20, 4), sticky="w")

        ctk.CTkLabel(
            self,
            text=(
                "映射 JSON（fc_linkfix_fcstd_map.json）写在「CAD / FCStd 搜索根」目录下；"
                "条目内 repo_rel_path 相对于该目录（形如 ./Sample…/零件.FCStd）。"
                "搜索根留空时等于工作空间。先「建立/更新映射」再运行。偏好 → fc_linkfix"
            ),
            anchor="w",
            font=ctk.CTkFont(size=12),
            text_color=("gray30", "gray70"),
            wraplength=920,
        ).grid(row=1, column=0, columnspan=4, padx=24, pady=(0, 10), sticky="w")

        ctk.CTkLabel(self, text="搜索根目录", anchor="w").grid(
            row=2, column=0, padx=(24, 8), pady=6, sticky="w"
        )
        self._search_root_entry = ctk.CTkEntry(self, width=420)
        self._search_root_entry.grid(row=2, column=1, columnspan=2, padx=4, pady=6, sticky="ew")
        ctk.CTkButton(self, text="浏览…", width=80, command=self._browse_search_root).grid(
            row=2, column=3, padx=(4, 24), pady=6
        )

        ctk.CTkLabel(self, text="FreeCAD 批量目录", anchor="w").grid(
            row=3, column=0, padx=(24, 8), pady=6, sticky="w"
        )
        self._batch_dir_entry = ctk.CTkEntry(self, width=420)
        self._batch_dir_entry.grid(row=3, column=1, columnspan=2, padx=4, pady=6, sticky="ew")
        ctk.CTkButton(self, text="浏览…", width=80, command=self._browse_batch_dir).grid(
            row=3, column=3, padx=(4, 24), pady=6
        )

        opts = ctk.CTkFrame(self, fg_color="transparent")
        opts.grid(row=4, column=0, columnspan=4, padx=24, sticky="w", pady=(4, 0))
        ctk.CTkCheckBox(opts, text="dry-run", variable=self._dry_run).pack(side="left", padx=(0, 14))
        ctk.CTkCheckBox(opts, text="all-in-dir", variable=self._all_in_dir).pack(side="left")

        btns = ctk.CTkFrame(self, fg_color="transparent")
        btns.grid(row=5, column=0, columnspan=4, padx=24, pady=8, sticky="w")
        ctk.CTkButton(btns, text="保存偏好", fg_color=("gray65", "gray35"), command=self._persist_xlink_fields).pack(
            side="left", padx=(0, 8)
        )
        ctk.CTkButton(btns, text="建立/更新映射", fg_color="gray45", command=self._build_map).pack(
            side="left", padx=(0, 8)
        )
        ctk.CTkButton(btns, text="运行", command=self._run).pack(side="left", padx=(0, 8))
        ctk.CTkButton(btns, text="打开报告目录", fg_color="gray40", command=self._open_report_dir).pack(side="left")

        self._log = ctk.CTkTextbox(self, font=ctk.CTkFont(family="Menlo", size=12))
        self._log.grid(row=6, column=0, columnspan=4, padx=24, pady=(8, 24), sticky="nsew")

        self.grid_rowconfigure(6, weight=1)
        self.grid_columnconfigure(1, weight=1)

    def _repo(self) -> Path:
        """当前工作空间根（工具条所选项目根）；相对路径以此为基准拼接。"""
        return self.state.repo_root.expanduser().resolve()

    def _pv(self) -> dict:
        return load_workspace_prefs(self.state.repo_root).get("fc_linkfix") or {}

    def _canon(self, text: str, *, fb: Path) -> Path:
        raw = (text or "").strip()
        if not raw:
            return fb
        q = Path(raw).expanduser()
        return q.resolve() if q.is_absolute() else (self._repo() / q).resolve()

    def on_show(self) -> None:
        pv = self._pv()
        rr = self._repo()

        cad = resolve_pref_path(pv.get("cad_search_root"), self.state.repo_root)
        bat = resolve_pref_path(pv.get("freecad_batch_dir"), self.state.repo_root)

        self._search_root_entry.delete(0, "end")
        if cad and cad.is_dir() and cad.resolve() != rr.resolve():
            self._search_root_entry.insert(0, str(cad.resolve()))
        else:
            self._search_root_entry.insert(0, str(rr))

        self._batch_dir_entry.delete(0, "end")

        def _eff(p: Path | None, root: Path) -> Path:
            return p if p and p.is_dir() else root

        if _eff(bat, rr).resolve() != rr.resolve():
            self._batch_dir_entry.insert(0, str(_eff(bat, rr)))

        if "dry_run" in pv:
            self._dry_run.set(bool(pv["dry_run"]))
        if "all_in_dir" in pv:
            self._all_in_dir.set(bool(pv["all_in_dir"]))

    def _persist_xlink_fields(self) -> None:
        rr = self._repo()
        sr, bd = self._search_root_entry.get(), self._batch_dir_entry.get()

        sr_eff = self._canon(sr, fb=rr)
        cad_sv = (
            None
            if sr_eff.resolve() == rr.resolve()
            else store_path_under_repo(sr_eff, rr)
        )
        patch: dict = {
            "dry_run": self._dry_run.get(),
            "all_in_dir": self._all_in_dir.get(),
            "cad_search_root": cad_sv,
            "freecad_batch_dir": (
                store_path_under_repo(self._canon(bd, fb=rr), rr) if bd.strip() else None
            ),
        }
        merge_workspace_section("fc_linkfix", patch, self.state.repo_root)

    def _browse_search_root(self) -> None:
        path = pick_workspace_directory(
            self,
            title="搜索根目录",
            repo_root=self.state.repo_root,
            path_hint=self._search_root_entry.get(),
        )
        if path:
            self._search_root_entry.delete(0, "end")
            self._search_root_entry.insert(0, str(Path(path).resolve()))
            self._persist_xlink_fields()

    def _browse_batch_dir(self) -> None:
        path = pick_workspace_directory(
            self,
            title="批量目录",
            repo_root=self.state.repo_root,
            path_hint=self._batch_dir_entry.get(),
        )
        if path:
            p = Path(path).resolve()
            self._batch_dir_entry.delete(0, "end")
            self._batch_dir_entry.insert(0, str(p))
            self._persist_xlink_fields()

    def _open_report_dir(self) -> None:
        d = self._canon(self._batch_dir_entry.get(), fb=self._repo())
        if d.is_dir():
            os.system(f'open "{d}"' if sys.platform == "darwin" else f'xdg-open "{d}"')

    def _log_line(self, text: str) -> None:
        self._log.insert("end", text + "\n")
        self._log.see("end")

    def _map_json_path(self, *, search_root: Path) -> Path:
        """与扫描根一致：`cad_search_root` 目录内的映射文件名。"""
        return Path(search_root).resolve() / FC_LINKFIX_MAP_NAME

    def _effective_cad_search_root(self) -> Path:
        """未填或与工作空间等价时退回工作空间根。"""
        rr = self._repo()
        return self._canon(self._search_root_entry.get(), fb=rr)

    def _build_map(self) -> None:
        search_root = self._effective_cad_search_root()
        if not search_root.is_dir():
            msg = f"请先填写可用的 搜索根目录。\n当前解析为：\n{search_root}"
            self._log.delete("1.0", "end")
            self._log_line(msg.replace("\n", " "))
            messagebox.showwarning("建立映射", msg, parent=self.winfo_toplevel())
            return

        dest = self._map_json_path(search_root=search_root)
        self._persist_xlink_fields()
        cmd = [
            sys.executable,
            str(_SCRIPTS_DIR / "fcstd_map.py"),
            "--root",
            str(search_root),
            "--relative-to",
            str(search_root.resolve()),
            "--json",
            str(dest),
        ]
        self._log.delete("1.0", "end")
        self._log_line("$ " + " ".join(cmd))

        def worker() -> None:
            try:
                proc = subprocess.run(
                    cmd, cwd=str(_SCRIPTS_DIR), capture_output=True, text=True, encoding="utf-8"
                )
                out = (proc.stdout or "") + (proc.stderr or "")
                self.after(0, lambda: self._log_line(out or "(无输出)"))
                self.after(0, lambda: self._log_line(f"退出码: {proc.returncode}"))
            except Exception as e:
                self.after(0, lambda: self._log_line(f"异常: {e}"))

        threading.Thread(target=worker, daemon=True).start()

    def _run(self) -> None:
        rr = self._repo()
        batch_dir = self._canon(self._batch_dir_entry.get(), fb=rr)
        if not batch_dir.is_dir():
            self._log_line(f"错误：批量目录不存在 {batch_dir}")
            return

        search_root = self._effective_cad_search_root()
        if not search_root.is_dir():
            self._log_line(f"错误：搜索根不存在 {search_root}")
            return

        map_path = self._map_json_path(search_root=search_root)
        if not map_path.is_file():
            self._log_line(f"错误：缺少映射列表 {map_path}")
            self._log_line(
                f'请先在本页「CAD 搜索根」（{search_root}）下建立映射文件'
                + ("（当前与工作空间一致）" if search_root.resolve() == rr.resolve() else "")
                + '，或点「建立/更新映射」（JSON 内路径相对 CAD 搜索根 / JSON 目录）。'
            )
            messagebox.showwarning(
                "链接路径修正",
                f'请先点击「建立/更新映射」生成索引文件：\n\n"{map_path}"',
                parent=self.winfo_toplevel(),
            )
            return

        self._persist_xlink_fields()

        cmd = [
            sys.executable,
            str(_SCRIPTS_DIR / "fix_fcstd_xlink_paths.py"),
            "--map-anchor",
            str(search_root.resolve()),
            "--map-json",
            str(map_path.resolve()),
        ]
        if self._dry_run.get():
            cmd.append("--dry-run")
        if self._all_in_dir.get():
            cmd += ["--all-in-dir", str(batch_dir)]
        else:
            doc_xml = batch_dir / "Document.xml"
            if not doc_xml.is_file():
                self._log_line("错误：未找到 Document.xml（请先选 FreeCAD 批量目录，或勾选 all-in-dir）")
                return
            cmd.append(str(doc_xml))

        self._log.delete("1.0", "end")
        self._log_line("$ " + " ".join(cmd))

        def worker() -> None:
            try:
                proc = subprocess.run(
                    cmd, cwd=str(_SCRIPTS_DIR), capture_output=True, text=True, encoding="utf-8"
                )
                out = (proc.stdout or "") + (proc.stderr or "")
                self.after(0, lambda: self._log_line(out or "(无输出)"))
                self.after(0, lambda: self._log_line(f"退出码: {proc.returncode}"))
            except Exception as e:
                self.after(0, lambda: self._log_line(f"异常: {e}"))

        threading.Thread(target=worker, daemon=True).start()
