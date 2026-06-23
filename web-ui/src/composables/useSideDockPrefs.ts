import { computed } from "vue";
import type { SideDock } from "../types/config";
import { useAppShell } from "./useAppShell";

/** 工作空间树 / 运行日志 / 页面属性 — 同侧停靠与块开关 */
export function useSideDockPrefs() {
  const shell = useAppShell();

  const treeDock = computed(() => shell.shellLayout.value.workspace_tree_dock);
  const logDock = computed(() => shell.shellLayout.value.shell_log_dock);
  const propsDock = computed(() => shell.shellLayout.value.properties_panel_dock);
  const logPanelOpen = computed(() => shell.shellLayout.value.log_panel_open);
  const propsPanelOpen = computed(() => shell.shellLayout.value.properties_panel_open);
  const gitCommitPanelOpen = computed(() => shell.shellLayout.value.git_commit_panel_open);
  const gitCommitDock = computed(() => shell.shellLayout.value.git_commit_panel_dock);
  const treePanelOpen = computed(() => shell.shellLayout.value.right_panel_open);
  const onGitPage = computed(() => shell.currentPage.value === "git");

  const unifiedDockSide = computed((): SideDock => {
    const docks = [treeDock.value, logDock.value, propsDock.value];
    if (docks.every((d) => d === "left")) return "left";
    if (docks.every((d) => d === "right")) return "right";
    return treeDock.value;
  });

  const dockMixed = computed(
    () => !(treeDock.value === logDock.value && logDock.value === propsDock.value),
  );

  async function applyDockPrefs(
    patch: Partial<{
      tree: SideDock;
      log: SideDock;
      props: SideDock;
      openTree?: boolean;
      openLog?: boolean;
      openProps?: boolean;
    }>,
  ) {
    const nextTree = patch.tree ?? treeDock.value;
    const nextLog = patch.log ?? logDock.value;
    const nextProps = patch.props ?? propsDock.value;
    const layoutPatch = {
      workspace_tree_dock: nextTree,
      shell_log_dock: nextLog,
      properties_panel_dock: nextProps,
      ...(patch.openTree === true ? { right_panel_open: true } : {}),
      ...(patch.openLog === true ? { log_panel_open: true } : {}),
      ...(patch.openProps === true ? { properties_panel_open: true } : {}),
    };
    shell.shellLayout.value = {
      ...shell.shellLayout.value,
      ...layoutPatch,
    };
    await shell.persistShellLayout(layoutPatch);
    shell.setStatus("侧栏布局已保存");
  }

  async function setTreeDock(side: SideDock) {
    if (side === treeDock.value) return;
    await applyDockPrefs({ tree: side });
  }

  async function setLogDock(side: SideDock) {
    if (side === logDock.value) return;
    await applyDockPrefs({ log: side });
  }

  async function setPropsDock(side: SideDock) {
    if (side === propsDock.value) return;
    await applyDockPrefs({ props: side });
  }

  async function setUnifiedDockSide(side: SideDock) {
    if (side === unifiedDockSide.value && !dockMixed.value) return;
    await applyDockPrefs({ tree: side, log: side, props: side });
  }

  async function setTreePanelOpen(open: boolean) {
    if (open === treePanelOpen.value) return;
    shell.shellLayout.value = {
      ...shell.shellLayout.value,
      right_panel_open: open,
    };
    await shell.persistShellLayout({ right_panel_open: open });
    shell.setStatus(open ? "已显示工作空间树" : "已隐藏工作空间树");
  }

  async function setLogPanelOpen(open: boolean) {
    if (open === logPanelOpen.value) return;
    await shell.setLogOpen(open);
    shell.setStatus(open ? "已显示运行日志" : "已隐藏运行日志");
  }

  async function setPropsPanelOpen(open: boolean) {
    if (open === propsPanelOpen.value) return;
    await shell.setPropertiesOpen(open);
    shell.setStatus(open ? "已显示页面属性" : "已隐藏页面属性");
  }

  async function setGitCommitDock(side: SideDock) {
    if (side === gitCommitDock.value) return;
    const prev = shell.shellLayout.value.git_commit_panel_dock;
    shell.shellLayout.value = {
      ...shell.shellLayout.value,
      git_commit_panel_dock: side,
    };
    try {
      await shell.persistShellLayout({ git_commit_panel_dock: side });
      shell.setStatus("侧栏布局已保存");
    } catch (e) {
      shell.shellLayout.value = {
        ...shell.shellLayout.value,
        git_commit_panel_dock: prev,
      };
      shell.setStatus(`侧栏布局保存失败：${e}`);
    }
  }

  async function setGitCommitPanelOpen(open: boolean) {
    if (open === gitCommitPanelOpen.value) return;
    shell.shellLayout.value = {
      ...shell.shellLayout.value,
      git_commit_panel_open: open,
    };
    await shell.persistShellLayout({ git_commit_panel_open: open });
    shell.setStatus(open ? "已显示 Git 提交" : "已隐藏 Git 提交");
  }

  return {
    unifiedDockSide,
    dockMixed,
    treeDock,
    logDock,
    propsDock,
    treePanelOpen,
    logPanelOpen,
    propsPanelOpen,
    gitCommitPanelOpen,
    gitCommitDock,
    onGitPage,
    setUnifiedDockSide,
    setTreeDock,
    setLogDock,
    setPropsDock,
    setGitCommitDock,
    setTreePanelOpen,
    setLogPanelOpen,
    setPropsPanelOpen,
    setGitCommitPanelOpen,
  };
}
