import { computed, type Ref } from "vue";
import type { FcstdMapPayload } from "../api";
import { usePnwPagePropertySheet } from "phoenix-wing";
import { pnwPropBool, pnwPropGroup, pnwPropReadonly, pnwPropSheet } from "phoenix-wing";

function formatScanTime(iso: string | null | undefined): string {
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

const PAGE_INTRO =
  "「工程内搜索」写入工作空间索引库并重建 BOM 引用表；条目 / 存在 / 缺失统计见侧栏「索引状态」与底栏。";

export function useFcstdMapPropertySheet(
  pageId: string,
  opts: {
    data: Ref<FcstdMapPayload | null>;
    forceUpdatePartName: Ref<boolean>;
    scanWorksetId: Ref<string>;
    worksetName: Ref<string>;
    onSaveScanOptions: () => void | Promise<void>;
  },
) {
  const { data, forceUpdatePartName, scanWorksetId, worksetName, onSaveScanOptions } = opts;

  const hasIndex = computed(() => Boolean(data.value?.exists));

  usePnwPagePropertySheet(pageId, () =>
    pnwPropSheet(
      [
        pnwPropGroup("scan_opts", "扫描选项", [
          pnwPropReadonly("scan_scope", "扫描范围", {
            value: computed(() => scanWorksetId.value ? `工作集 · ${worksetName.value}` : "全部"),
          }),
          pnwPropBool("force_update_part_name", "强制更新零件名", {
            value: forceUpdatePartName,
            hint: "重新扫描时覆盖索引中已有零件名（不写回 FCStd）；变更后自动保存",
            onChange: (v) => {
              forceUpdatePartName.value = v;
              void onSaveScanOptions();
            },
          }),
        ]),
        pnwPropGroup("status", "索引状态", [
          pnwPropReadonly("index_state", "索引库", {
            value: computed(() => (hasIndex.value ? "已建立" : "尚无")),
          }),
          pnwPropReadonly("last_scan_at", "上次扫描", {
            value: computed(() => formatScanTime(data.value?.last_scan_at)),
            hidden: computed(() => !data.value?.last_scan_at),
          }),
          pnwPropReadonly("total_entries", "条目", {
            value: computed(() => data.value?.stats.total_entries ?? "—"),
            hidden: computed(() => !hasIndex.value),
          }),
          pnwPropReadonly("present", "存在", {
            value: computed(() => data.value?.stats.present ?? "—"),
            hidden: computed(() => !hasIndex.value),
          }),
          pnwPropReadonly("missing", "缺失", {
            value: computed(() => data.value?.stats.missing ?? "—"),
            hidden: computed(() => !hasIndex.value),
          }),
          pnwPropReadonly("fcstd_count", "FCStd", {
            value: computed(() => data.value?.stats.fcstd_file_count ?? "—"),
            hidden: computed(() => !hasIndex.value),
          }),
          pnwPropReadonly("cad_count", "CAD 文件", {
            value: computed(() => data.value?.stats.cad_file_count ?? "—"),
            hidden: computed(() => !hasIndex.value),
          }),
          pnwPropReadonly("dup_names", "重名", {
            value: computed(() => data.value?.stats.duplicate_filename_kinds ?? "—"),
            hidden: computed(() => !hasIndex.value),
          }),
        ]),
        pnwPropGroup("paths", "路径", [
          pnwPropReadonly("database_path", "数据库", {
            value: computed(() => data.value?.database_path_display || "—"),
            mono: true,
            hidden: computed(() => !data.value?.database_path_display),
          }),
          pnwPropReadonly("map_path", "JSON", {
            value: computed(() => data.value?.map_path_display || "—"),
            mono: true,
            hidden: computed(() => !data.value?.map_path_display),
          }),
        ], { hidden: computed(() => !hasIndex.value) }),
        pnwPropGroup("intro", "介绍", [
          pnwPropReadonly("intro", "说明", {
            value: computed(() => PAGE_INTRO),
          }),
        ]),
      ],
      { title: "CAD 索引", schemaVersion: 1 },
    ),
  );
}
