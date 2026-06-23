import { computed } from "vue";
import { usePagePropertySheet } from "./usePagePropertySheet";
import { useCaaDialogPageStore } from "../stores/caaDialogPage";
import {
  formatGrid,
  formatIntList,
  resolveSelectedNode,
} from "../utils/caaDialogTree";
import { propGroup, propReadonly, propSheet } from "../utils/pagePropertySchema";

function dash(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  return String(value);
}

/** CAA 对话框 · 侧栏属性（选中控件 + 对话框元数据） */
export function useCaaDialogPropertySheet(pageId: string) {
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
  const hasNls = computed(() => Boolean(selectedNode.value?.nls));

  usePagePropertySheet(pageId, () =>
    propSheet(
      [
        propGroup("dialog", "对话框", [
          propReadonly("dialog_name", "名称", {
            value: computed(() => dash(store.ir?.dialogName)),
            mono: true,
          }),
          propReadonly("dialog_title", "标题", {
            value: computed(() => dash(store.ir?.title)),
          }),
          propReadonly("catdlg_source", ".CATDlg", {
            value: computed(() => dash(store.ir?.sources.catDlg)),
            mono: true,
          }),
          propReadonly("caa_service", "CAA 服务", {
            value: computed(() => {
              if (store.caaOnline === true) return "在线";
              if (store.caaOnline === false) return "离线";
              return "—";
            }),
            hint: "需运行 pnpm dev:caa",
          }),
        ]),
        propGroup("selection", "选中控件", [
          propReadonly("ctrl_id", "ID", {
            value: computed(() => dash(selectedNode.value?.id)),
            mono: true,
            labelTone: "emphasis",
          }),
          propReadonly("ctrl_type", "类型", {
            value: computed(() => dash(selectedNode.value?.type)),
            mono: true,
          }),
          propReadonly("ctrl_father", "父控件", {
            value: computed(() => dash(selectedNode.value?.father)),
            mono: true,
            hidden: computed(() => !selectedNode.value?.father),
          }),
          propReadonly("ctrl_style", "STYLE", {
            value: computed(() => dash(selectedNode.value?.style?.join(" | "))),
            mono: true,
            hidden: computed(() => !selectedNode.value?.style?.length),
          }),
        ], { hidden: computed(() => !hasSelection.value) }),
        propGroup("grid", "Grid 布局", [
          propReadonly("grid_placement", "位置", {
            value: computed(() =>
              selectedNode.value ? formatGrid(selectedNode.value) : "—",
            ),
            mono: true,
          }),
        ], { hidden: computed(() => !hasGrid.value) }),
        propGroup(
          "grid_res",
          "伸缩",
          [
            propReadonly("row_res", "ROWRES", {
              value: computed(() => formatIntList(selectedNode.value?.gridLayout?.rowResizable)),
              mono: true,
            }),
            propReadonly("col_res", "COLRES", {
              value: computed(() => formatIntList(selectedNode.value?.gridLayout?.colResizable)),
              mono: true,
            }),
          ],
          { hidden: computed(() => !hasGridLayout.value), defaultCollapsed: true },
        ),
        propGroup(
          "size",
          "尺寸",
          [
            propReadonly("text_height", "TH", {
              value: computed(() => dash(selectedNode.value?.size?.textHeight)),
              hidden: computed(() => selectedNode.value?.size?.textHeight == null),
            }),
            propReadonly("text_width", "TW", {
              value: computed(() => dash(selectedNode.value?.size?.textWidth)),
              hidden: computed(() => selectedNode.value?.size?.textWidth == null),
            }),
            propReadonly("column_count", "CC", {
              value: computed(() => dash(selectedNode.value?.size?.columnCount)),
              hidden: computed(() => selectedNode.value?.size?.columnCount == null),
            }),
            propReadonly("visible_columns", "VCC", {
              value: computed(() => dash(selectedNode.value?.size?.visibleColumnCount)),
              hidden: computed(() => selectedNode.value?.size?.visibleColumnCount == null),
            }),
          ],
          { hidden: computed(() => !hasSize.value), defaultCollapsed: true },
        ),
        propGroup(
          "nls",
          "文案 (NLS)",
          [
            propReadonly("nls_title", "Title", {
              value: computed(() => dash(selectedNode.value?.nls?.title)),
              hidden: computed(() => !selectedNode.value?.nls?.title),
            }),
            propReadonly("nls_help", "Help", {
              value: computed(() => dash(selectedNode.value?.nls?.help)),
              hidden: computed(() => !selectedNode.value?.nls?.help),
            }),
            propReadonly("nls_short", "ShortHelp", {
              value: computed(() => dash(selectedNode.value?.nls?.shortHelp)),
              hidden: computed(() => !selectedNode.value?.nls?.shortHelp),
            }),
            propReadonly("nls_long", "LongHelp", {
              value: computed(() => dash(selectedNode.value?.nls?.longHelp)),
              hidden: computed(() => !selectedNode.value?.nls?.longHelp),
            }),
            propReadonly("nls_columns", "列标题", {
              value: computed(() =>
                dash(selectedNode.value?.nls?.columnTitles?.filter(Boolean).join(" · ")),
              ),
              hidden: computed(() => !selectedNode.value?.nls?.columnTitles?.length),
            }),
          ],
          { hidden: computed(() => !hasNls.value), defaultCollapsed: true },
        ),
      ],
      { title: "CAA 对话框" },
    ),
  );
}
