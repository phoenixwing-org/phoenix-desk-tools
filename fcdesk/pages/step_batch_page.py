from __future__ import annotations

import os
import subprocess
import threading
import time
from pathlib import Path

import customtkinter as ctk

from fcdesk.freecad.batch_step.job import StepBatchJob
from fcdesk.freecad.batch_step.report import parse_batch_step_report_summary
from fcdesk.config.user_prefs import (
    format_resolved_under_workspace,
    format_stored_path_for_display,
    load_workspace_prefs,
    merge_workspace_section,
    resolve_workspace_path_entry,
    shorten_workspace_relative_display,
    store_path_under_repo,
)
from fcdesk.pages.base import BasePage
from fcdesk.pages import form_widgets as fw
from fcdesk.services.step_batch_service import preview_step_batch, run_step_batch
from fcdesk.shell.native_dialog import pick_workspace_directory
from fcdesk.shell.state import AppState

_SCRIPTS_DIR = Path(__file__).resolve().parents[2] / "scripts"
_BRIDGE_POLL_SEC = 600.0


class StepBatchPage(BasePage):
    page_id = "step_batch"

    def __init__(self, master, state: AppState, **kwargs) -> None:
        super().__init__(master, state, **kwargs)
        self._skip_existing = ctk.BooleanVar(value=True)
        self._vf_mode = ctk.StringVar(value="none")
        self._use_inbox_bridge = ctk.BooleanVar(value=False)
        self._step_recursive = ctk.BooleanVar(value=False)

        row = 0
        fw.page_title(self, text="STEP 批量").grid(row=row, column=0, columnspan=4, padx=24, pady=(20, 4), sticky="nw")

        row += 1
        bridge_row = ctk.CTkFrame(self, fg_color="transparent")
        bridge_row.grid(row=row, column=0, columnspan=4, padx=24, pady=(0, 10), sticky="w")
        ctk.CTkCheckBox(
            bridge_row,
            text="通过已开的 FreeCAD（需先执行监听宏）",
            variable=self._use_inbox_bridge,
        ).pack(side="left")

        row += 1
        fw.form_row_label(self, text="STEP 目录").grid(row=row, column=0, padx=(24, 12), pady=8, sticky="nw")
        self._step_dir_entry = ctk.CTkEntry(self, width=320)
        self._step_dir_entry.grid(row=row, column=1, columnspan=2, padx=4, pady=6, sticky="ew")
        ctk.CTkButton(self, text="浏览…", width=70, command=self._browse_step).grid(
            row=row, column=3, padx=(4, 24), pady=6
        )

        row += 1
        fw.form_row_label(self, text="输出目录").grid(row=row, column=0, padx=(24, 12), pady=8, sticky="nw")
        self._out_dir_entry = ctk.CTkEntry(self, width=320)
        self._out_dir_entry.grid(row=row, column=1, columnspan=2, padx=4, pady=6, sticky="ew")
        ctk.CTkButton(self, text="浏览…", width=70, command=self._browse_out).grid(
            row=row, column=3, padx=(4, 24), pady=6
        )

        row += 1
        opts_frame = ctk.CTkFrame(self, fg_color="transparent")
        opts_frame.grid(row=row, column=0, columnspan=4, padx=24, sticky="w", pady=(8, 0))
        
        opts_left = ctk.CTkFrame(opts_frame, fg_color="transparent")
        opts_left.pack(side="left", fill="y")
        ctk.CTkCheckBox(opts_left, text="跳过已有", variable=self._skip_existing).pack(side="left", padx=(0, 16))
        ctk.CTkCheckBox(opts_left, text="递归", variable=self._step_recursive).pack(side="left")
        
        opts_right = ctk.CTkFrame(opts_frame, fg_color="transparent")
        opts_right.pack(side="left", fill="y", padx=(16, 0))
        fw.inline_field_label(opts_right, text="视角：").pack(side="left", padx=(0, 6))
        vf_frame = ctk.CTkFrame(opts_right, fg_color="transparent")
        vf_frame.pack(side="left")
        for val, lbl in (
            ("none", "无"),
            ("last", "末"),
            ("all", "全"),
        ):
            ctk.CTkRadioButton(vf_frame, text=lbl, variable=self._vf_mode, value=val).pack(
                side="left", padx=(0, 8)
            )

        row += 1
        btns = ctk.CTkFrame(self, fg_color="transparent")
        btns.grid(row=row, column=0, columnspan=4, padx=24, pady=10, sticky="w")
        ctk.CTkButton(btns, text="保存", fg_color=("gray65", "gray35"), command=self._persist).pack(
            side="left", padx=(0, 8)
        )
        ctk.CTkButton(btns, text="运行", command=self._run).pack(side="left", padx=(0, 8))
        ctk.CTkButton(btns, text="预览", fg_color="gray45", command=self._preview_count).pack(
            side="left"
        )

        row += 1
        fw.footer_hint_label(
            self,
            (
                "A：freecadcmd（需在「配置」选 FreeCAD 目录）\n"
                "B：已开的 FreeCAD（需先执行监听宏）\n"
                "偏好 → step_batch · 运行日志见右侧栏"
            ),
            wraplength=600,
        ).grid(row=row, column=0, columnspan=4, padx=24, pady=(8, 24), sticky="nw")

        self.grid_columnconfigure(0, minsize=80)
        self.grid_columnconfigure(1, weight=1)

    def _repo(self) -> Path:
        return self.state.repo_root.expanduser().resolve()

    def _pv(self) -> dict:
        return load_workspace_prefs(self.state.repo_root).get("step_batch") or {}

    def on_show(self) -> None:
        pv = self._pv()
        rr = self.state.repo_root
        self._step_dir_entry.delete(0, "end")
        self._step_dir_entry.insert(
            0,
            shorten_workspace_relative_display(
                format_stored_path_for_display(pv.get("step_dir"), rr) or ""
            ),
        )

        self._out_dir_entry.delete(0, "end")
        self._out_dir_entry.insert(
            0,
            shorten_workspace_relative_display(
                format_stored_path_for_display(pv.get("out_dir"), rr) or ""
            ),
        )

        if "skip_existing" in pv:
            self._skip_existing.set(bool(pv["skip_existing"]))
        vf = str(pv.get("view_fit") or "none")
        self._vf_mode.set(vf if vf in ("none", "last", "all") else "none")
        if "use_inbox_bridge" in pv:
            self._use_inbox_bridge.set(bool(pv["use_inbox_bridge"]))
        if "step_recursive" in pv:
            self._step_recursive.set(bool(pv["step_recursive"]))

    def _browse_step(self) -> None:
        path = pick_workspace_directory(
            self,
            title="STEP 目录",
            repo_root=self.state.repo_root,
            path_hint=self._step_dir_entry.get(),
        )
        if path:
            self._step_dir_entry.delete(0, "end")
            self._step_dir_entry.insert(
                0,
                shorten_workspace_relative_display(
                    format_resolved_under_workspace(Path(path).expanduser(), self._repo())
                ),
            )

    def _browse_out(self) -> None:
        path = pick_workspace_directory(
            self,
            title="FCStd 输出目录",
            repo_root=self.state.repo_root,
            path_hint=self._out_dir_entry.get(),
        )
        if path:
            self._out_dir_entry.delete(0, "end")
            self._out_dir_entry.insert(
                0,
                shorten_workspace_relative_display(
                    format_resolved_under_workspace(Path(path).expanduser(), self._repo())
                ),
            )

    def _vf_flags(self) -> tuple[bool, bool]:
        mode = self._vf_mode.get()
        if mode == "all":
            return False, True
        if mode == "last":
            return True, False
        return False, False

    def _persist(self, *, quiet: bool = False) -> None:
        rr = self._repo()
        vf_last, vf_all = self._vf_flags()
        vf_key = "all" if vf_all else "last" if vf_last else "none"

        def store_entry(box: ctk.CTkEntry) -> str | None:
            raw = box.get().strip()
            if not raw or raw == ".":
                return None
            q = Path(raw).expanduser()
            qp = q.resolve(strict=False) if q.is_absolute() else (rr / q).resolve(strict=False)
            return store_path_under_repo(qp, rr)

        merge_workspace_section(
            "step_batch",
            {
                # 已废弃：曾与「套用约定」一齐使用；移除 UI 后以 None 清除旧键
                "project_relative": None,
                "step_dir": store_entry(self._step_dir_entry),
                "out_dir": store_entry(self._out_dir_entry),
                "skip_existing": self._skip_existing.get(),
                "view_fit": vf_key,
                "use_inbox_bridge": self._use_inbox_bridge.get(),
                "step_recursive": self._step_recursive.get(),
            },
            self.state.repo_root,
        )
        if not quiet:
            self._log_line("已保存偏好 → step_batch。")

    def _build_job(self) -> StepBatchJob | None:
        step_s = self._step_dir_entry.get().strip()
        out_s = self._out_dir_entry.get().strip()
        if not step_s or not out_s:
            self._log_line("错误：请填写 STEP 目录与 FCStd 输出目录。")
            return None
        rr = self._repo()
        step_dir = resolve_workspace_path_entry(step_s, rr)
        out_dir = resolve_workspace_path_entry(out_s, rr)
        if not step_dir.is_dir():
            self._log_line(f"错误：STEP 目录不存在：{step_dir}")
            return None
        vf_last, vf_all = self._vf_flags()
        return StepBatchJob(
            step_dir=step_dir,
            out_dir=out_dir,
            skip_existing=self._skip_existing.get(),
            view_fit_last=vf_last,
            view_fit_all=vf_all,
            project_tag="",
            step_recursive=self._step_recursive.get(),
        )

    def _step_batch_opts(self) -> dict:
        vf_last, vf_all = self._vf_flags()
        vf_key = "all" if vf_all else "last" if vf_last else "none"
        return {
            "step_dir": self._step_dir_entry.get().strip(),
            "out_dir": self._out_dir_entry.get().strip(),
            "skip_existing": self._skip_existing.get(),
            "view_fit": vf_key,
            "use_inbox_bridge": self._use_inbox_bridge.get(),
            "step_recursive": self._step_recursive.get(),
        }

    def _preview_count(self) -> None:
        try:
            data = preview_step_batch(self.state.repo_root, self._step_batch_opts())
            rec_on = "开" if data["recursive"] else "关"
            self._log_line(
                f"{data['step_dir_display']}\n"
                f"  仅顶层 STEP：{data['top_level']} | 全盘（含子文件夹）：{data['deep_total']}\n"
                f"  本次将批量处理数量：{data['batch_count']}（递归={rec_on}）"
            )
        except ValueError as e:
            self._log_line(str(e))

    def _run(self) -> None:
        self._persist(quiet=True)
        job = self._build_job()
        if job is None:
            return
        if self._use_inbox_bridge.get():
            self._run_via_inbox_bridge(job)
        else:
            self._run_via_freecadcmd(job)

    def _run_via_inbox_bridge(self, job: StepBatchJob) -> None:
        import fcdesk

        from fcdesk.freecad.inbox_bridge import enqueue_step_batch, take_response

        clone = Path(fcdesk.__file__).resolve().parent.parent
        fc_core = clone / "scripts" / "freecad_batch_step_fc.py"
        if not fc_core.is_file():
            self._log_line(
                "错误：收件箱桥接需要 **桌面工具源码树** 里的 scripts/freecad_batch_step_fc.py。\n"
                f"根据当前 fcdesk 安装解析到目录：{clone}\n\n"
                "请在 phoenix-freecad-desktop 克隆根执行 `pip install -e .`，或直接用 `python -m fcdesk` 启动。\n"
                "若仅有不含 scripts 的包安装，请取消勾选改用 freecadcmd 子进程。"
            )
            return

        listener = _SCRIPTS_DIR / "freecad_fcdesk_inbox_listener.py"
        uid = enqueue_step_batch(clone, job)

        self._log_line(
            "[桥接] 已向已打开的 FreeCAD 投递 STEP 批量任务。\n"
            f"任务 id: {uid}\n"
            f"fcdesk 工具仓库（供导入）: {clone}\n"
            f"监听宏（每台机在 FreeCAD 里执行过一次即可）：\n  {listener}\n"
            "~/.fcdesk/freecad_bridge/inbox/<任务id>_queued.json\n"
            "~/.fcdesk/freecad_bridge/done/<任务id>_result.json\n\n"
            "请勿关闭 FreeCAD；下方会轮询回信（超时 10 min）。明细见本页运行日志 / FreeCAD 控制台。\n",
        )

        deadline = time.monotonic() + _BRIDGE_POLL_SEC

        def tick() -> None:
            data = take_response(uid)
            if data is not None:
                if data.get("ok"):
                    report_path = job.out_dir / job.report_filename
                    summary = parse_batch_step_report_summary(report_path)
                    if summary:
                        self._log_line(
                            "\n"
                            f"转换完成：成功 {summary['ok']}，跳过 {summary['skip']}，"
                            f"失败 {summary['fail']}，共 {summary['total']} 个 STEP。"
                        )
                        if report_path.is_file():
                            self._log_line(f"报告文件：{report_path}")
                    else:
                        self._log_line(
                            "\n[fcdesk] FreeCAD 端执行结束；明细见 FreeCAD 报告窗口 / 本页日志。"
                        )
                else:
                    err = data.get("error") or "(无详情)"
                    self._log_line("\n[fcdesk] FreeCAD 端报错：\n" + err)
                return
            if time.monotonic() > deadline:
                self._log_line(
                    "\n[超时] 未收到回信。请先打开 FreeCAD，菜单 宏 → 执行 "
                    "`freecad_fcdesk_inbox_listener.py`（或使用「添加宏路径」指向 scripts/），"
                    "再重试投递；或直接取消勾选改用 freecadcmd 子进程。"
                )
                return
            self.after(300, tick)

        self.after(300, tick)

    def _run_via_freecadcmd(self, job: StepBatchJob) -> None:
        self._log_line("freecadcmd 批量转换…（可能需要数分钟）")

        def worker() -> None:
            try:
                data = run_step_batch(self.state.repo_root, self._step_batch_opts())
                text = data.get("log") or ""
                self.after(0, lambda: self._finish_run_log(text))
            except ValueError as e:
                self.after(0, lambda err=str(e): self._finish_run_log(err))
            except Exception as e:
                self.after(0, lambda err=str(e): self._finish_run_log(f"异常: {err}"))

        threading.Thread(target=worker, daemon=True).start()

    def _finish_run_log(self, text: str) -> None:
        self.append_log(text)

    def _log_line(self, text: str) -> None:
        self.append_log(text)
