"""工作空间内按扩展名筛选的目录树（ttk.Treeview），可供全局侧栏或多页嵌入。

跨平台（macOS 为主开发，兼容 Windows）：使用 ``pathlib``；扩展名用 ``suffix.casefold()`` 匹配，
因 macOS/APFS（常不区分大小写）与 Windows 上后缀大小写写法不一。目录跳过集合按「目录名折叠」比对，
并在 Windows 上跳过回收站等系统目录。
"""

from __future__ import annotations

from collections.abc import Callable
from pathlib import Path
from urllib.parse import quote, unquote

import customtkinter as ctk
import tkinter as tk
from tkinter import ttk

from fcdesk.shell.state import AppState

# 扫描时跳过的目录：名称做 casefold() 后与集合比对（避免 Windows / macOS 大小写写法差异）
_SKIP_DIR_NAMES_CI = frozenset(
    {
        ".git",
        ".svn",
        ".hg",
        "__pycache__",
        ".venv",
        "venv",
        "node_modules",
        ".idea",
        ".vs",
        ".bundle",
        "Pods",  # CocoaPods（macOS / iOS 工程噪音）
        # Windows（常见分区根或用户卷上的系统目录）
        "$recycle.bin",
        "system volume information",
        "recovery",
        "windowsapps",
        "program files",
        "program files (x86)",
        "programdata",
    }
)


def _should_skip_scan_dir(dirname: str) -> bool:
    """是否跳过不参与递归的目录名（大小写无关 + 点前缀惯例）。"""
    cf = dirname.casefold()
    if cf in _SKIP_DIR_NAMES_CI:
        return True
    # Unix/macOS：以 . 开头的目录多为工具/源码配置，减少体积与噪音（非工程 CAD 时可避扫）
    if cf.startswith("."):
        return True
    return False


FCSTD_SUFFIX = ".fcstd"
SW_PART_SUFFIX = ".sldprt"


def apply_ctkish_treeview_style(tree: ttk.Treeview, style_name: str) -> None:
    """与 FCStd 索引等页一致的亮/暗 Treeview 样式。"""
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
        style_name,
        background=bg,
        fieldbackground=bg,
        foreground=fg,
        rowheight=22,
        borderwidth=0,
    )
    style.map(
        style_name,
        background=[("selected", sel_bg)],
        foreground=[("selected", sel_fg)],
    )
    style.configure(
        f"{style_name}.Heading",
        background=("#3d3d3d" if dark else "#d9d9d9"),
        foreground=fg,
        relief="flat",
        borderwidth=0,
    )
    tree.configure(style=style_name)
    host = tree.master
    try:
        host.configure(bg=bg)
    except tk.TclError:
        pass


def iter_filtered_files(workspace: Path, *, want_fcstd: bool, want_sw_part: bool) -> list[Path]:
    """递归列出工作空间内匹配扩展名的文件（相对路径）。"""
    exts: set[str] = set()
    if want_fcstd:
        exts.add(FCSTD_SUFFIX)
    if want_sw_part:
        exts.add(SW_PART_SUFFIX)
    if not exts:
        return []

    root = workspace.expanduser().resolve(strict=False)
    if not root.is_dir():
        return []

    matched: list[Path] = []

    def walk(cur: Path) -> None:
        try:
            entries = sorted(cur.iterdir(), key=lambda p: (not p.is_dir(), p.name.lower()))
        except OSError:
            # 权限、网络盘离线、Windows 路径过长等
            return
        for ent in entries:
            try:
                is_dir = ent.is_dir()
                is_symlink = ent.is_symlink()
            except OSError:
                continue
            if is_dir:
                if _should_skip_scan_dir(ent.name):
                    continue
                # 不向「目录符号链接」递归：避免环路与误扫工作空间外（macOS/Linux 常见）；
                # Windows 的 Junction 多数 is_symlink() 为 False，仅靠跳过集合无法覆盖全部情况。
                if is_symlink:
                    continue
                walk(ent)
                continue
            suf = ent.suffix.casefold()
            if suf in exts:
                try:
                    matched.append(ent.relative_to(root))
                except ValueError:
                    pass

    walk(root)
    matched.sort(key=lambda p: p.as_posix().lower())
    return matched


