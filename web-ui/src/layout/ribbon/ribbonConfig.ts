import type { NavItem } from "../../types/config";
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

const SHELL_GROUPS: Array<{ id: string; label: string; pages: string[] }> = [
  { id: "system-common", label: "常用", pages: ["home", "audio_extract", "config"] },
  { id: "system-dev", label: "开发", pages: ["git", "test_fixtures", "unit_tests"] },
];

const MODULE_LABELS: Record<string, string> = {
  cad: "CAD",
  code: "Code",
};

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

  const moduleTabs = new Map<string, RibbonTabDef>();
  const moduleGroups = new Map<string, Map<string, RibbonGroupDef>>();
  for (const nav of navigation) {
    const module = String(nav.module || "").trim();
    const groupLabel = String(nav.ribbonGroup || "").trim();
    if (!module || !groupLabel) continue;

    let tab = moduleTabs.get(module);
    if (!tab) {
      tab = {
        id: module,
        label: MODULE_LABELS[module] || module,
        module,
        groups: [],
      };
      moduleTabs.set(module, tab);
      moduleGroups.set(module, new Map());
    }

    const groups = moduleGroups.get(module)!;
    let group = groups.get(groupLabel);
    if (!group) {
      group = {
        id: `${module}-group-${groups.size + 1}`,
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
