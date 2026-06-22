import { computed, type Ref } from "vue";
import { usePagePropertySheet } from "./usePagePropertySheet";
import { propBool, propEnum, propGroup, propPath, propReadonly, propSheet } from "../utils/pagePropertySchema";

const PAGE_INTRO =
  "使用 freecadcmd 批量将 STEP 转为 FCStd。请在「配置」页设置 FreeCAD 安装目录。";

const VIEW_FIT_OPTIONS = [
  { value: "none", label: "不调整" },
  { value: "last", label: "最后一个" },
  { value: "all", label: "全部" },
];

export function useStepBatchPropertySheet(
  pageId: string,
  opts: {
    stepDir: Ref<string>;
    outDir: Ref<string>;
    skipExisting: Ref<boolean>;
    viewFit: Ref<string>;
    stepRecursive: Ref<boolean>;
    onPersist: () => void;
  },
) {
  const { stepDir, outDir, skipExisting, viewFit, stepRecursive, onPersist } = opts;

  usePagePropertySheet(pageId, () =>
    propSheet(
      [
        propGroup("intro", "介绍", [
          propReadonly("intro", "说明", {
            value: computed(() => PAGE_INTRO),
          }),
        ]),
        propGroup("paths", "目录", [
          propPath("step_dir", "STEP 目录", {
            value: computed(() => stepDir.value),
            placeholder: "相对工作空间",
            onChange: (v) => {
              stepDir.value = v;
              onPersist();
            },
          }),
          propPath("out_dir", "FCStd 输出", {
            value: computed(() => outDir.value),
            placeholder: "相对工作空间",
            onChange: (v) => {
              outDir.value = v;
              onPersist();
            },
          }),
        ]),
        propGroup("options", "选项", [
          propBool("skip_existing", "跳过已存在 FCStd", {
            value: skipExisting,
            onChange: (v) => {
              skipExisting.value = v;
              onPersist();
            },
          }),
          propBool("step_recursive", "递归子目录", {
            value: stepRecursive,
            onChange: (v) => {
              stepRecursive.value = v;
              onPersist();
            },
          }),
          propEnum("view_fit", "视图适应", {
            value: computed(() => viewFit.value),
            options: VIEW_FIT_OPTIONS,
            onChange: (v) => {
              viewFit.value = v;
              onPersist();
            },
          }),
        ]),
      ],
      { title: "STEP 批量", schemaVersion: 2 },
    ),
  );
}
