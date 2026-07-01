import { computed } from "vue";
import type { CodeIgnoreForm } from "./useCodeIgnoreForm";
import { usePnwPagePropertySheet } from "phoenix-wing";
import { pnwPropGroup, pnwPropReadonly, pnwPropSheet } from "phoenix-wing";

export function useCodeIgnorePropertySheet(pageId: string, form: CodeIgnoreForm) {
  usePnwPagePropertySheet(pageId, () =>
    pnwPropSheet(
      [
        pnwPropGroup("scope", "生效范围", [
          pnwPropReadonly("consumers", "适用功能", {
            value: computed(() => form.consumerScope.value),
          }),
        ]),
        pnwPropGroup("stats", "规则统计", [
          pnwPropReadonly("merged", "合并生效", {
            value: computed(() => `${form.mergedIgnoreCount.value} 条`),
          }),
          pnwPropReadonly("builtin", "内置", {
            value: computed(() => form.ignoreBuiltinCount.value),
          }),
          pnwPropReadonly("file", "文件", {
            value: computed(() => form.ignoreFilePatterns.value.length),
          }),
          pnwPropReadonly("custom", "自定义", {
            value: computed(() => form.customLineCount.value),
          }),
          pnwPropReadonly("legacy", "旧文件条目", {
            value: computed(() => form.legacySourceCount.value),
            hidden: computed(() => form.legacySourceCount.value <= 0),
          }),
          pnwPropReadonly("process_suggestions", "过程目录推荐", {
            value: computed(() => form.processDirSuggestions.value.length),
            hidden: computed(() => !form.hasProcessSuggestions.value),
          }),
        ]),
        pnwPropGroup("paths", "Git 式忽略文件", [
          pnwPropReadonly("ignore_file", "code.ignore", {
            value: computed(() => form.ignoreFileDisplay.value || ".phoenix/code.ignore"),
            mono: true,
            hint: "磁盘文件，类 .gitignore；非 custom_ignore",
          }),
          pnwPropReadonly("ignore_file_status", "状态", {
            value: computed(() => form.ignoreFileStatus.value),
          }),
        ]),
      ],
      { title: "Code 忽略设定", schemaVersion: 1 },
    ),
  );
}
