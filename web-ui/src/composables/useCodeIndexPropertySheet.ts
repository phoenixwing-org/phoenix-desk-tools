import { computed, type Ref } from "vue";
import type { CodeIndexPayload } from "../api";
import { usePnwPagePropertySheet } from "phoenix-wing";
import { pnwPropGroup, pnwPropReadonly, pnwPropSheet } from "phoenix-wing";

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

function workspaceDisplay(payload: CodeIndexPayload | null): string {
  const raw = payload?.workspace_path_display?.trim() || payload?.workspace_path?.trim() || "";
  if (!raw || raw === ".") return "（工作空间根）";
  return raw;
}

const PAGE_INTRO =
  "扫描源文件、配置、文档与资源，写入 phoenix_code_* 索引表（与 CAD 索引同库）。统计与上次扫描时间见下方「索引状态」。";

export function useCodeIndexPropertySheet(
  pageId: string,
  opts: {
    data: Ref<CodeIndexPayload | null>;
    missingCount: Ref<number>;
  },
) {
  const { data, missingCount } = opts;

  const hasScan = computed(() => Boolean(data.value?.last_scan_at));

  usePnwPagePropertySheet(pageId, () =>
    pnwPropSheet(
      [
        pnwPropGroup("intro", "介绍", [
          pnwPropReadonly("intro", "说明", {
            value: computed(() => PAGE_INTRO),
          }),
        ]),
        pnwPropGroup("status", "索引状态", [
          pnwPropReadonly("index_state", "状态", {
            value: computed(() => (hasScan.value ? "已建立" : "尚未扫描")),
          }),
          pnwPropReadonly("last_scan_at", "上次扫描", {
            value: computed(() => formatScanTime(data.value?.last_scan_at)),
            hidden: computed(() => !data.value?.last_scan_at),
          }),
          pnwPropReadonly("total", "总计", {
            value: computed(() => data.value?.stats?.total ?? data.value?.file_count ?? "—"),
            hidden: computed(() => !hasScan.value),
          }),
          pnwPropReadonly("present", "存在", {
            value: computed(() => data.value?.present_count ?? "—"),
            hidden: computed(() => !hasScan.value),
          }),
          pnwPropReadonly("missing", "缺失", {
            value: computed(() => missingCount.value),
            hidden: computed(() => !hasScan.value || missingCount.value <= 0),
          }),
          pnwPropReadonly("source", "源文件", {
            value: computed(() => data.value?.stats?.source ?? "—"),
            hidden: computed(() => !hasScan.value),
          }),
          pnwPropReadonly("config", "配置", {
            value: computed(() => data.value?.stats?.config ?? "—"),
            hidden: computed(() => !hasScan.value),
          }),
          pnwPropReadonly("doc", "文档", {
            value: computed(() => data.value?.stats?.doc ?? "—"),
            hidden: computed(() => !hasScan.value),
          }),
          pnwPropReadonly("resource", "资源", {
            value: computed(() => data.value?.stats?.resource ?? "—"),
            hidden: computed(() => !hasScan.value),
          }),
        ]),
        pnwPropGroup("paths", "路径", [
          pnwPropReadonly("workspace_path", "工作空间", {
            value: computed(() => workspaceDisplay(data.value)),
            mono: true,
          }),
        ]),
      ],
      { title: "Code 索引", schemaVersion: 1 },
    ),
  );
}
