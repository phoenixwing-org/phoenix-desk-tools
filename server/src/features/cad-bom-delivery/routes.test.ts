import { afterEach, describe, expect, it, vi } from "vitest";
import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";
import { createCadBomDeliveryRoutes } from "./routes.js";
import { CadBomDeliveryError, type CadBomDeliveryService } from "./service.js";
import type { CadBomTransferEnvelope } from "./envelope.js";

const ID = "00000000-0000-4000-8000-000000000001";
function fixture() {
  const envelope: CadBomTransferEnvelope = {
    schema: "phoenix-bom.transfer-envelope", schemaVersion: 1, transferId: ID, createdAt: "2026-01-01T00:00:00.000Z",
    producer: { id: "phoenix-desk-tools", version: "0.1.0" },
    workspace: { schemaVersion: 13, fingerprint: `sha256:${"0".repeat(64)}`, scanId: ID, scannedAt: "2026-01-01T00:00:00.000Z" },
    payloadHash: `sha256:${"0".repeat(64)}`, parts: [], boms: [], attachments: [],
  };
  const preview = vi.fn<CadBomDeliveryService["preview"]>().mockResolvedValue({ preview_id: ID, expires_at: "2026-01-01T00:10:00.000Z", envelope, bytes: 100, suggested_filename: `phoenix-bom-${ID}.json` });
  const exportPreview = vi.fn<CadBomDeliveryService["exportPreview"]>().mockResolvedValue({ receipt: { status: "created", targetPath: "/independent/transfer.json", transferId: ID,
    payloadHash: envelope.payloadHash, bytes: 100, directorySync: "failed", warnings: ["published; directory sync failed"] } });
  const release = vi.fn<CadBomDeliveryService["release"]>().mockReturnValue({ released: true });
  const current = { preview, exportPreview, release, dispose: vi.fn() };
  return { routes: createCadBomDeliveryRoutes(current), ...current };
}
function request(action: string, body: unknown, headers: Record<string, string> = { "content-type": "application/json" }) {
  return new Request(`http://localhost/${action}`, { method: "POST", headers, body: JSON.stringify(body) });
}
afterEach(() => vi.restoreAllMocks());

