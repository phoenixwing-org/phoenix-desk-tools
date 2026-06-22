import { computed, type Ref } from "vue";
import { usePagePropertySheet } from "./usePagePropertySheet";
import { propBool, propGroup, propPath, propReadonly, propSheet } from "../utils/pagePropertySchema";

const PAGE_INTRO =
  "SolidWorks 三维模型批量导出 STEP（Windows COM）。非 Windows 可保存偏好与预览模型数量。";

export function useSwStepExportPropertySheet(
  pageId: string,
  opts: {
    sourceDir: Ref<string>;
    outStepDir: Ref<string>;
    recursiveScan: Ref<boolean>;
    onPersist: () => void;
  },
) {
  const { sourceDir, outStepDir, recursiveScan, onPersist } = opts;

  usePagePropertySheet(pageId, () =>
    propSheet(
      [
        propGroup("intro", "介绍", [
          propReadonly("intro", "说明", {
            value: computed(() => PAGE_INTRO),
          }),
        ]),
        propGroup("paths", "目录", [
          propPath("source_dir", "SolidWorks 模型", {
            value: computed(() => sourceDir.value),
            placeholder: "相对工作空间",
            onChange: (v) => {
              sourceDir.value = v;
              onPersist();
            },
          }),
          propPath("out_step_dir", "STEP 输出", {
            value: computed(() => outStepDir.value),
            placeholder: "相对工作空间",
            onChange: (v) => {
              outStepDir.value = v;
              onPersist();
            },
          }),
        ]),
        propGroup("options", "选项", [
          propBool("recursive_scan", "递归扫描子目录", {
            value: recursiveScan,
            onChange: (v) => {
              recursiveScan.value = v;
              onPersist();
            },
          }),
        ]),
      ],
      { title: "SW→STEP", schemaVersion: 2 },
    ),
  );
}
