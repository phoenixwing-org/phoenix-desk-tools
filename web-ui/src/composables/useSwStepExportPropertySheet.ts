import { computed } from "vue";
import { usePagePropertySheet } from "./usePagePropertySheet";
import { propGroup, propReadonly, propSheet } from "../utils/pagePropertySchema";

const PAGE_INTRO =
  "SolidWorks 三维模型批量导出 STEP（Windows COM）。非 Windows 可保存偏好与预览模型数量。";

export function useSwStepExportPropertySheet(pageId: string) {
  usePagePropertySheet(pageId, () =>
    propSheet(
      [
        propGroup("intro", "介绍", [
          propReadonly("intro", "说明", {
            value: computed(() => PAGE_INTRO),
          }),
        ]),
      ],
      { title: "SW→STEP", schemaVersion: 1 },
    ),
  );
}