import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ScanProgressPayload } from "../api";
import { useAsyncProgress } from "./useAsyncProgress";

const apiMocks = vi.hoisted(() => ({
  fetchProgress: vi.fn(),
  cancelScan: vi.fn(),
  fetchResume: vi.fn(),
}));

vi.mock("../api", () => ({
  fetchFcstdMapScanProgress: apiMocks.fetchProgress,
  cancelFcstdMapScan: apiMocks.cancelScan,
  fetchFcstdMapScanResume: apiMocks.fetchResume,
}));

function terminalPayload(status: "done" | "cancelled" | "error" = "done"): ScanProgressPayload {
  return {
    scan_id: "scan-1",
    phase: status,
    step: 3,
    status,
    cancelled: status === "cancelled",
    error: status === "error" ? "fixture error" : "",
    total_cad_files: 2,
    total_fcstd_files: 1,
    walk: { total: 2, processed: 2, percent: 100 },
    bom: { total: 1, processed: 1, skipped: 0, failed: 0, current_file: "", percent: 100, errors: [] },
    xref: { total: 1, processed: 1, skipped: 0, failed: 0, current_file: "", percent: 100, errors: [] },
  };
}

describe("useAsyncProgress polling contract", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.useFakeTimers();
    apiMocks.fetchProgress.mockReset();
    apiMocks.cancelScan.mockReset();
    apiMocks.fetchResume.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns after starting and keeps running until a terminal poll arrives", async () => {
    const progress = useAsyncProgress("fcstd-scan");
    const poll = vi.fn().mockResolvedValue(terminalPayload());

    await progress.startPolling(
      async () => ({ scan_id: "scan-1" }),
      poll,
      async () => ({ cancelled: true }),
      { interval: 10 },
    );

    expect(progress.isRunning.value).toBe(true);
    expect(progress.state.value?.status).toBe("running");
    await vi.advanceTimersByTimeAsync(10);
    expect(poll).toHaveBeenCalledWith("scan-1");
    expect(progress.state.value?.status).toBe("done");
    expect(progress.isRunning.value).toBe(false);
  });

  it("cancel marks the active task terminal and stops later polls", async () => {
    const progress = useAsyncProgress("fcstd-scan");
    const poll = vi.fn().mockResolvedValue(terminalPayload());
    const cancel = vi.fn().mockResolvedValue({ cancelled: true });
    await progress.startPolling(
      async () => ({ scan_id: "scan-1" }),
      poll,
      cancel,
      { interval: 10 },
    );

    await progress.cancel();
    await vi.advanceTimersByTimeAsync(20);
    expect(cancel).toHaveBeenCalledWith("scan-1");
    expect(poll).not.toHaveBeenCalled();
    expect(progress.state.value?.status).toBe("cancelled");
    expect(progress.isRunning.value).toBe(false);
  });

  it("restores the shared poller and re-registers server cancellation", async () => {
    apiMocks.fetchResume.mockResolvedValue({
      active: true,
      scan_id: "scan-1",
      source: "memory",
      progress: { ...terminalPayload(), status: "running", phase: "bom" },
    });
    apiMocks.fetchProgress.mockResolvedValue(terminalPayload());
    apiMocks.cancelScan.mockResolvedValue({ cancelled: true });
    const progress = useAsyncProgress("fcstd-scan");

    await expect(progress.resume()).resolves.toBe(true);
    expect(progress.isRunning.value).toBe(true);
    await progress.store.cancelTask("scan-1");

    expect(apiMocks.cancelScan).toHaveBeenCalledWith("scan-1");
    expect(progress.store.tasks["scan-1"]?.status).toBe("cancelled");
  });

  it("unregisters stream cancellation when the task reaches a terminal event", async () => {
    const progress = useAsyncProgress("unit-test");
    const cancel = vi.fn().mockResolvedValue({ cancelled: true });
    const result = {
      ok: true,
      suite_id: "code",
      suite_label: "Code",
      duration_ms: 1,
      modules: [],
      cases: [],
      failures: [],
      summary: {
        tests_run: 0,
        passed: 0,
        failed: 0,
        errors: 0,
        skipped: 0,
        modules: 0,
        duration_ms: 1,
        cancelled: 0,
      },
    };

    await progress.startStreaming(async (onEvent) => {
      onEvent({
        type: "start",
        run_id: "run-1",
        suite_id: "code",
        suite_label: "Code",
        total_modules: 0,
        total_cases: 0,
        modules: [],
        load_errors: [],
      });
      onEvent({ type: "done", result });
      return result;
    }, cancel);
    expect(progress.state.value?.status).toBe("done");
    await progress.store.cancelTask("run-1");
    expect(cancel).not.toHaveBeenCalled();
  });
});
