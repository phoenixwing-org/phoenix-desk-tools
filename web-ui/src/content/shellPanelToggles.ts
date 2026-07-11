/** 页脚 / Ribbon 面板切换按钮文案（前端静态；后端 shell_layout 仅存开关与布局，不含 tooltip） */

export type ShellPanelToggleKey =
  | "leftSidebar"
  | "rightSidebar"
  | "tree"
  | "properties"
  | "log"
  | "workset"
  | "sideDock";

export const shellPanelToggleCopy = {
  leftSidebar: {
    name: "左栏",
    open: "展开左栏",
    close: "收起左栏",
  },
  rightSidebar: {
    name: "右栏",
    open: "展开右栏",
    close: "收起右栏",
  },
  tree: {
    name: "工作空间树",
    open: "展开工作空间树",
    close: "收起工作空间树",
  },
  properties: {
    name: "页面属性",
    open: "展开页面属性",
    close: "收起页面属性",
  },
  log: {
    name: "运行日志",
    open: "展开运行日志",
    close: "收起运行日志",
    pending: "有新的运行输出",
  },
  workset: {
    name: "侧栏 · 工作集",
    action: "打开侧栏并切换到工作集",
  },
  sideDock: {
    name: "侧栏",
    action: "侧栏位置与块显示",
  },
} as const;

/** 单行 tooltip：名称 — 动作 */
export function shellPanelToggleTip(
  key: ShellPanelToggleKey,
  opts?: { open?: boolean; logPending?: boolean },
): string {
  const c = shellPanelToggleCopy[key];
  if ("action" in c) {
    return `${c.name} — ${c.action}`;
  }
  const open = opts?.open ?? false;
  const action = open ? c.close : c.open;
  let tip = `${c.name} — ${action}`;
  if ("pending" in c && opts?.logPending && !open) {
    tip += `（${c.pending}）`;
  }
  return tip;
}
