import type { NavItem } from "../types/config";

import { CAA_HOME_PAGE_ID, CAA_EDITOR_PAGE_ID } from "../constants/caaPages";

const EXTRA_LABELS: Record<string, string> = {
  welcome: "欢迎",
  config: "配置",
  [CAA_HOME_PAGE_ID]: "CAA 对话框",
  [CAA_EDITOR_PAGE_ID]: "CAA 对话框",
  part_key_detail: "零件详情",
  rename_analysis: "文件改名",
};

/** 侧栏属性标题：ribbonLabel > navigation.label > 内置表 */
export function resolvePageLabel(pageId: string, navigation: NavItem[]): string {
  const nav = navigation.find((n) => n.page === pageId);
  if (nav?.ribbonLabel) return nav.ribbonLabel;
  if (nav?.label) return nav.label;
  return EXTRA_LABELS[pageId] ?? pageId;
}
