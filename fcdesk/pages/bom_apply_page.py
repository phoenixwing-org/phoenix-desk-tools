"""属性回写：侧栏选中文件后可编辑 BOM 字段，并写入 FCStd ZIP 内 ``FcdeskBomAttrs.xml``。

``PartNumber`` / ``PartVersion`` / ``TypeCode`` 等与序列化、`fcstd_map.json` / ``FcdeskBomAttrs.xml`` 键名一致；其余路径类字段仍为 snake_case。约定见 ``doc/Fcdesk嵌入式BOM属性约定.md``。
"""

from __future__ import annotations

from pathlib import Path
import sys

import customtkinter as ctk
from tkinter import Menu, TclError, messagebox

from fcdesk.config.user_prefs import format_resolved_under_workspace
from fcdesk.fcstd_embedded_attrs import (
    EDITABLE_ENTRY_ATTRS,
    FcdeskFcstdEmbeddedError,
    read_embedded_bom_attrs,
    write_embedded_bom_attrs,
)
from fcdesk.fcstd_mapping import FcstdMapEntry, try_load_fcstd_entry_from_workspace_map
from fcdesk.pages.base import BasePage
from fcdesk.pages import form_widgets as fw
from fcdesk.shell.state import AppState

# (wire 键 snake_case ↔ JSON/XML；界面第二行英文名用大驼峰，与 FreeCAD Property 展示习惯一致)
_ATTR_ROWS: tuple[tuple[str, str, str, bool], ...] = (
    ("repo_rel_path", "仓库相对路径", "RepoRelativePath", False),
    ("filename", "文件名", "Filename", False),
    ("PartNumber", "零件号", "PartNumber", True),
    ("PartVersion", "版本", "PartVersion", True),
    ("TypeCode", "类型码 (H/S/R)", "TypeCode", True),
    ("ModelSeries", "型号系列", "ModelSeries", True),
    ("label", "标签", "Label", True),
)

_EDIT_KEYS = frozenset(k for k, _cn, _pascal_en, editable in _ATTR_ROWS if editable)
_READONLY_KEYS = frozenset(k for k, _cn, _pascal_en, editable in _ATTR_ROWS if not editable)


def _context_menu_sequences() -> tuple[str, ...]:
    """右键弹出菜单所用事件（避免 Linux 上钩住 ``<Button-2>``，以免顶替中键粘贴）。"""
    if sys.platform == "darwin":
        return ("<Button-2>", "<Button-3>", "<Control-Button-1>")
    return ("<Button-3>",)


