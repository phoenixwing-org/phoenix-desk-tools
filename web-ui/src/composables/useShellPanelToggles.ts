import { computed } from "vue";
import { shellPanelToggleTip } from "../content/shellPanelToggles";
import { useAppShell } from "./useAppShell";
import type { SideDock } from "../types/config";
import {
  buildCollapseSidePatch,
  buildExpandSidePatch,
  isSideVisible,
  sideHasDockedPanels,
  snapshotPanelsOnSide,
  type SidePanelSnapshot,
} from "../utils/sidebarSideToggle";
import { sideDockVisibility } from "../utils/sideDockLayout";

const collapsedSnapshots: { left: SidePanelSnapshot | null; right: SidePanelSnapshot | null } = {
  left: null,
  right: null,
};

/** 左/右栏与侧栏块开关 — Ribbon「系统」与页脚共用 */
export function useShellPanelToggles() {
  const shell = useAppShell();
  const dockVis = computed(() =>
    sideDockVisibility(shell.shellLayout.value, {
      onGitPage: shell.currentPage.value === "git",
      onCaaPage: shell.currentPage.value === "caa_dialog",
    }),
  );

  const leftSidebarOpen = computed(() => dockVis.value.leftVisible);
  const rightSidebarOpen = computed(() => dockVis.value.rightVisible);
  const leftSidebarDocked = computed(() => sideHasDockedPanels(shell.shellLayout.value, "left"));
  const rightSidebarDocked = computed(() => sideHasDockedPanels(shell.shellLayout.value, "right"));

  const treeOpen = computed(() => shell.shellLayout.value.right_panel_open);
  const logOpen = computed(() => shell.shellLayout.value.log_panel_open);
  const propsOpen = computed(() => shell.shellLayout.value.properties_panel_open);
  const hasLogContent = computed(() => Boolean(shell.logText.value.trim()));

  async function toggleSide(side: SideDock) {
    const layout = shell.shellLayout.value;
    const onGitPage = shell.currentPage.value === "git";
    const onCaaPage = shell.currentPage.value === "caa_dialog";
    const visible = isSideVisible(layout, side, { onGitPage, onCaaPage });
    if (visible) {
      collapsedSnapshots[side] = snapshotPanelsOnSide(layout, side);
      const patch = buildCollapseSidePatch(layout, side);
      shell.shellLayout.value = { ...layout, ...patch };
      await shell.persistShellLayout(patch);
      shell.setStatus(side === "left" ? "已收起左栏" : "已收起右栏");
      return;
    }
    const patch = buildExpandSidePatch(layout, side, collapsedSnapshots[side]);
    shell.shellLayout.value = { ...layout, ...patch };
    await shell.persistShellLayout(patch);
    shell.setStatus(side === "left" ? "已展开左栏" : "已展开右栏");
  }

  async function toggleLeftSidebar() {
    await toggleSide("left");
  }

  async function toggleRightSidebar() {
    await toggleSide("right");
  }

  async function togglePanel() {
    const next = !treeOpen.value;
    await shell.persistShellLayout({ right_panel_open: next });
    shell.setStatus(next ? "已展开工作空间树" : "已收起工作空间树");
  }

  async function toggleLog() {
    const next = !logOpen.value;
    await shell.setLogOpen(next);
    shell.setStatus(next ? "已展开运行日志" : "已收起运行日志");
  }

  async function toggleProps() {
    const next = !propsOpen.value;
    await shell.setPropertiesOpen(next);
    shell.setStatus(next ? "已展开页面属性" : "已收起页面属性");
  }

  const leftSidebarTip = computed(() =>
    shellPanelToggleTip("leftSidebar", { open: leftSidebarOpen.value }),
  );
  const rightSidebarTip = computed(() =>
    shellPanelToggleTip("rightSidebar", { open: rightSidebarOpen.value }),
  );
  const treeTip = computed(() => shellPanelToggleTip("tree", { open: treeOpen.value }));
  const propsTip = computed(() => shellPanelToggleTip("properties", { open: propsOpen.value }));
  const logTip = computed(() =>
    shellPanelToggleTip("log", {
      open: logOpen.value,
      logPending: hasLogContent.value && !logOpen.value,
    }),
  );
  const sideDockTip = computed(() => shellPanelToggleTip("sideDock"));

  return {
    leftSidebarOpen,
    rightSidebarOpen,
    leftSidebarDocked,
    rightSidebarDocked,
    treeOpen,
    logOpen,
    propsOpen,
    hasLogContent,
    leftSidebarTip,
    rightSidebarTip,
    treeTip,
    propsTip,
    logTip,
    sideDockTip,
    toggleLeftSidebar,
    toggleRightSidebar,
    togglePanel,
    toggleLog,
    toggleProps,
  };
}
