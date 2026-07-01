import { computed, type ComputedRef } from "vue";
import { nlsKeyForProp, nlsPathSegments, type NlsStringProp } from "@phoenix/catdlg-core";
import { caaServicePropertyGroup } from "./caaServicePropertyGroup";
import { usePnwPagePropertySheet } from "phoenix-wing";
import { useCaaDialogPageStore } from "../stores/caaDialogPage";
import {
  formatGrid,
  formatIntList,
  resolveSelectedNode,
} from "../utils/caaDialogTree";
import { catDlgDirRel } from "../utils/caaDialogDisplay";
import { pnwPropGroup, pnwPropReadonly, pnwPropSheet, pnwPropString } from "phoenix-wing";

function dash(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  return String(value);
}

export type CaaNlsFieldChange = {
  nodeId: string;
  prop: NlsStringProp;
  key: string;
  value: string;
  columnIndex?: number;
};

/** CAA 对话框 · 侧栏属性（选中控件 + 对话框元数据） */
export function useCaaDialogPropertySheet(
  pageId: string,
  opts?: {
    onNlsChange?: (change: CaaNlsFieldChange) => void;
  },
) {
  const store = useCaaDialogPageStore();

  const selectedNode = computed(() => resolveSelectedNode(store.ir, store.selectedId));

  const hasSelection = computed(() => Boolean(selectedNode.value));
  const hasGrid = computed(() => Boolean(selectedNode.value?.grid));
  const hasGridLayout = computed(
    () =>
      Boolean(
        selectedNode.value?.gridLayout?.rowResizable?.length ||
          selectedNode.value?.gridLayout?.colResizable?.length,
      ),
  );
  const hasSize = computed(() => Boolean(selectedNode.value?.size));
  const bindingCount = computed(() => store.ir?.parseMeta?.bindings?.length ?? 0);
  const selectedBindings = computed(() => {
    const nodeId = selectedNode.value?.id;
    if (!nodeId) return [];
    return (store.ir?.parseMeta?.bindings ?? []).filter(
      (b) => b.nodeId === nodeId || b.controlId === nodeId,
    );
  });

  function bindingSourceLabel(source: string | undefined): string {
    if (source === "updateDialog") return "UpdateDialog";
    if (source === "kevinWizard") return "KEVIN WIZARD";
    return "heuristic";
  }

  function formatBindingLines(
    bindings: NonNullable<NonNullable<typeof store.ir>["parseMeta"]>["bindings"],
  ): string {
    if (!bindings?.length) return "-";
    return bindings
      .map((b) => {
        const where = `${bindingSourceLabel(b.source)}${b.line ? `:${b.line}` : ""}`;
        const raw = b.text ? `\n${b.text}` : "";
        return `${b.target} · ${where}${raw}`;
      })
      .join("\n\n");
  }

  /** 选中控件各 NLS 属性的键 */
  const nlsKeyTitle = computed(() => {
    const node = selectedNode.value;
    if (!node || !store.ir) return "";
    return nlsKeyForProp(nlsPathSegments(node, store.ir.root), "title");
  });
  const nlsKeyHelp = computed(() => {
    const node = selectedNode.value;
    if (!node || !store.ir) return "";
    return nlsKeyForProp(nlsPathSegments(node, store.ir.root), "help");
  });
  const nlsKeyShortHelp = computed(() => {
    const node = selectedNode.value;
    if (!node || !store.ir) return "";
    return nlsKeyForProp(nlsPathSegments(node, store.ir.root), "shortHelp");
  });
  const nlsKeyLongHelp = computed(() => {
    const node = selectedNode.value;
    if (!node || !store.ir) return "";
    return nlsKeyForProp(nlsPathSegments(node, store.ir.root), "longHelp");
  });

  function nlsChange(prop: NlsStringProp, key: ComputedRef<string>, value: string) {
    const node = selectedNode.value;
    if (!node) return;
    opts?.onNlsChange?.({ nodeId: node.id, prop, key: key.value, value });
  }

  usePnwPagePropertySheet(pageId, () =>
    pnwPropSheet(
      [
        pnwPropGroup("dialog", "对话框", [
          pnwPropReadonly("dialog_name", "名称", {
            value: computed(() => dash(store.ir?.dialogName)),
            mono: true,
          }),
          pnwPropReadonly("dialog_title", "标题", {
            value: computed(() => dash(store.ir?.title)),
          }),
          pnwPropReadonly("catdlg_dir", ".CATDlg 目录", {
            value: computed(() => {
              const rel = store.ir?.sources.catDlg;
              if (!rel) return "—";
              return catDlgDirRel(rel) || "—";
            }),
            mono: true,
            hidden: computed(() => !store.ir?.sources.catDlg),
          }),
          pnwPropReadonly("catdlg_source", ".CATDlg", {
            value: computed(() => dash(store.ir?.sources.catDlg)),
            mono: true,
          }),
          pnwPropReadonly("catnls_source", ".CATNls", {
            value: computed(() => dash(store.ir?.sources.catNls)),
            mono: true,
            hidden: computed(() => !store.ir?.sources.catNls),
          }),
          pnwPropReadonly("catrsc_source", ".CATRsc", {
            value: computed(() => dash(store.ir?.sources.catRsc)),
            mono: true,
            hidden: computed(() => !store.ir?.sources.catRsc),
          }),
          pnwPropReadonly("binding_count", "字段绑定", {
            value: computed(() => bindingCount.value),
            hidden: computed(() => bindingCount.value === 0),
          }),
          pnwPropReadonly("nls_locales", "NLS 语言", {
            value: computed(() => {
              const locales = store.ir?.parseMeta?.locales;
              if (!locales?.length) return "—";
              return locales.map((l) => `${l.id} (${l.keyCount})`).join(" · ");
            }),
            hidden: computed(() => !store.ir?.parseMeta?.locales.length),
          }),
          pnwPropReadonly("bitmap_dirs", "位图目录", {
            value: computed(() => {
              const dirs = store.ir?.parseMeta?.bitmapDirs;
              if (!dirs?.length) return "—";
              const n = store.ir?.parseMeta?.bitmapFileCount ?? 0;
              return `${dirs.length} 个目录 · ${n} 个文件`;
            }),
            hidden: computed(() => !store.ir?.parseMeta?.bitmapDirs.length),
          }),
        ]),
        caaServicePropertyGroup(),
        pnwPropGroup("selection", "选中控件", [
          pnwPropReadonly("ctrl_id", "ID", {
            value: computed(() => dash(selectedNode.value?.id)),
            mono: true,
            labelTone: "emphasis",
          }),
          pnwPropReadonly("ctrl_type", "类型", {
            value: computed(() => dash(selectedNode.value?.type)),
            mono: true,
          }),
          pnwPropReadonly("ctrl_father", "父控件", {
            value: computed(() => dash(selectedNode.value?.father)),
            mono: true,
            hidden: computed(() => !selectedNode.value?.father),
          }),
          pnwPropReadonly("ctrl_style", "STYLE", {
            value: computed(() => dash(selectedNode.value?.style?.join(" | "))),
            mono: true,
            hidden: computed(() => !selectedNode.value?.style?.length),
          }),
        ], { hidden: computed(() => !hasSelection.value) }),
        pnwPropGroup("bindings", "字段绑定（只读）", [
          pnwPropReadonly("selected_bindings", "绑定", {
            value: computed(() => formatBindingLines(selectedBindings.value)),
            mono: true,
            multiline: true,
          }),
        ], { hidden: computed(() => selectedBindings.value.length === 0) }),
        pnwPropGroup(
          "nls",
          "文案 (NLS)",
          [
            pnwPropString("nls_title", "Title", {
              value: computed(() => selectedNode.value?.nls?.title ?? ""),
              onChange: (v) => nlsChange("title", nlsKeyTitle, v),
              placeholder: "控件标签文本",
            }),
            pnwPropString("nls_help", "Help（提示）", {
              value: computed(() => selectedNode.value?.nls?.help ?? ""),
              onChange: (v) => nlsChange("help", nlsKeyHelp, v),
              placeholder: "悬停提示",
              hint: "鼠标悬停时显示的完整提示文本",
            }),
            pnwPropString("nls_short", "ShortHelp（简短提示）", {
              value: computed(() => selectedNode.value?.nls?.shortHelp ?? ""),
              onChange: (v) => nlsChange("shortHelp", nlsKeyShortHelp, v),
              placeholder: "状态栏简短提示",
              hint: "状态栏 / 快速提示，通常比 Help 更短",
            }),
            pnwPropString("nls_long", "LongHelp（详细提示）", {
              value: computed(() => selectedNode.value?.nls?.longHelp ?? ""),
              onChange: (v) => nlsChange("longHelp", nlsKeyLongHelp, v),
              placeholder: "详细说明文本",
              hint: "详细帮助文本，用于更完整的说明",
            }),
            pnwPropReadonly("nls_columns", "列标题", {
              value: computed(() =>
                dash(selectedNode.value?.nls?.columnTitles?.filter(Boolean).join(" · ")),
              ),
              hidden: computed(() => !selectedNode.value?.nls?.columnTitles?.length),
            }),
          ],
          { hidden: computed(() => !hasSelection.value) },
        ),
        pnwPropGroup("grid", "Grid 布局", [
          pnwPropReadonly("grid_placement", "位置", {
            value: computed(() =>
              selectedNode.value ? formatGrid(selectedNode.value) : "—",
            ),
            mono: true,
          }),
        ], { hidden: computed(() => !hasGrid.value) }),
        pnwPropGroup(
          "grid_res",
          "伸缩",
          [
            pnwPropReadonly("row_res", "ROWRES", {
              value: computed(() => formatIntList(selectedNode.value?.gridLayout?.rowResizable)),
              mono: true,
            }),
            pnwPropReadonly("col_res", "COLRES", {
              value: computed(() => formatIntList(selectedNode.value?.gridLayout?.colResizable)),
              mono: true,
            }),
          ],
          { hidden: computed(() => !hasGridLayout.value), defaultCollapsed: true },
        ),
        pnwPropGroup(
          "size",
          "尺寸",
          [
            pnwPropReadonly("text_height", "TH", {
              value: computed(() => dash(selectedNode.value?.size?.textHeight)),
              hidden: computed(() => selectedNode.value?.size?.textHeight == null),
            }),
            pnwPropReadonly("text_width", "TW", {
              value: computed(() => dash(selectedNode.value?.size?.textWidth)),
              hidden: computed(() => selectedNode.value?.size?.textWidth == null),
            }),
            pnwPropReadonly("column_count", "CC", {
              value: computed(() => dash(selectedNode.value?.size?.columnCount)),
              hidden: computed(() => selectedNode.value?.size?.columnCount == null),
            }),
            pnwPropReadonly("visible_columns", "VCC", {
              value: computed(() => dash(selectedNode.value?.size?.visibleColumnCount)),
              hidden: computed(() => selectedNode.value?.size?.visibleColumnCount == null),
            }),
          ],
          { hidden: computed(() => !hasSize.value), defaultCollapsed: true },
        ),
      ],
      { title: "CAA 对话框" },
    ),
  );
}