class FilteredWorkspaceTreeFrame(ctk.CTkFrame):
    """类型筛选 + 扫描 + Treeview。

    Parameters
    ----------
    single_column_tree
        ``True`` 时仅单列树结点（文件名旁用 ``[FCStd]`` 等前缀表示类型），隐藏附加列。
    sidebar_layout
        ``True`` 时工具条纵向堆叠（适合窄幅全局侧栏）。
    """

    _ROOT_IID = "ws:root"

    def __init__(
        self,
        master,
        state: AppState,
        *,
        on_select: Callable[[Path | None], None] | None = None,
        single_column_tree: bool = False,
        sidebar_layout: bool = False,
        tree_style_suffix: str = "FilteredWs",
        **kwargs,
    ) -> None:
        super().__init__(master, fg_color="transparent", **kwargs)
        self._state = state
        self._single_column = single_column_tree
        self._sidebar_layout = sidebar_layout
        self._tree_style_key = tree_style_suffix
        self._on_select = on_select
        self._var_fcstd = ctk.BooleanVar(value=True)
        self._var_sw = ctk.BooleanVar(value=True)

        bar = ctk.CTkFrame(self, fg_color="transparent")
        bar.pack(fill="x", pady=(0, 8))
        self._toolbar_frame = bar

        if sidebar_layout:

            def row_cb(parent: ctk.CTkFrame, text: str, var: ctk.BooleanVar) -> None:
                ctk.CTkCheckBox(parent, text=text, variable=var).pack(anchor="w", fill="x", pady=2)

            row_cb(bar, "FCStd（.FCStd）", self._var_fcstd)
            row_cb(bar, "SolidWorks 零件（.sldprt）", self._var_sw)
            ctk.CTkButton(bar, text="扫描工作空间…", command=self.scan_workspace).pack(fill="x", pady=(6, 0))
        else:
            ctk.CTkCheckBox(bar, text="FCStd", variable=self._var_fcstd).pack(side="left", padx=(0, 14))
            ctk.CTkCheckBox(bar, text="SolidWorks（.sldprt）", variable=self._var_sw).pack(side="left", padx=(0, 14))
            ctk.CTkButton(bar, text="扫描…", width=88, command=self.scan_workspace).pack(side="left", padx=(0, 8))

        self._host = tk.Frame(self, highlightthickness=0)
        self._host.pack(fill="both", expand=True)

        vsb = ttk.Scrollbar(self._host, orient="vertical")
        hsb = ttk.Scrollbar(self._host, orient="horizontal")

        def _sy(*args: object, _sb=vsb) -> None:
            _sb.set(*args)

        def _sx(*args: object, _sb=hsb) -> None:
            _sb.set(*args)

        ts = f"{self._tree_style_key}.Treeview"
        if single_column_tree:
            self._tree = ttk.Treeview(
                self._host,
                show="tree",
                yscrollcommand=_sy,
                xscrollcommand=_sx,
                selectmode="browse",
            )
        else:
            self._tree = ttk.Treeview(
                self._host,
                columns=("kind", "relpath"),
                show="tree headings",
                yscrollcommand=_sy,
                xscrollcommand=_sx,
                selectmode="browse",
            )
            self._tree.heading("#0", text="名称")
            self._tree.heading("kind", text="类型")
            self._tree.heading("relpath", text="相对工作空间路径")
            self._tree.column("#0", width=220, stretch=True)
            self._tree.column("kind", width=92, stretch=False)
            self._tree.column("relpath", width=340, stretch=True)

        vsb.config(command=self._tree.yview)
        hsb.config(command=self._tree.xview)

        if single_column_tree:
            self._tree.heading("#0", text="工作空间")

        corner = tk.Frame(self._host, highlightthickness=0)
        self._tree.grid(row=0, column=0, sticky="nsew")
        vsb.grid(row=0, column=1, sticky="ns")
        hsb.grid(row=1, column=0, sticky="ew")
        corner.grid(row=1, column=1, sticky="sew")

        self._host.grid_rowconfigure(0, weight=1)
        self._host.grid_columnconfigure(0, weight=1)

        apply_ctkish_treeview_style(self._tree, ts)

        self._tree.bind("<<TreeviewSelect>>", self._on_tree_select_internal)

        self._placeholder("勾选类型后点「扫描…」遍历当前工作空间。")

    def set_on_select(self, on_select: Callable[[Path | None], None] | None) -> None:
        """切换选中回调（供外壳把事件派发到当前激活页）。"""
        self._on_select = on_select

    def _placeholder(self, msg: str) -> None:
        self._tree.delete(*self._tree.get_children(""))
        if self._single_column:
            self._tree.insert("", "end", iid="__hint__", text=msg)
        else:
            self._tree.insert("", "end", iid="__hint__", text=msg, values=("", ""))

    def scan_workspace(self) -> None:
        fc = self._var_fcstd.get()
        sw = self._var_sw.get()
        if not fc and not sw:
            self._placeholder("请至少勾选一种文件类型（FCStd 或 SolidWorks 零件）。")
            self._maybe_notify(None)
            return

        ws = self._state.repo_root
        root = ws.expanduser().resolve(strict=False)
        if not root.is_dir():
            self._placeholder(f"工作空间不是目录：{root}")
            self._maybe_notify(None)
            return

        files = iter_filtered_files(ws, want_fcstd=fc, want_sw_part=sw)
        self._populate(files)

    def _populate(self, rel_files: list[Path]) -> None:
        self._tree.delete(*self._tree.get_children(""))
        ws = self._state.repo_root.expanduser().resolve(strict=False)

        if self._single_column:
            self._tree.insert("", "end", iid=self._ROOT_IID, text=ws.name or str(ws))
        else:
            self._tree.insert("", "end", iid=self._ROOT_IID, text=ws.name or str(ws), values=("", ""))

        if not rel_files:
            if self._single_column:
                self._tree.insert(self._ROOT_IID, "end", iid="__empty__", text="（未发现匹配文件）")
            else:
                self._tree.insert(
                    self._ROOT_IID,
                    "end",
                    iid="__empty__",
                    text="（未发现匹配文件）",
                    values=("", "可调整勾选或在仓库中添加文件"),
                )
            self._tree.item(self._ROOT_IID, open=True)
            return

        dir_keys: set[tuple[str, ...]] = set()
        for rf in rel_files:
            parts = rf.parts
            if not parts:
                continue
            for i in range(len(parts) - 1):
                dir_keys.add(tuple(parts[: i + 1]))
        sorted_dirs = sorted(dir_keys, key=lambda t: (len(t), "/".join(t).lower()))

        def dir_iid(parts: tuple[str, ...]) -> str:
            if not parts:
                return self._ROOT_IID
            return "dir_" + quote("/".join(parts), safe="")

        def file_iid(relative: Path) -> str:
            return "file_" + quote(relative.as_posix(), safe="")

        for parts in sorted_dirs:
            name = parts[-1]
            parent_parts = parts[:-1]
            parent_id = dir_iid(parent_parts)
            if not self._tree.exists(parent_id):
                parent_id = self._ROOT_IID
            if self._single_column:
                self._tree.insert(parent_id, "end", iid=dir_iid(parts), text=name)
            else:
                self._tree.insert(parent_id, "end", iid=dir_iid(parts), text=name, values=("", ""))

        for rf in rel_files:
            parent_parts = tuple(rf.parts[:-1])
            pid = dir_iid(parent_parts)
            if not self._tree.exists(pid):
                pid = self._ROOT_IID
            name = rf.name
            suf = rf.suffix.casefold()
            if suf == FCSTD_SUFFIX:
                kind = "FCStd"
            elif suf == SW_PART_SUFFIX:
                kind = "SW·prt"
            else:
                kind = suf.lstrip(".").upper() or "—"
            fiid = file_iid(rf)
            display = name
            if self._single_column:
                display = f"[{kind}] {name}"
                row_kw: dict[str, object] = {"iid": fiid, "text": display}
            else:
                row_kw = {"iid": fiid, "text": name, "values": (kind, rf.as_posix())}
            try:
                self._tree.insert(pid, "end", **row_kw)
            except tk.TclError:
                continue

        self._tree.item(self._ROOT_IID, open=True)
        for parts in sorted_dirs:
            try:
                self._tree.item(dir_iid(parts), open=False)
            except tk.TclError:
                pass

    def clear(self) -> None:
        """清空树并重置占位。"""
        self._placeholder("勾选类型后点「扫描…」遍历当前工作空间。")
        self._maybe_notify(None)

    def _on_tree_select_internal(self, _event: object | None = None) -> None:
        sel = self._tree.selection()
        if not sel:
            self._maybe_notify(None)
            return
        first = sel[0]
        if first.startswith("file_"):
            rel_s = unquote(first[5:])
            self._maybe_notify(Path(rel_s))
        else:
            self._maybe_notify(None)

    def _maybe_notify(self, path: Path | None) -> None:
        if self._on_select:
            self._on_select(path)
