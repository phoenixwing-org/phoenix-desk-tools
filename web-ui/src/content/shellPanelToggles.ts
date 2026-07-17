/** 页脚 / Ribbon 面板切换按钮文案（前端静态；后端 shell_layout 仅存开关与布局，不含 tooltip） */

export type ShellPanelToggleKey =
  | "leftSidebar"
  | "rightSidebar"
  | "pageBlock"
  | "tree"
  | "properties"
  | "log"
  | "workset"
  | "sideDock";

export const shellPanelToggleCopy = {
  leftSidebar: {
    name: "左侧 Primary",
    open: "展开左侧 Primary",
    close: "收起左侧 Primary",
  },
  rightSidebar: {
    name: "右侧 Secondary",
    open: "展开右侧 Secondary",
    close: "收起右侧 Secondary",
  },
  pageBlock: {
    name: "页面 Block",
    open: "显示页面 Block",
    close: "隐藏页面 Block",
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
    name: "下方全局面板",
    open: "展开下方全局面板",
    close: "收起下方全局面板",
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
  opts?: { open?: boolean; logPending?: boolean; name?: string },
): string {
  const c = shellPanelToggleCopy[key];
  const name = opts?.name?.trim() || c.name;
  if ("action" in c) {
    return `${name} — ${c.action}`;
  }
  const open = opts?.open ?? false;
  const action = open ? c.close : c.open;
  let tip = `${name} — ${action}`;
  if ("pending" in c && opts?.logPending && !open) {
    tip += `（${c.pending}）`;
  }
  return tip;
}
