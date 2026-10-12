import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createServer, request as httpRequest, type ClientRequest, type Server } from "node:http";
import { getRequestListener } from "@hono/node-server";
import { strToU8, zipSync } from "fflate";
import { afterEach, describe, expect, it } from "vitest";
import { createPhoenixServerApp } from "../serverApp.js";
import { scanCadWorkspaceIndex } from "../lib/cadIndexScanService.js";
import { phoenixDatabasePath } from "../lib/phoenixDatabaseService.js";

const roots: string[] = [], servers = new Set<Server>(), clients = new Set<ClientRequest>();
const previews: Array<{ workspace: string; preview_id: string }> = [];
const app = createPhoenixServerApp();
const headers = { "Content-Type": "application/json", Origin: "http://localhost:49373" };
function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  return { promise: new Promise<T>(done => { resolve = done; }), resolve: (value: T) => resolve(value) };
}
async function fixture() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "desk-transfer-route-"))); roots.push(root);
  // Independently authored metadata only: no personal geometry, identifiers or assembly inventory.
  const file = path.join(root, "Probe.FCStd");
  fs.writeFileSync(file, zipSync({ "Document.xml": strToU8('<Document><Objects><Object name="Probe" type="PartDesign::Body"/></Objects><ObjectData><Object name="Probe"><Properties Count="4"><Property name="Label"><String value="Independent route specimen"/></Property><Property name="PartNumber"><String value="API-PROBE"/></Property><Property name="PartVersion"><String value="01"/></Property><Property name="PartName"><String value="Independent route specimen"/></Property></Properties></Object></ObjectData></Document>') }));
  await scanCadWorkspaceIndex(root);
  return { root, file, model: fs.readFileSync(file), database: fs.readFileSync(phoenixDatabasePath(root)) };
}
function post(endpoint: string, body: unknown, origin = headers.Origin) {
  return app.request(`/api/cad/bom-delivery/${endpoint}`, { method: "POST", headers: { ...headers, Origin: origin }, body: JSON.stringify(body) });
}
async function endpoint() {
  const entered = deferred<Request>(), handled = deferred<Response>(), adapterDone = deferred<void>(), closed = deferred<void>();
  const writes: string[] = [];
  const listener = getRequestListener(async (request, env) => {
    entered.resolve(request); const response = await app.fetch(request, env); handled.resolve(response); return response;
  }, { overrideGlobalObjects: false });
  const server = createServer((incoming, outgoing) => {
    outgoing.once("close", () => closed.resolve());
    for (const method of ["writeHead", "write", "end"] as const) {
      const original = outgoing[method];
      Object.defineProperty(outgoing, method, { value: function (...args: unknown[]) {
        writes.push(method); return Reflect.apply(original, this, args);
      } });
    }
    void listener(incoming, outgoing).finally(() => adapterDone.resolve());
  }); servers.add(server);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject); server.listen(0, "127.0.0.1", () => { server.off("error", reject); resolve(); });
  });
  const address = server.address(); if (!address || typeof address === "string") throw new Error("Expected a loopback port");
  return { url: `http://127.0.0.1:${address.port}`, port: address.port, entered: entered.promise, handled: handled.promise,
    adapterDone: adapterDone.promise, closed: closed.promise, writes };
}
afterEach(async () => {
  for (const item of previews.splice(0)) await post("release", item);
  for (const client of clients) client.destroy(); clients.clear();
  await Promise.all([...servers].map(server => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); }))); servers.clear();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("BOM delivery mounted local API", () => {
  it("previews through the canonical mount without exposing a private proof or creating outbox", async () => {
    const file = await fixture(); const response = await post("preview", { workspace: file.root });
    expect(response.status).toBe(200); const data = await response.json(); previews.push({ workspace: file.root, preview_id: data.preview_id });
    expect(data).toMatchObject({ envelope: { producer: { id: "phoenix-desk-tools" }, parts: [{ partNo: "API-PROBE", revision: "01" }] } });
    expect(JSON.stringify(data)).not.toContain(file.root); expect(data).not.toHaveProperty("proof");
    expect(fs.existsSync(path.join(file.root, ".phoenix", "outbox"))).toBe(false);
    expect(fs.readFileSync(file.file)).toEqual(file.model); expect(fs.readFileSync(phoenixDatabasePath(file.root))).toEqual(file.database);
  });
  it("rejects a foreign browser origin at the real app boundary before all delivery actions", async () => {
    const file = await fixture(); const native = await endpoint();
    for (const action of ["preview", "export", "release"]) {
      const response = await fetch(`${native.url}/api/cad/bom-delivery/${action}`, { method: "POST", headers: { ...headers, Origin: "https://untrusted.example" }, body: JSON.stringify({ workspace: file.root }) });
      expect(response.status, action).toBe(403); expect(await response.json()).toMatchObject({ detail: "Origin is not allowed for the local Phoenix API" });
    }
    expect(fs.existsSync(path.join(file.root, ".phoenix", "outbox"))).toBe(false);
    expect(fs.readFileSync(file.file)).toEqual(file.model); expect(fs.readFileSync(phoenixDatabasePath(file.root))).toEqual(file.database);
  });
  it("keeps a normal completed HTTP preview usable for confirmed export and exact-byte retry", async () => {
    const file = await fixture(); const native = await endpoint();
    const send = async (action: string, body: unknown) => {
      const response = await fetch(`${native.url}/api/cad/bom-delivery/${action}`, { method: "POST", headers, body: JSON.stringify(body) });
      return { status: response.status, data: await response.json() };
    };
    const preview = await send("preview", { workspace: file.root }); expect(preview.status).toBe(200);
    previews.push({ workspace: file.root, preview_id: preview.data.preview_id });
    const target = path.join(file.root, ".phoenix", "outbox", preview.data.suggested_filename);
    const body = { workspace: file.root, preview_id: preview.data.preview_id, target_path: target, confirmed: true };
    const first = await send("export", body); expect(first.status).toBe(200);
    expect(first.data.receipt).toMatchObject({ status: "created", targetPath: target, payloadHash: preview.data.envelope.payloadHash });
    const bytes = fs.readFileSync(target); expect(JSON.parse(bytes.toString("utf8"))).toEqual(preview.data.envelope);
    const again = await send("export", body); expect(again.status).toBe(200); expect(again.data.receipt.status).toBe("existing");
    expect(fs.readFileSync(target)).toEqual(bytes); expect(fs.readdirSync(path.dirname(target))).toEqual([preview.data.suggested_filename]);
    expect(fs.readFileSync(file.file)).toEqual(file.model); expect(fs.readFileSync(phoenixDatabasePath(file.root))).toEqual(file.database);
  });
  it("does not register unfinished push, login or history endpoints as fake success", async () => {
    for (const action of ["push", "prepare", "commit", "history", "login", "retry"]) {
      const response = await post(action, {}); expect(response.status, action).toBe(404);
    }
  });
  it("a disconnected incomplete JSON upload performs no response writes and no workspace IO", async () => {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "desk-transfer-disconnect-"))); roots.push(root);
    const native = await endpoint();
    const client = httpRequest({ hostname: "127.0.0.1", port: native.port, path: "/api/cad/bom-delivery/preview", method: "POST", agent: false, headers: { ...headers, "Transfer-Encoding": "chunked" } });
    clients.add(client); client.on("error", () => {}); client.flushHeaders(); client.write(`{"workspace":${JSON.stringify(root)}`);
    const request = await native.entered; const aborted = deferred<void>();
    request.signal.addEventListener("abort", () => aborted.resolve(), { once: true }); client.destroy(); await aborted.promise;
    await native.closed; await native.adapterDone; expect(request.signal.aborted).toBe(true); expect(native.writes).toEqual([]);
    expect((await native.handled).body).toBeNull(); expect(fs.readdirSync(root)).toEqual([]);
  });
});
