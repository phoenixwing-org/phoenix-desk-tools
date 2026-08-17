import { computed, toValue } from "vue";
import { useAppShell, type AppShellContext } from "./useAppShell";
import {
  useGlobalWorkbenchBottomContribution,
  type WorkbenchBottomContributionTab,
} from "./useWorkbenchBottomContribution";
import type { PnwBottomPanelTab } from "phoenix-wing";

/**
 * AppShell 自身 setup 需要显式传入刚创建的 context；其后代组件仍可通过 inject 使用。
 */
export function usePdtWorkbenchBottomPanel(shell?: AppShellContext) {
  const pdtShell = shell ?? useAppShell();
  const contribution = useGlobalWorkbenchBottomContribution();
  const runtimeLogLineCount = computed(() => pdtShell.logText.value
    .split(/\r?\n/)
    .filter(Boolean)
    .length);
  const contributedTabs = computed(() => contribution.value ? toValue(contribution.value.tabs) : []);
  const sourceLabel = computed(() => {
    const value = contribution.value?.sourceLabel;
    return value ? toValue(value) : "工作台";
  });
  const contributionSummary = computed(() => {
    const value = contribution.value?.summary;
    return value ? toValue(value) : "";
  });
  const contributionProps = computed(() => {
    const value = contribution.value?.props;
    return value ? toValue(value) : {};
  });
  const tabs = computed<readonly PnwBottomPanelTab[]>(() => [
    ...contributedTabs.value.map((tab: WorkbenchBottomContributionTab) => ({
      id: tab.id,
      label: tab.label,
      count: tab.count == null ? undefined : toValue(tab.count),
      tone: tab.tone == null ? undefined : toValue(tab.tone),
    })),
    { id: "output", label: "运行日志", count: runtimeLogLineCount.value },
  ]);

  function contentTab(tabId: WorkbenchBottomContributionTab["id"]) {
    return contributedTabs.value.find((item) => item.id === tabId);
  }

  function summary(activeTabId: string): string {
    if (activeTabId === "output") return `全局运行日志 · ${runtimeLogLineCount.value} 行`;
    if (contributionSummary.value) return `${sourceLabel.value} · ${contributionSummary.value}`;
    return "全局面板会保留最近的预检与问题；切换 View 不会销毁";
  }

  return {
    shell: pdtShell,
    contribution,
    contributionProps,
    tabs,
    contentTab,
    summary,
  };
}
