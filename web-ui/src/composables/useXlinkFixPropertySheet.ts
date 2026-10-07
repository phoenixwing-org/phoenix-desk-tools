import { computed, type Ref } from "vue";
import type { XlinkFixResult } from "../api";
import { usePnwPagePropertySheet } from "phoenix-wing";
import { pnwPropBool, pnwPropGroup, pnwPropPath, pnwPropReadonly, pnwPropSheet } from "phoenix-wing";

export function useXlinkFixPropertySheet(
  pageId: string,
  opts: {
    batchDir: Ref<string>;
    allInDir: Ref<boolean>;
    analysis: Ref<XlinkFixResult | null>;
    onPersist: () => void;
  },
) {
  const { batchDir, allInDir, analysis, onPersist } = opts;

  usePnwPagePropertySheet(pageId, () =>
    pnwPropSheet(
      [
        pnwPropGroup("scan", "扫描范围", [
          pnwPropPath("batch_dir", "修正目录", {
            value: computed(() => batchDir.value),
            mono: true,
            placeholder: "相对工作空间，如 .",
            hint: "相对工作空间根目录的 FCStd 扫描路径",
            onChange: (v) => {
              batchDir.value = v;
              onPersist();
            },
          }),
          pnwPropBool("all_in_dir", "目录内全部 FCStd", {
            value: allInDir,
            hint: "勾选时扫描该目录下全部 FCStd（推荐）",
            onChange: (v) => {
              allInDir.value = v;
              onPersist();
            },
          }),
        ]),
        pnwPropGroup(
          "meta",
          "分析信息",
          [
            pnwPropReadonly("map_path", "索引库", {
              value: computed(() => analysis.value?.map_path_display || "—"),
              mono: true,
              hidden: computed(() => !analysis.value?.map_path_display),
            }),
            pnwPropReadonly("batch_dir_display", "扫描目录", {
              value: computed(() => analysis.value?.batch_dir_display || "—"),
              mono: true,
              hidden: computed(() => !analysis.value?.batch_dir_display),
            }),
          ],
          { defaultCollapsed: false },
        ),
      ],
      { title: "错误修正 · XLink 范围", schemaVersion: 1 },
    ),
  );
}
