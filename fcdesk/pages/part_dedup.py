"""编号查重：检查文件名和编号+版本重复。"""

from __future__ import annotations

import csv
from collections import defaultdict
from pathlib import Path

import customtkinter as ctk

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
from fcdesk.shell.native_dialog import pick_workspace_directory
from fcdesk.shell.state import AppState

# 下拉展示常用大小写习惯；扫描仍用 suffix.casefold() 与实际文件匹配。
_PART_DEDUP_EXT_OPTIONS = (".FCStd", ".SLDPRT", ".SLDASM", ".SLDDRW", ".step", ".stp")
_DEFAULT_PART_DEDUP_EXT = ".SLDPRT"


def _coerce_known_extension_display(stored: str | None) -> str:
    """把偏好里存的任意大小写后缀映射到下拉约定的显示串。"""
    raw = (stored or "").strip()
    if not raw:
        return _DEFAULT_PART_DEDUP_EXT
    if raw[0] != ".":
        raw = "." + raw
    rk = raw.casefold()
    for opt in _PART_DEDUP_EXT_OPTIONS:
        if opt.casefold() == rk:
            return opt
    return raw


# FreeCAD：`.Drawing.FCStd`（图纸档）与普通 `.FCStd` 共用同一 pathlib 后缀名 `.FCStd`，
# 编号维度需拆开，否则会误判「同名不同档」编号重复。
_FCSTD_DUP_TAG_DRAWING = "::fcd_draw"
_FCSTD_DUP_TAG_MODEL = "::fcd_model"


def _freecad_fcstd_dup_tag(filename: str) -> str:
    """扩展名已为 .FCStd 族时使用；先于「是否 .drawing.fcstd」再判普通构件。"""
    n = Path(filename).name.casefold()
    if not n.endswith(".fcstd"):
        return ""
    if n.endswith(".drawing.fcstd"):
        return _FCSTD_DUP_TAG_DRAWING
    return _FCSTD_DUP_TAG_MODEL


def _split_fcstd_group_key(full: str) -> tuple[str, str]:
    if full.endswith(_FCSTD_DUP_TAG_DRAWING):
        return full[: -len(_FCSTD_DUP_TAG_DRAWING)], _FCSTD_DUP_TAG_DRAWING
    if full.endswith(_FCSTD_DUP_TAG_MODEL):
        return full[: -len(_FCSTD_DUP_TAG_MODEL)], _FCSTD_DUP_TAG_MODEL
    return full, ""


def _fcstd_dup_human_note(tag: str) -> str:
    if tag == _FCSTD_DUP_TAG_DRAWING:
        return "（图纸 · .Drawing.FCStd）"
    if tag == _FCSTD_DUP_TAG_MODEL:
        return "（构件 · .FCStd）"
    return ""


def _fcstd_dup_csv_suffix(tag: str) -> str:
    if tag == _FCSTD_DUP_TAG_DRAWING:
        return "|图纸.DrawingFCStd"
    if tag == _FCSTD_DUP_TAG_MODEL:
        return "|构件.FCStd"
    return ""


