export type CaaControlPriority = "P0" | "P1" | "P2";
export type CaaControlPreviewKind = "component" | "grayBox";

export type CaaControlCatalogEntry = {
  type: string;
  label: string;
  group: string;
  priority: CaaControlPriority;
  idPrefix: string;
  palette: boolean;
  canContainChildren: boolean;
  preview: CaaControlPreviewKind;
  nls: {
    hasTitle: boolean;
    hasHelp: boolean;
  };
  defaultTitle: boolean;
};

export type CaaControlPaletteGroup = {
  label: string;
  items: Array<Pick<CaaControlCatalogEntry, "type" | "label" | "priority" | "preview">>;
};

export const CAA_CONTROL_CATALOG_VERSION = 1;

export const CAA_CONTROL_CATALOG: readonly CaaControlCatalogEntry[] = [
  { type: "CATDlgDialog", label: "Dialog", group: "容器", priority: "P0", idPrefix: "Dialog", palette: false, canContainChildren: true, preview: "component", nls: { hasTitle: true, hasHelp: false }, defaultTitle: false },
  { type: "CATDlgFrame", label: "Frame", group: "容器", priority: "P0", idPrefix: "Frame", palette: true, canContainChildren: true, preview: "component", nls: { hasTitle: false, hasHelp: true }, defaultTitle: false },
  { type: "CATDlgTabContainer", label: "Tab", group: "容器", priority: "P1", idPrefix: "TabContainer", palette: true, canContainChildren: false, preview: "component", nls: { hasTitle: false, hasHelp: false }, defaultTitle: false },
  { type: "CATDlgTabPage", label: "TabPage", group: "容器", priority: "P1", idPrefix: "TabPage", palette: false, canContainChildren: true, preview: "component", nls: { hasTitle: true, hasHelp: false }, defaultTitle: false },
  { type: "CATDlgContainer", label: "Container", group: "容器", priority: "P2", idPrefix: "Container", palette: true, canContainChildren: true, preview: "component", nls: { hasTitle: false, hasHelp: false }, defaultTitle: false },
  { type: "CATDlgSplitter", label: "Splitter", group: "容器", priority: "P2", idPrefix: "Splitter", palette: false, canContainChildren: true, preview: "grayBox", nls: { hasTitle: false, hasHelp: false }, defaultTitle: false },
  { type: "CATDlgIconBox", label: "IconBox", group: "P2 灰盒", priority: "P2", idPrefix: "IconBox", palette: false, canContainChildren: false, preview: "grayBox", nls: { hasTitle: false, hasHelp: true }, defaultTitle: false },
  { type: "CATDlgMenuBar", label: "MenuBar", group: "菜单/工具栏", priority: "P2", idPrefix: "MenuBar", palette: false, canContainChildren: true, preview: "grayBox", nls: { hasTitle: false, hasHelp: false }, defaultTitle: false },
  { type: "CATDlgToolBar", label: "ToolBar", group: "菜单/工具栏", priority: "P2", idPrefix: "ToolBar", palette: false, canContainChildren: true, preview: "grayBox", nls: { hasTitle: false, hasHelp: false }, defaultTitle: false },
  { type: "CATDlgStatusBar", label: "StatusBar", group: "菜单/工具栏", priority: "P2", idPrefix: "StatusBar", palette: false, canContainChildren: true, preview: "grayBox", nls: { hasTitle: false, hasHelp: false }, defaultTitle: false },
  { type: "CATDlgSubMenu", label: "SubMenu", group: "菜单/工具栏", priority: "P2", idPrefix: "SubMenu", palette: false, canContainChildren: true, preview: "grayBox", nls: { hasTitle: true, hasHelp: true }, defaultTitle: false },
  { type: "CATDlgMenuItem", label: "MenuItem", group: "菜单/工具栏", priority: "P2", idPrefix: "MenuItem", palette: false, canContainChildren: false, preview: "grayBox", nls: { hasTitle: true, hasHelp: true }, defaultTitle: false },
  { type: "CATDlgToolBarItem", label: "ToolBarItem", group: "菜单/工具栏", priority: "P2", idPrefix: "ToolBarItem", palette: false, canContainChildren: false, preview: "grayBox", nls: { hasTitle: true, hasHelp: true }, defaultTitle: false },
  { type: "CATDlgPushItem", label: "PushItem", group: "菜单/工具栏", priority: "P2", idPrefix: "PushItem", palette: false, canContainChildren: false, preview: "grayBox", nls: { hasTitle: true, hasHelp: true }, defaultTitle: false },
  { type: "CATDlgCheckItem", label: "CheckItem", group: "菜单/工具栏", priority: "P2", idPrefix: "CheckItem", palette: false, canContainChildren: false, preview: "grayBox", nls: { hasTitle: true, hasHelp: true }, defaultTitle: false },
  { type: "CATDlgRadioItem", label: "RadioItem", group: "菜单/工具栏", priority: "P2", idPrefix: "RadioItem", palette: false, canContainChildren: false, preview: "grayBox", nls: { hasTitle: true, hasHelp: true }, defaultTitle: false },
  { type: "CATDlgSeparatorItem", label: "SeparatorItem", group: "菜单/工具栏", priority: "P2", idPrefix: "SeparatorItem", palette: false, canContainChildren: false, preview: "grayBox", nls: { hasTitle: false, hasHelp: false }, defaultTitle: false },
  { type: "CATDlgLabel", label: "Label", group: "基础控件", priority: "P0", idPrefix: "Label", palette: true, canContainChildren: false, preview: "component", nls: { hasTitle: true, hasHelp: true }, defaultTitle: true },
  { type: "CATDlgEditor", label: "Editor", group: "基础控件", priority: "P0", idPrefix: "Editor", palette: true, canContainChildren: false, preview: "component", nls: { hasTitle: false, hasHelp: true }, defaultTitle: true },
  { type: "CATDlgPushButton", label: "Button", group: "基础控件", priority: "P0", idPrefix: "PushButton", palette: true, canContainChildren: false, preview: "component", nls: { hasTitle: true, hasHelp: true }, defaultTitle: true },
  { type: "CATDlgCombo", label: "Combo", group: "基础控件", priority: "P1", idPrefix: "Combo", palette: true, canContainChildren: false, preview: "component", nls: { hasTitle: false, hasHelp: true }, defaultTitle: true },
  { type: "CATDlgCheckButton", label: "Check", group: "基础控件", priority: "P1", idPrefix: "CheckButton", palette: true, canContainChildren: false, preview: "component", nls: { hasTitle: true, hasHelp: true }, defaultTitle: true },
  { type: "CATDlgRadioButton", label: "Radio", group: "基础控件", priority: "P1", idPrefix: "RadioButton", palette: true, canContainChildren: false, preview: "component", nls: { hasTitle: true, hasHelp: true }, defaultTitle: true },
  { type: "CATDlgSpinner", label: "Spinner", group: "基础控件", priority: "P0", idPrefix: "Spinner", palette: true, canContainChildren: false, preview: "component", nls: { hasTitle: false, hasHelp: true }, defaultTitle: true },
  { type: "CATDlgSelectorList", label: "SelList", group: "基础控件", priority: "P0", idPrefix: "SelectorList", palette: true, canContainChildren: false, preview: "component", nls: { hasTitle: false, hasHelp: true }, defaultTitle: true },
  { type: "CATDlgMultiList", label: "MultiList", group: "列表", priority: "P0", idPrefix: "MultiList", palette: true, canContainChildren: false, preview: "component", nls: { hasTitle: false, hasHelp: true }, defaultTitle: true },
  { type: "CATDlgSeparator", label: "Separator", group: "装饰", priority: "P1", idPrefix: "Separator", palette: true, canContainChildren: false, preview: "component", nls: { hasTitle: false, hasHelp: false }, defaultTitle: false },
  { type: "CATDlgProgress", label: "Progress", group: "P2 灰盒", priority: "P2", idPrefix: "Progress", palette: false, canContainChildren: false, preview: "grayBox", nls: { hasTitle: false, hasHelp: true }, defaultTitle: false },
  { type: "CATDlgSlider", label: "Slider", group: "P2 灰盒", priority: "P2", idPrefix: "Slider", palette: false, canContainChildren: false, preview: "grayBox", nls: { hasTitle: false, hasHelp: true }, defaultTitle: false },
  { type: "CATDlgScrollbar", label: "Scrollbar", group: "P2 灰盒", priority: "P2", idPrefix: "Scrollbar", palette: false, canContainChildren: false, preview: "grayBox", nls: { hasTitle: false, hasHelp: true }, defaultTitle: false },
];

