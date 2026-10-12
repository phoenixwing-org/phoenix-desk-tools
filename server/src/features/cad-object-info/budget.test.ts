import { describe, expect, it, vi } from "vitest";
import { CAD_OBJECT_RESPONSE_LIMITS, CadObjectInfoBudget, measureCadObjectInfoJsonBytes } from "./budget.js";

describe("complete CAD object response output and deadline budget", () => {
  it("exactly counts JSON envelope, keys, punctuation, escapes and UTF-8 without whole-value serialization", async () => {
    const value = { success: true, data: { document: { objects: [{ name: '引号"\\\b\f\n\r\t\u0000\u001f🙂', label: "é中", properties: { "键\"": -0, tiny: 1e-7, huge: 1e21, lone: "\ud800", low: "\udfff" } }], root_names: [], xlinks: [] }, source: { file_size: 1, mtime_ms: 42.5 }, warnings: ["warning"] } };
    const expected = Buffer.byteLength(JSON.stringify(value), "utf8");
    const stringify = JSON.stringify;
    const spy = vi.spyOn(JSON, "stringify").mockImplementation((item: unknown) => {
      if (typeof item !== "number") throw new Error("budget must not allocate serialized values");
      return stringify(item);
    });
    try {
      expect(await measureCadObjectInfoJsonBytes(value, new CadObjectInfoBudget(undefined, { bytes: expected }))).toBe(expected);
      await expect(measureCadObjectInfoJsonBytes(value, new CadObjectInfoBudget(undefined, { bytes: expected - 1 }))).rejects.toMatchObject({ code: "resource_limit" });
    } finally { spy.mockRestore(); }
  });
  it("counts repeated inherited labels for every instance while scanning each string only once", async () => {
    let checks = 0;
    const budget = new CadObjectInfoBudget(undefined, { now: () => { checks++; return 0; }, bytes: 10_000 });
    const label = "a".repeat(8192);
    expect(budget.stringBytes(label)).toBe(8194);
    const first = checks;
    expect(budget.stringBytes(label)).toBe(8194);
    expect(checks - first).toBe(1); // Cached path still checks deadline; no second character scan.
    await expect(measureCadObjectInfoJsonBytes({ xlinks: [{ file: "A", label }, { file: "B", label }] }, budget)).rejects.toMatchObject({ code: "resource_limit" });
  });
  it("rejects a single escaped string as soon as its byte budget is exceeded", () => {
    const budget = new CadObjectInfoBudget(undefined, { bytes: 100 });
    expect(() => budget.stringBytes("\u0000".repeat(100))).toThrowError(expect.objectContaining({ code: "resource_limit" }));
  });
  it("fixes production output and time caps and forbids raising them through the test seam", () => {
    expect(CAD_OBJECT_RESPONSE_LIMITS).toEqual({ bytes: 64 * 1024 * 1024, durationMs: 30_000 });
    expect(() => new CadObjectInfoBudget(undefined, { bytes: CAD_OBJECT_RESPONSE_LIMITS.bytes + 1 })).toThrow("不能提高");
    expect(() => new CadObjectInfoBudget(undefined, { durationMs: 30_001 })).toThrow("不能提高");
  });
  it("enforces the 30 second boundary using a monotonic clock", () => {
    let now = 0; const budget = new CadObjectInfoBudget(undefined, { now: () => now });
    now = 29_999; expect(() => budget.check()).not.toThrow();
    now = 30_000; expect(() => budget.check()).toThrowError(expect.objectContaining({ code: "timeout" }));
  });
  it("stops output measurement at a cooperative deadline checkpoint", async () => {
    let now = 0; const budget = new CadObjectInfoBudget(undefined, { durationMs: 5, now: () => now });
    const pending = measureCadObjectInfoJsonBytes(Array.from({ length: 300 }, () => "value"), budget);
    now = 5;
    await expect(pending).rejects.toMatchObject({ code: "timeout" });
  });
  it("stops output measurement after cancellation without returning a successful byte count", async () => {
    const controller = new AbortController(); const budget = new CadObjectInfoBudget(controller.signal);
    const pending = measureCadObjectInfoJsonBytes(Array.from({ length: 300 }, () => "value"), budget);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: "cancelled" });
  });
  it("times out an unresolved async body wait rather than waiting indefinitely for another checkpoint", async () => {
    const budget = new CadObjectInfoBudget(undefined, { durationMs: 5 });
    await expect(budget.waitFor(new Promise<void>(() => {}))).rejects.toMatchObject({ code: "timeout" });
  });
  it("cancels an unresolved async wait and returns ordinary resolved or failed waits unchanged", async () => {
    const controller = new AbortController(); const budget = new CadObjectInfoBudget(controller.signal);
    const pending = budget.waitFor(new Promise<void>(() => {})); controller.abort();
    await expect(pending).rejects.toMatchObject({ code: "cancelled" });
    const active = new CadObjectInfoBudget();
    await expect(active.waitFor(Promise.resolve(42))).resolves.toBe(42);
    await expect(active.waitFor(Promise.reject(new Error("input failed")))).rejects.toThrow("input failed");
  });
});