class PartDedupPage(BasePage):
    """编号查重页：文件名重复 + 编号+版本重复（可选）。"""

    page_id = "part_dedup"

    def __init__(self, master, state: AppState, **kwargs) -> None:
        super().__init__(master, state, **kwargs)
        self._ext_var = ctk.StringVar(value=_DEFAULT_PART_DEDUP_EXT)
        self._code_len_var = ctk.IntVar(value=6)
        self._ver_len_var = ctk.IntVar(value=3)
        self._check_code = ctk.BooleanVar(value=True)
        self._check_version = ctk.BooleanVar(value=True)
        self._code_must_be_digit = ctk.BooleanVar(value=True)
        self._scan_dir = ""

        row = 0
        ctk.CTkLabel(
            self, text="编号查重", font=ctk.CTkFont(size=20, weight="bold"), anchor="w"
        ).grid(row=row, column=0, columnspan=4, padx=24, pady=(20, 4), sticky="w")

        row += 1
        opts_row = ctk.CTkFrame(self, fg_color="transparent")
        opts_row.grid(row=row, column=0, columnspan=4, padx=24, sticky="w", pady=(0, 8))

        ctk.CTkLabel(opts_row, text="扩展名：", anchor="w").pack(side="left", padx=(0, 4))
        ext_menu = ctk.CTkOptionMenu(
            opts_row,
            variable=self._ext_var,
            values=list(_PART_DEDUP_EXT_OPTIONS),
            width=118,
        )
        ext_menu.pack(side="left", padx=(0, 16))

        ctk.CTkLabel(opts_row, text="编号位数：", anchor="w").pack(side="left", padx=(0, 4))
        ctk.CTkEntry(opts_row, textvariable=self._code_len_var, width=50).pack(side="left", padx=(0, 12))

        ctk.CTkLabel(opts_row, text="版本位数：", anchor="w").pack(side="left", padx=(0, 4))
        ctk.CTkEntry(opts_row, textvariable=self._ver_len_var, width=50).pack(side="left")

        row += 1
        check_row = ctk.CTkFrame(self, fg_color="transparent")
        check_row.grid(row=row, column=0, columnspan=4, padx=24, sticky="w", pady=(0, 8))
        ctk.CTkCheckBox(check_row, text="编号检查", variable=self._check_code).pack(side="left", padx=(0, 12))
        ctk.CTkCheckBox(check_row, text="版本检查", variable=self._check_version).pack(side="left", padx=(0, 12))
        ctk.CTkCheckBox(check_row, text="零件号必须为数字", variable=self._code_must_be_digit).pack(side="left")

        row += 1
        ctk.CTkLabel(self, text="扫描目录", width=70, anchor="w").grid(
            row=row, column=0, padx=(24, 8), pady=6, sticky="w"
        )
        self._dir_entry = ctk.CTkEntry(self, placeholder_text="留空则扫描工作空间根", width=320)
        self._dir_entry.grid(row=row, column=1, columnspan=2, padx=4, pady=6, sticky="ew")
        ctk.CTkButton(self, text="浏览…", width=70, command=self._browse_dir).grid(
            row=row, column=3, padx=(4, 24), pady=6
        )

        row += 1
        btns = ctk.CTkFrame(self, fg_color="transparent")
        btns.grid(row=row, column=0, columnspan=4, padx=24, pady=10, sticky="w")
        ctk.CTkButton(btns, text="保存", fg_color=("gray65", "gray35"), command=self._persist).pack(side="left", padx=(0, 8))
        ctk.CTkButton(btns, text="扫描", command=self._scan).pack(side="left", padx=(0, 8))
        ctk.CTkButton(btns, text="导出 CSV", fg_color="gray45", command=self._export_csv).pack(side="left")

        row += 1
        self._log = ctk.CTkTextbox(self, font=ctk.CTkFont(family="Menlo", size=12))
        self._log.grid(row=row, column=0, columnspan=4, padx=24, pady=(8, 24), sticky="nsew")

        row += 1
        ctk.CTkLabel(
            self,
            text=(
                "文件名格式：零件号(6位)_版本(3位)_描述.ext\n"
                "零件号=前N位，版本=第N+2位起，中间为分隔符(_.-)\n"
                "勾选「版本检查」且文件名能解析出版本时，只参与编号+版本查重，不计入编号重复。\n"
                "零件号必须为数字」时，只检查纯数字零件号（如100001），\n"
                "中文/字母零件号（如排气管）将跳过编号查重。\n"
                "扩展名为 FCStd 时：`.Drawing.FCStd`（图纸档）与普通 `.FCStd`（构件）在编号/版本分组中分列，不会互判重复。"
            ),
            anchor="w",
            font=ctk.CTkFont(size=12),
            text_color=("gray30", "gray70"),
            wraplength=600,
            justify="left",
        ).grid(row=row, column=0, columnspan=4, padx=24, pady=(8, 24), sticky="w")

        self.grid_rowconfigure(row - 1, weight=1)
        self.grid_columnconfigure(0, minsize=80)
        self.grid_columnconfigure(1, weight=1)

        self._last_results: dict = {}

    def _pv(self) -> dict:
        return load_workspace_prefs(self.state.repo_root).get("part_dedup") or {}

    def _repo(self) -> Path:
        return self.state.repo_root.expanduser().resolve()

    def on_show(self) -> None:
        pv = self._pv()
        rr = self.state.repo_root
        
        # 恢复扩展名
        ext = _coerce_known_extension_display(pv.get("extension", _DEFAULT_PART_DEDUP_EXT))
        self._ext_var.set(ext)
        
        # 恢复位数设置
        self._code_len_var.set(pv.get("code_len", 6))
        self._ver_len_var.set(pv.get("ver_len", 3))
        
        # 恢复勾选状态
        self._check_code.set(bool(pv.get("check_code", True)))
        self._check_version.set(bool(pv.get("check_version", True)))
        self._code_must_be_digit.set(bool(pv.get("code_must_be_digit", True)))
        
        # 恢复扫描目录（未配置或等价根 → 「.」）
        self._dir_entry.delete(0, "end")
        disp = format_stored_path_for_display(pv.get("scan_dir"), rr)
        txt = shorten_workspace_relative_display(disp if disp is not None else "")
        self._scan_dir = txt
        self._dir_entry.insert(0, txt)

    def _persist(self, *, quiet: bool = False) -> None:
        rr = self._repo()

        def se(box: ctk.CTkEntry) -> str | None:
            t = box.get().strip()
            if not t or t == ".":
                return None
            q = Path(t).expanduser()
            qp = q.resolve(strict=False) if q.is_absolute() else (rr / q).resolve(strict=False)
            return store_path_under_repo(qp, rr)

        merge_workspace_section(
            "part_dedup",
            {
                "extension": self._ext_var.get(),
                "code_len": self._code_len_var.get(),
                "ver_len": self._ver_len_var.get(),
                "check_code": self._check_code.get(),
                "check_version": self._check_version.get(),
                "code_must_be_digit": self._code_must_be_digit.get(),
                "scan_dir": se(self._dir_entry),
            },
            self.state.repo_root,
        )
        if not quiet and self._log is not None:
            self._log_line("已保存偏好 → part_dedup")

    def _browse_dir(self) -> None:
        p = pick_workspace_directory(
            self,
            title="选择扫描目录",
            repo_root=self.state.repo_root,
            path_hint=self._dir_entry.get(),
        )
        if p:
            rr = self._repo()
            shown = shorten_workspace_relative_display(
                format_resolved_under_workspace(Path(p).expanduser(), rr)
            )
            self._dir_entry.delete(0, "end")
            self._dir_entry.insert(0, shown)
            self._scan_dir = shown

    def _parse_filename(self, name: str) -> tuple[str | None, str | None]:
        """从文件名解析编号和版本。
        
        支持格式：
        - 100001.001（零件号.版本）
        - 100001-001（零件号-版本）
        - 100001_001（零件号_版本）
        
        如果启用了"零件号必须为数字"，则只有零件号部分为纯数字时才返回有效值。
        """
        code_len = self._code_len_var.get()
        ver_len = self._ver_len_var.get()

        stem = Path(name).stem
        if len(stem) < code_len:
            return None, None

        code = stem[:code_len]
        
        # 如果启用了零件号必须为数字的检查
        if self._code_must_be_digit.get():
            if not code.isdigit():
                return None, None
        
        if self._check_version.get() and len(stem) >= code_len + 1 + ver_len:
            ver = stem[code_len + 1 : code_len + 1 + ver_len]
            return code, ver
        
        return code, None

    def _scan(self) -> None:
        self._persist(quiet=True)  # 扫描前自动保存当前配置
        self._log.delete("1.0", "end")
        
        ext = self._ext_var.get()
        repo_root = self.state.repo_root.expanduser().resolve()

        scan_path = resolve_workspace_path_entry(self._dir_entry.get(), repo_root)
        if not scan_path.is_dir():
            self._log_line(
                f"错误：目录不存在：{format_resolved_under_workspace(scan_path, repo_root)}"
            )
            return

        scan_disp = format_resolved_under_workspace(scan_path, repo_root)
        self._log_line(f"扫描目录：{scan_disp}")
        self._log_line(f"扩展名：{ext}（大小写无关匹配）")

        # 后缀按 Unicode casefold 比较：覆盖 .FcStd / .FCSTD 等，避免仅用 rglob "*.fcstd"
        # "*.FCSTD" 在区分大小写的卷（常见 macOS/APFS）上找不到混合大小写扩展名。
        raw_ext = (ext or "").strip()
        if not raw_ext.startswith("."):
            raw_ext = "." + raw_ext.lstrip(".")
        ext_cf = raw_ext.casefold()
        files: list[Path] = []
        try:
            for fp in scan_path.rglob("*"):
                try:
                    if fp.is_file() and fp.suffix.casefold() == ext_cf:
                        files.append(fp)
                except OSError:
                    continue
        except OSError as e:
            self._log_line(f"扫描失败：{e}")
            return
        
        files = sorted(files, key=lambda p: str(p.resolve()))
        if not files:
            self._log_line(f"未找到 {ext} 文件")
            return

        self._log_line(f"共找到 {len(files)} 个文件（已去重）")
        if ext_cf == ".fcstd":
            self._log_line(
                "说明：`.Drawing.FCStd`（图纸）与 `.FCStd`（一般构件）在编号查重中会分开计数。\n"
            )

        name_groups: dict[str, list[Path]] = defaultdict(list)
        code_groups: dict[str, list[Path]] = defaultdict(list)
        ver_groups: dict[str, list[Path]] = defaultdict(list)

        for fp in files:
            name_key = fp.name
            name_groups[name_key].append(fp)

            # FreeCAD FCStd：图纸与普通构件分桶，编号/编号+版本不混组
            fcstd_tag = _freecad_fcstd_dup_tag(fp.name) if ext_cf == ".fcstd" else ""

            if self._check_code.get():
                code, ver = self._parse_filename(fp.name)
                if code:
                    # 能解析出版本号的文件只做「编号+版本」维度查重，不计入裸「编号重复」
                    if not ver:
                        code_groups[f"{code}{fcstd_tag}"].append(fp)

                    if ver and self._check_version.get():
                        ver_groups[f"{code}_{ver}{fcstd_tag}"].append(fp)

        results = {
            "name_dup": [],
            "code_dup": [],
            "ver_dup": [],
        }

        self._log_line("=" * 50)
        self._log_line("【文件名重复】")
        self._log_line("=" * 50)
        name_dup_count = 0
        for name, paths in sorted(name_groups.items()):
            if len(paths) > 1:
                name_dup_count += 1
                results["name_dup"].append({"文件名": name, "路径": [str(p) for p in paths]})
                self._log_line(f"\n文件名：{name}")
                for p in paths:
                    self._log_line(f"  {p}")
        
        if name_dup_count == 0:
            self._log_line("无重复")
        else:
            self._log_line(f"\n共 {name_dup_count} 组文件名重复")

        if self._check_code.get():
            self._log_line("")
            self._log_line("=" * 50)
            self._log_line("【编号重复】")
            self._log_line("=" * 50)
            code_dup_count = 0
            for grp_key, paths in sorted(code_groups.items()):
                if len(paths) > 1:
                    code_dup_count += 1
                    base, suf = _split_fcstd_group_key(grp_key)
                    note_h = _fcstd_dup_human_note(suf)
                    csv_suf = _fcstd_dup_csv_suffix(suf)
                    results["code_dup"].append(
                        {"编号": f"{base}{csv_suf}", "路径": [str(p) for p in paths]}
                    )
                    ln = f"\n编号：{base}"
                    if note_h:
                        ln += f" {note_h}"
                    self._log_line(ln)
                    for p in paths:
                        self._log_line(f"  {p}")
            
            if code_dup_count == 0:
                self._log_line("无重复")
            else:
                self._log_line(f"\n共 {code_dup_count} 组编号重复")

        if self._check_code.get() and self._check_version.get():
            self._log_line("")
            self._log_line("=" * 50)
            self._log_line("【编号+版本重复】")
            self._log_line("=" * 50)
            ver_dup_count = 0
            for ver_key, paths in sorted(ver_groups.items()):
                if len(paths) > 1:
                    ver_dup_count += 1
                    stripped, suf = _split_fcstd_group_key(ver_key)
                    parts_g = stripped.split("_", 1)
                    cod = parts_g[0]
                    ver_part = parts_g[1] if len(parts_g) > 1 else ""
                    csv_suf = _fcstd_dup_csv_suffix(suf)
                    note_h = _fcstd_dup_human_note(suf)
                    results["ver_dup"].append(
                        {
                            "编号": cod,
                            "版本": ver_part,
                            "_csv_fc": csv_suf,
                            "路径": [str(p) for p in paths],
                        }
                    )
                    ln = f"\n编号+版本：{cod}_{ver_part}"
                    if note_h:
                        ln += f" {note_h}"
                    self._log_line(ln)
                    for p in paths:
                        self._log_line(f"  {p}")
            
            if ver_dup_count == 0:
                self._log_line("无重复")
            else:
                self._log_line(f"\n共 {ver_dup_count} 组编号+版本重复")

        self._last_results = results
        total_dup = len(results["name_dup"]) + len(results["code_dup"]) + len(results["ver_dup"])
        self._log_line(f"\n{'=' * 50}")
        self._log_line(f"扫描完成：{total_dup} 组重复")

    def _export_csv(self) -> None:
        if not self._last_results:
            self._log_line("请先执行扫描")
            return

        repo_root = self.state.repo_root.expanduser().resolve()
        csv_path = repo_root / "重复文件检查报告.csv"

        try:
            with open(csv_path, "w", newline="", encoding="utf-8-sig") as f:
                writer = csv.writer(f)
                writer.writerow(["类型", "标识", "文件路径"])

                for item in self._last_results.get("name_dup", []):
                    for path in item["路径"]:
                        writer.writerow(["文件名重复", item["文件名"], path])

                for item in self._last_results.get("code_dup", []):
                    for path in item["路径"]:
                        writer.writerow(["编号重复", item["编号"], path])

                for item in self._last_results.get("ver_dup", []):
                    tag = item.get("_csv_fc") or ""
                    for path in item["路径"]:
                        writer.writerow([
                            "编号+版本重复",
                            f"{item['编号']}_{item['版本']}{tag}",
                            path,
                        ])

            self._log_line(f"\nCSV 已导出：{csv_path}")
        except Exception as e:
            self._log_line(f"\n导出失败：{e}")

    def _log_line(self, text: str) -> None:
        self._log.insert("end", text + "\n")
        self._log.see("end")
