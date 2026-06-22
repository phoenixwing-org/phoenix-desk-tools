import { computed, ref, shallowRef } from "vue";
import type { PagePropertiesSheet } from "../types/pageProperties";

const sheetsByPageId = shallowRef(new Map<string, PagePropertiesSheet>());
const activePageId = ref<string | null>(null);

/** 壳层在 Tab / 导航切换时调用，决定侧栏属性面板显示哪一页的 sheet */
export function setPropertiesActivePage(pageId: string | null) {
  activePageId.value = pageId?.trim() || null;
}

export function registerPageProperties(sheet: PagePropertiesSheet) {
  const next = new Map(sheetsByPageId.value);
  next.set(sheet.pageId, sheet);
  sheetsByPageId.value = next;
}

export function unregisterPageProperties(pageId: string) {
  const next = new Map(sheetsByPageId.value);
  next.delete(pageId);
  sheetsByPageId.value = next;
}

const activeSheet = computed(() => {
  const id = activePageId.value;
  if (!id) return null;
  return sheetsByPageId.value.get(id) ?? null;
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
