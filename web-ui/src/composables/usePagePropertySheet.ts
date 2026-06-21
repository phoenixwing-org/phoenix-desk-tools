import { onUnmounted, watchEffect } from "vue";
import { registerPageProperties, unregisterPageProperties } from "./pagePropertiesHost";
import type { PagePropertiesSheet } from "../types/pageProperties";

type SheetBuilder = () => Omit<PagePropertiesSheet, "pageId">;

/**
 * 业务页注册侧栏属性表；KeepAlive 下多页并存时由壳层 `setPropertiesActivePage` 决定展示哪一份。
 */
export function usePagePropertySheet(pageId: string, build: SheetBuilder) {
  watchEffect((onCleanup) => {
    registerPageProperties({ pageId, ...build() });
    onCleanup(() => unregisterPageProperties(pageId));
  });
  onUnmounted(() => unregisterPageProperties(pageId));
}
