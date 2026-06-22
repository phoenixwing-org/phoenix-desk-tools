import { computed, type Ref } from "vue";
import type { XlinkFixResult } from "../api";
import { usePagePropertySheet } from "./usePagePropertySheet";
import { propBool, propGroup, propPath, propReadonly, propSheet } from "../utils/pagePropertySchema";

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

  usePagePropertySheet(pageId, () =>
    propSheet(
      [
        propGroup("scan", "扫描范围", [
          propPath("batch_dir", "修正目录", {
            value: computed(() => batchDir.value),
            mono: true,
            placeholder: "相对工作空间，如 .",
            hint: "相对工作空间根目录的 FCStd 扫描路径",
            onChange: (v) => {
              batchDir.value = v;
              onPersist();
            },
          }),
          propBool("all_in_dir", "目录内全部 FCStd", {
            value: allInDir,
            hint: "勾选时扫描该目录下全部 FCStd（推荐）",
            onChange: (v) => {
              allInDir.value = v;
              onPersist();
            },
          }),
        ]),
        propGroup(
          "meta",
          "分析信息",
          [
            propReadonly("map_path", "索引库", {
              value: computed(() => analysis.value?.map_path_display || "—"),
              mono: true,
              hidden: computed(() => !analysis.value?.map_path_display),
            }),
            propReadonly("batch_dir_display", "扫描目录", {
              value: computed(() => analysis.value?.batch_dir_display || "—"),
              mono: true,
              hidden: computed(() => !analysis.value?.batch_dir_display),
            }),
          ],
          { defaultCollapsed: false },
        ),
      ],
      { title: "链接路径修正", schemaVersion: 1 },
    ),
  );
}
