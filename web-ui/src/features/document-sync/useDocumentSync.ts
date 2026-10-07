import { ref, watch, type Ref } from "vue";
import { loadSyncHistory, type SyncOptions } from "./api";
import type { RenameLog } from "../../api";
import { useDocumentSyncPreferencesStore } from "./preferences";

export function useDocumentSync(workspace: Ref<string>, report: (text: string, error: boolean) => void) {
  const preferences = useDocumentSyncPreferencesStore();
  const logs = ref<RenameLog[]>([]), totalLogs = ref(0);
  const options = ref<SyncOptions>({ log_ids: [], roots: [], filenames: true, contents: true, include_stem: false });
  const busy = ref(false), error = ref(""), phase = ref("");
  let epoch = 0;
  watch(options, value => preferences.saveOptions(workspace.value, value), { deep: true, flush: "sync" });
  function fail(cause: unknown) { error.value = cause instanceof Error ? cause.message : String(cause); report(error.value, true); }
  async function refreshHistory() {
    if (!workspace.value || busy.value) return;
    const token = ++epoch, ws = workspace.value;
    busy.value = true; error.value = ""; phase.value = "读取改名记录";
    try {
      const data = await loadSyncHistory(ws);
      if (token !== epoch || ws !== workspace.value) return;
      logs.value = data.entries; totalLogs.value = data.total;
      options.value.log_ids = options.value.log_ids.filter(id => data.entries.some(log => log.id === id));
    } catch (cause) { if (token === epoch) fail(cause); }
    finally { if (token === epoch) { busy.value = false; phase.value = ""; } }
  }
  watch(workspace, () => {
    epoch++; logs.value = []; totalLogs.value = 0; busy.value = false; error.value = "";
    options.value = preferences.optionsFor(workspace.value);
    phase.value = ""; void refreshHistory();
  }, { immediate: true, flush: "sync" });
  return { logs, totalLogs, options, busy, error, phase, refreshHistory };
}
