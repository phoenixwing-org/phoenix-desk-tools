export type FileDetailSubTab = "overview" | "edit" | "xref" | "assembly" | "drawing";
export const DEFAULT_FILE_DETAIL_SUB_TAB: FileDetailSubTab = "edit";

/** @deprecated 会话/旧 payload 兼容 */
export type LegacyFileDetailSubTab = "attributes" | "rename" | FileDetailSubTab;

export function normalizeFileDetailSubTab(tab: unknown): FileDetailSubTab {
  if (tab === "attributes") return "edit";
  if (tab === "overview" || tab === "edit" || tab === "xref" || tab === "assembly" || tab === "drawing") return tab;
  // 缺省及旧 session / payload 的 "rename" 进入编辑属性。
  return DEFAULT_FILE_DETAIL_SUB_TAB;
}

export type FileDetailOpenPayload = {
  rel: string;
  subTab?: LegacyFileDetailSubTab;
  preferredNewFilename?: string;
};
