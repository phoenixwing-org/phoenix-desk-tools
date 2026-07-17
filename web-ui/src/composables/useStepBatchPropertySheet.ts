import { computed, type Ref } from "vue";
import { usePnwPagePropertySheet } from "phoenix-wing";
import { pnwPropBool, pnwPropEnum, pnwPropGroup, pnwPropPath, pnwPropReadonly, pnwPropSheet } from "phoenix-wing";

const PAGE_INTRO =
  "使用 freecadcmd 批量将 STEP 转为 FCStd。请在「配置」页设置 FreeCAD 安装目录。";

export const STEP_VIEW_FIT_OPTIONS = [
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

  usePnwPagePropertySheet(pageId, () =>
    pnwPropSheet(
      [
        pnwPropGroup("intro", "介绍", [
          pnwPropReadonly("intro", "说明", {
            value: computed(() => PAGE_INTRO),
          }),
        ]),
        pnwPropGroup("paths", "目录", [
          pnwPropPath("step_dir", "STEP 目录", {
            value: computed(() => stepDir.value),
            placeholder: "相对工作空间",
            onChange: (v) => {
              stepDir.value = v;
              onPersist();
            },
          }),
          pnwPropPath("out_dir", "FCStd 输出", {
            value: computed(() => outDir.value),
            placeholder: "相对工作空间",
            onChange: (v) => {
              outDir.value = v;
              onPersist();
            },
          }),
        ]),
        pnwPropGroup("options", "选项", [
          pnwPropBool("skip_existing", "跳过已存在 FCStd", {
            value: skipExisting,
            onChange: (v) => {
              skipExisting.value = v;
              onPersist();
            },
          }),
          pnwPropBool("step_recursive", "递归子目录", {
            value: stepRecursive,
            onChange: (v) => {
              stepRecursive.value = v;
              onPersist();
            },
          }),
          pnwPropEnum("view_fit", "视图适应", {
            value: computed(() => viewFit.value),
            options: STEP_VIEW_FIT_OPTIONS,
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
