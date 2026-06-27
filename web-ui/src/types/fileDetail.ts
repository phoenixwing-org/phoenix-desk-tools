export type FileDetailSubTab = "overview" | "edit" | "xref" | "assembly";

/** @deprecated 会话/旧 payload 兼容 */
export type LegacyFileDetailSubTab = "attributes" | "rename" | FileDetailSubTab;

export function normalizeFileDetailSubTab(tab: unknown): FileDetailSubTab {
  if (tab === "attributes") return "edit";
  if (tab === "overview" || tab === "edit" || tab === "xref" || tab === "assembly") return tab;
  // 旧 session / payload 的 "rename" 回退到 overview
  return "overview";
}

export type FileDetailOpenPayload = {
  rel: string;
  subTab?: LegacyFileDetailSubTab;
  preferredNewFilename?: string;
};
