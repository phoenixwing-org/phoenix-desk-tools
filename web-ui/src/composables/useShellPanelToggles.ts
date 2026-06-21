import { computed } from "vue";
import { shellPanelToggleTip } from "../content/shellPanelToggles";
import { useAppShell } from "./useAppShell";
import { usePagePropertiesHost } from "./pagePropertiesHost";

/** 工作空间树 / 属性 / 日志 / 工作集 — Ribbon「系统」与页脚共用 */
export function useShellPanelToggles() {
  const shell = useAppShell();
  const { hasProperties } = usePagePropertiesHost();

  const panelOpen = computed(() => shell.shellLayout.value.right_panel_open);
  const logOpen = computed(() => shell.shellLayout.value.log_panel_open);
  const propsOpen = computed(() => shell.shellLayout.value.properties_panel_open);
  const hasLogContent = computed(() => Boolean(shell.logText.value.trim()));

  async function togglePanel() {
    const next = !panelOpen.value;
    await shell.persistShellLayout({ right_panel_open: next });
    shell.setStatus(next ? "已展开侧栏" : "已收起侧栏");
  }

  async function toggleLog() {
    const next = !logOpen.value;
    await shell.setLogOpen(next);
    if (next) {
      await shell.persistShellLayout({ right_panel_open: true });
    }
    shell.setStatus(next ? "已展开运行日志" : "已收起运行日志");
  }

  async function toggleProps() {
    const next = !propsOpen.value;
    await shell.setPropertiesOpen(next);
    if (next) {
      await shell.persistShellLayout({ right_panel_open: true });
    }
    shell.setStatus(next ? "已展开页面属性" : "已收起页面属性");
  }

  async function openWorksetPanel() {
    await shell.openWorksetSidebar();
    shell.setStatus("已打开侧栏 · 工作集");
  }

  const treeTip = computed(() => shellPanelToggleTip("tree", { open: panelOpen.value }));
  const propsTip = computed(() => shellPanelToggleTip("properties", { open: propsOpen.value }));
  const logTip = computed(() =>
    shellPanelToggleTip("log", {
      open: logOpen.value,
      logPending: hasLogContent.value && !logOpen.value,
    }),
  );
  const worksetTip = computed(() => shellPanelToggleTip("workset"));
  const sideDockTip = computed(() => shellPanelToggleTip("sideDock"));

  return {
    panelOpen,
    logOpen,
    propsOpen,
    hasProperties,
    hasLogContent,
    treeTip,
    propsTip,
    logTip,
    worksetTip,
    sideDockTip,
    togglePanel,
    toggleLog,
    toggleProps,
    openWorksetPanel,
  };
}
