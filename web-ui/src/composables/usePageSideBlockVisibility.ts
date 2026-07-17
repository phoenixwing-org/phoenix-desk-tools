import { computed, ref, toValue, type MaybeRefOrGetter } from "vue";
import { pageHasSideBlock } from "../layout/pageSideBlockRegistry";

const SESSION_KEY = "phoenix-page-side-block-visibility-v1";

function readClosedPageBlocks(): Record<string, true> {
  try {
    const raw = JSON.parse(sessionStorage.getItem(SESSION_KEY) ?? "{}") as unknown;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    return Object.fromEntries(
      Object.entries(raw).filter(([pageId, closed]) => pageHasSideBlock(pageId) && closed === true),
    );
  } catch {
    return {};
  }
}

const closedPageBlocks = ref<Record<string, true>>(readClosedPageBlocks());

function persistClosedPageBlocks() {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(closedPageBlocks.value));
  } catch {
    /* sessionStorage may be unavailable; the in-memory preference still works */
  }
}

export function isPageSideBlockOpen(pageId: string): boolean {
  return pageHasSideBlock(pageId) && closedPageBlocks.value[pageId] !== true;
}

export function setPageSideBlockOpen(pageId: string, open: boolean): void {
  if (!pageHasSideBlock(pageId)) return;
  if ((closedPageBlocks.value[pageId] !== true) === open) return;
  const next = { ...closedPageBlocks.value };
  if (open) delete next[pageId];
  else next[pageId] = true;
  closedPageBlocks.value = next;
  persistClosedPageBlocks();
}

/** 页面 Block 默认展开；用户可在当前桌面会话中独立隐藏每个工具的 Block。 */
export function usePageSideBlockVisibility(pageId: MaybeRefOrGetter<string>) {
  const resolvedPageId = computed(() => toValue(pageId));
  const available = computed(() => pageHasSideBlock(resolvedPageId.value));
  const open = computed(() => isPageSideBlockOpen(resolvedPageId.value));

  function setOpen(next: boolean) {
    setPageSideBlockOpen(resolvedPageId.value, next);
  }

  function toggle() {
    setOpen(!open.value);
  }

  return { available, open, setOpen, toggle };
}
