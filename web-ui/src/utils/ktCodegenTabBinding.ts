import type { WorkbenchTab } from "../types/workbench";

export const KT_CODEGEN_PAGE_ID = "kt_codegen";

export function normalizeKtCodegenDocumentPath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.\/+/, "").trim();
}

/** 同一路径只允许绑定一个已打开的 KT Codegen View。 */
export function findKtCodegenDocumentTab(
  tabs: readonly WorkbenchTab[],
  path: string,
): WorkbenchTab | undefined {
  const key = normalizeKtCodegenDocumentPath(path);
  if (!key) return undefined;
  return tabs.find((tab) =>
    tab.pageId === KT_CODEGEN_PAGE_ID
    && normalizeKtCodegenDocumentPath(tab.contextKey ?? "") === key,
  );
}

/** 第一次选文档时可复用当前未绑定且干净的启动 View。 */
export function reusableKtCodegenBlankTab(
  tabs: readonly WorkbenchTab[],
  activeTabId: string,
): WorkbenchTab | undefined {
  const active = tabs.find((tab) => tab.id === activeTabId);
  return active?.pageId === KT_CODEGEN_PAGE_ID
    && !active.contextKey?.trim()
    && !active.dirty
    ? active
    : undefined;
}
