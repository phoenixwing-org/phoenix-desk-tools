import { onMounted, onUnmounted } from "vue";
import { registerPageProperties, unregisterPageProperties } from "./pagePropertiesHost";
import type { PagePropertiesSheet } from "../types/pageProperties";

type SheetBuilder = () => Omit<PagePropertiesSheet, "pageId">;

/**
 * 业务页注册侧栏属性表；KeepAlive 下多页并存时由壳层 `setPropertiesActivePage` 决定展示哪一份。
 * build 一次、onMounted 注册：字段 value / hidden / options 须为稳定 computed/ref。
 */
export function usePagePropertySheet(pageId: string, build: SheetBuilder) {
  const sheet: PagePropertiesSheet = { pageId, ...build() };
  onMounted(() => registerPageProperties(sheet));
  onUnmounted(() => unregisterPageProperties(pageId));
}