describe("strict bounded CAD BOM delivery request contracts", () => {
  it("returns direct DTOs and passes only typed validated fields/current request signal", async () => {
    const data = fixture();
    const previewRequest = request("preview", { workspace: "/independent" });
    const response = await data.routes.fetch(previewRequest); expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toMatchObject({ preview_id: ID, bytes: 100 });
    expect(data.preview).toHaveBeenCalledWith("/independent", previewRequest.signal);
    const exportRequest = request("export", { workspace: "/independent", preview_id: ID, target_path: "/independent/transfer.json", confirmed: true });
    const exported = await data.routes.fetch(exportRequest); expect(exported.status).toBe(200);
    expect(await exported.json()).toMatchObject({ receipt: { status: "created", directorySync: "failed", warnings: ["published; directory sync failed"] } });
    expect(data.exportPreview).toHaveBeenCalledWith("/independent", ID, "/independent/transfer.json", true, exportRequest.signal);
    expect(await (await data.routes.fetch(request("release", { workspace: "/independent", preview_id: ID }))).json()).toEqual({ released: true });
  });

  it.each([false, "true", 1, null, {}])("rejects non-literal confirmation %j before the export operation", async confirmed => {
    const data = fixture(), response = await data.routes.fetch(request("export", { workspace: "/independent", preview_id: ID,
      target_path: "/independent/transfer.json", confirmed }));
    expect(response.status).toBe(400); expect(data.exportPreview).not.toHaveBeenCalled();
  });

  it.each(["export", "release"])("rejects injected source/proof fields on %s too", async action => {
    const data = fixture(), response = await data.routes.fetch(request(action, { workspace: "/independent", preview_id: ID,
      ...(action === "export" ? { target_path: "/independent/transfer.json", confirmed: true } : {}), proof: {} }));
    expect(response.status).toBe(400); expect(data.exportPreview).not.toHaveBeenCalled(); expect(data.release).not.toHaveBeenCalled();
  });

  it.each(["proof", "envelope", "hooks", "testHooks", "producerVersion", "version", "constructor", "__proto__"])("rejects untrusted extra field %s before any source operation", async key => {
    const data = fixture();
    const body = `{"workspace":"/independent",${JSON.stringify(key)}:{}}`;
    const response = await data.routes.request("/preview", { method: "POST", headers: { "content-type": "application/json" }, body });
    expect(response.status).toBe(400); expect(await response.json()).toMatchObject({ code: "invalid_arguments" }); expect(data.preview).not.toHaveBeenCalled();
  });

  it.each([{}, [], null, { workspace: 4 }, { workspace: {} }, { workspace: "/independent", preview_id: ID }])("rejects wrong or missing preview fields: %j", async body => {
    const data = fixture(), response = await data.routes.fetch(request("preview", body));
    expect(response.status).toBe(400); expect(data.preview).not.toHaveBeenCalled();
  });

  it.each(["text/plain", "application/x-json", "application/json-patch+json", ""])("requires application/json media type: %s", async contentType => {
    const data = fixture(), response = await data.routes.fetch(request("preview", { workspace: "/independent" }, { "content-type": contentType }));
    expect(response.status).toBe(415); expect(await response.json()).toMatchObject({ code: "unsupported_media_type" }); expect(data.preview).not.toHaveBeenCalled();
  });

  it("accepts JSON with charset, rejects duplicate decoded keys and malformed UTF-8", async () => {
    const data = fixture();
    expect((await data.routes.fetch(request("preview", { workspace: "/independent" }, { "content-type": "Application/JSON; charset=utf-8" }))).status).toBe(200);
    for (const body of ['{"workspace":"a","workspace":"b"}', '{"workspace":"a","work\\u0073pace":"b"}', '{"workspace":', new Uint8Array([0xff, 0xfe])]) {
      const response = await data.routes.request("/preview", { method: "POST", headers: { "content-type": "application/json" }, body });
      expect(response.status).toBe(400);
    }
    expect(data.preview).toHaveBeenCalledTimes(1);
  });

  it("enforces 16 KiB actual bytes, including lying content-length and multibyte JSON, without source calls", async () => {
    const data = fixture();
    const base = '{"workspace":"/independent"}';
    const exact = `${base}${" ".repeat(16 * 1024 - Buffer.byteLength(base))}`;
    expect((await data.routes.request("/preview", { method: "POST", headers: { "content-type": "application/json" }, body: exact })).status).toBe(200);
    for (const [body, declared] of [[`${exact} `, "1"], [JSON.stringify({ workspace: "中".repeat(6000) }), "1"], [base, "16385"]]) {
      const response = await data.routes.request("/preview", { method: "POST", headers: { "content-type": "application/json", "content-length": declared }, body });
      expect(response.status).toBe(413); expect(await response.json()).toMatchObject({ code: "resource_limit" });
    }
    expect(data.preview).toHaveBeenCalledTimes(1);
  });

  it("cancels an idle chunked body without waiting for more bytes or invoking source preparation", async () => {
    const data = fixture(), controller = new AbortController(); let readStarted!: () => void, cancelled = false;
    const started = new Promise<void>(resolve => { readStarted = resolve; });
    const stream = new ReadableStream<Uint8Array>({ pull() { readStarted(); }, cancel() { cancelled = true; } });
    const raw = new Request("http://localhost/preview", { method: "POST", headers: { "content-type": "application/json" }, body: stream, signal: controller.signal,
      duplex: "half" } as RequestInit & { duplex: "half" });
    const pending = data.routes.fetch(raw); await started; controller.abort();
    const response = await pending; expect(response.status).toBe(400); expect(await response.json()).toMatchObject({ code: "cancelled" });
    expect(cancelled).toBe(true); expect(data.preview).not.toHaveBeenCalled();
  });

  it("stops over-limit chunked body at its first oversized chunk", async () => {
    const data = fixture(); let cancelled = false, pulls = 0;
    const stream = new ReadableStream<Uint8Array>({ pull(controller) { pulls++; controller.enqueue(new Uint8Array(16 * 1024 + 1)); }, cancel() { cancelled = true; } });
    const raw = new Request("http://localhost/preview", { method: "POST", headers: { "content-type": "application/json" }, body: stream,
      duplex: "half" } as RequestInit & { duplex: "half" });
    const response = await data.routes.fetch(raw); expect(response.status).toBe(413); expect(cancelled).toBe(true); expect(pulls).toBeLessThanOrEqual(2);
    expect(data.preview).not.toHaveBeenCalled();
  });

  it.each([400, 409, 410, 413, 415] as const)("preserves domain status %s and bounded diagnostics", async status => {
    const data = fixture(); data.preview.mockRejectedValue(new CadBomDeliveryError("domain-code", status, "independent reason", ["bounded leaf"]));
    const response = await data.routes.fetch(request("preview", { workspace: "/independent" }));
    expect(response.status).toBe(status); expect(await response.json()).toEqual({ code: "domain-code", detail: "independent reason", causes: ["bounded leaf"] });
  });

  it("does not convert a published receipt into an error when the current request disconnects late", async () => {
    const data = fixture(), controller = new AbortController();
    const receipt = { status: "existing" as const, targetPath: "/independent/transfer.json", transferId: ID, payloadHash: `sha256:${"0".repeat(64)}`, bytes: 100,
      directorySync: "synced" as const, warnings: ["published; cleanup warning"] };
    data.exportPreview.mockImplementation(async () => { controller.abort(); return { receipt }; });
    const raw = new Request("http://localhost/export", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ workspace: "/independent", preview_id: ID, target_path: receipt.targetPath, confirmed: true }), signal: controller.signal });
    const response = await data.routes.fetch(raw); expect(response.status).toBe(200); expect(await response.json()).toEqual({ receipt });
  });

  it("revokes a prepared but not yet returned preview if its request aborts in the completion window", async () => {
    const data = fixture(), controller = new AbortController();
    const value = await data.preview("/independent"); data.preview.mockClear();
    data.preview.mockImplementation(async () => { controller.abort(); return value; });
    const raw = new Request("http://localhost/preview", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ workspace: "/independent" }), signal: controller.signal });
    const response = await data.routes.fetch(raw); expect(response.status).toBe(400);
    expect(data.release).toHaveBeenCalledExactlyOnceWith("/independent", ID);
  });

  it.each([false, true])("revokes only before Node response finish; finish=%s disconnect no longer owns the preview", async finished => {
    const data = fixture(), controller = new AbortController(), socket = new Socket();
    const outgoing = new ServerResponse(new IncomingMessage(socket));
    const raw = new Request("http://localhost/preview", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ workspace: "/independent" }), signal: controller.signal });
    const response = await data.routes.fetch(raw, { outgoing }); expect(response.status).toBe(200);
    if (finished) outgoing.emit("finish");
    controller.abort(); expect(data.release).toHaveBeenCalledTimes(finished ? 0 : 1);
    if (!finished) expect(data.release).toHaveBeenCalledWith("/independent", ID);
    expect(outgoing.listenerCount("finish")).toBe(0); socket.destroy();
  });

  it("rejects unsupported action names instead of returning placeholder success", async () => {
    const data = fixture(); for (const name of ["push", "login", "history", "commit", "prepare"]) expect((await data.routes.fetch(request(name, {}))).status).toBe(404);
  });
});