class BomApplyPage(BasePage):
    page_id = "bom_apply"

    def __init__(self, master, state: AppState, **kwargs) -> None:
        super().__init__(master, state, **kwargs)

        self.grid_rowconfigure(0, weight=1)
        root_scroll = ctk.CTkScrollableFrame(self, fg_color="transparent")
        root_scroll.grid(row=0, column=0, sticky="nsew")
        root_scroll.grid_columnconfigure(0, weight=1)

        fw.page_title(root_scroll, text="属性回写").grid(
            row=0,
            column=0,
            padx=24,
            pady=(20, 8),
            sticky="nw",
        )

        wrap = ctk.CTkFrame(root_scroll, fg_color="transparent")
        wrap.grid(row=1, column=0, sticky="ew", padx=24, pady=(0, 0))
        wrap.grid_columnconfigure(0, weight=1)

        self._preview_title = ctk.CTkLabel(
            wrap,
            text="选中文件属性",
            font=ctk.CTkFont(size=14, weight="bold"),
            anchor="w",
        )
        self._preview_title.grid(row=0, column=0, sticky="nw", pady=(0, 4))

        self._source_hint = ctk.CTkLabel(
            wrap,
            text="",
            anchor="w",
            justify="left",
            font=ctk.CTkFont(size=11),
            text_color=("gray34", "gray68"),
        )
        self._source_hint.grid(row=1, column=0, sticky="nw", pady=(0, 6))

        btn_bar = ctk.CTkFrame(wrap, fg_color="transparent")
        btn_bar.grid(row=2, column=0, sticky="nw", pady=(0, 10))
        ctk.CTkButton(btn_bar, text="重新读取", width=100, fg_color=("gray72", "gray38"), command=self._reload_disk).grid(
            row=0,
            column=0,
            padx=(0, 10),
        )
        self._btn_save = ctk.CTkButton(btn_bar, text="保存到 ZIP", width=112, command=self._save_zip)
        self._btn_save.grid(row=0, column=1, padx=(0, 10))

        self._status_hint = ctk.CTkLabel(
            btn_bar,
            text="",
            anchor="w",
            font=ctk.CTkFont(size=12),
            text_color=("gray40", "gray65"),
        )
        self._status_hint.grid(row=0, column=2, padx=(8, 0), sticky="w")

        self._abs_path_label = ctk.CTkLabel(
            wrap,
            text="",
            anchor="nw",
            justify="left",
            wraplength=900,
            font=ctk.CTkFont(size=12),
        )
        self._abs_path_label.grid(row=3, column=0, sticky="nw", pady=(0, 10))

        self._attrs_panel = ctk.CTkFrame(wrap, fg_color="transparent")
        self._attrs_panel.grid(row=4, column=0, sticky="ew", pady=(0, 8))
        self._attrs_panel.grid_columnconfigure(2, weight=1)

        self._dirty_labels: dict[str, ctk.CTkLabel] = {}
        self._value_widgets: dict[str, ctk.CTkEntry] = {}

        mono = ctk.CTkFont(size=11)
        sub_gray = ("gray42", "gray65")

        hdr = ctk.CTkFrame(self._attrs_panel, fg_color="transparent")
        hdr.grid(row=0, column=0, columnspan=4, sticky="ew", padx=0, pady=(0, 6))
        ctk.CTkLabel(hdr, text="", width=8).grid(row=0, column=0, padx=(0, 8))
        ctk.CTkLabel(hdr, text="说明 / 英文名（大驼峰）", anchor="w", font=ctk.CTkFont(size=11, weight="bold")).grid(
            row=0,
            column=1,
            sticky="w",
        )
        ctk.CTkLabel(hdr, text="值", anchor="w", font=ctk.CTkFont(size=11, weight="bold")).grid(
            row=0,
            column=3,
            sticky="w",
        )

        grid_row_start = 1
        for j, (attr_key, caption_cn, pascal_en, editable_) in enumerate(_ATTR_ROWS):
            i = grid_row_start + j
            marker = ctk.CTkLabel(self._attrs_panel, text="", width=18, anchor="center", font=("Arial", 16))
            marker.grid(row=i, column=0, sticky="n", padx=(0, 4), pady=(6, 0))
            self._dirty_labels[attr_key] = marker

            meta = ctk.CTkFrame(self._attrs_panel, fg_color="transparent")
            meta.grid(row=i, column=1, sticky="nw", padx=(0, 12), pady=(4, 6))
            ctk.CTkLabel(meta, text=caption_cn, anchor="w", font=ctk.CTkFont(size=13)).pack(anchor="w")
            ctk.CTkLabel(meta, text=pascal_en, anchor="w", font=mono, text_color=sub_gray).pack(anchor="w")

            widget = ctk.CTkEntry(self._attrs_panel, height=28)
            widget.grid(row=i, column=2, columnspan=2, sticky="ew", padx=(0, 6), pady=(4, 6))
            if editable_:
                widget.bind("<KeyRelease>", lambda _e, k=attr_key: self._touch_field(k))
                widget.bind("<<Paste>>", lambda _e, k=attr_key: self.after(50, lambda: self._touch_field(k)))
            else:
                widget.configure(state="readonly")

            self._bind_field_copy_menu(widget)
            self._value_widgets[attr_key] = widget

        fw.page_hint_label(
            root_scroll,
            (
                "表格第二列为 PartNumber / PartVersion …（大驼峰），与 FreeCAD 属性面板可读名一致；"
                "`fcstd_map.json` 与 ``FcdeskBomAttrs.xml`` 中可写字段键名为 ``PartNumber``、``PartVersion``、``TypeCode`` 等（与大驼峰列一致；``label`` 为小写）。\n"
                "在右侧栏选中 ``.FCStd`` 后可编辑 PartNumber / PartVersion / TypeCode / ModelSeries / Label。\n"
                "各字段值可为文本框；「仓库相对路径」「文件名」为只读。\n"
                "可复制：拖选后用快捷键，或在框内右键点「复制」；若无选区则复制整框内容。\n"
                "保存将把属性写入 ZIP 内的 ``FcdeskBomAttrs.xml``（不修改 Document.xml）。"
                "若 FreeCAD 正打开该文件，保存常因占用失败——请先关闭 FreeCAD 或其它占用程序。\n"
                "切换到树中另一个文件而未保存将丢弃当前未保存改动。"
            ),
            wraplength=920,
        ).grid(row=2, column=0, sticky="ew", padx=24, pady=(16, 24))

        self._current_rel: Path | None = None
        self._preview_entry: FcstdMapEntry | None = None
        self._baseline: dict[str, str] = {}
        self._show_empty_selection()

    def _entry_tk(self, box: ctk.CTkEntry) -> object:
        """指向内部 ``tk.Entry``；CTkEntry 外层 ``bind`` 有时收不到指针事件。"""
        return getattr(box, "_entry", box)

    def _copy_entry_text_clipboard(self, box: ctk.CTkEntry) -> None:
        tk_e = self._entry_tk(box)
        try:
            if tk_e.selection_present():
                text = tk_e.selection_get()
            else:
                text = box.get()
        except TclError:
            text = box.get()
        root = self.winfo_toplevel()
        root.clipboard_clear()
        root.clipboard_append(text)
        root.update_idletasks()

    def _bind_field_copy_menu(self, box: ctk.CTkEntry) -> None:
        tk_shell = self._entry_tk(box)

        def show_menu(event) -> None:  # noqa: ANN001
            m = Menu(self.winfo_toplevel(), tearoff=0)
            m.add_command(label="复制", command=lambda b=box: self._copy_entry_text_clipboard(b))
            try:
                m.tk_popup(event.x_root, event.y_root)
            finally:
                m.grab_release()

        for seq in _context_menu_sequences():
            tk_shell.bind(seq, show_menu)

    def _set_status(self, text: str, *, ok: bool | None = None) -> None:
        if ok is True:
            col = ("#166534", "#4ade80")
        elif ok is False:
            col = ("#9a3412", "#fca5a5")
        else:
            col = ("gray40", "gray65")
        self._status_hint.configure(text=text, text_color=col)

    def _touch_field(self, attr_key: str | None = None) -> None:
        _ = attr_key  # uniform refresh
        self._refresh_dirty_marks()

    def _refresh_dirty_marks(self) -> None:
        for k in _EDIT_KEYS:
            mark = self._dirty_labels[k]
            w = self._value_widgets[k]
            cur = w.get().strip()
            base = self._baseline.get(k, "")
            dirty = cur != base
            mark.configure(text="●" if dirty else "")
            if dirty:
                mark.configure(text_color=("#c2410c", "#fdba74"))
            else:
                mark.configure(text_color=("gray60", "gray65"))

    def _any_dirty(self) -> bool:
        for k in _EDIT_KEYS:
            w = self._value_widgets[k]
            cur = w.get().strip()
            if cur != self._baseline.get(k, ""):
                return True
        return False

    def _collect_editable(self) -> dict[str, str]:
        out: dict[str, str] = {}
        for k in EDITABLE_ENTRY_ATTRS:
            w = self._value_widgets[k]
            out[k] = w.get().strip()
        return out

    def _widget_set_value(self, key: str, text: str) -> None:
        w = self._value_widgets[key]
        w.configure(state="normal")
        w.delete(0, "end")
        if key in _READONLY_KEYS:
            disp = text if text.strip() else "—"
            w.insert(0, disp)
            w.configure(state="readonly")
        else:
            w.insert(0, text)

    def _entry_to_plain(self, e: FcstdMapEntry) -> dict[str, str]:
        return {
            "repo_rel_path": str(e.repo_rel_path or ""),
            "filename": str(e.filename or ""),
            "PartNumber": str(e.PartNumber or ""),
            "PartVersion": str(e.PartVersion or ""),
            "TypeCode": str(e.TypeCode or ""),
            "ModelSeries": str(e.ModelSeries or ""),
            "label": str(e.label or ""),
        }

    def _merge_embedded_over(self, base: dict[str, str], embedded: dict[str, str]) -> dict[str, str]:
        out = dict(base)
        for k in EDITABLE_ENTRY_ATTRS:
            if k in embedded:
                out[k] = embedded[k]
        return out

    def on_workspace_tree_select(self, rel: Path | None, *, from_sidebar: bool = True) -> None:
        rr = self.state.repo_root.expanduser().resolve(strict=False)
        if rel is None:
            self._show_empty_selection()
            return

        if from_sidebar and self._any_dirty():
            self._set_status("已从树切换：未保存的编辑已丢弃", ok=False)

        mapped = try_load_fcstd_entry_from_workspace_map(repo_root=rr, rel_workspace=rel)
        if mapped is not None:
            entry = mapped
            note = "数据来源：fcstd_map.json · 嵌入式 XML 可对以下可编辑字段覆盖"
        else:
            entry = FcstdMapEntry.preview_from_workspace_relative(rel)
            note = "数据来源：文件名 / 仓库相对路径推断 · 嵌入式 XML（若存在）可覆盖下方可写字段"

        full = rr / rel
        disp = format_resolved_under_workspace(full, rr)

        self._preview_entry = entry
        self._current_rel = rel
        plain = self._entry_to_plain(entry)
        embedded: dict[str, str] = {}
        if full.is_file() and full.suffix.casefold() == ".fcstd":
            try:
                embedded = read_embedded_bom_attrs(full)
                if embedded:
                    note += "\n检测到 FcdeskBomAttrs.xml，可编辑字段以其中内容为准。"
            except FcdeskFcstdEmbeddedError as ex:
                self._set_status(f"嵌入式属性读取警告：{ex}", ok=False)
        merged = self._merge_embedded_over(plain, embedded)

        self._source_hint.configure(text=note)
        self._abs_path_label.configure(
            text=f"绝对路径（展示）\n{disp}",
            text_color=("gray12", "gray90"),
        )

        for k in merged:
            self._widget_set_value(k, merged[k])
        self._baseline = {k: merged[k] for k in _EDIT_KEYS}
        self._refresh_dirty_marks()
        self._set_btn_enabled_for_selection(full)

        self._configure_entry_widgets_editable(full)

        fcstd_note = ""
        if full.suffix.casefold() != ".fcstd":
            fcstd_note = "当前非 FCStd·保存不可用"
            self._set_status(fcstd_note, ok=False)
        else:
            self._set_status("已载入", ok=True)

    def _set_btn_enabled_for_selection(self, full: Path) -> None:
        can = full.is_file() and full.suffix.casefold() == ".fcstd"
        self._btn_save.configure(state="normal" if can else "disabled")

    def _configure_entry_widgets_editable(self, full: Path) -> None:
        can = full.is_file() and full.suffix.casefold() == ".fcstd"
        state = "normal" if can else "disabled"
        for k in _EDIT_KEYS:
            self._value_widgets[k].configure(state=state)

        # 只读展示列始终 readonly，便于选取复制（不因非 FCStd 而 disabled）
        for k in _READONLY_KEYS:
            self._value_widgets[k].configure(state="readonly")

    def _show_empty_selection(self) -> None:
        self._current_rel = None
        self._preview_entry = None
        self._baseline = {}
        self._source_hint.configure(text="")
        self._abs_path_label.configure(
            text="在右侧栏选中文件结点（目录结点不触发）。",
            text_color=("gray35", "gray72"),
        )
        for ak, _cn, _pascal_en, editable in _ATTR_ROWS:
            self._dirty_labels[ak].configure(text="", text_color=("gray60", "gray65"))
            w = self._value_widgets[ak]
            if editable:
                w.configure(state="normal")
                w.delete(0, "end")
                w.configure(state="disabled")
            else:
                w.configure(state="normal")
                w.delete(0, "end")
                w.insert(0, "—")
                w.configure(state="readonly")
        self._btn_save.configure(state="disabled")
        self._set_status("", ok=None)

    def _reload_disk(self) -> None:
        if self._current_rel is None:
            messagebox.showinfo("重新读取", "请先在右侧栏选择一个文件。", parent=self)
            return
        self.on_workspace_tree_select(self._current_rel, from_sidebar=False)
        self._set_status("已从磁盘重新读取", ok=True)

    def _save_zip(self) -> None:
        if self._current_rel is None or self._preview_entry is None:
            messagebox.showwarning("保存", "没有选中的文件。", parent=self)
            return
        rr = self.state.repo_root.expanduser().resolve(strict=False)
        full = rr / self._current_rel
        if not full.is_file() or full.suffix.casefold() != ".fcstd":
            messagebox.showwarning(
                "保存",
                "仅支持将可编辑字段写入 .FCStd（ZIP）。当前文件不适用。",
                parent=self,
            )
            return

        vals = self._collect_editable()
        try:
            write_embedded_bom_attrs(full, vals)
        except PermissionError as e:
            messagebox.showwarning(
                "保存失败",
                "没有权限改写文件（可能被占用）。\n请先关闭 FreeCAD 或其它占用该文件的程序。\n\n"
                f"{e}",
                parent=self,
            )
            self._set_status("保存失败：权限 / 占用", ok=False)
            return
        except OSError as e:
            messagebox.showerror("保存失败", str(e), parent=self)
            self._set_status("保存失败", ok=False)
            return
        except FcdeskFcstdEmbeddedError as e:
            messagebox.showerror("保存失败", str(e), parent=self)
            self._set_status("保存失败：ZIP/XML", ok=False)
            return

        self._baseline = {k: vals.get(k, "") for k in _EDIT_KEYS}
        self._refresh_dirty_marks()
        self._set_status("已写入 FcdeskBomAttrs.xml（ZIP 原子替换）", ok=True)
        messagebox.showinfo(
            "已保存",
            "属性已写入该 FCStd ZIP 内的 FcdeskBomAttrs.xml。\n"
            "下次在 FreeCAD 中打开前请确保已写完并关闭其它占用。",
            parent=self,
        )
