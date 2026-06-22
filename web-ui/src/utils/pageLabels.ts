import type { NavItem } from "../types/config";
import { RIBBON_TABS } from "../layout/ribbon/ribbonConfig";

const EXTRA_LABELS: Record<string, string> = {
  welcome: "欢迎",
  config: "配置",
  part_key_detail: "零件详情",
  rename_analysis: "文件改名",
};

/** 侧栏属性标题：Ribbon 覆盖 > navigation > 内置表 */
export function resolvePageLabel(pageId: string, navigation: NavItem[]): string {
  for (const tab of RIBBON_TABS) {
    for (const group of tab.groups) {
      const item = group.items.find((i) => i.pageId === pageId);
      if (item?.label) return item.label;
    }
  }
  const fromNav = navigation.find((n) => n.page === pageId)?.label;
  if (fromNav) return fromNav;
  return EXTRA_LABELS[pageId] ?? pageId;
}
