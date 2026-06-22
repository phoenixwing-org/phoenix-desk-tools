import { computed } from "vue";
import type { CodeIgnoreForm } from "./useCodeIgnoreForm";
import { usePagePropertySheet } from "./usePagePropertySheet";
import { propGroup, propReadonly, propSheet } from "../utils/pagePropertySchema";

export function useCodeIgnorePropertySheet(pageId: string, form: CodeIgnoreForm) {
  usePagePropertySheet(pageId, () =>
    propSheet(
      [
        propGroup("scope", "生效范围", [
          propReadonly("consumers", "适用功能", {
            value: computed(() => form.consumerScope.value),
          }),
        ]),
        propGroup("stats", "规则统计", [
          propReadonly("merged", "合并生效", {
            value: computed(() => `${form.mergedIgnoreCount.value} 条`),
          }),
          propReadonly("builtin", "内置", {
            value: computed(() => form.ignoreBuiltinCount.value),
          }),
          propReadonly("file", "文件", {
            value: computed(() => form.ignoreFilePatterns.value.length),
          }),
          propReadonly("custom", "自定义", {
            value: computed(() => form.customLineCount.value),
          }),
          propReadonly("legacy", "旧文件条目", {
            value: computed(() => form.legacySourceCount.value),
            hidden: computed(() => form.legacySourceCount.value <= 0),
          }),
          propReadonly("process_suggestions", "过程目录推荐", {
            value: computed(() => form.processDirSuggestions.value.length),
            hidden: computed(() => !form.hasProcessSuggestions.value),
          }),
        ]),
        propGroup("paths", "忽略文件", [
          propReadonly("ignore_file", "路径", {
            value: computed(() => form.ignoreFileDisplay.value || ".phoenix/code.ignore"),
            mono: true,
          }),
          propReadonly("ignore_file_status", "状态", {
            value: computed(() => form.ignoreFileStatus.value),
          }),
        ]),
      ],
      { title: "Code 忽略设定", schemaVersion: 1 },
    ),
  );
}
