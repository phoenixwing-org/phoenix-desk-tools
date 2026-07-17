import type { Component } from "vue";
import { PAGE_CONTRIBUTIONS } from "./pageRegistry";

/**
 * 页面级左侧 Block 派生查询表。
 *
 * 业务页面统一在 PAGE_CONTRIBUTIONS 登记可选 sideBlock；AppShell 与 Sidebar Host
 * 只查询本表，不感知具体工具，也不扩展 showXxx 布尔协议。
 */
export const PAGE_SIDE_BLOCK_COMPONENTS: Readonly<Record<string, Component>> = Object.freeze(
  Object.fromEntries(Object.entries(PAGE_CONTRIBUTIONS)
    .filter((entry): entry is [string, { view: Component; sideBlock: Component }] => Boolean(entry[1].sideBlock))
    .map(([pageId, contribution]) => [pageId, contribution.sideBlock])),
);

export const PAGE_SIDE_BLOCK_LABELS: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(Object.entries(PAGE_CONTRIBUTIONS)
    .filter(([, contribution]) => Boolean(contribution.sideBlock))
    .map(([pageId, contribution]) => [pageId, contribution.sideBlockLabel?.trim() || "页面 Block"])),
);

export function pageSideBlockComponent(pageId: string): Component | null {
  return PAGE_SIDE_BLOCK_COMPONENTS[pageId] ?? null;
}

export function pageHasSideBlock(pageId: string): boolean {
  return Boolean(pageSideBlockComponent(pageId));
}

export function pageSideBlockLabel(pageId: string): string | null {
  return pageHasSideBlock(pageId) ? (PAGE_SIDE_BLOCK_LABELS[pageId] ?? "页面 Block") : null;
}
