import type { NavItem } from "../../types/config";
import { FREECAD_MCP_MANAGE_ACTION } from "../../features/freecad-mcp/navigation";
import { SHARED_TOOL_PAGE_IDS, TOOL_NAV_MODULE_IDS } from "../../constants/navModules";
import {
  pnwCheckRibbonContributionCompatibility,
  type PnwRibbonGroupDef,
  type PnwRibbonItemDef,
  type PnwRibbonItemSize,
  type PnwRibbonTabDef,
} from "phoenix-wing";

export type RibbonItemSize = PnwRibbonItemSize;
export type RibbonItemDef = PnwRibbonItemDef;
export type RibbonGroupDef = PnwRibbonGroupDef;
export type RibbonTabDef = PnwRibbonTabDef;

export const RIBBON_SHELL_TAB_ID = "system";
/** 保留已持久化的 CAD Ribbon ID，只合并显示，不重写领域 module。 */
export const RIBBON_TOOLS_TAB_ID = "cad";

const SHELL_GROUPS: Array<{ id: string; label: string; pages: string[] }> = [
  { id: "system-common", label: "常用", pages: ["home", "config"] },
  { id: "system-dev", label: "开发", pages: ["git", "test_fixtures", "unit_tests"] },
];

function ribbonItem(nav: NavItem): RibbonItemDef {
  return {
    pageId: nav.page,
    // 0.6 导航树与旧 Ribbon 共用同一来源；短标题仍可由页面贡献覆盖。
    label: nav.ribbonLabel || nav.label,
  };
}

/** Build the visible Ribbon from the same navigation config that owns page labels and modules. */
export function buildRibbonTabs(navigation: NavItem[]): RibbonTabDef[] {
  const byPage = new Map(navigation.map((nav) => [nav.page, nav]));
  const shellGroups = SHELL_GROUPS.map((group) => ({
    id: group.id,
    label: group.label,
    items: group.pages.map((page) => byPage.get(page)).filter(Boolean).map((nav) => ribbonItem(nav!)),
  })).filter((group) => group.items.length > 0);
  if (byPage.has("config")) shellGroups.push({
    id: "system-freecad", label: "FreeCAD", items: [{ pageId: FREECAD_MCP_MANAGE_ACTION, label: "MCP 管理" }],
  });

  const moduleTabs = new Map<string, RibbonTabDef>();
  const moduleGroups = new Map<string, Map<string, RibbonGroupDef>>();
  for (const nav of navigation) {
    const module = String(nav.module || "").trim();
    const groupLabel = String(nav.ribbonGroup || "").trim();
    if (!groupLabel) continue;
    const isToolsTab = TOOL_NAV_MODULE_IDS.includes(module) || SHARED_TOOL_PAGE_IDS.includes(nav.page);
    const tabId = isToolsTab ? RIBBON_TOOLS_TAB_ID : module;
    if (!tabId) continue;

    let tab = moduleTabs.get(tabId);
    if (!tab) {
      tab = {
        id: tabId,
        label: isToolsTab ? "工具" : module,
        // The aggregate has several domains and shared tools. Visibility must
        // be filtered per navigation item before grouping, not by this tab.
        ...(isToolsTab ? {} : { module }),
        groups: [],
      };
      moduleTabs.set(tabId, tab);
      moduleGroups.set(tabId, new Map());
    }

    const groups = moduleGroups.get(tabId)!;
    let group = groups.get(groupLabel);
    if (!group) {
      group = {
        id: `${tabId}-group-${groups.size + 1}`,
        label: groupLabel,
        items: [],
      };
      groups.set(groupLabel, group);
      tab.groups.push(group);
    }
    if (!group.items.some((item) => item.pageId === nav.page)) {
      group.items.push(ribbonItem(nav));
    }
  }

  const document = {
    kind: "phoenix.ribbon-contributions" as const,
    schemaVersion: 1 as const,
    tabs: [
      { id: RIBBON_SHELL_TAB_ID, label: "系统", groups: shellGroups },
      ...moduleTabs.values(),
    ],
  };
  const compatibility = pnwCheckRibbonContributionCompatibility(document);
  if (!compatibility.compatible) {
    throw new Error(`Wing Ribbon contribution rejected: ${compatibility.code}`);
  }
  return [...compatibility.document.tabs];
}
