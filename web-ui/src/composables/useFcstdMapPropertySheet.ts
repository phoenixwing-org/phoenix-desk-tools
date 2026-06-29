import { computed, type Ref } from "vue";
import type { FcstdMapPayload } from "../api";
import { usePagePropertySheet } from "./usePagePropertySheet";
import { propBool, propGroup, propReadonly, propSheet } from "../utils/pagePropertySchema";

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

  usePagePropertySheet(pageId, () =>
    propSheet(
      [
        propGroup("scan_opts", "扫描选项", [
          propReadonly("scan_scope", "扫描范围", {
            value: computed(() => scanWorksetId.value ? `工作集 · ${worksetName.value}` : "全部"),
          }),
          propBool("force_update_part_name", "强制更新零件名", {
            value: forceUpdatePartName,
            hint: "重新扫描时覆盖索引中已有零件名（不写回 FCStd）；变更后自动保存",
            onChange: (v) => {
              forceUpdatePartName.value = v;
              void onSaveScanOptions();
            },
          }),
        ]),
        propGroup("status", "索引状态", [
          propReadonly("index_state", "索引库", {
            value: computed(() => (hasIndex.value ? "已建立" : "尚无")),
          }),
          propReadonly("last_scan_at", "上次扫描", {
            value: computed(() => formatScanTime(data.value?.last_scan_at)),
            hidden: computed(() => !data.value?.last_scan_at),
          }),
          propReadonly("total_entries", "条目", {
            value: computed(() => data.value?.stats.total_entries ?? "—"),
            hidden: computed(() => !hasIndex.value),
          }),
          propReadonly("present", "存在", {
            value: computed(() => data.value?.stats.present ?? "—"),
            hidden: computed(() => !hasIndex.value),
          }),
          propReadonly("missing", "缺失", {
            value: computed(() => data.value?.stats.missing ?? "—"),
            hidden: computed(() => !hasIndex.value),
          }),
          propReadonly("fcstd_count", "FCStd", {
            value: computed(() => data.value?.stats.fcstd_file_count ?? "—"),
            hidden: computed(() => !hasIndex.value),
          }),
          propReadonly("cad_count", "CAD 文件", {
            value: computed(() => data.value?.stats.cad_file_count ?? "—"),
            hidden: computed(() => !hasIndex.value),
          }),
          propReadonly("dup_names", "重名", {
            value: computed(() => data.value?.stats.duplicate_filename_kinds ?? "—"),
            hidden: computed(() => !hasIndex.value),
          }),
        ]),
        propGroup("paths", "路径", [
          propReadonly("database_path", "数据库", {
            value: computed(() => data.value?.database_path_display || "—"),
            mono: true,
            hidden: computed(() => !data.value?.database_path_display),
          }),
          propReadonly("map_path", "JSON", {
            value: computed(() => data.value?.map_path_display || "—"),
            mono: true,
            hidden: computed(() => !data.value?.map_path_display),
          }),
        ], { hidden: computed(() => !hasIndex.value) }),
        propGroup("intro", "介绍", [
          propReadonly("intro", "说明", {
            value: computed(() => PAGE_INTRO),
          }),
        ]),
      ],
      { title: "CAD 索引", schemaVersion: 1 },
    ),
  );
}
