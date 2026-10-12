import { beforeEach, describe, expect, it, vi } from "vitest";
const fetch = vi.hoisted(() => vi.fn());
vi.mock("../../api", () => ({ jsonFetch: fetch }));
import { absoluteJsonTarget, exportBomDelivery, joinOutputDirectory, previewBomDelivery, releaseBomDelivery, safeSuggestedFilename, validateBomDeliveryPreview, validateBomDeliveryReceipt } from "./api";
import { syntheticPreview, syntheticReceipt } from "./fixtures.test-support";
beforeEach(() => fetch.mockReset());
describe("BOM delivery public HTTP transport", () => {
  it("sends strict preview and export input, forwarding AbortSignal, never a client payload", async () => {
    const signal = new AbortController().signal, value = syntheticPreview();
    fetch.mockResolvedValueOnce(value).mockResolvedValueOnce({ receipt: syntheticReceipt() });
    expect(await previewBomDelivery("/example", signal)).toEqual(value);
    expect(await exportBomDelivery("/example", value.preview_id, "/example/result.json", signal)).toEqual(syntheticReceipt());
    expect(fetch.mock.calls.map(call => [call[0], JSON.parse(call[1].body), call[1].signal])).toEqual([
      ["/api/cad/bom-delivery/preview", { workspace: "/example" }, signal],
      ["/api/cad/bom-delivery/export", { workspace: "/example", preview_id: value.preview_id, target_path: "/example/result.json", confirmed: true }, signal],
    ]);
  });
  it("validates release acknowledgment", async () => {
    fetch.mockResolvedValueOnce({ released: true }).mockResolvedValueOnce({ released: false });
    await releaseBomDelivery("/example", syntheticPreview().preview_id);
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ workspace: "/example", preview_id: syntheticPreview().preview_id });
    await expect(releaseBomDelivery("/example", syntheticPreview().preview_id)).rejects.toThrow("released");
  });
  it("best-effort releases malformed preview with a valid handle independently from request signal", async () => {
    fetch.mockResolvedValueOnce({ ...syntheticPreview(), bytes: 0 }).mockResolvedValue({ released: true });
    const signal = new AbortController().signal;
    await expect(previewBomDelivery("/example", signal)).rejects.toThrow("bytes");
    expect(fetch.mock.calls[1][0]).toMatch(/release$/);
    expect(fetch.mock.calls[1][1].signal).toBeUndefined();
  });
  it("does not release arbitrary malformed handle", async () => {
    fetch.mockResolvedValue({ ...syntheticPreview(), preview_id: "arbitrary" });
    await expect(previewBomDelivery("/example")).rejects.toThrow("preview_id");
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it.each(["relative.json", "/example/../result.json", "/example/result.txt", "/example/./result.json", "/example/\nresult.json"])("rejects unsafe target %s before fetch", async target => {
    await expect(exportBomDelivery("/example", syntheticPreview().preview_id, target)).rejects.toThrow(); expect(fetch).not.toHaveBeenCalled();
  });
  it("joins safe JSON basename only and supports native absolute path forms", () => {
    const name = syntheticPreview().suggested_filename;
    expect(joinOutputDirectory("/example/", name)).toBe(`/example/${name}`);
    expect(joinOutputDirectory("C:\\example\\", name)).toBe(`C:\\example\\${name}`);
    expect(absoluteJsonTarget("\\\\server\\share\\result.json")).toContain("result.json");
    expect(() => safeSuggestedFilename(`../${name}`)).toThrow();
  });
  it.each([
    (v: ReturnType<typeof syntheticPreview>) => ({ ...v, unknown: true }),
    (v: ReturnType<typeof syntheticPreview>) => ({ ...v, expires_at: "2030-01-01" }),
    (v: ReturnType<typeof syntheticPreview>) => ({ ...v, suggested_filename: "unsafe.json" }),
    (v: ReturnType<typeof syntheticPreview>) => ({ ...v, envelope: { ...v.envelope, producer: { id: "kt-auto-cad", version: "test" } } }),
    (v: ReturnType<typeof syntheticPreview>) => ({ ...v, envelope: { ...v.envelope, schemaVersion: 2 } }),
    (v: ReturnType<typeof syntheticPreview>) => ({ ...v, envelope: { ...v.envelope, payloadHash: "hash" } }),
    (v: ReturnType<typeof syntheticPreview>) => ({ ...v, envelope: { ...v.envelope, boms: [{ ...v.envelope.boms[0], items: [{ ...v.envelope.boms[0].items[0], qty: 0 }] }] } }),
    (v: ReturnType<typeof syntheticPreview>) => ({ ...v, bytes: 8 * 1024 * 1024 + 1 }),
    (v: ReturnType<typeof syntheticPreview>) => ({ ...v, envelope: { ...v.envelope, parts: [] } }),
    (v: ReturnType<typeof syntheticPreview>) => ({ ...v, envelope: { ...v.envelope, boms: [{ ...v.envelope.boms[0], items: [] }] } }),
    (v: ReturnType<typeof syntheticPreview>) => ({ ...v, envelope: { ...v.envelope, producer: { id: "phoenix-desk-tools", version: "x".repeat(33) } } }),
    (v: ReturnType<typeof syntheticPreview>) => ({ ...v, envelope: { ...v.envelope, boms: [{ ...v.envelope.boms[0], name: "x".repeat(101) }] } }),
    (v: ReturnType<typeof syntheticPreview>) => ({ ...v, envelope: { ...v.envelope, boms: [{ ...v.envelope.boms[0], bomKey: "bad-key" }] } }),
    (v: ReturnType<typeof syntheticPreview>) => ({ ...v, envelope: { ...v.envelope, workspace: { ...v.envelope.workspace, scanId: "c1000000-0000-4000-8000-000000000001" } } }),
    (v: ReturnType<typeof syntheticPreview>) => ({ ...v, bytes: v.bytes + 1 }),
  ])("rejects invalid server preview shape %#", mutate => { expect(() => validateBomDeliveryPreview(mutate(syntheticPreview()))).toThrow(); });
  it("accepts published receipt warnings without converting them to a failure", () => {
    const receipt = { ...syntheticReceipt(), directorySync: "failed", warnings: ["Directory sync not confirmed"] };
    expect(validateBomDeliveryReceipt({ receipt })).toEqual(receipt);
    expect(() => validateBomDeliveryReceipt({ receipt: { ...receipt, status: "success" } })).toThrow();
    expect(() => validateBomDeliveryReceipt({ receipt, success: true })).toThrow();
  });
});
