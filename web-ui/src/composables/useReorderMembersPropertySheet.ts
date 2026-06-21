import { computed } from "vue";
import { usePagePropertySheet } from "../composables/usePagePropertySheet";
import { useReorderMembersPageStore } from "../stores/reorderMembersPage";
import type { KevinSystemCodeMode } from "../stores/reorderMembersPage";
import { propBool, propEnum, propGroup, propReadonly, propSheet } from "../utils/pagePropertySchema";

const KEVIN_SYSTEM_CODE_OPTIONS: Array<{
  value: KevinSystemCodeMode;
  label: string;
  description: string;
}> = [
  {
    value: "merge_strip",
    label: "合并排序并清除标记",
    description: "合并 // functions 内相关声明，清除 START/END，段内字母序（推荐）",
  },
  {
    value: "keep_markers",
    label: "保留 START/END",
    description: "仅排序 START/END 块内声明，保留标记行，不合并 functions 段",
  },
  {
    value: "off",
    label: "不处理",
    description: "当作普通 public 段参与排序，不识别 KEVIN_SYSTEM_CODE 段",
  },
];

/** C++ 成员排序 · 属性描述符（由壳层自动渲染，无页面内定制 UI） */
export function useReorderMembersPropertySheet(
  pageId: string,
  onPersistServer?: () => void,
  onValidationError?: (message: string) => void,
) {
  const pageStore = useReorderMembersPageStore();

  usePagePropertySheet(pageId, () =>
    propSheet(
      [
      propGroup("run", "运行选项", [
        propBool("include_cpp", ".cpp", {
          value: computed(() => pageStore.includeCpp),
          onChange: (v) => {
            if (!pageStore.setIncludeCpp(v)) {
              onValidationError?.("至少勾选一种源文件类型");
              return;
            }
            onPersistServer?.();
          },
        }),
        propBool("include_header", "头文件（.h / .hpp）", {
          value: computed(() => pageStore.includeHeader),
          onChange: (v) => {
            if (!pageStore.setIncludeHeader(v)) {
              onValidationError?.("至少勾选一种源文件类型");
              return;
            }
            onPersistServer?.();
          },
        }),
        propBool("verbose", "详细日志", {
          value: computed(() => pageStore.verbose),
          onChange: (v) => {
            pageStore.setVerbose(v);
            onPersistServer?.();
          },
        }),
      ]),
      propGroup("kevin_system_code", "KEVIN_SYSTEM_CODE", [
        propEnum("mode", "处理方式", {
          value: computed(() => pageStore.kevinSystemCodeMode),
          labelTone: "emphasis",
          options: KEVIN_SYSTEM_CODE_OPTIONS.map((o) => ({
            value: o.value,
            label: o.label,
            description: o.description,
          })),
          hint:
            KEVIN_SYSTEM_CODE_OPTIONS.find((o) => o.value === pageStore.kevinSystemCodeMode)
              ?.description ?? "",
          onChange: (v) => {
            pageStore.setKevinSystemCodeMode(v as KevinSystemCodeMode);
            onPersistServer?.();
          },
        }),
      ]),
      propGroup(
        "ignore",
        "忽略规则",
        [
          propReadonly("ignore_file", "忽略文件", {
            value: computed(() => pageStore.ignoreFileDisplay || "（未配置）"),
            mono: true,
          }),
        ],
        { defaultCollapsed: true },
      ),
    ],
      { title: "C++ 成员排序" },
    ),
  );
}
