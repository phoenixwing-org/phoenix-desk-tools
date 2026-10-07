import { computed, ref, watch, type Ref } from "vue";
import { useWorkspaceTreeExpansionStore } from "../stores/workspaceTreeExpansion";

export function useWorkspaceTreeExpansion(workspace: Ref<string>, query: Ref<string>) {
  const store = useWorkspaceTreeExpansionStore();
  const searchOverrides = ref(new Map<string, boolean>());
  const searching = computed(() => Boolean(query.value.trim()));
  // Search expansion is temporary and must not overwrite the user's normal tree state.
  watch([workspace, query], () => { searchOverrides.value = new Map(); }, { flush: "sync" });
  const expansion = computed<ReadonlyMap<string, boolean>>(() => searching.value
    ? searchOverrides.value
    : new Map(store.statesFor(workspace.value).map(item => [item.path, item.expanded])));
  function toggle(path: string, expanded: boolean) {
    if (searching.value) searchOverrides.value.set(path, expanded);
    else store.setExpanded(workspace.value, path, expanded);
  }
  return { expansion, searching, toggle };
}
