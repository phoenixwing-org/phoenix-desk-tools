/** 页脚 / Ribbon 面板切换按钮文案（前端静态；后端 shell_layout 仅存开关与布局，不含 tooltip） */

export type ShellPanelToggleKey = "tree" | "properties" | "log" | "workset" | "sideDock";

export const shellPanelToggleCopy = {
  tree: {
    name: "工作空间树 / 侧栏",
    open: "展开侧栏",
    close: "收起侧栏",
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
    name: "侧栏停靠",
    action: "设置树 / 属性 / 日志 左·右停靠",
  },
} as const;

/** 单行 tooltip：名称 — 动作 */
export function shellPanelToggleTip(
  key: ShellPanelToggleKey,
  opts?: { open?: boolean; logPending?: boolean },
): string {
  const c = shellPanelToggleCopy[key];
  if (key === "workset" || key === "sideDock") {
    return `${c.name} — ${c.action}`;
  }
  const open = opts?.open ?? false;
  const action = open ? c.close : c.open;
  let tip = `${c.name} — ${action}`;
  if (key === "log" && opts?.logPending && !open) {
    tip += `（${c.pending}）`;
  }
  return tip;
}
