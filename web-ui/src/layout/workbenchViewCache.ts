import { defineComponent, h, markRaw, type Component } from "vue";
import type { WorkbenchTab } from "../types/workbench";

/** Give each tab an include-able KeepAlive identity, so closed previews really unmount. */
export function createWorkbenchViewCache(resolve: (pageId: string) => Component) {
  const wrappers = new Map<string, Component>();
  const nameFor = (id: string) => `WorkbenchView_${id}`;
  function componentFor(tab: WorkbenchTab): Component {
    let component = wrappers.get(tab.id);
    if (!component) {
      const view = resolve(tab.pageId);
      const tabId = tab.id;
      component = markRaw(defineComponent({
        name: nameFor(tabId),
        setup: () => () => h(view, { workbenchTabId: tabId }),
      }));
      wrappers.set(tab.id, component);
    }
    return component;
  }
  function retain(ids: string[]) {
    const open = new Set(ids);
    for (const id of wrappers.keys()) if (!open.has(id)) wrappers.delete(id);
  }
  return { componentFor, nameFor, retain };
}
