/** CAA 工作台 pageId；当前挂在 code 模块，日后可独立 `caa` 模块。 */
export const CAA_HOME_PAGE_ID = "caa_dialog_home";
export const CAA_EDITOR_PAGE_ID = "caa_dialog";

/** navigation.module / PAGE_MODULE_FALLBACK */
export const CAA_NAV_MODULE = "code";

export function isCaaEditorPage(pageId: string): boolean {
  return pageId === CAA_EDITOR_PAGE_ID;
}

/** Ribbon「CAA 对话框」高亮：主页或任一编辑 Tab */
export function isCaaRibbonScopePage(pageId: string): boolean {
  return pageId === CAA_HOME_PAGE_ID || pageId === CAA_EDITOR_PAGE_ID;
}
