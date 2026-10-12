import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createServer, request as httpRequest, type ClientRequest, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { getRequestListener } from "@hono/node-server";
import { Hono } from "hono";
import { strToU8, zipSync } from "fflate";
import { afterEach, describe, expect, it } from "vitest";
import { createCadObjectInfoRoutes } from "./routes.js";
import { readCadObjectInfo } from "./service.js";

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
type Transport = { request: Request; incoming: IncomingMessage; outgoing: ServerResponse };
type Reader = typeof readCadObjectInfo;
const servers = new Set<Server>(), clients = new Set<ClientRequest>(), roots: string[] = [];
function fixture() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "desk-object-http-"))); roots.push(root);
  // Independently authored metadata and opaque bytes, not a copied CAD model.
  const bytes = zipSync({ "Document.xml": strToU8('<Document><ObjectData><Object name="Example" type="Part::Feature"><Properties><Property name="Label"><String value="Independent example"/></Property></Properties></Object></ObjectData></Document>'), "shape.bin": new Uint8Array([7, 3, 11]) });
  fs.writeFileSync(path.join(root, "Example.FCStd"), bytes);
  return { root, bytes, body: JSON.stringify({ workspacePath: root, filePath: "Example.FCStd" }) };
}
async function endpoint(read: Reader = readCadObjectInfo) {
  const entered = deferred<Transport>(), bodyEnded = deferred<void>(), requestClosed = deferred<void>();
  const responseClosed = deferred<void>(), responseFinished = deferred<void>(), handled = deferred<Response>(), adapterDone = deferred<void>();
  const writes: string[] = [];
  const app = new Hono(); app.route("/api/cad/object-info", createCadObjectInfoRoutes(undefined, read));
  const listener = getRequestListener(async (request, env) => {
    entered.resolve({ request, incoming: env.incoming as IncomingMessage, outgoing: env.outgoing as ServerResponse });
    const response = await app.fetch(request, env);
    handled.resolve(response); return response;
  }, { overrideGlobalObjects: false });
  const server = createServer((incoming, outgoing) => {
    incoming.once("end", () => bodyEnded.resolve()); incoming.once("close", () => requestClosed.resolve());
    outgoing.once("close", () => responseClosed.resolve()); outgoing.once("finish", () => responseFinished.resolve());
    for (const method of ["writeHead", "write", "end"] as const) {
      const original = outgoing[method];
      // Observe actual native writes; delegate unchanged to Node, never fabricate a response.
      Object.defineProperty(outgoing, method, { value: function (...args: unknown[]) {
        writes.push(method); return Reflect.apply(original, this, args);
      } });
    }
    void listener(incoming, outgoing).finally(() => adapterDone.resolve());
  });
  servers.add(server);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject); server.listen(0, "127.0.0.1", () => { server.off("error", reject); resolve(); });
  });
  const address = server.address(); if (!address || typeof address === "string") throw new Error("Expected a loopback TCP port");
  const port = address.port;
  function send(body: string, complete = true) {
    const response = deferred<{ status: number; text: string }>();
    const client = httpRequest({ hostname: "127.0.0.1", port, path: "/api/cad/object-info", method: "POST", agent: false,
      headers: { "Content-Type": "application/json", ...(complete ? { "Content-Length": Buffer.byteLength(body) } : { "Transfer-Encoding": "chunked" }) } }, incoming => {
      const chunks: Buffer[] = []; incoming.on("data", chunk => chunks.push(Buffer.from(chunk)));
      incoming.once("end", () => response.resolve({ status: incoming.statusCode!, text: Buffer.concat(chunks).toString("utf8") }));
    });
    clients.add(client); client.on("error", () => {}); // Expected local socket hangup on deliberate disconnect.
    if (complete) client.end(body); else { client.flushHeaders(); client.write(body); }
    return { client, response: response.promise };
  }
  return { entered: entered.promise, bodyEnded: bodyEnded.promise, requestClosed: requestClosed.promise,
    responseClosed: responseClosed.promise, responseFinished: responseFinished.promise, handled: handled.promise,
    adapterDone: adapterDone.promise, writes, send };
}
afterEach(async () => {
  for (const client of clients) client.destroy(); clients.clear();
  await Promise.all([...servers].map(server => new Promise<void>(resolve => {
    server.closeAllConnections(); server.close(() => resolve());
  }))); servers.clear();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("CAD object route actual loopback HTTP cancellation", () => {
  it("aborts the downstream signal after a complete upload disconnects and performs no response writes", async () => {
    const file = fixture(), downstream = deferred<AbortSignal>(), release = deferred<void>(); let reads = 0;
    const server = await endpoint(async (workspace, rel, signal, budget) => {
      downstream.resolve(signal!); await budget!.waitFor(release.promise); reads++;
      return readCadObjectInfo(workspace, rel, signal, budget);
    });
    const { client } = server.send(file.body);
    const signal = await downstream.promise, transport = await server.entered; await server.bodyEnded;
    expect(transport.incoming.complete).toBe(true); expect(signal.aborted).toBe(false);
    const aborted = deferred<void>(); signal.addEventListener("abort", () => aborted.resolve(), { once: true });
    client.destroy(); await aborted.promise; await server.responseClosed; await server.adapterDone;
    expect(signal).toBe(transport.request.signal); expect(signal.aborted).toBe(true); expect(reads).toBe(0);
    expect(server.writes).toEqual([]);
    expect((await server.handled).body).toBeNull();
    expect(fs.readFileSync(path.join(file.root, "Example.FCStd"))).toEqual(Buffer.from(file.bytes));
    expect(fs.readdirSync(file.root)).toEqual(["Example.FCStd"]);
  });

  it("discards a completed real read returned late after client disconnect instead of serializing success", async () => {
    const file = fixture(), completed = deferred<AbortSignal>(), release = deferred<void>();
    const server = await endpoint(async (workspace, rel, signal, budget) => {
      const result = await readCadObjectInfo(workspace, rel, signal, budget);
      completed.resolve(signal!); await release.promise; return result;
    });
    const { client } = server.send(file.body); const signal = await completed.promise;
    const aborted = deferred<void>(); signal.addEventListener("abort", () => aborted.resolve(), { once: true });
    client.destroy(); await aborted.promise; await server.responseClosed; release.resolve(); await server.adapterDone;
    expect(signal.aborted).toBe(true); expect(server.writes).toEqual([]);
    expect((await server.handled).body).toBeNull();
    expect(fs.readFileSync(path.join(file.root, "Example.FCStd"))).toEqual(Buffer.from(file.bytes));
  });

  it("does not treat normal request end, complete or close as cancellation while awaiting the read", async () => {
    const file = fixture(), downstream = deferred<AbortSignal>(), release = deferred<void>();
    const server = await endpoint(async (workspace, rel, signal, budget) => {
      downstream.resolve(signal!); await budget!.waitFor(release.promise);
      return readCadObjectInfo(workspace, rel, signal, budget);
    });
    const { response } = server.send(file.body); const signal = await downstream.promise;
    const transport = await server.entered; await server.bodyEnded; await server.requestClosed;
    expect(transport.incoming.complete).toBe(true); expect(signal.aborted).toBe(false); release.resolve();
    const result = await response; await server.responseFinished; await server.responseClosed; await server.adapterDone;
    expect(result.status).toBe(200); expect(JSON.parse(result.text)).toMatchObject({ success: true, data: { document: { root_names: ["Example"] } } });
    expect(signal.aborted).toBe(false); expect(server.writes).toContain("writeHead"); expect(server.writes).toContain("end");
    expect(fs.readFileSync(path.join(file.root, "Example.FCStd"))).toEqual(Buffer.from(file.bytes));
  });

  it("cancels a real incomplete body upload without invoking the downstream reader or writing an error response", async () => {
    let reads = 0; const server = await endpoint(async (...args) => { reads++; return readCadObjectInfo(...args); });
    const { client } = server.send('{"workspacePath":', false); const transport = await server.entered;
    const aborted = deferred<void>(); transport.request.signal.addEventListener("abort", () => aborted.resolve(), { once: true });
    client.destroy(); await aborted.promise; await server.responseClosed; await server.adapterDone;
    expect(transport.incoming.complete).toBe(false); expect(transport.request.signal.aborted).toBe(true);
    expect(reads).toBe(0); expect(server.writes).toEqual([]);
    expect((await server.handled).body).toBeNull();
  });

  it("still sends a normal validation error for a complete connected HTTP request", async () => {
    const server = await endpoint(); const { response } = server.send('{"filePath":null}');
    const result = await response; const transport = await server.entered; await server.adapterDone;
    expect(result.status).toBe(400); expect(JSON.parse(result.text)).toMatchObject({ success: false, code: "invalid_arguments" });
    expect(transport.request.signal.aborted).toBe(false); expect(server.writes).toContain("writeHead");
  });

  it("preserves the cancelled JSON contract for an in-memory aborted Request with no Node bindings", async () => {
    const controller = new AbortController(); controller.abort();
    const request = new Request("http://localhost/", { method: "POST", signal: controller.signal,
      headers: { "Content-Type": "application/json" }, body: "{}" });
    const response = await createCadObjectInfoRoutes().fetch(request);
    expect(response.status).toBe(400); expect(await response.json()).toMatchObject({ success: false, code: "cancelled" });
  });

  it("reads a normal in-memory Request with no Node bindings", async () => {
    const file = fixture();
    const request = new Request("http://localhost/", { method: "POST",
      headers: { "Content-Type": "application/json" }, body: file.body });
    const response = await createCadObjectInfoRoutes().fetch(request);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true, data: { document: { root_names: ["Example"] } } });
    expect(request.signal.aborted).toBe(false);
    expect(fs.readFileSync(path.join(file.root, "Example.FCStd"))).toEqual(Buffer.from(file.bytes));
    expect(fs.readdirSync(file.root)).toEqual(["Example.FCStd"]);
  });
});
