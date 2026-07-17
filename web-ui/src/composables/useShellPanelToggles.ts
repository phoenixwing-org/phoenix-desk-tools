import { computed } from "vue";
import { shellPanelToggleTip } from "../content/shellPanelToggles";
import { useAppShell } from "./useAppShell";
import { usePageSideBlockVisibility } from "./usePageSideBlockVisibility";

type RightPanelSnapshot = {
  right_panel_open: boolean;
  properties_panel_open: boolean;
  git_commit_panel_open: boolean;
  workset_panel_open: boolean;
};

let rightPanelSnapshot: RightPanelSnapshot | null = null;

/** VS Code 式三块布局开关：左侧 Primary、下方全局面板、右侧 Secondary。 */
export function useShellPanelToggles() {
  const shell = useAppShell();
  const {
    available: pageBlockAvailable,
    open: pageBlockOpen,
    setOpen: setPageBlockOpen,
  } = usePageSideBlockVisibility(computed(() => shell.currentPage.value));

  const leftSidebarOpen = computed(() => pageBlockAvailable.value && pageBlockOpen.value);
  const logOpen = computed(() => shell.shellLayout.value.log_panel_open);
  const rightSidebarOpen = computed(() => {
    const layout = shell.shellLayout.value;
    return layout.right_panel_open
      || layout.properties_panel_open
      || layout.workset_panel_open
      || (shell.currentPage.value === "git" && layout.git_commit_panel_open);
  });

  const leftSidebarTip = computed(() => shellPanelToggleTip("leftSidebar", {
    open: leftSidebarOpen.value,
  }));
  const logTip = computed(() => shellPanelToggleTip("log", { open: logOpen.value }));
  const rightSidebarTip = computed(() => shellPanelToggleTip("rightSidebar", {
    open: rightSidebarOpen.value,
  }));

  function toggleLeftSidebar(): void {
    if (!pageBlockAvailable.value) return;
    const next = !leftSidebarOpen.value;
    setPageBlockOpen(next);
    shell.setStatus(next ? "已展开左侧 Primary" : "已收起左侧 Primary");
  }

  async function toggleLog(): Promise<void> {
    const next = !logOpen.value;
    await shell.setLogOpen(next);
    shell.setStatus(next ? "已展开下方全局面板" : "已收起下方全局面板");
  }

  async function toggleRightSidebar(): Promise<void> {
    const layout = shell.shellLayout.value;
    let patch: RightPanelSnapshot;
    if (rightSidebarOpen.value) {
      rightPanelSnapshot = {
        right_panel_open: layout.right_panel_open,
        properties_panel_open: layout.properties_panel_open,
        git_commit_panel_open: layout.git_commit_panel_open,
        workset_panel_open: layout.workset_panel_open,
      };
      patch = {
        right_panel_open: false,
        properties_panel_open: false,
        git_commit_panel_open: false,
        workset_panel_open: false,
      };
    } else {
      patch = {
        ...(rightPanelSnapshot ?? {
        right_panel_open: true,
        properties_panel_open: true,
        git_commit_panel_open: shell.currentPage.value === "git",
        workset_panel_open: false,
        }),
        // Secondary 是一个整体；展开时至少显示工作空间树，避免只留下空白占位。
        right_panel_open: true,
      };
    }
    shell.shellLayout.value = { ...layout, ...patch };
    await shell.persistShellLayout(patch);
    shell.setStatus(rightSidebarOpen.value ? "已展开右侧 Secondary" : "已收起右侧 Secondary");
  }

  return {
    leftSidebarOpen,
    rightSidebarOpen,
    logOpen,
    leftSidebarTip,
    rightSidebarTip,
    logTip,
    toggleLeftSidebar,
    toggleRightSidebar,
    toggleLog,
  };
}
