import { onMounted, onUnmounted } from "vue";

export type PageSessionApi = {
  serialize(): Record<string, unknown>;
  hydrate(snapshot: Record<string, unknown>): boolean | Promise<boolean>;
  isDirty(): boolean;
  /** 关闭 Tab 前尝试落盘（如属性回写 → saveBom） */
  flush?(): Promise<boolean>;
};

const registry = new Map<string, PageSessionApi>();

export function getPageSession(tabId: string): PageSessionApi | undefined {
  return registry.get(tabId);
}

export function registerPageSession(tabId: string, api: PageSessionApi): void {
  registry.set(tabId, api);
}

export function unregisterPageSession(tabId: string): void {
  registry.delete(tabId);
}

export function collectPageStates(tabIds: string[]): Record<string, Record<string, unknown>> {
  const out: Record<string, Record<string, unknown>> = {};
  for (const id of tabIds) {
    const api = registry.get(id);
    if (!api) continue;
    try {
      out[id] = api.serialize();
    } catch {
      /* skip broken snapshot */
    }
  }
  return out;
}

/** 在页面 setup 中注册 serialize / hydrate（需 stable tabId） */
export function usePageSession(tabId: string | undefined, api: PageSessionApi): void {
  if (!tabId) return;

  onMounted(() => {
    registerPageSession(tabId, api);
  });

  onUnmounted(() => {
    unregisterPageSession(tabId);
  });
}
