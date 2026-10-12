import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createServer, request as httpRequest, type ClientRequest, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { getRequestListener } from "@hono/node-server";
import { Hono } from "hono";
import { strToU8, zipSync } from "fflate";
import { afterEach, describe, expect, it } from "vitest";
import { createCadLightInfoRoutes } from "./routes.js";
import { readCadLightInfo } from "./service.js";

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
type Transport = { request: Request; incoming: IncomingMessage; outgoing: ServerResponse };
const servers = new Set<Server>(), clients = new Set<ClientRequest>(), roots: string[] = [];
function fixture() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "desk-light-http-"))); roots.push(root);
  // Independent metadata only: no copied part list, assembly or geometry.
  const xml = '<Document><Objects><Object name="Example" type="PartDesign::Body"/></Objects><ObjectData><Object name="Example"><Properties><Property name="PartName"><String value="Independent HTTP example"/></Property></Properties></Object></ObjectData></Document>';
  const bytes = zipSync({ "Document.xml": strToU8(xml), "opaque.bin": new Uint8Array([13, 3, 17]) });
  const filename = path.join(root, "Example.FCStd"); fs.writeFileSync(filename, bytes);
  return { root, filename, bytes, mtime: fs.statSync(filename).mtimeMs,
    body: JSON.stringify({ workspacePath: root, filePath: "Example.FCStd" }) };
}
function expectUntouched(file: ReturnType<typeof fixture>) {
  expect(fs.readFileSync(file.filename)).toEqual(Buffer.from(file.bytes));
  expect(fs.statSync(file.filename).mtimeMs).toBe(file.mtime);
  // Neither the reader nor the HTTP lifecycle may initialize an index/outbox.
  expect(fs.readdirSync(file.root)).toEqual(["Example.FCStd"]);
}
async function endpoint(read: typeof readCadLightInfo = readCadLightInfo) {
  const entered = deferred<Transport>(), bodyEnded = deferred<void>(), requestClosed = deferred<void>();
  const responseClosed = deferred<void>(), responseFinished = deferred<void>(), handled = deferred<Response>(), adapterDone = deferred<void>();
  const writes: string[] = [];
  const app = new Hono(); app.route("/api/cad/light-info", createCadLightInfoRoutes(undefined, read));
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
      // Observe native writes while still delegating unchanged to Node.
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
  const address = server.address(); if (!address || typeof address === "string") throw new Error("Expected loopback TCP port");
  const port = address.port;
  function send(body: string) {
    const response = deferred<{ status: number; text: string }>();
    const client = httpRequest({ hostname: "127.0.0.1", port, path: "/api/cad/light-info", method: "POST", agent: false,
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) } }, incoming => {
      const chunks: Buffer[] = []; incoming.on("data", chunk => chunks.push(Buffer.from(chunk)));
      incoming.once("end", () => response.resolve({ status: incoming.statusCode!, text: Buffer.concat(chunks).toString("utf8") }));
    });
    clients.add(client); client.on("error", () => {}); // Deliberate disconnect causes the expected local socket hangup.
    client.end(body); return { client, response: response.promise };
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

describe("CAD light route actual loopback HTTP lifecycle", () => {
  it("aborts downstream after a complete upload disconnects without any response writes", async () => {
    const file = fixture(), downstream = deferred<AbortSignal>(), release = deferred<void>(); let reads = 0;
    const server = await endpoint(async (workspace, rel, signal, budget) => {
      downstream.resolve(signal!); await budget!.waitFor(release.promise); reads++;
      return readCadLightInfo(workspace, rel, signal, budget);
    });
    const { client } = server.send(file.body);
    const signal = await downstream.promise, transport = await server.entered; await server.bodyEnded;
    expect(transport.incoming.complete).toBe(true); expect(signal.aborted).toBe(false);
    const aborted = deferred<void>(); signal.addEventListener("abort", () => aborted.resolve(), { once: true });
    client.destroy(); await aborted.promise; await server.responseClosed; await server.adapterDone;
    expect(signal).toBe(transport.request.signal); expect(signal.aborted).toBe(true); expect(reads).toBe(0);
    expect(server.writes).toEqual([]); expect((await server.handled).body).toBeNull(); expectUntouched(file);
  });

  it("discards a completed real light read held until after disconnect instead of serializing stale success", async () => {
    const file = fixture(), completed = deferred<AbortSignal>(), release = deferred<void>(); let completedReads = 0;
    const server = await endpoint(async (workspace, rel, signal, budget) => {
      const result = await readCadLightInfo(workspace, rel, signal, budget);
      expect(result.analysis.embeddedFields.PartName).toBe("Independent HTTP example");
      completedReads++; completed.resolve(signal!); await release.promise; return result;
    });
    const { client } = server.send(file.body); const signal = await completed.promise;
    const aborted = deferred<void>(); signal.addEventListener("abort", () => aborted.resolve(), { once: true });
    client.destroy(); await aborted.promise; await server.responseClosed; release.resolve(); await server.adapterDone;
    expect(completedReads).toBe(1); expect(signal.aborted).toBe(true); expect(server.writes).toEqual([]);
    expect((await server.handled).body).toBeNull(); expectUntouched(file);
  });

  it("does not cancel on normal complete request end/close and returns the final 200 summary", async () => {
    const file = fixture(), downstream = deferred<AbortSignal>(), release = deferred<void>();
    const server = await endpoint(async (workspace, rel, signal, budget) => {
      downstream.resolve(signal!); await budget!.waitFor(release.promise);
      return readCadLightInfo(workspace, rel, signal, budget);
    });
    const { response } = server.send(file.body); const signal = await downstream.promise;
    const transport = await server.entered; await server.bodyEnded; await server.requestClosed;
    expect(transport.incoming.complete).toBe(true); expect(signal.aborted).toBe(false); release.resolve();
    const result = await response; await server.responseFinished; await server.responseClosed; await server.adapterDone;
    expect(result.status).toBe(200); expect(JSON.parse(result.text)).toMatchObject({ success: true, data: {
      analysis: { objectCount: 1, xlinks: [], embeddedFields: { PartName: "Independent HTTP example" } },
      diagnostics: { items: [], counts: { resolved: 0, ambiguous: 0, missing: 0, self: 0, non_fcstd: 0 } }, warnings: [],
    } });
    expect(signal.aborted).toBe(false); expect(server.writes).toContain("writeHead"); expect(server.writes).toContain("end"); expectUntouched(file);
  });
});
