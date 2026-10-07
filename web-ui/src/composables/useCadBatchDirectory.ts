import { computed, onScopeDispose, toValue, watch, type MaybeRefOrGetter } from "vue";
import { useCadBatchDirectoryStore } from "../stores/cadBatchDirectory";
import type { PagePrimarySection } from "./usePagePrimaryContribution";

let nextOwner = 0;

export function useCadBatchDirectory(workspace: MaybeRefOrGetter<string>) {
  const store = useCadBatchDirectoryStore();
  const currentWorkspace = computed(() => toValue(workspace));
  const state = computed(() => store.entry(currentWorkspace.value));
  const directory = computed({
    get: () => state.value.directory,
    set: value => store.setDirectory(currentWorkspace.value, value),
  });
  const disabled = computed(() => !currentWorkspace.value || state.value.pending || state.value.locks.length > 0);
  const scopeKey = computed(() => JSON.stringify([currentWorkspace.value, directory.value]));
  let workspaceRevision = 0;
  onScopeDispose(() => { workspaceRevision++; });
  watch(currentWorkspace, () => {
    workspaceRevision++;
  }, { immediate: true, flush: "sync" });

  function bindBusy(busy: MaybeRefOrGetter<boolean>) {
    const owner = `cad-batch-${++nextOwner}`;
    let lockedWorkspace = "";
    watch(() => [currentWorkspace.value, toValue(busy)] as const, ([path, active]) => {
      if (lockedWorkspace) store.lock(lockedWorkspace, owner, false);
      lockedWorkspace = active ? path : "";
      if (lockedWorkspace) store.lock(lockedWorkspace, owner, true);
    }, { immediate: true, flush: "sync" });
    onScopeDispose(() => { if (lockedWorkspace) store.lock(lockedWorkspace, owner, false); });
  }

  async function validate(): Promise<boolean> {
    const workspace = currentWorkspace.value;
    const revision = workspaceRevision;
    return store.validate(workspace, () => revision === workspaceRevision);
  }

  const section: PagePrimarySection = {
    id: "cad-batch-directory", title: "搜索目录",
    description: computed(() => state.value.error || state.value.discoveryError || "批量工具共用此范围；按工作空间记住目录，刷新后恢复。仅在当前工作空间内搜索。"),
    controls: [{
      id: "cad-batch-directory", kind: "directory", label: "目录", modelValue: directory,
      disabled, loading: computed(() => state.value.loading),
      options: computed(() => [
        { value: ".", label: "工作空间根目录（.）" },
        ...state.value.directories.map(item => ({ value: item.path, label: item.name })),
      ]),
      placeholder: "选择一级目录，或输入子目录", onUpdate: value => { directory.value = value; },
      onRefresh: () => store.refresh(currentWorkspace.value, true),
      onPick: async () => {
        const workspace = currentWorkspace.value;
        const revision = workspaceRevision;
        await store.pick(workspace, () => revision === workspaceRevision);
      },
    }],
  };
  return { directory, section, scopeKey, disabled, validate, bindBusy };
}
