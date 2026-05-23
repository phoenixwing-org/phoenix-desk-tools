from __future__ import annotations

import os
import subprocess
import threading
import time
from pathlib import Path

import customtkinter as ctk

from fcdesk.batch_step.job import StepBatchJob
from fcdesk.batch_step.step_paths import (
    list_step_paths_for_batch,
    sample_step_fcstd_dirs,
    step_tree_stats,
)
from fcdesk.config.user_prefs import (
    load_workspace_prefs,
    merge_workspace_section,
    resolve_pref_path,
    store_path_under_repo,
)
from fcdesk.pages.base import BasePage
from fcdesk.shell.freecad_exec import resolve_freecad_cmd
from fcdesk.shell.native_dialog import pick_workspace_directory
from fcdesk.shell.state import AppState

_SCRIPTS_DIR = Path(__file__).resolve().parents[2] / "scripts"
_RUNNER = _SCRIPTS_DIR / "freecad_batch_step_runner.py"
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
        ctk.CTkLabel(
            self, text="STEP 批量 → FCStd", font=ctk.CTkFont(size=20, weight="bold"), anchor="w"
        ).grid(row=row, column=0, columnspan=4, padx=24, pady=(20, 4), sticky="w")

        row += 1
        ctk.CTkLabel(
            self,
            text=(
                "方式 A：子进程调用 freecadcmd（须在「配置」页选择 FreeCAD 安装目录）。"
                "方式 B：勾选「已开的 FreeCAD」后，先到 FreeCAD 里执行宏 scripts/freecad_fcdesk_inbox_listener.py。"
                "偏好 → step_batch"
            ),
            anchor="w",
            font=ctk.CTkFont(size=12),
            text_color=("gray30", "gray70"),
        ).grid(row=row, column=0, columnspan=4, padx=24, pady=(0, 8), sticky="w")

        row += 1
        bridge_row = ctk.CTkFrame(self, fg_color="transparent")
        bridge_row.grid(row=row, column=0, columnspan=4, padx=24, pady=(0, 10), sticky="w")
        ctk.CTkCheckBox(
            bridge_row,
            text="通过已打开的 FreeCAD（fcdesk 收件箱桥接，类「连到已启动的 CAD」）",
            variable=self._use_inbox_bridge,
        ).pack(side="left")

        row += 1
        ctk.CTkLabel(self, text="工程相对路径（约定 step/FreeCAD）", anchor="w").grid(
            row=row, column=0, padx=(24, 8), pady=6, sticky="w"
        )
        self._project_rel = ctk.CTkEntry(self, placeholder_text="例如 Sample2TA002", width=320)
        self._project_rel.grid(row=row, column=1, columnspan=2, padx=4, pady=6, sticky="ew")
        ctk.CTkButton(self, text="套用约定", width=90, command=self._fill_sample_dirs).grid(
            row=row, column=3, padx=(4, 24), pady=6
        )

        row += 1
        ctk.CTkLabel(self, text="STEP 目录", anchor="w").grid(
            row=row, column=0, padx=(24, 8), pady=6, sticky="w"
        )
        self._step_dir_entry = ctk.CTkEntry(self, width=420)
        self._step_dir_entry.grid(row=row, column=1, columnspan=2, padx=4, pady=6, sticky="ew")
        ctk.CTkButton(self, text="浏览…", width=80, command=self._browse_step).grid(
            row=row, column=3, padx=(4, 24), pady=6
        )

        row += 1
        ctk.CTkLabel(self, text="FCStd 输出目录", anchor="w").grid(
            row=row, column=0, padx=(24, 8), pady=6, sticky="w"
        )
        self._out_dir_entry = ctk.CTkEntry(self, width=420)
        self._out_dir_entry.grid(row=row, column=1, columnspan=2, padx=4, pady=6, sticky="ew")
        ctk.CTkButton(self, text="浏览…", width=80, command=self._browse_out).grid(
            row=row, column=3, padx=(4, 24), pady=6
        )

        row += 1
        opts = ctk.CTkFrame(self, fg_color="transparent")
        opts.grid(row=row, column=0, columnspan=4, padx=24, sticky="w", pady=(4, 0))
        ctk.CTkCheckBox(opts, text="已存在 FCStd 则跳过", variable=self._skip_existing).pack(side="left", padx=(0, 24))

        ctk.CTkCheckBox(
            opts,
            text="包含子文件夹中的 STEP",
            variable=self._step_recursive,
        ).pack(side="left", padx=(0, 24))

        ctk.CTkLabel(opts, text="视角适配（会话内）：", anchor="w").pack(side="left", padx=(0, 6))
        for val, lbl in (
            ("none", "不做"),
            ("last", "仅最后一个"),
            ("all", "每个文件"),
        ):
            ctk.CTkRadioButton(opts, text=lbl, variable=self._vf_mode, value=val).pack(
                side="left", padx=(0, 12)
            )

        row += 1
        btns = ctk.CTkFrame(self, fg_color="transparent")
        btns.grid(row=row, column=0, columnspan=4, padx=24, pady=8, sticky="w")
        ctk.CTkButton(btns, text="保存偏好", fg_color=("gray65", "gray35"), command=self._persist).pack(
            side="left", padx=(0, 8)
        )
        ctk.CTkButton(btns, text="运行 STEP 批量", command=self._run).pack(side="left", padx=(0, 8))
        ctk.CTkButton(btns, text="预览文件数（仅本地）", fg_color="gray45", command=self._preview_count).pack(
            side="left"
        )

        row += 1
        self._log = ctk.CTkTextbox(self, font=ctk.CTkFont(family="Menlo", size=12))
        self._log.grid(row=row, column=0, columnspan=4, padx=24, pady=(8, 24), sticky="nsew")

        self.grid_rowconfigure(row, weight=1)
        self.grid_columnconfigure(1, weight=1)

    def _repo(self) -> Path:
        return self.state.repo_root.expanduser().resolve()

    def _pv(self) -> dict:
        return load_workspace_prefs().get("step_batch") or {}

    def on_show(self) -> None:
        pv = self._pv()
        rr = self.state.repo_root
        rel = pv.get("project_relative")
        self._project_rel.delete(0, "end")
        if rel:
            self._project_rel.insert(0, str(rel))

        self._step_dir_entry.delete(0, "end")
        sd = resolve_pref_path(pv.get("step_dir"), rr)
        if sd and sd.is_dir():
            self._step_dir_entry.insert(0, str(sd.resolve()))

        self._out_dir_entry.delete(0, "end")
        od = resolve_pref_path(pv.get("out_dir"), rr)
        if od:
            self._out_dir_entry.insert(0, str(od.expanduser()))

        if "skip_existing" in pv:
            self._skip_existing.set(bool(pv["skip_existing"]))
        vf = str(pv.get("view_fit") or "none")
        self._vf_mode.set(vf if vf in ("none", "last", "all") else "none")
        if "use_inbox_bridge" in pv:
            self._use_inbox_bridge.set(bool(pv["use_inbox_bridge"]))
        if "step_recursive" in pv:
            self._step_recursive.set(bool(pv["step_recursive"]))

    def _fill_sample_dirs(self) -> None:
        rel = (self._project_rel.get() or "").strip()
        if not rel:
            self._log_line("请先填写「工程相对路径」。")
            return
        try:
            step_d, fc_d = sample_step_fcstd_dirs(self._repo(), rel)
        except ValueError as e:
            self._log_line(f"错误：{e}")
            return
        self._step_dir_entry.delete(0, "end")
        self._step_dir_entry.insert(0, str(step_d))
        self._out_dir_entry.delete(0, "end")
        self._out_dir_entry.insert(0, str(fc_d))
        self._log_line(f"已按约定填入 STEP：{step_d}\nFCStd：{fc_d}")

    def _browse_step(self) -> None:
        path = pick_workspace_directory(
            self,
            title="STEP 目录",
            repo_root=self.state.repo_root,
            path_hint=self._step_dir_entry.get(),
        )
        if path:
            self._step_dir_entry.delete(0, "end")
            self._step_dir_entry.insert(0, path)

    def _browse_out(self) -> None:
        path = pick_workspace_directory(
            self,
            title="FCStd 输出目录",
            repo_root=self.state.repo_root,
            path_hint=self._out_dir_entry.get(),
        )
        if path:
            self._out_dir_entry.delete(0, "end")
            self._out_dir_entry.insert(0, path)

    def _vf_flags(self) -> tuple[bool, bool]:
        mode = self._vf_mode.get()
        if mode == "all":
            return False, True
        if mode == "last":
            return True, False
        return False, False

    def _persist(self, *, quiet: bool = False) -> None:
        rr = self._repo()
        rel = (self._project_rel.get() or "").strip()
        vf_last, vf_all = self._vf_flags()
        vf_key = "all" if vf_all else "last" if vf_last else "none"

        def store_entry(box: ctk.CTkEntry) -> str | None:
            raw = box.get().strip()
            if not raw:
                return None
            q = Path(raw).expanduser()
            qp = q.resolve(strict=False) if q.is_absolute() else (rr / q).resolve(strict=False)
            return store_path_under_repo(qp, rr)

        merge_workspace_section(
            "step_batch",
            {
                "project_relative": rel or None,
                "step_dir": store_entry(self._step_dir_entry),
                "out_dir": store_entry(self._out_dir_entry),
                "skip_existing": self._skip_existing.get(),
                "view_fit": vf_key,
                "use_inbox_bridge": self._use_inbox_bridge.get(),
                "step_recursive": self._step_recursive.get(),
            },
        )
        if not quiet:
            self._log_line("已保存偏好 → step_batch。")

    def _build_job(self) -> StepBatchJob | None:
        step_s = self._step_dir_entry.get().strip()
        out_s = self._out_dir_entry.get().strip()
        if not step_s or not out_s:
            self._log_line("错误：请填写 STEP 目录与 FCStd 输出目录（或套用约定）。")
            return None
        rr = self._repo()
        step_dir = rr / Path(step_s) if not Path(step_s).is_absolute() else Path(step_s)
        step_dir = step_dir.expanduser().resolve()
        out_dir = rr / Path(out_s) if not Path(out_s).is_absolute() else Path(out_s)
        out_dir = out_dir.expanduser().resolve()
        if not step_dir.is_dir():
            self._log_line(f"错误：STEP 目录不存在：{step_dir}")
            return None
        vf_last, vf_all = self._vf_flags()
        rel = (self._project_rel.get() or "").strip()
        return StepBatchJob(
            step_dir=step_dir,
            out_dir=out_dir,
            skip_existing=self._skip_existing.get(),
            view_fit_last=vf_last,
            view_fit_all=vf_all,
            project_tag=rel,
            step_recursive=self._step_recursive.get(),
        )

    def _preview_count(self) -> None:
        step_s = self._step_dir_entry.get().strip()
        if not step_s:
            self._log_line("请先填写 STEP 目录。")
            return
        rr = self._repo()
        step_dir = rr / Path(step_s) if not Path(step_s).is_absolute() else Path(step_s)
        step_dir = step_dir.expanduser().resolve()
        try:
            top, deep = step_tree_stats(step_dir)
            rec = self._step_recursive.get()
            n = len(list_step_paths_for_batch(step_dir, recursive=rec))
        except (OSError, NotADirectoryError) as e:
            self._log_line(f"无法扫描：{e}")
            return
        rec_on = "开" if rec else "关"
        self._log_line(
            f"{step_dir}\n"
            f"  仅顶层 STEP：{top} | 全盘（含子文件夹）：{deep}\n"
            f"  本次将批量处理数量：{n}（递归={rec_on}）"
        )

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

        from fcdesk.integration.inbox_bridge import enqueue_step_batch, take_response

        clone = Path(fcdesk.__file__).resolve().parent.parent
        fc_core = clone / "scripts" / "freecad_batch_step_fc.py"
        if not fc_core.is_file():
            self._log.delete("1.0", "end")
            self._log_line(
                "错误：收件箱桥接需要 **桌面工具源码树** 里的 scripts/freecad_batch_step_fc.py。\n"
                f"根据当前 fcdesk 安装解析到目录：{clone}\n\n"
                "请在 phoenix-freecad-desktop 克隆根执行 `pip install -e .`，或直接用 `python -m fcdesk` 启动。\n"
                "若仅有不含 scripts 的包安装，请取消勾选改用 freecadcmd 子进程。"
            )
            return

        listener = _SCRIPTS_DIR / "freecad_fcdesk_inbox_listener.py"
        uid = enqueue_step_batch(clone, job)

        self._log.delete("1.0", "end")
        self._log_line(
            "[桥接] 已向已打开的 FreeCAD 投递 STEP 批量任务。\n"
            f"任务 id: {uid}\n"
            f"fcdesk 工具仓库（供导入）: {clone}\n"
            f"监听宏（每台机在 FreeCAD 里执行过一次即可）：\n  {listener}\n"
            "~/.fcdesk/freecad_bridge/inbox/<任务id>_queued.json\n"
            "~/.fcdesk/freecad_bridge/done/<任务id>_result.json\n\n"
            "请勿关闭 FreeCAD；下方会轮询回信（超时 10 min）。报告仍在所选输出目录的 Markdown。\n",
        )

        deadline = time.monotonic() + _BRIDGE_POLL_SEC

        def tick() -> None:
            data = take_response(uid)
            if data is not None:
                if data.get("ok"):
                    self._log_line("\n[fcdesk] FreeCAD 端执行结束（参见上方报告路径）。")
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
        fc_home = self.state.freecad_dir
        cmd_exe = resolve_freecad_cmd(fc_home)
        if not cmd_exe:
            hint = fc_home if fc_home else "(未设置)"
            self._log_line(
                f"错误：未找到批量命令解释器（freecadcmd / FreeCADCmd）。\n"
                f"请在「配置」页选择安装根目录（当前：{hint}）。\n"
                f"macOS 官方 dmg：请选应用程序里的 **FreeCAD.app**。\n"
                f"新版本常见批次入口：**FreeCAD.app/Contents/Resources/bin/freecadcmd**\n"
                f"少数旧版：**…/Contents/MacOS/FreeCADCmd**（外层 MacOS 里只有「FreeCAD」启动器的不行）。"
            )
            return
        if not _RUNNER.is_file():
            self._log_line(f"错误：找不到运行脚本 {_RUNNER}")
            return

        cmd = [str(cmd_exe), str(_RUNNER)]
        inner_env = job.subprocess_env()
        outer = os.environ.copy()
        merged = {**outer, **inner_env}

        line = "$ " + " ".join(cmd) + "\n" + "\n".join(f"{k}={v}" for k, v in sorted(inner_env.items()))
        self._log.delete("1.0", "end")
        self._log_line(line)

        def worker() -> None:
            try:
                proc = subprocess.run(
                    cmd,
                    cwd=str(self.state.repo_root.resolve()),
                    env=merged,
                    capture_output=True,
                    text=True,
                    encoding="utf-8",
                    errors="replace",
                )
                out_parts = [(proc.stdout or ""), (proc.stderr or "")]
                text = ("\n".join(p for p in out_parts if p)).strip()
                self.after(
                    0,
                    lambda: self._log_line(text or "(无控制台输出)；请查看输出目录 Markdown 报告。"),
                )
                self.after(0, lambda: self._log_line(f"\n退出码: {proc.returncode}"))
            except Exception as e:
                self.after(0, lambda: self._log_line(f"异常: {e}"))

        threading.Thread(target=worker, daemon=True).start()

    def _log_line(self, text: str) -> None:
        self._log.insert("end", text + "\n")
        self._log.see("end")
