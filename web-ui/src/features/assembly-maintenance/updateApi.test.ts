import { beforeEach, describe, expect, it, vi } from "vitest";
const fetch = vi.hoisted(() => vi.fn());
vi.mock("../../api", () => ({ jsonFetch: fetch }));
import { assemblyUpdateApi, validateAssemblyUpdateJob, validateAssemblyUpdateReconciliation } from "./updateApi";
import { syntheticReconciliation, syntheticUpdateJob } from "./updateFixtures.test-support";
beforeEach(() => vi.resetAllMocks());
describe("assembly update API contracts", () => {
  it("posts only explicit selection or frozen job id and mode; mutations are not aborted as if cancelled", async () => {
    const input = { workspacePath: "/synthetic/workspace", filePath: "examples/Assembly.FCStd", selectedObjects: ["Selected"] };
    fetch.mockResolvedValue({ success: true, data: syntheticUpdateJob() }); await assemblyUpdateApi.start(input);
    expect(fetch).toHaveBeenLastCalledWith("/api/cad/assembly-maintenance/update/start", { method: "POST", body: JSON.stringify(input), signal: undefined });
    const publish = { workspacePath: input.workspacePath, id: syntheticUpdateJob().id, mode: "verified_copy" as const, confirmedClosed: false, confirmedNotReopened: false };
    await assemblyUpdateApi.publish(publish); expect(fetch).toHaveBeenLastCalledWith("/api/cad/assembly-maintenance/update/publish", { method: "POST", body: JSON.stringify(publish), signal: undefined });
  });
  it("requires genuine success envelopes and full preservation evidence", async () => {
    for (const data of [{ success: "true", data: syntheticUpdateJob() }, { success: true, data: { ...syntheticUpdateJob(), preview: { ...syntheticUpdateJob().preview, joint_frames_unchanged: false } } }, { success: true, data: { ...syntheticUpdateJob(), output_rel: "/private/artifact.FCStd" } }]) {
      fetch.mockResolvedValueOnce(data);
      await expect(assemblyUpdateApi.status({ workspacePath: "/synthetic/workspace", id: syntheticUpdateJob().id })).rejects.toThrow("不要重复发布");
    }
    expect(() => validateAssemblyUpdateJob({ ...syntheticUpdateJob(), status: "needs_reconcile", can_publish: true })).toThrow();
  });
  it("keeps read-only reconciliation and bounded metadata history separate from a live writable job", async () => {
    const record = syntheticReconciliation(); fetch.mockResolvedValueOnce({ success: true, data: record });
    const signal = new AbortController().signal;
    expect(await assemblyUpdateApi.reconcile({ workspacePath: "/synthetic/workspace", id: record.id }, signal)).toEqual(record);
    expect(fetch.mock.calls[0][1].signal).toBe(signal);
    fetch.mockResolvedValueOnce({ success: true, data: { protocol_version: 1, records: [record], truncated: false } });
    expect((await assemblyUpdateApi.history({ workspacePath: "/synthetic/workspace", limit: 30 })).records).toEqual([record]);
    expect(() => validateAssemblyUpdateReconciliation({ ...record, can_publish: true })).toThrow();
    fetch.mockResolvedValueOnce({ success: true, data: { protocol_version: 1, records: Array(51).fill(record), truncated: true } });
    await expect(assemblyUpdateApi.history({ workspacePath: "/synthetic/workspace" })).rejects.toThrow();
  });
});
