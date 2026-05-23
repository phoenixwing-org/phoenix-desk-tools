from __future__ import annotations

import subprocess
import sys
import threading
from pathlib import Path

import customtkinter as ctk

from fcdesk.config.user_prefs import load_workspace_prefs, merge_workspace_section
from fcdesk.pages.base import BasePage
from fcdesk.shell.native_dialog import pick_workspace_directory
from fcdesk.shell.state import AppState

_SCRIPTS_DIR = Path(__file__).resolve().parents[2] / "scripts"


class FcstdMapPage(BasePage):
    page_id = "fcstd_map"

    def __init__(self, master, state: AppState, **kwargs) -> None:
        super().__init__(master, state, **kwargs)

        ctk.CTkLabel(
            self, text="FCStd 索引", font=ctk.CTkFont(size=20, weight="bold"), anchor="w"
        ).grid(row=0, column=0, columnspan=3, padx=24, pady=(20, 4), sticky="w")

        ctk.CTkLabel(self, text="扫描根 → fcstd_map.json（相对工具条工作空间根写入）", anchor="w").grid(
            row=1, column=0, columnspan=3, padx=24, pady=(0, 10), sticky="w"
        )

        ctk.CTkLabel(self, text="扫描根", anchor="w").grid(
            row=2, column=0, padx=(24, 8), pady=6, sticky="w"
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
        ctk.CTkButton(row3, text="生成 JSON", command=self._run).pack(side="left")

        self._log = ctk.CTkTextbox(self, font=ctk.CTkFont(family="Menlo", size=12))
        self._log.grid(row=4, column=0, columnspan=3, padx=24, pady=(8, 24), sticky="nsew")
        self.grid_rowconfigure(4, weight=1)
        self.grid_columnconfigure(1, weight=1)

    def on_show(self) -> None:
        pref = load_workspace_prefs(self.state.repo_root).get("fcstd_map") or {}
        sr = pref.get("scan_root") or ""
        root_path = Path(sr).expanduser() if sr else self.state.repo_root
        if not root_path.is_dir():
            root_path = self.state.repo_root
        self._scan_root_entry.delete(0, "end")
        self._scan_root_entry.insert(0, str(root_path))

    def _persist(self) -> None:
        s = self._scan_root_entry.get().strip()
        merge_workspace_section("fcstd_map", {"scan_root": s or None}, self.state.repo_root)

    def _browse(self) -> None:
        path = pick_workspace_directory(
            self,
            title="扫描根目录",
            repo_root=self.state.repo_root,
            path_hint=self._scan_root_entry.get(),
        )
        if path:
            self._scan_root_entry.delete(0, "end")
            self._scan_root_entry.insert(0, path)
            self._persist()

    def _run(self) -> None:
        scan = Path(self._scan_root_entry.get().strip())
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
            "--json",
            str(out),
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
