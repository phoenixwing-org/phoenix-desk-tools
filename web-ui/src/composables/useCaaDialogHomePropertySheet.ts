import { computed, type Ref } from "vue";
import { caaServicePropertyGroup } from "./caaServicePropertyGroup";
import { usePnwPagePropertySheet } from "phoenix-wing";
import { pnwPropGroup, pnwPropReadonly, pnwPropSheet } from "phoenix-wing";

function formatTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString("zh-CN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

/** CAA 对话框主页 · 侧栏属性（索引 SQL 统计） */
export function useCaaDialogHomePropertySheet(
  pageId: string,
  opts: {
    dialogCount: Ref<number>;
    moduleCount: Ref<number>;
    lastScanAt: Ref<string | null | undefined>;
    indexed: Ref<boolean>;
    lastLoadedAt: Ref<string | null>;
    listLoading: Ref<boolean>;
  },
) {
  const { dialogCount, moduleCount, lastScanAt, indexed, lastLoadedAt, listLoading } = opts;

  usePnwPagePropertySheet(pageId, () =>
    pnwPropSheet(
      [
        pnwPropGroup("list", "列表", [
          pnwPropReadonly("dialog_count", "对话框数", {
            value: computed(() => (indexed.value ? dialogCount.value : "—")),
          }),
          pnwPropReadonly("module_count", "模块数", {
            value: computed(() => (indexed.value && dialogCount.value > 0 ? moduleCount.value : "—")),
            hidden: computed(() => !indexed.value || dialogCount.value <= 0),
          }),
          pnwPropReadonly("data_source", "数据来源", {
            value: computed(() => "CAA 索引 SQL"),
          }),
          pnwPropReadonly("list_state", "加载状态", {
            value: computed(() => (listLoading.value ? "加载中…" : indexed.value ? "已加载" : "索引未建立")),
          }),
          pnwPropReadonly("last_loaded", "本次加载", {
            value: computed(() => formatTime(lastLoadedAt.value)),
            hidden: computed(() => !lastLoadedAt.value),
          }),
        ]),
        pnwPropGroup("index", "CAA 索引", [
          pnwPropReadonly("index_state", "索引状态", {
            value: computed(() => (indexed.value ? "已建立" : "尚未扫描")),
          }),
          pnwPropReadonly("last_scan_at", "上次扫描", {
            value: computed(() => formatTime(lastScanAt.value)),
            hidden: computed(() => !lastScanAt.value),
          }),
        ]),
        caaServicePropertyGroup(),
      ],
      { title: "CAA 对话框主页" },
    ),
  );
}
