import { describe, expect, it, vi } from "vitest";
import type { AssemblyMaintenanceInspection } from "../../../../shared/assembly-maintenance";
import { createAssemblyMaintenanceController, type AssemblyMaintenanceState } from "./controller";
import { syntheticInspection } from "./fixtures.test-support";
import { inspectionLogs, pathStatusLabel, rigidIntentLabel } from "./viewModel";

function deferred() {
  let resolve!: (value: AssemblyMaintenanceInspection) => void, reject!: (error: Error) => void;
  const promise = new Promise<AssemblyMaintenanceInspection>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function setup() {
  const inspect = vi.fn().mockResolvedValue(syntheticInspection()), log = vi.fn(), busyChange = vi.fn();
  let state: AssemblyMaintenanceState = { busy: false, inspection: null, error: "" };
  const controller = createAssemblyMaintenanceController({ inspect }, { change: next => { state = next; }, log, busyChange });
  return { controller, inspect, log, busyChange, state: () => state };
}
const context = { workspacePath: "/synthetic/workspace", filePath: "examples/SampleAssembly.FCStd" };

describe("assembly maintenance controller", () => {
  it("reads one explicit saved file and emits one observation log per completed inspection", async () => {
    const s = setup(); await s.controller.setContext(context);
    expect(s.inspect).toHaveBeenCalledExactlyOnceWith(context, expect.any(AbortSignal));
    expect(s.state().inspection?.synchronization).toBe("not_checked"); expect(s.state().busy).toBe(false);
    expect(s.busyChange.mock.calls).toEqual([[true], [false]]); expect(s.log).toHaveBeenCalledTimes(1);
    expect(s.log.mock.calls[0][0]).toMatchObject({ problem: false });
    expect(s.log.mock.calls[0][0].message).toContain("子装配同步状态未验证");
    await s.controller.refresh(); expect(s.log).toHaveBeenCalledTimes(2);
  });

  it("reports missing paths and the exact joint endpoint to Bottom without claiming repair", async () => {
    const s = setup(), result = syntheticInspection();
    result.links[0].path_status = "missing"; result.summary.missing_path_count = 1;
    result.joint_issues = [{ object_name: "Joint", label: "Sample joint", reference: "Reference2", reason: "empty_reference", target_object_name: null }];
    result.summary.joint_issue_count = 1; result.warnings = ["只检查当前磁盘文件"];
    s.inspect.mockResolvedValue(result); await s.controller.setContext(context);
    expect(s.log).toHaveBeenCalledTimes(4);
    expect(s.log.mock.calls[0][0].problem).toBe(true);
    expect(s.log.mock.calls[1][0].message).toContain("../parts/Sample.FCStd");
    expect(s.log.mock.calls[2][0].message).toContain("Joint) · Reference2");
    expect(s.log.mock.calls[2][0].message).toContain("不自动删除或重连 Joint");
  });

  it("aborts on close, forgets old observations and ignores late success", async () => {
    const s = setup(), late = deferred(); s.inspect.mockReturnValue(late.promise);
    const loading = s.controller.setContext(context), signal = s.inspect.mock.calls[0][1] as AbortSignal;
    s.controller.close(); expect(signal.aborted).toBe(true);
    late.resolve(syntheticInspection()); await loading;
    expect(s.state()).toEqual({ busy: false, inspection: null, error: "" }); expect(s.log).not.toHaveBeenCalled();
    await s.controller.refresh(); expect(s.inspect).toHaveBeenCalledTimes(1);
  });

  it("aborts and ignores a previous file's late error when context changes", async () => {
    const s = setup(), late = deferred(); s.inspect.mockReturnValueOnce(late.promise);
    const first = s.controller.setContext(context), signal = s.inspect.mock.calls[0][1] as AbortSignal;
    const changed = syntheticInspection(); changed.rel = "examples/OtherAssembly.FCStd"; s.inspect.mockResolvedValueOnce(changed);
    await s.controller.setContext({ ...context, filePath: changed.rel });
    late.reject(new Error("stale failure")); await first;
    expect(signal.aborted).toBe(true); expect(s.state().inspection?.rel).toBe(changed.rel);
    expect(s.state().error).toBe(""); expect(s.log).toHaveBeenCalledTimes(1);
  });

  it("also aborts on workspace replacement and never keeps a previous good result after an error", async () => {
    const s = setup(); await s.controller.setContext(context);
    const late = deferred(); s.inspect.mockReturnValueOnce(late.promise);
    const loading = s.controller.refresh(), signal = s.inspect.mock.calls[1][1] as AbortSignal;
    expect(s.state().inspection).toBeNull(); s.inspect.mockRejectedValueOnce(new Error("read refused"));
    await s.controller.setContext({ ...context, workspacePath: "/synthetic/other-workspace" });
    late.resolve(syntheticInspection()); await loading;
    expect(signal.aborted).toBe(true); expect(s.state().inspection).toBeNull(); expect(s.state().error).toBe("read refused");
    expect(s.log).toHaveBeenLastCalledWith(expect.objectContaining({ problem: true, message: expect.stringContaining("read refused") }));
  });

  it("keeps Rigid intent, path observation and synchronization independent", () => {
    expect(rigidIntentLabel(true)).toBe("刚性"); expect(rigidIntentLabel(false)).toBe("柔性"); expect(rigidIntentLabel(null)).toBe("未知");
    expect(pathStatusLabel("present")).toContain("目标未验证"); expect(pathStatusLabel("outside_workspace")).toContain("未检查");
    const messages = inspectionLogs(syntheticInspection()).map(entry => entry.message).join(" ");
    expect(messages).not.toMatch(/装配健康|同步成功|更新成功/);
  });
});
