"""属性回写：侧栏选中文件后可编辑 BOM 字段，并写入 FCStd ZIP 内 ``Document.xml``
（挂载到 PartDesign::Body，或总成 ``Object.type`` 含 assembly / ``App::Part``，见 ``fcstd_document_bom_props``）。

``PartNumber`` / … / ``label``（Body 等挂载对象的 ``Label``）等与
``FcstdMapEntry`` / ``fcstd_map.json`` 键名一致；其余路径类字段仍为 snake_case。约定见 ``doc/cad/Phoenix嵌入式BOM属性约定.md``。
"""

from __future__ import annotations

from pathlib import Path
import sys

import customtkinter as ctk
from tkinter import Menu, TclError, messagebox

from phoenix.bom_apply_prefs import (
    default_bom_apply_prefs,
    load_bom_apply_field_defaults,
    recommend_field_fill_values,
    save_bom_apply_field_defaults,
)
from phoenix.config.user_prefs import format_resolved_under_workspace
from phoenix.fcstd_document_kind import (
    FcstdDocumentKinds,
    FcstdKindFilters,
    kinds_match_filters,
    read_fcstd_document_kinds,
    recommend_fcstd_filename_suffix,
)
from phoenix.fcstd_embedded_attrs import (
    EDITABLE_ENTRY_ATTRS,
    PhoenixFcstdEmbeddedError,
    read_embedded_bom_attrs,
    write_embedded_bom_attrs,
)
from phoenix.fcstd_mapping import (
    FcstdMapEntry,
    coerce_inferred_part_name,
    compose_fcstd_body_label_display,
    compose_fcstd_recommended_filename,
    format_recommended_filename_hint,
    infer_fcstd_name_suffix,
    rename_workspace_fcstd_file,
    try_load_fcstd_entry_from_workspace_map,
    try_update_fcstd_map_entry_rename,
)
from phoenix.pages.base import BasePage
from phoenix.pages import form_widgets as fw
from phoenix.shell.state import AppState

# (wire 键 snake_case ↔ JSON/XML；界面第二行英文名用大驼峰，与 FreeCAD Property 展示习惯一致)
_ATTR_ROWS: tuple[tuple[str, str, str, bool], ...] = (
    ("repo_rel_path", "仓库相对路径", "RepoRelativePath", False),
    ("filename", "文件名", "Filename", True),
    ("PartNumber", "零件号", "PartNumber", True),
    ("PartVersion", "版本", "PartVersion", True),
    ("TypeCode", "类型码 (H/S/R)", "TypeCode", True),
    ("ModelSeries", "型号系列", "ModelSeries", True),
    ("PartName", "零件名称", "PartName", True),
    ("label", "标签", "Label", True),
)

_EDIT_KEYS = frozenset(k for k, _cn, _pascal_en, editable in _ATTR_ROWS if editable)
_READONLY_KEYS = frozenset(k for k, _cn, _pascal_en, editable in _ATTR_ROWS if not editable)


def _context_menu_sequences() -> tuple[str, ...]:
    """右键弹出菜单所用事件（避免 Linux 上钩住 ``<Button-2>``，以免顶替中键粘贴）。"""
    if sys.platform == "darwin":
        return ("<Button-2>", "<Button-3>", "<Control-Button-1>")
    return ("<Button-3>",)


