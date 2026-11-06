import { beforeEach, describe, expect, it, vi } from "vitest";
const fetch = vi.hoisted(() => vi.fn());
vi.mock("../../api", () => ({ jsonFetch: fetch }));
import { assemblyMaintenanceApi, validateAssemblyInspection } from "./api";
import { syntheticInspection } from "./fixtures.test-support";

beforeEach(() => { vi.resetAllMocks(); });
describe("saved assembly inspection API", () => {
  it("posts only explicit workspace and file context, with abort signal", async () => {
    fetch.mockResolvedValue({ success: true, data: syntheticInspection() }); const signal = new AbortController().signal;
    const input = { workspacePath: "/synthetic/workspace", filePath: "examples/SampleAssembly.FCStd" };
    const result = await assemblyMaintenanceApi.inspect(input, signal);
    expect(fetch).toHaveBeenCalledExactlyOnceWith("/api/cad/assembly-maintenance/inspect", {
      method: "POST", body: JSON.stringify(input), signal,
    }); expect(result.update.available).toBe(false);
  });
  it("requires the actual success envelope and rejects missing, false or truthy success", async () => {
    const input = { workspacePath: "/synthetic/workspace", filePath: "examples/SampleAssembly.FCStd" };
    for (const response of [syntheticInspection(), { data: syntheticInspection() }, { success: false, data: syntheticInspection() }, { success: "true", data: syntheticInspection() }, { success: true, data: null }]) {
      fetch.mockResolvedValueOnce(response); await expect(assemblyMaintenanceApi.inspect(input)).rejects.toThrow("响应无效");
    }
  });
  it("accepts the inspection-only requirement for a separate verified preview", () => {
    const response = syntheticInspection(); response.update.reason_code = "requires_verified_preview";
    expect(validateAssemblyInspection(response).update).toMatchObject({ available: false, reason_code: "requires_verified_preview" });
  });
  it("rejects write availability, fake synchronization, malformed values and inconsistent counts", () => {
    expect(validateAssemblyInspection(syntheticInspection()).scope).toBe("current_saved_file");
    for (const change of [
      (r: any) => { r.update.available = true; },
      (r: any) => { r.synchronization = "healthy"; },
      (r: any) => { r.links[0].rigid = "true"; },
      (r: any) => { r.links[0].path_status = "healthy"; },
      (r: any) => { r.source.sha256 = "invalid"; },
      (r: any) => { r.summary.assembly_link_count++; },
      (r: any) => { r.summary.missing_path_count++; },
      (r: any) => { r.joint_issues = [{ reference: "Reference3" }]; },
    ]) { const response = syntheticInspection(); change(response); expect(() => validateAssemblyInspection(response)).toThrow("响应无效"); }
  });
});
