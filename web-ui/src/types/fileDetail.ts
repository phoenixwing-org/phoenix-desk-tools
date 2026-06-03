export type FileDetailSubTab = "overview" | "edit" | "xref" | "assembly" | "rename";

/** @deprecated 会话/旧 payload 兼容 */
export type LegacyFileDetailSubTab = "attributes" | FileDetailSubTab;

export function normalizeFileDetailSubTab(tab: unknown): FileDetailSubTab {
  if (tab === "attributes") return "edit";
  if (tab === "overview" || tab === "edit" || tab === "xref" || tab === "assembly" || tab === "rename") return tab;
  return "overview";
}

export type FileDetailOpenPayload = {
  rel: string;
  subTab?: LegacyFileDetailSubTab;
  preferredNewFilename?: string;
};
