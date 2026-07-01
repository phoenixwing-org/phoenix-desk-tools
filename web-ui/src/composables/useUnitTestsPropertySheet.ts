import { computed, type ComputedRef, type Ref } from "vue";
import type { UnitTestRunResult } from "../api";
import { usePnwPagePropertySheet } from "phoenix-wing";
import { pnwPropGroup, pnwPropReadonly, pnwPropSheet } from "phoenix-wing";
import type { UnitTestsPageTab } from "../stores/unitTestsPage";

const TAB_LABELS: Record<UnitTestsPageTab, string> = {
  results: "测试结果",
  watchlist: "关注列表",
};

export function useUnitTestsPropertySheet(
  pageId: string,
  opts: {
    runCheckedCount: ComputedRef<number>;
    runnableSuiteCount: ComputedRef<number>;
    activeTab: ComputedRef<UnitTestsPageTab>;
    running: Ref<boolean>;
    result: Ref<UnitTestRunResult | null>;
  },
) {
  const { runCheckedCount, runnableSuiteCount, activeTab, running, result } = opts;

  usePnwPagePropertySheet(pageId, () =>
    pnwPropSheet(
      [
        pnwPropGroup("scope", "运行范围", [
          pnwPropReadonly("suites_checked", "勾选套件", {
            value: computed(() => `${runCheckedCount.value} / ${runnableSuiteCount.value}`),
          }),
          pnwPropReadonly("active_tab", "当前视图", {
            value: computed(() => TAB_LABELS[activeTab.value] ?? activeTab.value),
          }),
        ]),
        pnwPropGroup("run", "运行状态", [
          pnwPropReadonly("run_state", "状态", {
            value: computed(() => (running.value ? "运行中" : result.value ? "已完成" : "空闲")),
          }),
          pnwPropReadonly("last_summary", "上次结果", {
            value: computed(() => {
              const r = result.value;
              if (!r?.summary) return "—";
              const s = r.summary;
              const parts = [
                `通过 ${s.passed ?? 0}`,
                `失败 ${s.failed ?? 0}`,
                `跳过 ${s.skipped ?? 0}`,
              ];
              if (s.errors) parts.push(`错误 ${s.errors}`);
              return parts.join(" · ");
            }),
            hidden: computed(() => !result.value?.summary),
          }),
        ]),
      ],
      { title: "单元测试" },
    ),
  );
}
