import type { AssemblyMaintenanceInspection } from "../../../../shared/assembly-maintenance";
import type { AssemblyMaintenanceApi } from "./api";
import { inspectionLogs } from "./viewModel";

export interface AssemblyMaintenanceContext { workspacePath: string; filePath: string }
export interface AssemblyMaintenanceState {
  busy: boolean;
  inspection: AssemblyMaintenanceInspection | null;
  error: string;
}
export function createAssemblyMaintenanceController(api: AssemblyMaintenanceApi, hooks: {
  change: (state: AssemblyMaintenanceState) => void;
  busyChange?: (busy: boolean) => void;
  log?: (entry: { message: string; problem: boolean }) => void;
}) {
  let context: AssemblyMaintenanceContext | null = null;
  let state: AssemblyMaintenanceState = { busy: false, inspection: null, error: "" };
  let sequence = 0, request: AbortController | null = null;
  function publish(next: AssemblyMaintenanceState) {
    const busyChanged = state.busy !== next.busy;
    state = next;
    hooks.change({ ...state });
    if (busyChanged) hooks.busyChange?.(state.busy);
  }
  function cancel() { sequence++; request?.abort(); request = null; }
  async function refresh() {
    cancel();
    const current = context;
    if (!current) { publish({ busy: false, inspection: null, error: "" }); return; }
    const token = sequence, abort = new AbortController(); request = abort;
    publish({ busy: true, inspection: null, error: "" });
    try {
      const inspection = await api.inspect({ ...current }, abort.signal);
      if (token !== sequence || abort.signal.aborted) return;
      publish({ busy: false, inspection, error: "" });
      for (const entry of inspectionLogs(inspection)) hooks.log?.(entry);
    } catch (error) {
      if (token !== sequence || abort.signal.aborted) return;
      const message = error instanceof Error ? error.message : String(error);
      publish({ busy: false, inspection: null, error: message });
      hooks.log?.({ message: `[装配检查] ${current.filePath}：${message}`, problem: true });
    } finally { if (token === sequence) request = null; }
  }
  function setContext(next: AssemblyMaintenanceContext | null): Promise<void> {
    context = next ? { ...next } : null;
    return refresh();
  }
  function close() { context = null; cancel(); publish({ busy: false, inspection: null, error: "" }); }
  return { refresh, setContext, close };
}
