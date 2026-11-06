import { describe, expect, it, vi } from "vitest";
import { createAssemblyMaintenanceRoutes } from "./routes.js";
import type { AssemblyUpdateService } from "./updates.js";

vi.mock("./runtime.js", () => ({ assemblyUpdateService: {} }));
const id = "12345678-1234-1234-1234-123456789abc";
function fixture() {
  const methods = {
    start: vi.fn(() => ({ id, status: "preparing" })), get: vi.fn(() => ({ id, status: "ready" })),
    cancel: vi.fn(() => ({ id, status: "cancelled" })), publish: vi.fn(async () => ({ id, status: "published" })),
    reconcile: vi.fn(() => ({ id, read_only: true, can_publish: false })), history: vi.fn(() => ({ protocol_version: 1, records: [], truncated: false })),
  };
  const routes = createAssemblyMaintenanceRoutes(undefined, undefined, methods as unknown as AssemblyUpdateService);
  const post = (command: string, body: unknown) => routes.request(`/update/${command}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return { methods, post };
}
describe("assembly update HTTP authority boundary", () => {
  it("accepts only an explicit host and object selection; engine/proofs never come from HTTP", async () => {
    const { post, methods } = fixture();
    const body = { workspacePath: "/synthetic/workspace", filePath: "Host.FCStd", selectedObjects: ["Subassembly"] };
    expect((await post("start", body)).status).toBe(202);
    expect(methods.start).toHaveBeenCalledWith(body.workspacePath, body.filePath, body.selectedObjects);
    for (const key of ["script", "freecadHome", "nativeProof", "stagedFile", "sourceSha256", "restoreAuthority", "outputRel"]) {
      expect((await post("start", { ...body, [key]: "untrusted" })).status).toBe(400);
    }
    expect(methods.start).toHaveBeenCalledTimes(1);
  });
  it("requires both explicit source-replacement confirmations and forbids target overrides", async () => {
    const { post, methods } = fixture();
    const base = { workspacePath: "/synthetic/workspace", id, mode: "replace_source", confirmedClosed: true, confirmedNotReopened: true };
    for (const value of [{ ...base, confirmedClosed: false }, { ...base, confirmedNotReopened: false }, { ...base, mode: "replace_all" }, { ...base, targetRel: "Other.FCStd" }]) {
      expect((await post("publish", value)).status).toBe(400);
    }
    expect(methods.publish).not.toHaveBeenCalled();
    expect((await post("publish", base)).status).toBe(200);
    expect(methods.publish).toHaveBeenCalledWith(base.workspacePath, id, "replace_source", { closed: true, notReopened: true });
    expect((await post("publish", { ...base, mode: "verified_copy", confirmedClosed: false, confirmedNotReopened: false })).status).toBe(200);
  });
  it("status/cancel/reconciliation only accept a workspace-bound UUID", async () => {
    const { post, methods } = fixture();
    for (const command of ["status", "cancel", "reconcile"]) {
      expect((await post(command, { workspacePath: "/synthetic/workspace", id })).status).toBe(200);
      expect((await post(command, { workspacePath: "/synthetic/workspace", id: "../../escape" })).status).toBe(400);
      expect((await post(command, { workspacePath: "/synthetic/workspace", id, receiptPath: "/untrusted" })).status).toBe(400);
    }
    expect(methods.reconcile).toHaveBeenCalledTimes(1);
  });
  it("history is bounded and rejects receipt paths or write authority", async () => {
    const { post, methods } = fixture();
    expect((await post("history", { workspacePath: "/synthetic/workspace" })).status).toBe(200);
    expect((await post("history", { workspacePath: "/synthetic/workspace", limit: 20 })).status).toBe(200);
    for (const body of [{ limit: 101 }, { limit: 0 }, { limit: "20" }, { path: "/untrusted" }, { can_publish: true }]) {
      expect((await post("history", { workspacePath: "/synthetic/workspace", ...body })).status).toBe(400);
    }
    expect(methods.history).toHaveBeenCalledTimes(2);
  });
  it("does not echo private native errors and never invokes a fallback command", async () => {
    const { post, methods } = fixture();
    methods.publish.mockRejectedValue(new Error("/private/synthetic/secret/native.log"));
    const response = await post("publish", { workspacePath: "/synthetic/workspace", id, mode: "verified_copy", confirmedClosed: false, confirmedNotReopened: false });
    expect(response.status).toBe(400);
    const text = await response.text();
    expect(text).toContain("不要重复写入"); expect(text).not.toContain("secret");
    expect(methods.start).not.toHaveBeenCalled();
  });
  it("enforces request and response byte ceilings", async () => {
    const { post, methods } = fixture();
    expect((await post("start", { workspacePath: "x".repeat(70_000), filePath: "Host.FCStd", selectedObjects: ["A"] })).status).toBe(413);
    expect(methods.start).not.toHaveBeenCalled();
    methods.get.mockReturnValue({ id, status: "ready", oversized: "x".repeat(2 * 1024 * 1024) } as never);
    expect((await post("status", { workspacePath: "/synthetic/workspace", id })).status).toBe(413);
  });
  it("rejects empty, duplicated, oversized or malformed object selections before admission", async () => {
    const { post, methods } = fixture();
    for (const selectedObjects of [[], ["A", "A"], Array.from({ length: 51 }, (_, index) => "A" + index), ["../A"], ["A\0"], [false]]) {
      expect((await post("start", { workspacePath: "/synthetic/workspace", filePath: "Host.FCStd", selectedObjects })).status).toBe(400);
    }
    for (const filePath of ["", "opaque.txt", "Host\0.FCStd", "Host\n.FCStd"]) {
      expect((await post("start", { workspacePath: "/synthetic/workspace", filePath, selectedObjects: ["A"] })).status).toBe(400);
    }
    expect(methods.start).not.toHaveBeenCalled();
  });
  it("all commands reject control-bearing workspaces without invoking the service", async () => {
    const { post, methods } = fixture();
    for (const command of ["start", "status", "cancel", "publish", "history", "reconcile"]) {
      const fields = command === "start" ? { filePath: "Host.FCStd", selectedObjects: ["A"] }
        : command === "publish" ? { id, mode: "verified_copy", confirmedClosed: false, confirmedNotReopened: false }
          : command === "history" ? {} : { id };
      expect((await post(command, { workspacePath: "/synthetic/\0workspace", ...fields })).status).toBe(400);
    }
    expect(Object.values(methods).every(method => !method.mock.calls.length)).toBe(true);
  });
  it("oversized post-publication responses explicitly require read-only reconciliation, never automatic retry", async () => {
    const { post, methods } = fixture(); methods.publish.mockResolvedValue({ id, status: "published", oversized: "x".repeat(2 * 1024 * 1024) } as never);
    const response = await post("publish", { workspacePath: "/synthetic/workspace", id, mode: "verified_copy", confirmedClosed: false, confirmedNotReopened: false });
    expect(response.status).toBe(413); expect(await response.text()).toContain("不要重复写入"); expect(methods.publish).toHaveBeenCalledOnce(); expect(methods.start).not.toHaveBeenCalled();
  });
  it("all command error branches suppress underlying absolute paths and do not escalate to another operation", async () => {
    const { post, methods } = fixture();
    for (const method of Object.values(methods)) method.mockImplementation(() => { throw new Error("/private/opaque-detail"); });
    const inputs = { start: { filePath: "Host.FCStd", selectedObjects: ["A"] }, status: { id }, cancel: { id },
      publish: { id, mode: "verified_copy", confirmedClosed: false, confirmedNotReopened: false }, reconcile: { id }, history: {} };
    for (const [command, fields] of Object.entries(inputs)) {
      const response = await post(command, { workspacePath: "/synthetic/workspace", ...fields });
      expect(response.status).toBe(400); expect(await response.text()).not.toContain("opaque-detail");
    }
    expect(Object.values(methods).every(method => method.mock.calls.length === 1)).toBe(true);
  });
});