class _HoverTooltip:
    """轻量悬停提示（用于「推荐文件名」按钮预览）。"""

    def __init__(self, widget, text_getter) -> None:  # noqa: ANN001
        self._widget = widget
        self._text_getter = text_getter
        self._tip: ctk.CTkToplevel | None = None
        widget.bind("<Enter>", self._show, add="+")
        widget.bind("<Leave>", self._hide, add="+")

    def _show(self, _event=None) -> None:  # noqa: ANN001
        text = (self._text_getter() or "").strip()
        if not text:
            return
        if self._tip is not None:
            self._tip.destroy()
        tip = ctk.CTkToplevel(self._widget)
        tip.wm_overrideredirect(True)
        tip.attributes("-topmost", True)
        lbl = ctk.CTkLabel(
            tip,
            text=text,
            justify="left",
            anchor="w",
            font=ctk.CTkFont(size=11),
            corner_radius=6,
            fg_color=("gray92", "gray22"),
            text_color=("gray10", "gray90"),
            padx=10,
            pady=8,
        )
        lbl.pack()
        tip.update_idletasks()
        x = self._widget.winfo_rootx() + 8
        y = self._widget.winfo_rooty() + self._widget.winfo_height() + 4
        tip.geometry(f"+{x}+{y}")
        self._tip = tip

    def _hide(self, _event=None) -> None:  # noqa: ANN001
        if self._tip is not None:
            self._tip.destroy()
            self._tip = None


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

        self._var_kind_part = ctk.BooleanVar(value=True)
        self._var_kind_assembly = ctk.BooleanVar(value=True)
        self._var_kind_drawing = ctk.BooleanVar(value=True)

        kind_row = ctk.CTkFrame(wrap, fg_color="transparent")
        kind_row.grid(row=2, column=0, sticky="ew", pady=(0, 8))
        self._doc_kind_label = ctk.CTkLabel(
            kind_row,
            text="文档类型：—",
            anchor="w",
            font=ctk.CTkFont(size=11),
            text_color=("gray34", "gray68"),
        )
        self._doc_kind_label.pack(side="left", padx=(0, 12))
        ctk.CTkLabel(kind_row, text="读取/推荐时匹配：", font=ctk.CTkFont(size=11)).pack(side="left", padx=(0, 6))
        for text, var in (
            ("零件", self._var_kind_part),
            ("装配", self._var_kind_assembly),
            ("图纸", self._var_kind_drawing),
        ):
            ctk.CTkCheckBox(kind_row, text=text, variable=var, width=88).pack(side="left", padx=(0, 8))
        ctk.CTkButton(
            kind_row,
            text="识别类型",
            width=88,
            height=28,
            fg_color=("gray72", "gray38"),
            command=self._refresh_document_kinds_from_disk,
        ).pack(side="left", padx=(4, 0))

        btn_bar = ctk.CTkFrame(wrap, fg_color="transparent")
        btn_bar.grid(row=3, column=0, sticky="nw", pady=(0, 10))
        ctk.CTkButton(btn_bar, text="重新读取", width=100, fg_color=("gray72", "gray38"), command=self._reload_disk).grid(
            row=0,
            column=0,
            padx=(0, 10),
            pady=(0, 8),
        )
        self._btn_save = ctk.CTkButton(btn_bar, text="保存到 ZIP", width=112, command=self._save_zip)
        self._btn_save.grid(row=0, column=1, padx=(0, 10), pady=(0, 8))
        self._btn_embed_read = ctk.CTkButton(
            btn_bar,
            text="从ZIP内写入界面",
            width=138,
            command=self._fill_form_from_zip_embedded,
            fg_color=("gray72", "gray38"),
        )
        self._btn_embed_read.grid(row=0, column=2, padx=(0, 10), pady=(0, 8))
        self._btn_filename_hints = ctk.CTkButton(
            btn_bar,
            text="从文件名写入界面",
            width=138,
            command=self._fill_form_from_filename_hints,
            fg_color=("gray72", "gray38"),
        )
        self._btn_filename_hints.grid(row=0, column=3, padx=(0, 10), pady=(0, 8))
        self._btn_label_formula = ctk.CTkButton(
            btn_bar,
            text="Label←编号公式",
            width=128,
            command=self._apply_label_formula,
            fg_color=("gray70", "gray40"),
        )
        self._btn_label_formula.grid(row=0, column=4, padx=(0, 10), pady=(0, 8))
        self._btn_recommend_filename = ctk.CTkButton(
            btn_bar,
            text="推荐文件名",
            width=112,
            command=self._apply_recommended_filename,
            fg_color=("gray72", "gray38"),
        )
        self._btn_recommend_filename.grid(row=0, column=5, padx=(0, 10), pady=(0, 8))

        self._status_hint = ctk.CTkLabel(
            btn_bar,
            text="",
            anchor="w",
            font=ctk.CTkFont(size=12),
            text_color=("gray40", "gray65"),
        )
        self._status_hint.grid(row=0, column=6, padx=(8, 0), sticky="w", pady=(0, 8))

        self._abs_path_label = ctk.CTkLabel(
            wrap,
            text="",
            anchor="nw",
            justify="left",
            wraplength=900,
            font=ctk.CTkFont(size=12),
        )
        self._abs_path_label.grid(row=4, column=0, sticky="nw", pady=(0, 10))

        self._attrs_panel = ctk.CTkFrame(wrap, fg_color="transparent")
        self._attrs_panel.grid(row=5, column=0, sticky="ew", pady=(0, 8))
        self._attrs_panel.grid_columnconfigure(2, weight=1)

        self._dirty_labels: dict[str, ctk.CTkLabel] = {}
        self._value_widgets: dict[str, ctk.CTkEntry] = {}
        self._filename_recommend_hint: ctk.CTkLabel | None = None
        self._btn_rename_file: ctk.CTkButton | None = None

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
        extra_rows = 0
        for j, (attr_key, caption_cn, pascal_en, editable_) in enumerate(_ATTR_ROWS):
            i = grid_row_start + j + extra_rows
            marker = ctk.CTkLabel(self._attrs_panel, text="", width=18, anchor="center", font=("Arial", 16))
            marker.grid(row=i, column=0, sticky="n", padx=(0, 4), pady=(6, 0))
            self._dirty_labels[attr_key] = marker

            meta = ctk.CTkFrame(self._attrs_panel, fg_color="transparent")
            meta.grid(row=i, column=1, sticky="nw", padx=(0, 12), pady=(4, 6))
            ctk.CTkLabel(meta, text=caption_cn, anchor="w", font=ctk.CTkFont(size=13)).pack(anchor="w")
            ctk.CTkLabel(meta, text=pascal_en, anchor="w", font=mono, text_color=sub_gray).pack(anchor="w")

            widget = ctk.CTkEntry(self._attrs_panel, height=28)
            if attr_key == "filename":
                widget.grid(row=i, column=2, columnspan=1, sticky="ew", padx=(0, 4), pady=(4, 6))
                self._btn_rename_file = ctk.CTkButton(
                    self._attrs_panel,
                    text="改名",
                    width=56,
                    height=28,
                    command=self._rename_disk_file,
                    fg_color=("gray70", "gray40"),
                )
                self._btn_rename_file.grid(row=i, column=3, sticky="e", padx=(0, 6), pady=(4, 6))
            else:
                widget.grid(row=i, column=2, columnspan=2, sticky="ew", padx=(0, 6), pady=(4, 6))
            if editable_:
                widget.bind("<KeyRelease>", lambda _e, k=attr_key: self._touch_field(k))
                widget.bind("<<Paste>>", lambda _e, k=attr_key: self.after(50, lambda: self._touch_field(k)))
            else:
                widget.configure(state="readonly")

            self._bind_field_copy_menu(widget)
            self._value_widgets[attr_key] = widget

            if attr_key == "filename":
                self._filename_recommend_hint = ctk.CTkLabel(
                    self._attrs_panel,
                    text="",
                    anchor="nw",
                    justify="left",
                    wraplength=820,
                    font=ctk.CTkFont(size=11),
                    text_color=("gray34", "gray68"),
                )
                self._filename_recommend_hint.grid(
                    row=i + 1,
                    column=0,
                    columnspan=4,
                    sticky="ew",
                    padx=(28, 6),
                    pady=(0, 6),
                )
                extra_rows += 1

        _HoverTooltip(self._btn_recommend_filename, self._filename_recommend_tooltip_text)

        fw.page_hint_label(
            root_scroll,
            (
                "表格第二列为 PartNumber / PartVersion …（大驼峰），与 FreeCAD 属性面板可读名一致；"
                "``fcstd_map.json`` 中可写字段键名为 ``PartNumber``、``PartVersion``、``TypeCode``、``PartName`` 等"
                "（见大驼峰列；``label`` 对应 Body 的 ``Label``）。若 ``PartName`` 为空保存时会按当前 ``Label`` 写入 Document。\n"
                "载入时若文档无 ``PartName``，界面用 ``Label`` 预填。**Label←编号公式**：``PartNumber.PartVersion-{PartName}``（名为空则用标签）。\n"
                "在右侧栏选中 ``.FCStd`` 后可编辑零件号…型号系列 · 零件名称 · 标签 · **文件名**（可手改，不写 ZIP）。\n"
                "各字段值可为文本框；「仓库相对路径」为只读。\n"
                "可复制：拖选后用快捷键，或在框内右键点「复制」；若无选区则复制整框内容。\n"
                "**从ZIP内写入界面**：仅从当前包内 Document / 旧侧车读取可写字段，覆盖下方表单（不写盘）；无有效字段时会提示。\n"
                "**从文件名写入界面**：按 ``fcstd_mapping`` 规则从文件名与仓库路径推断零件号「版本」「类型」「型号」等并填入（不写盘）；推断不出内容时会提示。\n"
                "**推荐文件名**：按 ``PartNumber.PartVersion[-TypeCode][-ModelSeries]-名称`` 拼出推荐名；"
                "空字段会先填入工作空间记忆：**上次零件号 +1**、版本默认 **001**、类型默认 **H**、**上次型号**（存于 ``.phoenix/phoenix-workspace-prefs.json`` 的 ``bom_apply``）。\n"
                "后缀由 **Document.xml 识别类型** 决定（装配 ``.ASSY.FCStd``、图纸 ``.Drawing.FCStd``、零件 ``.FCStd``），"
                "上方勾选用于过滤「从 ZIP 读取 / 推荐文件名」是否对该类型生效；选中文件时会自动识别类型（亦可点「识别类型」）。\n"
                "「推荐文件名」仅填入文件名字段；**改名** 前有未写入属性时会询问是否**写入并改名**。\n"
                "保存将把属性写入 ``Document.xml`` 内 BOM 挂载对象的 Property（Body → type 含 assembly → App::Part）。"
                "``PartNumber`` 等与手动「添加属性」一致：**组**默认为 **「CustomDefine」**（常量 ``PHOENIX_EMBEDDED_BOM_PROPERTY_GROUP``），**工具提示**写入 ``Property/@doc``。 "
                "若包内仍存在旧版 ``FcdeskBomAttrs.xml``，保存时会移除该文件并完成迁移。\n"
                "若 FreeCAD 正打开该文件，保存常因占用失败——请先关闭 FreeCAD 或其它占用程序。\n"
                "切换到树中另一个文件而未保存将丢弃当前未保存改动。"
            ),
            wraplength=920,
        ).grid(row=2, column=0, sticky="ew", padx=24, pady=(16, 24))

        self._current_rel: Path | None = None
        self._preview_entry: FcstdMapEntry | None = None
        self._baseline: dict[str, str] = {}
        self._original_disk_filename: str = ""
        self._current_document_kinds: FcstdDocumentKinds | None = None
        self._bom_field_defaults: dict[str, str] = default_bom_apply_prefs()
        self._reload_bom_apply_prefs()
        self._show_empty_selection()

    def on_show(self) -> None:
        self._reload_bom_apply_prefs()

    def _reload_bom_apply_prefs(self) -> None:
        rr = self.state.repo_root.expanduser().resolve(strict=False)
        self._bom_field_defaults = load_bom_apply_field_defaults(rr)

    def _fill_empty_bom_fields_from_prefs(self) -> list[str]:
        """将空着的零件号/版本/类型/型号用工作空间记忆或默认值填入界面。"""
        fills = recommend_field_fill_values(self._bom_field_defaults)
        touched: list[str] = []
        for key in ("PartNumber", "PartVersion", "TypeCode", "ModelSeries"):
            w = self._value_widgets[key]
            if w.get().strip():
                continue
            val = fills.get(key, "")
            if not val:
                continue
            self._widget_set_value(key, val)
            touched.append(key)
        if touched:
            self._refresh_dirty_marks()
        return touched

    def _persist_bom_apply_prefs_from_form(self) -> None:
        save_bom_apply_field_defaults(
            self.state.repo_root,
            part_number=self._value_widgets["PartNumber"].get(),
            part_version=self._value_widgets["PartVersion"].get(),
            type_code=self._value_widgets["TypeCode"].get(),
            model_series=self._value_widgets["ModelSeries"].get(),
        )
        self._reload_bom_apply_prefs()

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

    def _has_unsaved_document_attrs(self) -> bool:
        """``Document.xml`` 可写字段相对上次载入/保存基线有改动（不含仅改文件名字段）。"""
        for k in EDITABLE_ENTRY_ATTRS:
            w = self._value_widgets[k]
            if w.get().strip() != self._baseline.get(k, ""):
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

    def _kind_filters(self) -> FcstdKindFilters:
        return FcstdKindFilters(
            part=bool(self._var_kind_part.get()),
            assembly=bool(self._var_kind_assembly.get()),
            drawing=bool(self._var_kind_drawing.get()),
        )

    def _update_doc_kind_label(self) -> None:
        k = self._current_document_kinds
        if k is None:
            self._doc_kind_label.configure(text="文档类型：—（非 FCStd 或未识别）")
            return
        suf = recommend_fcstd_filename_suffix(k)
        self._doc_kind_label.configure(text=f"文档类型：{k.display_text()} · 推荐后缀 {suf}")

    def _refresh_document_kinds_from_disk(self) -> None:
        if self._current_rel is None:
            messagebox.showinfo("识别类型", "请先在右侧栏选择一个文件。", parent=self)
            return
        rr = self.state.repo_root.expanduser().resolve(strict=False)
        full = rr / self._current_rel
        if not full.is_file() or full.suffix.casefold() != ".fcstd":
            self._current_document_kinds = None
            self._update_doc_kind_label()
            messagebox.showwarning("识别类型", "仅支持 .FCStd 族文件。", parent=self)
            return
        self._current_document_kinds = read_fcstd_document_kinds(full)
        self._update_doc_kind_label()
        self._set_status(f"已识别：{self._current_document_kinds.display_text()}", ok=True)

    def _ensure_kinds_allow_operation(self, op_name: str) -> bool:
        if self._current_document_kinds is None:
            return True
        if kinds_match_filters(self._current_document_kinds, self._kind_filters()):
            return True
        detected = self._current_document_kinds.display_text()
        messagebox.showinfo(
            op_name,
            f"当前文件识别为「{detected}」，与已勾选的文档类型不一致。\n"
            "请调整上方类型勾选，或换选匹配的文件。",
            parent=self,
        )
        return False

    def _recommended_suffix_for_current_file(self) -> str:
        if self._current_document_kinds is not None:
            k = self._current_document_kinds
            if kinds_match_filters(k, self._kind_filters()):
                return recommend_fcstd_filename_suffix(k)
        cur_name = self._value_widgets["filename"].get().strip()
        if cur_name in ("", "—"):
            cur_name = self._original_disk_filename
        return infer_fcstd_name_suffix(cur_name or self._original_disk_filename or "x.FCStd")

    def _clear_filename_recommend_hint(self) -> None:
        if self._filename_recommend_hint is not None:
            self._filename_recommend_hint.configure(text="")

    def _filename_form_values(self) -> dict[str, str]:
        return {
            "PartNumber": self._value_widgets["PartNumber"].get().strip(),
            "PartVersion": self._value_widgets["PartVersion"].get().strip(),
            "TypeCode": self._value_widgets["TypeCode"].get().strip(),
            "ModelSeries": self._value_widgets["ModelSeries"].get().strip(),
            "PartName": self._value_widgets["PartName"].get().strip(),
            "label": self._value_widgets["label"].get().strip(),
        }

    def _build_recommended_filename(self) -> tuple[str | None, str]:
        """返回 ``(推荐文件名, 扩展名)``；无法拼出时 ``(None, suffix)``。"""
        cur_name = self._value_widgets["filename"].get().strip()
        if cur_name in ("", "—"):
            cur_name = self._original_disk_filename
        suffix = self._recommended_suffix_for_current_file()
        vals = self._filename_form_values()
        built = compose_fcstd_recommended_filename(
            part_number=vals["PartNumber"],
            part_version=vals["PartVersion"],
            type_code=vals["TypeCode"],
            model_series=vals["ModelSeries"],
            part_name=vals["PartName"],
            label_fallback=vals["label"],
            suffix=suffix,
        )
        return built, suffix

    def _filename_recommend_hint_text(self, recommended: str, suffix: str) -> str:
        vals = self._filename_form_values()
        orig = self._original_disk_filename or self._baseline.get("filename", "")
        if orig == "—":
            orig = ""
        kind_line = ""
        if self._current_document_kinds is not None:
            kind_line = (
                f"\n文档类型：{self._current_document_kinds.display_text()} · "
                f"推荐后缀 {recommend_fcstd_filename_suffix(self._current_document_kinds)}"
            )
        return (
            format_recommended_filename_hint(
                original_filename=orig,
                recommended_filename=recommended,
                part_number=vals["PartNumber"],
                part_version=vals["PartVersion"],
                type_code=vals["TypeCode"],
                model_series=vals["ModelSeries"],
                part_name=vals["PartName"],
                label=vals["label"],
                suffix=suffix,
            )
            + kind_line
        )

    def _filename_recommend_tooltip_text(self) -> str:
        built, suffix = self._build_recommended_filename()
        if not built:
            return "需要非空的零件号与版本才能推荐文件名。"
        return self._filename_recommend_hint_text(built, suffix)

    def _show_filename_recommend_hint(self, recommended: str, suffix: str) -> None:
        if self._filename_recommend_hint is None:
            return
        self._filename_recommend_hint.configure(text=self._filename_recommend_hint_text(recommended, suffix))

    def _entry_to_plain(self, e: FcstdMapEntry) -> dict[str, str]:
        return {
            "repo_rel_path": str(e.repo_rel_path or ""),
            "filename": str(e.filename or ""),
            "PartNumber": str(e.PartNumber or ""),
            "PartVersion": str(e.PartVersion or ""),
            "TypeCode": str(e.TypeCode or ""),
            "ModelSeries": str(e.ModelSeries or ""),
            "PartName": str(e.PartName or ""),
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
            note = "数据来源：fcstd_map.json · Document.xml（挂载对象 Property）可对以下可编辑字段覆盖"
        else:
            entry = FcstdMapEntry.preview_from_workspace_relative(rel)
            note = "数据来源：文件名 / 仓库相对路径推断 · Document.xml 挂载对象字段（若有）可覆盖下方可写字段"

        full = rr / rel
        disp = format_resolved_under_workspace(full, rr)

        self._preview_entry = entry
        self._current_rel = rel
        self._original_disk_filename = rel.name
        if full.is_file() and full.suffix.casefold() == ".fcstd":
            self._current_document_kinds = read_fcstd_document_kinds(full)
        else:
            self._current_document_kinds = None
        self._update_doc_kind_label()
        plain = self._entry_to_plain(entry)
        embedded: dict[str, str] = {}
        if full.is_file() and full.suffix.casefold() == ".fcstd":
            try:
                embedded = read_embedded_bom_attrs(full)
                if embedded:
                    note += "\n已读取 Document.xml / 遗留侧车内的可写字段。"
            except PhoenixFcstdEmbeddedError as ex:
                self._set_status(f"嵌入式属性读取警告：{ex}", ok=False)
        merged = self._merge_embedded_over(plain, embedded)
        merged = self._merged_with_partname_coerce(merged)

        self._source_hint.configure(text=note)
        self._abs_path_label.configure(
            text=f"绝对路径（展示）\n{disp}",
            text_color=("gray12", "gray90"),
        )

        for k in merged:
            self._widget_set_value(k, merged[k])
        self._baseline = {k: merged[k] for k in _EDIT_KEYS}
        self._clear_filename_recommend_hint()
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
        self._btn_label_formula.configure(state="normal" if can else "disabled")
        self._btn_embed_read.configure(state="normal" if can else "disabled")
        self._btn_filename_hints.configure(state="normal" if can else "disabled")
        self._btn_recommend_filename.configure(state="normal" if can else "disabled")
        if self._btn_rename_file is not None:
            self._btn_rename_file.configure(state="normal" if can else "disabled")

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
        self._original_disk_filename = ""
        self._current_document_kinds = None
        self._update_doc_kind_label()
        self._clear_filename_recommend_hint()
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
        self._btn_label_formula.configure(state="disabled")
        self._btn_embed_read.configure(state="disabled")
        self._btn_filename_hints.configure(state="disabled")
        self._btn_recommend_filename.configure(state="disabled")
        if self._btn_rename_file is not None:
            self._btn_rename_file.configure(state="disabled")
        self._set_status("", ok=None)

    def _reload_disk(self) -> None:
        if self._current_rel is None:
            messagebox.showinfo("重新读取", "请先在右侧栏选择一个文件。", parent=self)
            return
        self.on_workspace_tree_select(self._current_rel, from_sidebar=False)
        self._set_status("已从磁盘重新读取", ok=True)

    def _merged_with_partname_coerce(self, row: dict[str, str]) -> dict[str, str]:
        merged = dict(row)
        inferred = coerce_inferred_part_name(
            merged.get("PartName"),
            merged.get("label"),
            filename=merged.get("filename"),
            repo_rel_path=merged.get("repo_rel_path"),
            part_number=merged.get("PartNumber"),
            part_version=merged.get("PartVersion"),
            type_code=merged.get("TypeCode"),
            model_series=merged.get("ModelSeries"),
        )
        if inferred:
            merged["PartName"] = inferred
        return merged

    def _push_merged_into_form(self, merged: dict[str, str]) -> None:
        for k in merged:
            self._widget_set_value(k, merged[k])
        self._baseline = {k: merged[k] for k in _EDIT_KEYS}
        self._refresh_dirty_marks()

    def _fill_form_from_zip_embedded(self) -> None:
        """将 Document.xml / 旧侧车内的可写字段读入表单（与选中时合并规则一致，但不重新走整页载入）。"""
        rel = self._current_rel
        if rel is None:
            messagebox.showinfo("从 ZIP 嵌入读取", "请先在右侧栏选择一个文件。", parent=self)
            return
        rr = self.state.repo_root.expanduser().resolve(strict=False)
        full = rr / rel
        if not full.is_file() or full.suffix.casefold() != ".fcstd":
            messagebox.showwarning("从 ZIP 嵌入读取", "请先选中一个 .FCStd 文件。", parent=self)
            return
        if self._current_document_kinds is None:
            self._current_document_kinds = read_fcstd_document_kinds(full)
            self._update_doc_kind_label()
        if not self._ensure_kinds_allow_operation("从 ZIP 嵌入读取"):
            return
        try:
            embedded = read_embedded_bom_attrs(full)
        except PhoenixFcstdEmbeddedError as ex:
            messagebox.showerror("从 ZIP 嵌入读取", str(ex), parent=self)
            self._set_status("嵌入读取失败", ok=False)
            return
        if not any((embedded.get(k) or "").strip() for k in EDITABLE_ENTRY_ATTRS):
            messagebox.showinfo(
                "从 ZIP 嵌入读取",
                "当前包内 Document.xml / FcdeskBomAttrs.xml 无可读 BOM 字段（均为空）。",
                parent=self,
            )
            return
        mapped = try_load_fcstd_entry_from_workspace_map(repo_root=rr, rel_workspace=rel)
        if mapped is not None:
            plain = self._entry_to_plain(mapped)
        else:
            plain = self._entry_to_plain(FcstdMapEntry.preview_from_workspace_relative(rel))
        merged = self._merged_with_partname_coerce(self._merge_embedded_over(plain, embedded))
        self._push_merged_into_form(merged)
        self._set_status("已从 ZIP 嵌入属性填入界面（尚未保存到磁盘）", ok=True)

    def _fill_form_from_filename_hints(self) -> None:
        """按文件名与路径推断规则填入界面（不读 Document，也不写盘）。"""
        rel = self._current_rel
        if rel is None:
            messagebox.showinfo("从文件名写入", "请先在右侧栏选择一个文件。", parent=self)
            return
        rr = self.state.repo_root.expanduser().resolve(strict=False)
        full = rr / rel
        if not full.is_file() or full.suffix.casefold() != ".fcstd":
            messagebox.showwarning("从文件名写入", "请先选中一个 .FCStd 文件。", parent=self)
            return
        entry = FcstdMapEntry.preview_from_workspace_relative(rel)
        plain = self._entry_to_plain(entry)
        if not any((plain.get(k) or "").strip() for k in EDITABLE_ENTRY_ATTRS):
            messagebox.showinfo(
                "从文件名写入",
                "未能从当前文件名或仓库路径识别出 BOM 字段（如零件号、三位版本、H/S/R、型号片段等）。",
                parent=self,
            )
            return
        self._preview_entry = entry
        merged = self._merged_with_partname_coerce(plain)
        self._push_merged_into_form(merged)
        self._set_status("已从文件名 / 路径推断填入界面（尚未写入 ZIP）", ok=True)

    def _apply_label_formula(self) -> None:
        if self._current_rel is None:
            messagebox.showinfo("编号公式", "请先在右侧栏选择一个文件。", parent=self)
            return
        self._fill_empty_bom_fields_from_prefs()
        pn = self._value_widgets["PartNumber"].get()
        pv = self._value_widgets["PartVersion"].get()
        pnm = self._value_widgets["PartName"].get()
        lb = self._value_widgets["label"].get()
        built = compose_fcstd_body_label_display(
            part_number=pn,
            part_version=pv,
            part_name=pnm,
            label_fallback=lb,
        )
        if built is None:
            messagebox.showwarning(
                "编号公式",
                "需要非空的零件号与版本，才能拼接为 Label。\n格式：PartNumber.PartVersion-PartName\n"
                "（PartName 若为空则用当前 Label 填入连字符后那一段。）",
                parent=self,
            )
            return
        self._widget_set_value("label", built)
        self._touch_field("label")
        self._refresh_dirty_marks()
        self._set_status(f"Label 已填为「{built}」（未写入 ZIP）", ok=True)

    def _apply_recommended_filename(self) -> None:
        if self._current_rel is None:
            messagebox.showinfo("推荐文件名", "请先在右侧栏选择一个文件。", parent=self)
            return
        rr = self.state.repo_root.expanduser().resolve(strict=False)
        full = rr / self._current_rel
        if full.is_file() and full.suffix.casefold() == ".fcstd":
            if self._current_document_kinds is None:
                self._current_document_kinds = read_fcstd_document_kinds(full)
                self._update_doc_kind_label()
            if not self._ensure_kinds_allow_operation("推荐文件名"):
                return
        filled = self._fill_empty_bom_fields_from_prefs()
        built, suffix = self._build_recommended_filename()
        if not built:
            messagebox.showwarning(
                "推荐文件名",
                "需要非空的零件号（PartNumber）与版本（PartVersion）才能拼接文件名。\n"
                "格式：PartNumber.PartVersion[-TypeCode][-ModelSeries]-名称"
                f"{suffix}",
                parent=self,
            )
            return
        self._widget_set_value("filename", built)
        self._show_filename_recommend_hint(built, suffix)
        self._touch_field("filename")
        self._persist_bom_apply_prefs_from_form()
        status = f"文件名已填入「{built}」"
        if filled:
            status = f"已用记忆值补全：{', '.join(filled)}；{status}"
        if built == (self._original_disk_filename or self._current_rel.name):
            status += "（与磁盘当前名称一致）"
        else:
            status += "（未改磁盘；请先保存属性到 ZIP，再点「改名」）"
        self._set_status(status, ok=True)

    def _rename_disk_file(self, *, confirm: bool = True) -> None:
        if self._current_rel is None:
            messagebox.showinfo("改名", "请先在右侧栏选择一个文件。", parent=self)
            return
        if self._has_unsaved_document_attrs():
            if not messagebox.askyesno(
                "改名",
                "当前有尚未写入 ZIP 的属性（零件号、版本、类型、标签等）。\n\n"
                "是否先写入 Document.xml，再重命名磁盘文件？",
                parent=self,
            ):
                self._set_status("改名已取消", ok=False)
                return
            if not self._save_zip(silent=True):
                messagebox.showwarning("改名", "写入属性失败，已取消改名。", parent=self)
                return
        new_name = self._value_widgets["filename"].get().strip()
        if new_name in ("", "—"):
            messagebox.showwarning("改名", "请先填写目标文件名。", parent=self)
            return
        old_name = self._original_disk_filename or self._current_rel.name
        if new_name == old_name:
            messagebox.showinfo("改名", "文件名与磁盘上当前名称相同，无需重命名。", parent=self)
            return
        if confirm and not messagebox.askyesno(
            "改名",
            f"将重命名磁盘文件：\n\n{old_name}\n    ↓\n{new_name}\n\n"
            f"相对路径：{(self._current_rel.parent / new_name).as_posix()}\n\n"
            "请确认 FreeCAD 等程序已关闭对该文件的占用。",
            parent=self,
        ):
            return

        rr = self.state.repo_root.expanduser().resolve(strict=False)
        old_rel = self._current_rel
        try:
            new_rel = rename_workspace_fcstd_file(
                repo_root=rr,
                rel=old_rel,
                new_basename=new_name,
            )
        except ValueError as ex:
            messagebox.showwarning("改名", str(ex), parent=self)
            self._set_status("改名失败：文件名无效", ok=False)
            return
        except FileNotFoundError as ex:
            messagebox.showerror("改名", str(ex), parent=self)
            self._set_status("改名失败：源文件不存在", ok=False)
            return
        except FileExistsError as ex:
            messagebox.showwarning("改名", str(ex), parent=self)
            self._set_status("改名失败：目标已存在", ok=False)
            return
        except PermissionError as ex:
            messagebox.showwarning(
                "改名失败",
                "没有权限重命名（可能被占用）。\n请先关闭 FreeCAD 或其它占用该文件的程序。\n\n"
                f"{ex}",
                parent=self,
            )
            self._set_status("改名失败：权限 / 占用", ok=False)
            return
        except OSError as ex:
            messagebox.showerror("改名失败", str(ex), parent=self)
            self._set_status("改名失败", ok=False)
            return

        map_updated = try_update_fcstd_map_entry_rename(repo_root=rr, old_rel=old_rel, new_rel=new_rel)
        shell = self.winfo_toplevel()
        if hasattr(shell, "refresh_workspace_tree_and_select"):
            shell.refresh_workspace_tree_and_select(new_rel)
        self.on_workspace_tree_select(new_rel, from_sidebar=False)
        note = f"已重命名为 {new_name}"
        if map_updated:
            note += "（已更新 fcstd_map.json）"
        self._set_status(note, ok=True)

    def _save_zip(self, *, silent: bool = False) -> bool:
        if self._current_rel is None or self._preview_entry is None:
            if not silent:
                messagebox.showwarning("保存", "没有选中的文件。", parent=self)
            return False
        rr = self.state.repo_root.expanduser().resolve(strict=False)
        full = rr / self._current_rel
        if not full.is_file() or full.suffix.casefold() != ".fcstd":
            if not silent:
                messagebox.showwarning(
                    "保存",
                    "仅支持将可编辑字段写入 .FCStd（ZIP）。当前文件不适用。",
                    parent=self,
                )
            return False

        vals = self._collect_editable()
        inferred = coerce_inferred_part_name(
            vals.get("PartName"),
            vals.get("label"),
            part_number=vals.get("PartNumber"),
            part_version=vals.get("PartVersion"),
            type_code=vals.get("TypeCode"),
            model_series=vals.get("ModelSeries"),
        )
        if inferred and not vals.get("PartName", "").strip():
            vals["PartName"] = inferred
        try:
            write_embedded_bom_attrs(full, vals)
        except PermissionError as e:
            if not silent:
                messagebox.showwarning(
                    "保存失败",
                    "没有权限改写文件（可能被占用）。\n请先关闭 FreeCAD 或其它占用该文件的程序。\n\n"
                    f"{e}",
                    parent=self,
                )
            self._set_status("保存失败：权限 / 占用", ok=False)
            return False
        except OSError as e:
            if not silent:
                messagebox.showerror("保存失败", str(e), parent=self)
            self._set_status("保存失败", ok=False)
            return False
        except PhoenixFcstdEmbeddedError as e:
            if not silent:
                messagebox.showerror("保存失败", str(e), parent=self)
            self._set_status("保存失败：ZIP/XML", ok=False)
            return False

        self._baseline = {k: vals.get(k, "") for k in _EDIT_KEYS}
        self._refresh_dirty_marks()
        self._persist_bom_apply_prefs_from_form()
        self._set_status("已写入 Document.xml（ZIP 原子替换）", ok=True)
        if not silent:
            messagebox.showinfo(
                "已保存",
                "属性已写入该 FCStd 包内 Document.xml（挂载对象下的 Property）。\n"
                "下次在 FreeCAD 中打开前请确保已写完并关闭其它占用。",
                parent=self,
            )
        return True
