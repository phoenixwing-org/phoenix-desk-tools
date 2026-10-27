import { pnwReduceDockableToolState, type PnwDockableToolState } from "phoenix-wing";
import { isActiveRun, type BatchRun } from "../../../../shared/batch-tasks/contracts";

export interface BatchAutoMonitorSnapshot { workspace: string; runs: readonly Pick<BatchRun, "id" | "status">[]; stale: boolean }
export interface BatchAutoMonitorTimer { schedule(callback: () => void, milliseconds: number): unknown; clear(handle: unknown): void }
export interface BatchAutoMonitorPorts {
  toolState(): PnwDockableToolState;
  present(state: PnwDockableToolState): void;
  selectRun(id: string): void;
  timer?: BatchAutoMonitorTimer;
}

/** Observes accepted ledger rows only. It has no execution/admission/cancellation port. */
export function createBatchTasksAutoMonitor(ports: BatchAutoMonitorPorts) {
  const timer = ports.timer ?? { schedule: (callback: () => void, ms: number) => setTimeout(callback, ms), clear: (handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>) };
  let enabled = true, disposed = false, workspace = "", generation = 0;
  let latest: BatchAutoMonitorSnapshot = { workspace: "", runs: [], stale: false };
  let pending: { runId: string; generation: number; handle: unknown } | undefined;
  const seen = new Map<string, Set<string>>();
  function stopTransition() { if (pending) timer.clear(pending.handle); pending = undefined; }
  function observe(snapshot: BatchAutoMonitorSnapshot) {
    if (disposed) return;
    latest = snapshot;
    if (workspace !== snapshot.workspace) { workspace = snapshot.workspace; generation++; stopTransition(); }
    if (!workspace || snapshot.stale) { stopTransition(); return; }
    if (!seen.has(workspace)) seen.set(workspace, new Set());
    const known = seen.get(workspace)!;
    const added = snapshot.runs.filter(run => !known.has(run.id));
    for (const run of snapshot.runs) known.add(run.id);
    if (pending && !snapshot.runs.some(run => run.id === pending!.runId && isActiveRun(run.status))) stopTransition();
    if (!enabled) { stopTransition(); return; }
    const run = added.find(run => isActiveRun(run.status));
    // An already visible tool is owned by its user's chosen placement.
    if (!run || ports.toolState().mode !== "closed") return;
    stopTransition(); ports.selectRun(run.id);
    ports.present(pnwReduceDockableToolState(ports.toolState(), { type: "open-floating" }));
    const own = generation, runId = run.id;
    const handle = timer.schedule(() => {
      if (!pending || pending.generation !== own || pending.runId !== runId) return;
      pending = undefined;
      if (disposed || !enabled || generation !== own || latest.workspace !== workspace || latest.stale || ports.toolState().mode !== "floating"
        || !latest.runs.some(value => value.id === runId && isActiveRun(value.status))) return;
      ports.present(pnwReduceDockableToolState(ports.toolState(), { type: "dock-primary" }));
    }, 2000);
    pending = { runId, generation: own, handle };
  }
  return {
    observe,
    setEnabled(value: boolean) { enabled = value; if (!value) stopTransition(); },
    manualChange() { generation++; stopTransition(); },
    dispose() { disposed = true; generation++; stopTransition(); seen.clear(); },
  };
}
