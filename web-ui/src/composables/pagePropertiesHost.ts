import { computed, ref, shallowReactive } from "vue";
import type { PagePropertiesSheet } from "../types/pageProperties";

/** 按 pageId 存 sheet；用 reactive Map 避免每次 register 替换整表触发 activeSheet 误刷新 */
const sheetsByPageId = shallowReactive(new Map<string, PagePropertiesSheet>());
const activePageId = ref<string | null>(null);

/** 壳层在 Tab / 导航切换时调用，决定侧栏属性面板显示哪一页的 sheet */
export function setPropertiesActivePage(pageId: string | null) {
  activePageId.value = pageId?.trim() || null;
}

export function registerPageProperties(sheet: PagePropertiesSheet) {
  const prev = sheetsByPageId.get(sheet.pageId);
  if (prev === sheet) return;
  sheetsByPageId.set(sheet.pageId, sheet);
}

export function unregisterPageProperties(pageId: string) {
  sheetsByPageId.delete(pageId);
}

const activeSheet = computed<PagePropertiesSheet | null>(() => {
  const id = activePageId.value;
  if (!id) return null;
  return sheetsByPageId.get(id) ?? null;
});

export function usePagePropertiesHost() {
  return {
    activeSheet,
    activePageId,
    hasProperties: computed(() => !!activePageId.value),
    registerPageProperties,
    unregisterPageProperties,
    setPropertiesActivePage,
  };
}
