import { computed } from "vue";
import type { SideDock, ShellLayout } from "../types/config";
import { useAppShell } from "./useAppShell";

/** 工作空间树 / 运行日志左·右停靠（与日志是否展开无关，始终可改） */
export function useSideDockPrefs() {
  const shell = useAppShell();

  const treeDock = computed(() => shell.shellLayout.value.workspace_tree_dock);
  const logDock = computed(() => shell.shellLayout.value.shell_log_dock);
  const logPanelOpen = computed(() => shell.shellLayout.value.log_panel_open);

  async function applyDockPrefs(patch: Partial<{ tree: SideDock; log: SideDock; openLog?: boolean }>) {
    const nextTree = patch.tree ?? treeDock.value;
    const nextLog = patch.log ?? logDock.value;
    const layoutPatch: Partial<ShellLayout> = {
      workspace_tree_dock: nextTree,
      shell_log_dock: nextLog,
      right_panel_open: true,
    };
    if (patch.openLog === true) {
      layoutPatch.log_panel_open = true;
    }
    shell.shellLayout.value = {
      ...shell.shellLayout.value,
      workspace_tree_dock: nextTree,
      shell_log_dock: nextLog,
      right_panel_open: true,
      ...(patch.openLog === true ? { log_panel_open: true } : {}),
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

  async function setLogPanelOpen(open: boolean) {
    if (open === logPanelOpen.value) return;
    await shell.setLogOpen(open);
    if (open) {
      await shell.persistShellLayout({ right_panel_open: true });
    }
    shell.setStatus(open ? "已展开运行日志" : "已收起运行日志");
  }

  return {
    treeDock,
    logDock,
    logPanelOpen,
    setTreeDock,
    setLogDock,
    setLogPanelOpen,
  };
}
