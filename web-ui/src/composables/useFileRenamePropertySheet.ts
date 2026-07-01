import { computed, type Ref } from "vue";
import type { RefScanPayload } from "../api";
import { usePnwPagePropertySheet } from "phoenix-wing";
import { pnwPropBool, pnwPropGroup, pnwPropReadonly, pnwPropSheet } from "phoenix-wing";

export function useFileRenamePropertySheet(
  pageId: string,
  opts: {
    includeTransitive: Ref<boolean>;
    scan: Ref<RefScanPayload | null>;
  },
) {
  const { includeTransitive, scan } = opts;

  usePnwPagePropertySheet(pageId, () =>
    pnwPropSheet(
      [
        pnwPropGroup("rules", "规则", [
          pnwPropBool("include_transitive", "含间接宿主", {
            value: includeTransitive,
            hint: "勾选时包含传递闭包内的间接宿主",
          }),
        ]),
        pnwPropGroup(
          "meta",
          "分析信息",
          [
            pnwPropReadonly("old_basename", "旧文件名", {
              value: computed(() => scan.value?.old_basename || "—"),
              mono: true,
              hidden: computed(() => !scan.value?.old_basename),
            }),
            pnwPropReadonly("new_basename", "新文件名", {
              value: computed(() => scan.value?.new_basename || "—"),
              mono: true,
              hidden: computed(() => !scan.value?.new_basename),
            }),
            pnwPropReadonly("host_count", "宿主数", {
              value: computed(() => scan.value?.host_count ?? "—"),
              hidden: computed(() => scan.value == null),
            }),
            pnwPropReadonly("hit_count", "引用命中", {
              value: computed(() => scan.value?.hit_count ?? "—"),
              hidden: computed(() => scan.value == null),
            }),
            pnwPropReadonly("pending_hit_count", "待修正", {
              value: computed(() => scan.value?.pending_hit_count ?? scan.value?.hit_count ?? "—"),
              hidden: computed(() => scan.value == null),
            }),
          ],
          { defaultCollapsed: false },
        ),
      ],
      { title: "改名分析", schemaVersion: 1 },
    ),
  );
}
