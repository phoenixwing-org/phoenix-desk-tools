import { computed } from "vue";
import type { SideDock, ShellLayout } from "../types/config";
import { useAppShell } from "./useAppShell";

/** 工作空间树 / 运行日志 / 页面属性 左·右停靠 */
export function useSideDockPrefs() {
  const shell = useAppShell();

  const treeDock = computed(() => shell.shellLayout.value.workspace_tree_dock);
  const logDock = computed(() => shell.shellLayout.value.shell_log_dock);
  const propsDock = computed(() => shell.shellLayout.value.properties_panel_dock);
  const logPanelOpen = computed(() => shell.shellLayout.value.log_panel_open);
  const propsPanelOpen = computed(() => shell.shellLayout.value.properties_panel_open);

  async function applyDockPrefs(
    patch: Partial<{ tree: SideDock; log: SideDock; props: SideDock; openLog?: boolean; openProps?: boolean }>,
  ) {
    const nextTree = patch.tree ?? treeDock.value;
    const nextLog = patch.log ?? logDock.value;
    const nextProps = patch.props ?? propsDock.value;
    const layoutPatch: Partial<ShellLayout> = {
      workspace_tree_dock: nextTree,
      shell_log_dock: nextLog,
      properties_panel_dock: nextProps,
      right_panel_open: true,
    };
    if (patch.openLog === true) {
      layoutPatch.log_panel_open = true;
    }
    if (patch.openProps === true) {
      layoutPatch.properties_panel_open = true;
    }
    shell.shellLayout.value = {
      ...shell.shellLayout.value,
      workspace_tree_dock: nextTree,
      shell_log_dock: nextLog,
      properties_panel_dock: nextProps,
      right_panel_open: true,
      ...(patch.openLog === true ? { log_panel_open: true } : {}),
      ...(patch.openProps === true ? { properties_panel_open: true } : {}),
    };
    await shell.persistShellLayout(layoutPatch);
    shell.setStatus("侧栏停靠已保存");
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

  async function setLogPanelOpen(open: boolean) {
    if (open === logPanelOpen.value) return;
    await shell.setLogOpen(open);
    if (open) {
      await shell.persistShellLayout({ right_panel_open: true });
    }
    shell.setStatus(open ? "已展开运行日志" : "已收起运行日志");
  }

  async function setPropsPanelOpen(open: boolean) {
    if (open === propsPanelOpen.value) return;
    await shell.setPropertiesOpen(open);
    if (open) {
      await shell.persistShellLayout({ right_panel_open: true });
    }
    shell.setStatus(open ? "已展开页面属性" : "已收起页面属性");
  }

  return {
    treeDock,
    logDock,
    propsDock,
    logPanelOpen,
    propsPanelOpen,
    setTreeDock,
    setLogDock,
    setPropsDock,
    setLogPanelOpen,
    setPropsPanelOpen,
  };
}
