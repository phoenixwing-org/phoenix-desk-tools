import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pnwReduceDockableToolState } from "phoenix-wing";
import { pdtCreateBatchTasksToolState } from "../../workbench/pdtBatchTasksDockableTool";
import { createBatchTasksAutoMonitor } from "./autoMonitor";
import { syntheticRun } from "./fixtures.test-support";

beforeEach(() => vi.useFakeTimers()); afterEach(() => vi.useRealTimers());
function fixture() {
  let state = pdtCreateBatchTasksToolState();
  const present = vi.fn(next => { state = next; }), selectRun = vi.fn();
  const monitor = createBatchTasksAutoMonitor({ toolState: () => state, present, selectRun,
    timer: { schedule: (callback, milliseconds) => setTimeout(callback, milliseconds), clear: handle => clearTimeout(handle as ReturnType<typeof setTimeout>) } });
  return { monitor, present, selectRun, state: () => state,
    manual(command: Parameters<typeof pnwReduceDockableToolState>[1]) { monitor.manualChange(); state = pnwReduceDockableToolState(state, command); },
    observe(runs = [syntheticRun()], workspace = "/independent-workspace", stale = false) { monitor.observe({ workspace, runs, stale }); } };
}
describe("accepted-ledger auto monitor", () => {
  it("opens a new active row once and docks after two seconds despite repeated polling", () => {
    const f = fixture(); f.observe(); expect(f.state().mode).toBe("floating"); expect(f.selectRun).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(1000); f.observe(); vi.advanceTimersByTime(999); expect(f.state().mode).toBe("floating");
    vi.advanceTimersByTime(1); expect(f.state().mode).toBe("primary"); expect(f.present).toHaveBeenCalledTimes(2);
    f.observe(); f.observe(); expect(f.present).toHaveBeenCalledTimes(2); f.monitor.dispose();
  });
  it("does nothing without an accepted active ledger row, including rejection and completed history", () => {
    const f = fixture(); f.observe([]); f.observe([syntheticRun({ status: "failed" })]); vi.runAllTimers();
    expect(f.present).not.toHaveBeenCalled(); expect(f.selectRun).not.toHaveBeenCalled(); f.monitor.dispose();
  });
  it("does not reopen a manually closed run on the next poll", () => {
    const f = fixture(); f.observe(); f.manual({ type: "close" }); f.observe(); vi.runAllTimers();
    expect(f.state().mode).toBe("closed"); expect(f.present).toHaveBeenCalledTimes(1); f.monitor.dispose();
  });
  it("preserves a user-moved floating window and an already visible Primary", () => {
    const f = fixture(); f.observe(); f.manual({ type: "set-floating-position", position: { x: 117, y: 129 } }); vi.runAllTimers();
    expect(f.state().mode).toBe("floating"); expect(f.state().floatingPosition).toEqual({ x: 117, y: 129 });
    f.manual({ type: "dock-primary" }); f.observe([syntheticRun({ id: "new-run" })]); vi.runAllTimers(); expect(f.state().mode).toBe("primary"); expect(f.present).toHaveBeenCalledTimes(1); f.monitor.dispose();
  });
  it("does not force fast terminal runs into Primary", () => {
    const f = fixture(); f.observe(); vi.advanceTimersByTime(300); f.observe([syntheticRun({ status: "succeeded" })]); vi.runAllTimers();
    expect(f.state().mode).toBe("floating"); expect(f.present).toHaveBeenCalledTimes(1); f.monitor.dispose();
  });
  it("drops delayed placement after workspace changes or a stale connection", () => {
    const f = fixture(); f.observe(); f.observe([], "/other-workspace"); vi.runAllTimers(); expect(f.state().mode).toBe("floating");
    f.manual({ type: "close" }); f.observe([syntheticRun({ id: "next" })], "/other-workspace"); f.observe([syntheticRun({ id: "next" })], "/other-workspace", true); vi.runAllTimers();
    expect(f.state().mode).toBe("floating"); expect(f.present).toHaveBeenCalledTimes(2); f.monitor.dispose();
  });
  it("disabling prevents placement and re-enabling does not replay a seen row", () => {
    const f = fixture(); f.monitor.setEnabled(false); f.observe(); f.monitor.setEnabled(true); f.observe(); vi.runAllTimers();
    expect(f.present).not.toHaveBeenCalled(); f.observe([syntheticRun({ id: "new" })]); expect(f.state().mode).toBe("floating"); f.monitor.setEnabled(false); vi.runAllTimers(); expect(f.state().mode).toBe("floating"); f.monitor.dispose();
  });
});
