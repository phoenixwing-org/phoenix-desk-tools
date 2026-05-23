"""SolidWorks（Windows COM）批量导出 STEP ，对接已打开的 CAD 会话。"""

from __future__ import annotations

import sys
import threading
from pathlib import Path

import customtkinter as ctk

from fcdesk.config.user_prefs import (
    load_workspace_prefs,
    merge_workspace_section,
    resolve_pref_path,
    store_path_under_repo,
)
from fcdesk.integration.solidworks_com import attach_solidworks, batch_export_models_to_step, windows_only
from fcdesk.integration.solidworks_models import iter_sw_model_paths
from fcdesk.pages.base import BasePage
from fcdesk.shell.native_dialog import pick_workspace_directory
from fcdesk.shell.state import AppState


def _com_export_available_here() -> bool:
    """本机是否可走 SolidWorks COM（仅 Windows 才为真；Mac 仍可显示同款界面便于布局与存偏好）。"""
    return windows_only()


class SwStepExportPage(BasePage):
    page_id = "sw_step_export"

    def __init__(self, master, state: AppState, **kwargs) -> None:
        super().__init__(master, state, **kwargs)
        self._recursive = ctk.BooleanVar(value=False)

        row = 0
        ctk.CTkLabel(
            self,
            text="SolidWorks → STEP（批量）",
            font=ctk.CTkFont(size=20, weight="bold"),
            anchor="w",
        ).grid(row=row, column=0, columnspan=4, padx=24, pady=(20, 8), sticky="w")

        row += 1
        if _com_export_available_here():
            hint_lines = (
                "先打开 SolidWorks，再点此页导出。逐项打开 `.sldprt`/`.sldasm`（不含 `.slddrw`），"
                "另存为同名 `.step`。\n依赖：`pip install pywin32`。"
                "若 Open/SaveAs 参数与装机版本不匹配，请参阅文档。"
            )
            hint_color = ("gray30", "gray70")
        else:
            hint_lines = (
                "【Mac／Linux · 仅为界面与设计】控件与偏好与 Windows 版一致；"
                "批量导出 STEP 仅在 Windows + SolidWorks + pywin32 下可用。"
                "此处可填写路径、「保存偏好」、用「预览」统计 `.sldprt`/`.sldasm`。"
                "\n详情请读 `doc/SolidWorks批量STEP导出.md`。当前系统：" + sys.platform
            )
            hint_color = ("#8B4513", "#D2691E")
        ctk.CTkLabel(
            self,
            text=hint_lines,
            anchor="w",
            justify="left",
            font=ctk.CTkFont(size=12),
            text_color=hint_color,
            wraplength=920,
        ).grid(row=row, column=0, columnspan=4, padx=24, pady=(0, 14), sticky="w")

        row += 1
        ctk.CTkLabel(self, text="模型来源目录（.sldprt / .sldasm）", anchor="w").grid(
            row=row, column=0, padx=(24, 8), pady=6, sticky="w"
        )
        self._src = ctk.CTkEntry(self, width=420)
        self._src.grid(row=row, column=1, columnspan=2, padx=4, pady=6, sticky="ew")
        ctk.CTkButton(self, text="浏览…", width=80, command=self._browse_src).grid(
            row=row, column=3, padx=(4, 24), pady=6
        )

        row += 1
        ctk.CTkLabel(self, text="STEP 输出目录", anchor="w").grid(row=row, column=0, padx=(24, 8), pady=6, sticky="w")
        self._dst = ctk.CTkEntry(self, width=420)
        self._dst.grid(row=row, column=1, columnspan=2, padx=4, pady=6, sticky="ew")
        ctk.CTkButton(self, text="浏览…", width=80, command=self._browse_dst).grid(
            row=row, column=3, padx=(4, 24), pady=6
        )

        row += 1
        ox = ctk.CTkFrame(self, fg_color="transparent")
        ox.grid(row=row, column=0, columnspan=4, padx=24, sticky="w", pady=4)
        ctk.CTkCheckBox(ox, text="包含子文件夹（递归）", variable=self._recursive).pack(side="left")

        row += 1
        btns = ctk.CTkFrame(self, fg_color="transparent")
        btns.grid(row=row, column=0, columnspan=4, padx=24, pady=12, sticky="w")
        ctk.CTkButton(btns, text="保存偏好", fg_color=("gray65", "gray35"), command=self._persist).pack(
            side="left", padx=(0, 8)
        )
        ctk.CTkButton(btns, text="预览三维模型数目", fg_color="gray45", command=self._preview_count).pack(
            side="left", padx=(0, 8)
        )
        ctk.CTkButton(btns, text="批量导出 STEP", command=self._run).pack(side="left")

        row += 1
        self._log = ctk.CTkTextbox(self, font=ctk.CTkFont(family="Menlo", size=12))
        self._log.grid(row=row, column=0, columnspan=4, padx=24, pady=(0, 24), sticky="nsew")
        self.grid_rowconfigure(row, weight=1)
        self.grid_columnconfigure(1, weight=1)

    def _pv(self) -> dict:
        return load_workspace_prefs().get("sw_step_export") or {}

    def _repo(self) -> Path:
        return self.state.repo_root.expanduser().resolve()

    def on_show(self) -> None:
        pv = self._pv()
        rr = self.state.repo_root
        sd = resolve_pref_path(pv.get("source_dir"), rr)
        self._src.delete(0, "end")
        if sd and sd.exists():
            self._src.insert(0, str(sd.resolve()))
        od = resolve_pref_path(pv.get("out_step_dir"), rr)
        self._dst.delete(0, "end")
        if od:
            self._dst.insert(0, str(od.expanduser()))
        self._recursive.set(bool(pv.get("recursive_scan", False)))

    def _browse_src(self) -> None:
        p = pick_workspace_directory(
            self, title="模型来源目录", repo_root=self.state.repo_root, path_hint=self._src.get()
        )
        if p:
            self._src.delete(0, "end")
            self._src.insert(0, p)

    def _browse_dst(self) -> None:
        p = pick_workspace_directory(
            self, title="STEP 输出目录", repo_root=self.state.repo_root, path_hint=self._dst.get()
        )
        if p:
            self._dst.delete(0, "end")
            self._dst.insert(0, p)

    def _persist(self, *, quiet: bool = False) -> None:
        rr = self._repo()

        def se(box: ctk.CTkEntry) -> str | None:
            t = box.get().strip()
            if not t:
                return None
            q = Path(t).expanduser()
            qp = q.resolve(strict=False) if q.is_absolute() else (rr / q).resolve(strict=False)
            return store_path_under_repo(qp, rr)

        merge_workspace_section(
            "sw_step_export",
            {
                "source_dir": se(self._src),
                "out_step_dir": se(self._dst),
                "recursive_scan": self._recursive.get(),
            },
        )
        if not quiet and self._log is not None:
            self._log_line("已保存偏好 → sw_step_export。")

    def _resolved_src_dst(self) -> tuple[Path, Path] | None:
        rr = self._repo()
        s_txt, d_txt = self._src.get().strip(), self._dst.get().strip()
        if not s_txt or not d_txt:
            self._log_line("错误：来源目录与输出目录都要填写。")
            return None
        sp = Path(s_txt).expanduser()
        sp = sp.resolve(strict=False) if sp.is_absolute() else (rr / sp).resolve(strict=False)
        dp = Path(d_txt).expanduser()
        dp = dp.resolve(strict=False) if dp.is_absolute() else (rr / dp).resolve(strict=False)
        if not sp.is_dir():
            self._log_line(f"错误：模型目录不存在：{sp}")
            return None
        return sp, dp

    def _preview_count(self) -> None:
        rr = self._resolved_src_dst()
        if rr is None:
            return
        sp, _ = rr
        try:
            n = len(iter_sw_model_paths(sp, recursive=self._recursive.get()))
        except OSError as e:
            self._log_line(str(e))
            return
        self._log_line(f"{sp}\n三维模型数量（不含图纸）: {n}")

    def _log_line(self, text: str) -> None:
        if self._log is None:
            return
        self._log.insert("end", text + "\n")
        self._log.see("end")

    def _run(self) -> None:
        if not _com_export_available_here():
            self._log_line(
                "批量导出 STEP 需要 Windows + SolidWorks + pywin32；"
                "在 macOS/Linux 本页仅供布局与预览，请到 Windows 上再点导出。"
            )
            return
        try:
            import pythoncom
            import win32com.client
        except ImportError:
            self._log_line(
                "未检测到 pywin32。请先：`pip install pywin32`（与此处启动 fcdesk 相同的 Python）。"
            )
            return

        pairing = self._resolved_src_dst()
        if pairing is None:
            return
        src, dst = pairing
        self._persist(quiet=True)

        try:
            paths = list(iter_sw_model_paths(src, recursive=self._recursive.get()))
        except OSError as e:
            self._log_line(str(e))
            return
        if not paths:
            self._log_line("未发现 .sldprt / .sldasm，已中止。")
            return

        self._log.delete("1.0", "end")
        self._log_line(f"SolidWorks COM 导出：\n来源 {src}\nSTEP 目录 {dst}\n模型数 {len(paths)}")

        def worker() -> None:
            pythoncom.CoInitialize()

            def clog(m: str) -> None:
                self.after(0, lambda s=m: self._log_line(s))

            try:
                sw_app = attach_solidworks()
                outcome = batch_export_models_to_step(
                    sw_app,
                    paths=paths,
                    out_step_dir=dst,
                    log=clog,
                )
                lines_out = [
                    f"成功 {len(outcome.ok)}，失败 {len(outcome.failed)}。",
                ]
                if outcome.failed:
                    lines_out.append("—— 失败项 ——")
                    for fp, err in outcome.failed[:50]:
                        lines_out.append(f"  {fp}: {err}")
                    if len(outcome.failed) > 50:
                        lines_out.append(f" … 另有 {len(outcome.failed)-50} 条")
                text = "\n".join(lines_out)
                self.after(0, lambda t=text: self._log_line("\n" + t))
            except Exception as e:
                msg = repr(e)
                self.after(0, lambda m=msg: self._log_line("\n异常: " + m))
            finally:
                pythoncom.CoUninitialize()

        threading.Thread(target=worker, daemon=True).start()
