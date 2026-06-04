import { driver, type DriveStep } from "driver.js";
import "driver.js/dist/driver.css";
import { useOnboardingStore } from "../stores/onboarding";
import { SHELL_TOUR_VERSION } from "../utils/onboardingConstants";
import type { AppShellContext } from "./useAppShell";

const TOUR_STEPS: DriveStep[] = [
  {
    element: "[data-tour='nav-rail']",
    popover: {
      title: "功能导航",
      description: "除主页、配置外，各工具从这里进入。未设置工作空间时，功能项会暂时不可用。",
      side: "right",
      align: "start",
    },
  },
  {
    element: "[data-tour='nav-config']",
    popover: {
      title: "配置",
      description: "工作空间根目录、FreeCAD 安装路径、最近打开列表与界面偏好都在这里维护。",
      side: "right",
      align: "end",
    },
  },
  {
    element: "[data-tour='tab-bar']",
    popover: {
      title: "Tab 栏",
      description: "可同时打开多个文件详情或功能页；点击 × 关闭，关闭全部后回到主页。",
      side: "bottom",
      align: "start",
    },
  },
  {
    element: "[data-tour='workspace-tree']",
    popover: {
      title: "工作空间树",
      description: "浏览当前工作空间下的 FCStd 等文件；点击文件可打开文件详情（由当前页或默认逻辑接管）。",
      side: "left",
      align: "start",
    },
  },
  {
    element: "[data-tour='main-content']",
    popover: {
      title: "主内容区",
      description: "当前 Tab 对应的功能页面显示在这里，例如 CAD 索引、BOM 列表、文件详情等。",
      side: "top",
      align: "center",
    },
  },
  {
    element: "[data-tour='shell-log']",
    popover: {
      title: "运行日志",
      description: "批量扫描、STEP 转换等任务的输出会追加到这里；可在配置或侧栏调整高度与展开。",
      side: "left",
      align: "end",
    },
  },
];

export function useShellTour(shell: AppShellContext) {
  const store = useOnboardingStore();

  async function prepareTourUi() {
    if (!shell.shellLayout.value.right_panel_open) {
      await shell.persistShellLayout({ right_panel_open: true });
    }
    if (!shell.shellLayout.value.log_panel_open) {
      await shell.setLogOpen(true);
    }
    shell.goToPage("home");
    await new Promise((r) => setTimeout(r, 280));
  }

  async function startShellTour(force = false) {
    if (!force && !store.workspaceOk) {
      shell.setStatus("请先配置工作空间后再开始界面巡游");
      shell.goToPage("config");
      return;
    }
    await prepareTourUi();

    const d = driver({
      showProgress: true,
      progressText: "{{current}} / {{total}}",
      nextBtnText: "下一步",
      prevBtnText: "上一步",
      doneBtnText: "完成",
      showButtons: ["next", "previous", "close"],
      steps: TOUR_STEPS,
      onDestroyed: () => {
        store.markShellTourSeen(SHELL_TOUR_VERSION);
      },
    });
    d.drive();
  }

  return { startShellTour, prepareTourUi };
}