const CATALOG_BY_TYPE = new Map(CAA_CONTROL_CATALOG.map((entry) => [entry.type, entry]));

export function getCaaControlCatalogEntry(type: string): CaaControlCatalogEntry | undefined {
  return CATALOG_BY_TYPE.get(type);
}

export function isKnownCaaControlType(type: string): boolean {
  return CATALOG_BY_TYPE.has(type);
}

export function controlIdPrefix(type: string): string {
  return getCaaControlCatalogEntry(type)?.idPrefix ?? type.replace(/^CATDlg/, "");
}

export function shouldCreateDefaultTitle(type: string): boolean {
  return getCaaControlCatalogEntry(type)?.defaultTitle ?? false;
}

export function isCaaContainerType(type: string): boolean {
  return getCaaControlCatalogEntry(type)?.canContainChildren ?? false;
}

export function caaControlPaletteGroups(): CaaControlPaletteGroup[] {
  const groups = new Map<string, CaaControlPaletteGroup["items"]>();
  for (const entry of CAA_CONTROL_CATALOG) {
    if (!entry.palette) continue;
    const items = groups.get(entry.group) ?? [];
    items.push({
      type: entry.type,
      label: entry.label,
      priority: entry.priority,
      preview: entry.preview,
    });
    groups.set(entry.group, items);
  }
  return [...groups.entries()].map(([label, items]) => ({ label, items }));
}
