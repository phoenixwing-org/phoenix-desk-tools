import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { strToU8, zipSync } from "fflate";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCadLightInfoRoutes } from "./routes.js";
import { readCadLightInfo } from "./service.js";
import { CadObjectInfoError } from "../cad-object-info/error.js";

let root: string;
beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "desk-light-route-")));
  fs.writeFileSync(path.join(root, "Probe.FCStd"), zipSync({ "Document.xml": strToU8("<Document/>") }));
});
afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });
const request = (body: unknown) => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
describe("light info strict bounded request and response", () => {
  it("keeps the primary cancellation code while never exposing aggregate cleanup details", async () => {
    const route = createCadLightInfoRoutes(undefined, async () => { throw new AggregateError([
      new CadObjectInfoError("cancelled", "轻量读取已取消"), new Error(`private cleanup ${root}`),
    ], "internal aggregate"); });
    const response = await route.request("/", request({ workspacePath: root, filePath: "Probe.FCStd" }));
    expect(response.status).toBe(400);
    const result = await response.json(); expect(result).toMatchObject({ success: false, code: "cancelled", error: "轻量读取已取消" });
    expect(JSON.stringify(result)).not.toContain(root); expect(JSON.stringify(result)).not.toContain("cleanup");
  });
  it("reads a full summary envelope without implicitly creating an index", async () => {
    const response = await createCadLightInfoRoutes().request("/", request({ workspacePath: root, filePath: "Probe.FCStd" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true, data: { analysis: { documentXmlBytes: 11, objectCount: 0, xlinks: [], embeddedFields: {} },
      diagnostics: { items: [], counts: { resolved: 0, ambiguous: 0, missing: 0, self: 0, non_fcstd: 0 } } } });
    expect(fs.readdirSync(root)).toEqual(["Probe.FCStd"]);
  });
  it.each([{ budget: 100 }, { limits: { xmlBytes: 128 } }, { beforeFinalCheck: "hook" }, { producerVersion: "client" }])("rejects unknown or client budget/hook fields: %o", async extra => {
    const read = vi.fn(readCadLightInfo);
    const response = await createCadLightInfoRoutes(undefined, read).request("/", request({ workspacePath: root, filePath: "Probe.FCStd", ...extra }));
    expect(response.status).toBe(400); expect(await response.json()).toMatchObject({ success: false, code: "invalid_arguments" }); expect(read).not.toHaveBeenCalled();
  });
  it.each([null, [], {}, { workspacePath: root }, { workspacePath: root, filePath: 1 }, { workspacePath: "", filePath: "Probe.FCStd" }])("rejects invalid arguments: %o", async body => {
    const response = await createCadLightInfoRoutes().request("/", request(body));
    expect(response.status).toBe(400); expect(await response.json()).toMatchObject({ success: false, code: "invalid_arguments" });
  });
  it("exposes resource, malformed JSON/UTF-8 and deadline failures without absolute-path errors", async () => {
    const limited = await createCadLightInfoRoutes({ bytes: 100 }).request("/", request({ workspacePath: root, filePath: "Probe.FCStd" }));
    expect(limited.status).toBe(413); expect(await limited.json()).toMatchObject({ success: false, code: "resource_limit" });
    for (const body of ["{", new Uint8Array([255])]) {
      const response = await createCadLightInfoRoutes().request("/", { method: "POST", body });
      expect(response.status).toBe(400); expect(await response.json()).toMatchObject({ success: false, code: "invalid_arguments" });
    }
    const failure = await createCadLightInfoRoutes().request("/", request({ workspacePath: root, filePath: "Missing.FCStd" }));
    expect(JSON.stringify(await failure.json())).not.toContain(root);
    let now = 0;
    const timeout = await createCadLightInfoRoutes({ durationMs: 5, now: () => now }, async (...args) => { now = 5; return readCadLightInfo(...args); })
      .request("/", request({ workspacePath: root, filePath: "Probe.FCStd" }));
    expect(timeout.status).toBe(408); expect(await timeout.json()).toMatchObject({ code: "timeout" });
  });
  it("bounds actual streaming request bytes, not only Content-Length", async () => {
    const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(strToU8(" ".repeat(64 * 1024 + 1))); controller.close(); } });
    const response = await createCadLightInfoRoutes().request("/", { method: "POST", headers: { "Content-Length": "1" }, body: stream, duplex: "half" } as RequestInit);
    expect(response.status).toBe(413); expect(await response.json()).toMatchObject({ code: "resource_limit" });
  });
  it("discards a late result after cancellation and keeps in-memory cancelled JSON", async () => {
    const controller = new AbortController();
    const route = createCadLightInfoRoutes(undefined, async (...args) => { const result = await readCadLightInfo(...args); controller.abort(); return result; });
    const req = new Request("http://localhost/", { ...request({ workspacePath: root, filePath: "Probe.FCStd" }), signal: controller.signal });
    const response = await route.fetch(req);
    expect(response.status).toBe(400); expect(await response.json()).toMatchObject({ success: false, code: "cancelled" });
  });
});
