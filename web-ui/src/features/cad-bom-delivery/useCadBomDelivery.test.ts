import { effectScope, ref, type EffectScope } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../api";
const api = vi.hoisted(() => ({ preview: vi.fn(), export: vi.fn(), release: vi.fn() }));
vi.mock("./api", async original => ({ ...await original<typeof import("./api")>(), previewBomDelivery: api.preview, exportBomDelivery: api.export, releaseBomDelivery: api.release }));
import { useCadBomDelivery } from "./useCadBomDelivery";
import { deferred, syntheticPreview, syntheticReceipt } from "./fixtures.test-support";
let scope: EffectScope;
const ws = ref("/example"), active = ref(true), log = vi.fn(), confirm = vi.fn(), picker = vi.fn();
function setup() { scope = effectScope(); return scope.run(() => useCadBomDelivery(ws, { appendLog: log, confirmExport: confirm, pickDirectory: picker }, active))!; }
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2030-01-01T00:00:00.000Z"));
  ws.value = "/example"; active.value = true; vi.clearAllMocks();
  api.preview.mockResolvedValue(syntheticPreview()); api.export.mockResolvedValue(syntheticReceipt()); api.release.mockResolvedValue(undefined); confirm.mockResolvedValue(true); picker.mockResolvedValue(null);
});
afterEach(() => { scope?.stop(); vi.useRealTimers(); });
describe("BOM delivery context-bound offline journey", () => {
  it("does nothing on initial entry; explicit preview yields whole-workspace counts and default target", async () => {
    const d = setup(); expect(api.preview).not.toHaveBeenCalled(); expect(d.canExport.value).toBe(false);
    await d.runPreview(); expect(d.counts.value).toEqual({ parts: 2, boms: 1, items: 1 });
    expect(d.targetPath.value).toBe(`/example/.phoenix/outbox/${syntheticPreview().suggested_filename}`); expect(d.canExport.value).toBe(true); expect(api.export).not.toHaveBeenCalled();
  });
  it("guards duplicate operations while busy", async () => {
    const result = deferred<ReturnType<typeof syntheticPreview>>(); api.preview.mockReturnValue(result.promise);
    const d = setup(), pending = d.runPreview(); await d.runPreview(); await d.runExport();
    expect(api.preview).toHaveBeenCalledTimes(1); expect(api.export).not.toHaveBeenCalled(); result.resolve(syntheticPreview()); await pending;
  });
  it.each(["workspace", "inactive", "cancel", "dispose"])("aborts and releases a late preview on %s", async kind => {
    const result = deferred<ReturnType<typeof syntheticPreview>>(); api.preview.mockReturnValue(result.promise);
    const d = setup(), pending = d.runPreview(), signal = api.preview.mock.calls[0][1] as AbortSignal;
    if (kind === "workspace") ws.value = "/other"; else if (kind === "inactive") active.value = false; else if (kind === "cancel") d.cancel(); else scope.stop();
    expect(signal.aborted).toBe(true); result.resolve(syntheticPreview()); await pending;
    expect(d.preview.value).toBeNull(); expect(api.release).toHaveBeenCalledWith("/example", syntheticPreview().preview_id); expect(api.release.mock.calls[0]).toHaveLength(2);
  });
  it("explicit prompt cancellation never sends export and preserves valid preview", async () => {
    const d = setup(); await d.runPreview(); confirm.mockResolvedValue(false); await d.runExport();
    expect(confirm.mock.calls[0][0]).toContain("整个工作空间 /example"); expect(confirm.mock.calls[0][0]).toContain(syntheticPreview().envelope.payloadHash);
    expect(api.export).not.toHaveBeenCalled(); expect(d.canExport.value).toBe(true);
  });
  it.each(["workspace", "target", "inactive", "cancel"])("does not export after confirmation context changes: %s", async kind => {
    const answer = deferred<boolean>(); confirm.mockReturnValue(answer.promise);
    const d = setup(); await d.runPreview(); const pending = d.runExport();
    if (kind === "workspace") ws.value = "/other"; else if (kind === "target") d.targetSetting.value = "/example/new.json"; else if (kind === "inactive") active.value = false; else d.cancel();
    answer.resolve(true); await pending; expect(api.export).not.toHaveBeenCalled();
  });
  it("expires deterministically, disables export, and releases instead of replaying", async () => {
    const d = setup(); await d.runPreview(); vi.advanceTimersByTime(600000);
    expect(d.expired.value).toBe(true); expect(d.canExport.value).toBe(false); await d.runExport(); expect(api.export).not.toHaveBeenCalled(); expect(api.preview).toHaveBeenCalledTimes(1); expect(api.release).toHaveBeenCalledTimes(1);
  });
  it("does not release TTL handle during an in-flight export; retains a known published receipt", async () => {
    const result = deferred<ReturnType<typeof syntheticReceipt>>(); api.export.mockReturnValue(result.promise);
    const d = setup(); await d.runPreview(); const pending = d.runExport(); await Promise.resolve(); vi.advanceTimersByTime(600000);
    expect(api.release).not.toHaveBeenCalled(); result.resolve(syntheticReceipt()); await pending;
    expect(d.receipt.value).toEqual(syntheticReceipt()); expect(d.status.value).toBe("published"); expect(api.release).toHaveBeenCalledTimes(1);
  });
  it("410 requires a new preview, with no silent retry", async () => {
    api.export.mockRejectedValue(new ApiError("Preview unavailable", 410, { code: "expired" }));
    const d = setup(); await d.runPreview(); await d.runExport(); await d.runExport();
    expect(d.canExport.value).toBe(false); expect(d.error.value).toContain("不会自动重新导出"); expect(api.preview).toHaveBeenCalledTimes(1); expect(api.export).toHaveBeenCalledTimes(1);
  });
  it("409 shows causes and leaves a valid handle available for an explicit corrected attempt", async () => {
    api.export.mockRejectedValue(new ApiError("Source conflict", 409, { code: "conflict", causes: ["Inventory changed"] }));
    const d = setup(); await d.runPreview(); await d.runExport();
    expect(d.error.value).toContain("Inventory changed"); expect(d.canExport.value).toBe(true); expect(api.export).toHaveBeenCalledTimes(1); expect(api.release).not.toHaveBeenCalled(); expect(log).toHaveBeenLastCalledWith(expect.stringContaining("Inventory changed"), { source: "bom_delivery", open: true });
  });
  it("deduplicates detail and identical causes while preserving every different bounded cause", async () => {
    api.preview.mockRejectedValue(new ApiError("Source changed", 409, { causes: ["Source changed", "Missing target", " Missing target ", "Other distinct cause"] }));
    const d = setup(); await d.runPreview();
    expect(d.error.value).toBe("Source changed\nMissing target\nOther distinct cause");
    expect(log).toHaveBeenLastCalledWith("[BOM交付] Source changed\nMissing target\nOther distinct cause", { source: "bom_delivery", open: true });
  });
  it("network failure during export cannot claim no write", async () => {
    api.export.mockRejectedValue(new TypeError("Connection lost"));
    const d = setup(); await d.runPreview(); await d.runExport(); expect(d.status.value).toBe("unconfirmed"); expect(d.error.value).toContain("结果未确认，请核对目标");
  });
  it("workspace switch during export logs the captured old target, not computed new target", async () => {
    const result = deferred<ReturnType<typeof syntheticReceipt>>(); api.export.mockReturnValue(result.promise);
    const d = setup(); await d.runPreview(); const target = d.targetPath.value, pending = d.runExport(); await Promise.resolve();
    const signal = api.export.mock.calls[0][3] as AbortSignal; ws.value = "/other"; expect(signal.aborted).toBe(true);
    expect(log.mock.calls.at(-1)?.[0]).toContain(target); expect(log.mock.calls.at(-1)?.[0]).not.toContain("/other");
    result.reject(new DOMException("Cancelled", "AbortError")); await pending; expect(d.receipt.value).toBeNull(); expect(d.error.value).toBe("");
  });
  it("late confirmed receipt is logged for old workspace but never applied to new workspace", async () => {
    const result = deferred<ReturnType<typeof syntheticReceipt>>(); api.export.mockReturnValue(result.promise);
    const d = setup(); await d.runPreview(); const pending = d.runExport(); await Promise.resolve(); ws.value = "/other";
    result.resolve(syntheticReceipt()); await pending; expect(d.receipt.value).toBeNull(); expect(log.mock.calls.at(-1)?.[0]).toContain("旧上下文已确认发布（/example）");
  });
  it("retains published receipt and opens bottom for directory sync and warning details", async () => {
    const value = { ...syntheticReceipt(), directorySync: "failed" as const, warnings: ["Published with warning"] }; api.export.mockResolvedValue(value);
    const d = setup(); await d.runPreview(); await d.runExport(); expect(d.status.value).toBe("published"); expect(log).toHaveBeenLastCalledWith(expect.stringContaining("文件已发布"), { source: "bom_delivery", open: true });
    api.preview.mockRejectedValue(new Error("New preflight failed")); await d.runPreview(); expect(d.receipt.value).toEqual(value); d.cancel(); expect(d.receipt.value).toEqual(value);
  });
  it("receipt mismatch is an unconfirmed outcome, never false publication", async () => {
    api.export.mockResolvedValue({ ...syntheticReceipt(), bytes: 99 }); const d = setup(); await d.runPreview(); await d.runExport(); expect(d.receipt.value).toBeNull(); expect(d.status.value).toBe("unconfirmed");
  });
  it("directory picker is output-only and ignores late selection in another workspace", async () => {
    const selected = deferred<string | null>(); picker.mockReturnValue(selected.promise); const d = setup(), pending = d.chooseDirectory();
    expect(picker).toHaveBeenCalledWith("/example"); ws.value = "/other"; selected.resolve("/output"); await pending; expect(d.directorySetting.value).toBe("");
    picker.mockResolvedValue("/output"); await d.chooseDirectory(); await d.runPreview(); expect(d.targetPath.value).toBe(`/output/${syntheticPreview().suggested_filename}`);
  });
  it("keeps only target preferences per workspace, never its preview or receipt", async () => {
    const d = setup(); d.targetSetting.value = "/example/custom.json"; await d.runPreview(); ws.value = "/other"; expect(d.targetSetting.value).toBe(""); ws.value = "/example"; expect(d.targetSetting.value).toBe("/example/custom.json"); expect(d.preview.value).toBeNull(); expect(d.receipt.value).toBeNull();
  });
  it("invalid manual target disables export before confirmation or HTTP", async () => {
    const d = setup(); await d.runPreview(); d.targetSetting.value = "relative.json"; expect(d.targetValid.value).toBe(false); await d.runExport(); expect(confirm).not.toHaveBeenCalled(); expect(api.export).not.toHaveBeenCalled();
  });
  it("opens the error bottom when preflight fails and never offers a misleading empty export", async () => {
    api.preview.mockRejectedValue(new ApiError("Index partial-ready; rescan required", 409, { causes: ["Unsupported reference"] }));
    const d = setup(); await d.runPreview(); expect(d.preview.value).toBeNull(); expect(d.canExport.value).toBe(false); expect(log).toHaveBeenLastCalledWith(expect.stringContaining("Unsupported reference"), { source: "bom_delivery", open: true });
  });
});
