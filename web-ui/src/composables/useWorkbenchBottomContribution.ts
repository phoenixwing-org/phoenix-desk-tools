import {
  computed,
  onActivated,
  onMounted,
  onUnmounted,
  ref,
  shallowReactive,
  toValue,
  type Component,
  type MaybeRefOrGetter,
} from "vue";

export type WorkbenchBottomResolvable<T> = MaybeRefOrGetter<T>;

export type WorkbenchBottomContributionTab = {
  id: "preflight" | "problems";
  label: string;
  count?: WorkbenchBottomResolvable<number>;
  tone?: WorkbenchBottomResolvable<"default" | "warning" | "error">;
};

export type WorkbenchBottomContribution = {
  sourceLabel?: WorkbenchBottomResolvable<string>;
  summary?: WorkbenchBottomResolvable<string>;
  tabs: WorkbenchBottomResolvable<readonly WorkbenchBottomContributionTab[]>;
  component: Component;
  props?: WorkbenchBottomResolvable<Record<string, unknown>>;
};

const contributions = shallowReactive(new Map<string, WorkbenchBottomContribution>());
const activeContributionKey = ref("");
const activePanelTab = ref<"preflight" | "problems" | "output">("preflight");

export function workbenchBottomContributionKey(pageId: string, workbenchTabId?: string): string {
  return workbenchTabId?.trim() || pageId.trim();
}

function fallbackContributionKey(): string {
  return [...contributions.keys()].at(-1) ?? "";
}

export function setWorkbenchBottomContribution(
  pageId: string,
  workbenchTabId: string | undefined,
  contribution: WorkbenchBottomContribution | null,
  activate = false,
): void {
  const key = workbenchBottomContributionKey(pageId, workbenchTabId);
  if (!key) return;
  if (contribution) {
    contributions.set(key, contribution);
    if (activate || !activeContributionKey.value) activeContributionKey.value = key;
    return;
  }
  contributions.delete(key);
  if (activeContributionKey.value === key) activeContributionKey.value = fallbackContributionKey();
}

export function activateWorkbenchBottomContribution(pageId: string, workbenchTabId?: string): void {
  const key = workbenchBottomContributionKey(pageId, workbenchTabId);
  if (contributions.has(key)) activeContributionKey.value = key;
}

/**
 * 页面只贡献全局面板内容，不拥有面板实例。
 *
 * 面板宿主位于 AppShell；页面切走后最近一次贡献仍保留，因而高度、页签和内容不会
 * 随 View 销毁。再次激活同类多 Tab 页面时只切换贡献上下文。
 */
export function useWorkbenchBottomContribution(
  pageId: string,
  workbenchTabId: string | undefined,
  contribution: WorkbenchBottomContribution,
): void {
  const activate = () => setWorkbenchBottomContribution(pageId, workbenchTabId, contribution, true);
  activate();
  onMounted(activate);
  onActivated(activate);
  onUnmounted(() => {
    const key = workbenchBottomContributionKey(pageId, workbenchTabId);
    if (contributions.get(key) === contribution) {
      setWorkbenchBottomContribution(pageId, workbenchTabId, null);
    }
  });
}

export function useGlobalWorkbenchBottomContribution() {
  return computed(() => contributions.get(activeContributionKey.value));
}

export function useWorkbenchBottomPanelState() {
  return {
    activeTab: activePanelTab,
    setActiveTab(tab: "preflight" | "problems" | "output") {
      activePanelTab.value = tab;
    },
  };
}

export function resolveWorkbenchBottomValue<T>(value: WorkbenchBottomResolvable<T>): T {
  return toValue(value);
}
