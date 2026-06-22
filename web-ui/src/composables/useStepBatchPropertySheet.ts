import { computed } from "vue";
import { usePagePropertySheet } from "./usePagePropertySheet";
import { propGroup, propReadonly, propSheet } from "../utils/pagePropertySchema";

const PAGE_INTRO =
  "使用 freecadcmd 批量将 STEP 转为 FCStd。请在「配置」页设置 FreeCAD 安装目录。";

export function useStepBatchPropertySheet(pageId: string) {
  usePagePropertySheet(pageId, () =>
    propSheet(
      [
        propGroup("intro", "介绍", [
          propReadonly("intro", "说明", {
            value: computed(() => PAGE_INTRO),
          }),
        ]),
      ],
      { title: "STEP 批量", schemaVersion: 1 },
    ),
  );
}