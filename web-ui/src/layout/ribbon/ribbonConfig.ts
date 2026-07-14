import type { NavItem } from "../../types/config";

export type RibbonItemSize = "large" | "small";

export type RibbonItemDef = {
  pageId: string;
  label?: string;
  size?: RibbonItemSize;
};

export type RibbonGroupDef = {
  id: string;
  label: string;
  items: RibbonItemDef[];
};

export type RibbonTabDef = {
  id: string;
  label: string;
  module?: string;
  groups: RibbonGroupDef[];
};

export const RIBBON_SHELL_TAB_ID = "system";

const SHELL_GROUPS: Array<{ id: string; label: string; pages: string[] }> = [
  { id: "system-common", label: "常用", pages: ["home", "config"] },
  { id: "system-dev", label: "开发", pages: ["git", "test_fixtures", "unit_tests"] },
];

const MODULE_LABELS: Record<string, string> = {
  cad: "CAD",
  code: "Code",
};

function ribbonItem(nav: NavItem): RibbonItemDef {
  return {
    pageId: nav.page,
    ...(nav.ribbonLabel ? { label: nav.ribbonLabel } : {}),
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

  return [
    { id: RIBBON_SHELL_TAB_ID, label: "系统", groups: shellGroups },
    ...moduleTabs.values(),
  ];
}
