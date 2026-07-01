import { computed } from "vue";
import { usePnwPagePropertySheet } from "phoenix-wing";
import { useReorderMembersPageStore } from "../stores/reorderMembersPage";
import { useFileWorksetsStore } from "../stores/fileWorksets";
import type { KevinSystemCodeMode } from "../stores/reorderMembersPage";
import { pnwPropBool, pnwPropEnum, pnwPropGroup, pnwPropReadonly, pnwPropSheet } from "phoenix-wing";

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
  const worksetStore = useFileWorksetsStore();

  usePnwPagePropertySheet(pageId, () =>
    pnwPropSheet(
      [
      pnwPropGroup("scope", "运行范围", [
        pnwPropReadonly("active_workset", "活动工作集", {
          value: computed(() => worksetStore.activeWorkset?.name || "（未选择）"),
          hint: "侧栏「工作集」Tab 中当前活动集；主区可用「从工作集勾选」",
        }),
        pnwPropReadonly("workset_path_count", "工作集文件数", {
          value: computed(() => {
            const ws = worksetStore.activeWorkset;
            const n = (ws?.entries ?? ws?.paths)?.length ?? 0;
            return n ? String(n) : "—";
          }),
        }),
      ]),
      pnwPropGroup("run", "运行选项", [
        pnwPropBool("include_cpp", ".cpp", {
          value: computed(() => pageStore.includeCpp),
          onChange: (v) => {
            if (!pageStore.setIncludeCpp(v)) {
              onValidationError?.("至少勾选一种源文件类型");
              return;
            }
            onPersistServer?.();
          },
        }),
        pnwPropBool("include_header", "头文件（.h / .hpp）", {
          value: computed(() => pageStore.includeHeader),
          onChange: (v) => {
            if (!pageStore.setIncludeHeader(v)) {
              onValidationError?.("至少勾选一种源文件类型");
              return;
            }
            onPersistServer?.();
          },
        }),
        pnwPropBool("verbose", "详细日志", {
          value: computed(() => pageStore.verbose),
          onChange: (v) => {
            pageStore.setVerbose(v);
            onPersistServer?.();
          },
        }),
      ]),
      pnwPropGroup("kevin_system_code", "KEVIN_SYSTEM_CODE", [
        pnwPropEnum("mode", "处理方式", {
          value: computed(() => pageStore.kevinSystemCodeMode),
          labelTone: "emphasis",
          options: KEVIN_SYSTEM_CODE_OPTIONS.map((o) => ({
            value: o.value,
            label: o.label,
            description: o.description,
          })),
          hint: computed(
            () =>
              KEVIN_SYSTEM_CODE_OPTIONS.find((o) => o.value === pageStore.kevinSystemCodeMode)
                ?.description ?? "",
          ),
          onChange: (v) => {
            pageStore.setKevinSystemCodeMode(v as KevinSystemCodeMode);
            onPersistServer?.();
          },
        }),
      ]),
      pnwPropGroup(
        "ignore",
        "忽略规则",
        [
          pnwPropReadonly("ignore_file", "忽略文件", {
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
