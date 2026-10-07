import { ref } from "vue";
import { pnwWorkbenchTabActionTargets, type PnwWorkbenchTabActionRequest } from "phoenix-wing";
import type { WorkbenchTab } from "../types/workbench";
import type { PageSessionApi } from "./usePageSession";

export function createWorkbenchTabActions(options: {
  tabs: () => readonly WorkbenchTab[];
  session: (id: string) => PageSessionApi | undefined;
  close: (id: string) => Promise<boolean>;
  confirmRefresh: (title: string) => Promise<boolean>;
  status: (message: string) => void;
}) {
  const pending = ref(false);
  function disabled(request: PnwWorkbenchTabActionRequest): boolean {
    const ids = pnwWorkbenchTabActionTargets(options.tabs(), request);
    return pending.value || !ids.length || ids.some(id => options.session(id)?.isBusy?.())
      || (request.action === "refresh" && !options.session(request.tabId)?.refresh);
  }
  async function run(request: PnwWorkbenchTabActionRequest): Promise<boolean> {
    if (disabled(request)) return false;
    const ids = pnwWorkbenchTabActionTargets(options.tabs(), request);
    pending.value = true;
    try {
      if (request.action === "refresh") {
        const tab = options.tabs().find(tab => tab.id === request.tabId)!;
        const api = options.session(tab.id)!;
        if ((api.isDirty() || tab.dirty) && !await options.confirmRefresh(tab.title)) return false;
        if (!options.tabs().includes(tab) || options.session(tab.id) !== api || api.isBusy?.()) return false;
        if (await api.refresh?.() === false) return false;
        options.status(`已刷新：${tab.title}`);
        return true;
      }
      // Snapshot targets, but recheck existence and busy state before each guarded close.
      for (const id of ids) {
        if (!options.tabs().some(tab => tab.id === id)) continue;
        if (options.session(id)?.isBusy?.() || !await options.close(id)) return false;
      }
      return true;
    } catch (error) {
      options.status(`标签操作失败：${String(error)}`); return false;
    } finally { pending.value = false; }
  }
  return { pending, disabled, run };
}
