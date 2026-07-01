import { computed, type ComputedRef, type Ref } from "vue";
import type { BomXrefMeta } from "../api";
import { usePnwPagePropertySheet } from "phoenix-wing";
import { pnwPropGroup, pnwPropReadonly, pnwPropSheet } from "phoenix-wing";

function formatTimestamp(iso: string | null | undefined): string {
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

export function useBomExportPropertySheet(
  pageId: string,
  opts: {
    meta: Ref<BomXrefMeta | null>;
    catalogCount: Ref<number> | ComputedRef<number>;
  },
) {
  const { meta, catalogCount } = opts;

  const hasIndex = computed(() => (meta.value?.edge_count ?? 0) > 0);

  usePnwPagePropertySheet(pageId, () =>
    pnwPropSheet(
      [
        pnwPropGroup("xref", "引用表", [
          pnwPropReadonly("xref_state", "状态", {
            value: computed(() => (hasIndex.value ? "已建立" : "空")),
          }),
          pnwPropReadonly("last_bom_xref_at", "上次更新", {
            value: computed(() => formatTimestamp(meta.value?.last_bom_xref_at)),
            hidden: computed(() => !meta.value?.last_bom_xref_at),
          }),
          pnwPropReadonly("edge_count", "引用边", {
            value: computed(() => meta.value?.edge_count ?? "—"),
            hidden: computed(() => !hasIndex.value),
          }),
          pnwPropReadonly("host_count", "宿主", {
            value: computed(() => meta.value?.host_count ?? "—"),
            hidden: computed(() => !hasIndex.value),
          }),
          pnwPropReadonly("assembly_count", "总成", {
            value: computed(() => catalogCount.value),
          }),
          pnwPropReadonly("target_resolved", "已解析", {
            value: computed(() => meta.value?.target_resolved ?? "—"),
            hidden: computed(() => meta.value?.target_resolved == null),
          }),
          pnwPropReadonly("target_ambiguous", "歧义", {
            value: computed(() => meta.value?.target_ambiguous ?? "—"),
            hidden: computed(() => meta.value?.target_ambiguous == null),
          }),
          pnwPropReadonly("target_missing", "缺失", {
            value: computed(() => meta.value?.target_missing ?? "—"),
            hidden: computed(() => meta.value?.target_missing == null),
          }),
        ]),
        pnwPropGroup("paths", "路径", [
          pnwPropReadonly("database_path", "索引库", {
            value: computed(() => meta.value?.database_path_display || "—"),
            mono: true,
            hidden: computed(() => !meta.value?.database_path_display),
          }),
        ]),
      ],
      { title: "BOM 列表", schemaVersion: 1 },
    ),
  );
}
