import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createServer, request as httpRequest, type ClientRequest, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { getRequestListener } from "@hono/node-server";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createWorkspaceRecoveryRoutes } from "./routes.js";
import { createWorkspaceRecoveryService, type WorkspaceRecoveryService } from "./service.js";
import { createWorkspaceRecoveryBackup, createWorkspaceRecoveryEngine, inspectWorkspaceRecoveryBackup, WORKSPACE_BACKUP_MANIFEST, WORKSPACE_RESTORE_MARKER } from "./recovery.js";

let root: string;
const DB = ".phoenix/phoenix-workspace.sqlite";
const servers = new Set<Server>(), clients = new Set<ClientRequest>();
beforeEach(() => { root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "desk-recovery-http-"))); });
afterEach(async () => {
  for (const client of clients) client.destroy(); clients.clear();
  await Promise.all([...servers].map(server => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); }))); servers.clear();
  vi.restoreAllMocks(); fs.rmSync(root, { recursive: true, force: true });
});
async function fixture() {
  const workspace = path.join(root, "workspace"), backup = path.join(root, "package"); fs.mkdirSync(path.join(workspace, ".phoenix/outbox/empty"), { recursive: true });
  const db = new DatabaseSync(path.join(workspace, DB));
  try { db.exec("CREATE TABLE independent_manual(note TEXT); INSERT INTO independent_manual VALUES ('independent fixture');"); } finally { db.close(); }
  fs.writeFileSync(path.join(workspace, ".phoenix/outbox/opaque.bin"), new Uint8Array([0, 255, 9]));
  await createWorkspaceRecoveryBackup({ workspace, destinationDirectory: backup });
  return { workspace, backup, database: fs.readFileSync(path.join(workspace, DB)), manifest: fs.readFileSync(path.join(backup, WORKSPACE_BACKUP_MANIFEST)) };
}
function deferred<T = void>() { let resolve!: (value: T | PromiseLike<T>) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
function post(url: string, body: unknown, signal?: AbortSignal) { return new Request(`http://localhost${url}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal }); }

describe("workspace recovery strict plain HTTP contract", () => {
  it("runs inspect, restore, release and explicit backup using plain no-store DTOs", async () => {
    const file = await fixture(), service = createWorkspaceRecoveryService({ currentWorkspace: () => file.workspace }), app = createWorkspaceRecoveryRoutes(service);
    const response = await app.fetch(post("/inspect", { workspace: file.workspace, backup_directory: file.backup }));
    expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("no-store"); const inspection = await response.json();
    expect(inspection).not.toHaveProperty("files"); expect(inspection).not.toHaveProperty("success"); expect(inspection).not.toHaveProperty("data");
    const target = path.join(root, "restored"); const restored = await app.fetch(post("/restore", { workspace: file.workspace, inspection_id: inspection.inspection_id, target_directory: target, confirmed: true }));
    expect(restored.status).toBe(200); expect(await restored.json()).toMatchObject({ receipt: { workspace: target, fileCount: 2 } });
    const gone = await app.fetch(post("/release", { workspace: file.workspace, inspection_id: inspection.inspection_id })); expect(gone.status).toBe(410);
    const backup = path.join(root, "second-package"); const result = await app.fetch(post("/backup", { workspace: file.workspace, target_directory: backup, confirmed: true }));
    expect(result.status).toBe(200); expect(await result.json()).toMatchObject({ receipt: { backupDirectory: backup } });
    const next = await (await app.fetch(post("/inspect", { workspace: file.workspace, backup_directory: backup }))).json();
    expect(await (await app.fetch(post("/release", { workspace: file.workspace, inspection_id: next.inspection_id }))).json()).toEqual({ released: true });
    expect(fs.readFileSync(path.join(file.workspace, DB))).toEqual(file.database);
  });
  it.each([
    ["inspect", { workspace: "/noncurrent", backup_directory: "/package", proof: {} }],
    ["inspect", { workspace: "/noncurrent", backup_directory: "/package", hooks: {} }],
    ["backup", { workspace: "/noncurrent", target_directory: "/target", confirmed: true, producerVersion: "fake" }],
    ["restore", { workspace: "/noncurrent", inspection_id: "fake", target_directory: "/target", confirmed: true, manifest_sha256: "0".repeat(64) }],
    ["restore", { workspace: "/noncurrent", inspection_id: "fake", target_directory: "/target", confirmed: true, backup_path: "/package" }],
    ["backup", { workspace: "/noncurrent", target_directory: "/target", confirmed: false }],
    ["backup", { workspace: "/noncurrent", target_directory: "/target" }],
    ["release", { workspace: "/noncurrent", inspection_id: 7 }],
    ["inspect", { workspace: null, backup_directory: "/package" }],
  ])("rejects prohibited/missing fields for %s (case %#) before any engine IO", async (action, body) => {
    const inspect = vi.fn(inspectWorkspaceRecoveryBackup), service = createWorkspaceRecoveryService({ currentWorkspace: () => "", inspect }), response = await createWorkspaceRecoveryRoutes(service).fetch(post(`/${action}`, body));
    expect(response.status).toBe(400); expect(await response.json()).toMatchObject({ code: "invalid_arguments" }); expect(inspect).not.toHaveBeenCalled();
  });
  it.each(['{"workspace":"/x","workspace":"/y","backup_directory":"/z"}', '{"work\\u0073pace":"/x","workspace":"/y","backup_directory":"/z"}', "null", "[]", "{"])("rejects invalid objects and duplicate escaped keys: %s", async body => {
    const response = await createWorkspaceRecoveryRoutes().fetch(new Request("http://localhost/inspect", { method: "POST", headers: { "Content-Type": "application/json" }, body }));
    expect(response.status).toBe(400); expect(response.headers.get("cache-control")).toBe("no-store"); expect(await response.json()).toMatchObject({ code: "invalid_arguments" });
  });
  it("rejects unsupported content types, malformed UTF-8 and actual streaming size independently of Content-Length", async () => {
    const app = createWorkspaceRecoveryRoutes();
    expect((await app.fetch(new Request("http://localhost/inspect", { method: "POST", body: "{}" }))).status).toBe(415);
    expect((await app.fetch(new Request("http://localhost/inspect", { method: "POST", headers: { "Content-Type": "application/json" }, body: new Uint8Array([255]) }))).status).toBe(400);
    const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(16 * 1024)); controller.enqueue(new Uint8Array([0])); controller.close(); } });
    const request = new Request("http://localhost/inspect", { method: "POST", headers: { "Content-Type": "application/json", "Content-Length": "1" }, body: stream, duplex: "half" } as RequestInit);
    expect((await app.fetch(request)).status).toBe(413);
  });
  it("cancels an in-memory body reader without awaiting a stalled upload or invoking the engine", async () => {
    const controller = new AbortController(), entered = deferred(), stream = new ReadableStream<Uint8Array>({ pull() { entered.resolve(); return new Promise<void>(() => {}); } });
    const request = new Request("http://localhost/inspect", { method: "POST", headers: { "Content-Type": "application/json" }, body: stream, signal: controller.signal, duplex: "half" } as RequestInit);
    const response = createWorkspaceRecoveryRoutes().fetch(request); await entered.promise; controller.abort();
    expect((await response).status).toBe(400); expect(await (await response).json()).toMatchObject({ code: "cancelled" });
  });
});

type Transport = { request: Request; incoming: IncomingMessage; outgoing: ServerResponse };
async function endpoint(service: WorkspaceRecoveryService, action = "inspect", beforeDelivery?: (response: Response) => Promise<void>) {
  const entered = deferred<Transport>(), bodyEnded = deferred(), requestClosed = deferred(), responseClosed = deferred(), responseFinished = deferred(), handled = deferred<Response>(), adapterDone = deferred();
  const writes: string[] = [], app = new Hono(); app.route("/api/workspace-recovery", createWorkspaceRecoveryRoutes(service));
  const listener = getRequestListener(async (request, env) => { entered.resolve({ request, incoming: env.incoming as IncomingMessage, outgoing: env.outgoing as ServerResponse }); const response = await app.fetch(request, env); handled.resolve(response); await beforeDelivery?.(response); return response; }, { overrideGlobalObjects: false });
  const server = createServer((incoming, outgoing) => {
    incoming.once("end", () => bodyEnded.resolve()); incoming.once("close", () => requestClosed.resolve()); outgoing.once("close", () => responseClosed.resolve()); outgoing.once("finish", () => responseFinished.resolve());
    for (const method of ["writeHead", "write", "end"] as const) { const original = outgoing[method]; Object.defineProperty(outgoing, method, { value: function (...args: unknown[]) { writes.push(method); return Reflect.apply(original, this, args); } }); }
    void listener(incoming, outgoing).finally(() => adapterDone.resolve());
  }); servers.add(server);
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", () => { server.off("error", reject); resolve(); }); });
  const address = server.address(); if (!address || typeof address === "string") throw new Error("loopback port required"); const port = address.port;
  function send(body: string, complete = true) {
    const response = deferred<{ status: number; text: string }>(), client = httpRequest({ hostname: "127.0.0.1", port, path: `/api/workspace-recovery/${action}`, method: "POST", agent: false,
      headers: { "Content-Type": "application/json", ...(complete ? { "Content-Length": Buffer.byteLength(body) } : { "Transfer-Encoding": "chunked" }) } }, incoming => {
      const chunks: Buffer[] = []; incoming.on("data", chunk => chunks.push(Buffer.from(chunk))); incoming.once("end", () => response.resolve({ status: incoming.statusCode!, text: Buffer.concat(chunks).toString("utf8") }));
    }); clients.add(client); client.on("error", () => {}); if (complete) client.end(body); else { client.flushHeaders(); client.write(body); }
    return { client, response: response.promise };
  }
  return { entered: entered.promise, bodyEnded: bodyEnded.promise, requestClosed: requestClosed.promise, responseClosed: responseClosed.promise, responseFinished: responseFinished.promise, handled: handled.promise, adapterDone: adapterDone.promise, writes, send };
}
describe("actual loopback disconnect lifecycle", () => {
  it("revokes only an undelivered inspection when disconnect wins after route success but before outgoing finish", async () => {
    const file = await fixture(), ready = deferred(), resume = deferred(), service = createWorkspaceRecoveryService({ currentWorkspace: () => file.workspace });
    const other = await service.inspect(file.workspace, file.backup);
    const server = await endpoint(service, "inspect", async () => { ready.resolve(); await resume.promise; });
    const { client } = server.send(JSON.stringify({ workspace: file.workspace, backup_directory: file.backup })); await ready.promise;
    const inspection = await (await server.handled).clone().json(), transport = await server.entered;
    const aborted = deferred(); transport.request.signal.addEventListener("abort", () => aborted.resolve(), { once: true }); client.destroy(); await aborted.promise; await server.responseClosed;
    await expect(service.restore(file.workspace, inspection.inspection_id, path.join(root, "not-created"), true)).rejects.toMatchObject({ status: 410 });
    expect(service.release(file.workspace, other.inspection_id)).toEqual({ released: true });
    // This test-owned suspension is after app.fetch has returned a Response.
    // The adapter can attempt native writes to an already destroyed socket;
    // unlike the downstream-cancellation cases below this is not a no-write
    // claim. It proves the route's undelivered-handle cleanup handover only.
    expect(transport.outgoing.destroyed).toBe(true); expect(transport.outgoing.writableFinished).toBe(false);
    resume.resolve(); await server.adapterDone;
    expect(fs.existsSync(path.join(root, "not-created"))).toBe(false);
  });
  it("cancels an actual restore before completion publication after a fully uploaded request disconnects", async () => {
    const file = await fixture(), atBoundary = deferred(), resume = deferred();
    const engine = createWorkspaceRecoveryEngine({ beforeCompletion: async mode => { if (mode === "restore") { atBoundary.resolve(); await resume.promise; } } });
    const service = createWorkspaceRecoveryService({ currentWorkspace: () => file.workspace, restore: engine.restoreWorkspaceRecoveryBackup });
    const inspection = await service.inspect(file.workspace, file.backup), destination = path.join(root, "incomplete");
    const server = await endpoint(service, "restore"), { client } = server.send(JSON.stringify({ workspace: file.workspace, inspection_id: inspection.inspection_id, target_directory: destination, confirmed: true }));
    await atBoundary.promise; const transport = await server.entered; await server.bodyEnded; expect(transport.incoming.complete).toBe(true);
    const aborted = deferred(); transport.request.signal.addEventListener("abort", () => aborted.resolve(), { once: true }); client.destroy(); await aborted.promise; await server.responseClosed;
    resume.resolve(); await server.adapterDone; expect(server.writes).toEqual([]); expect((await server.handled).body).toBeNull();
    expect(fs.existsSync(destination)).toBe(true); expect(fs.existsSync(path.join(destination, WORKSPACE_RESTORE_MARKER))).toBe(false);
    expect(fs.readFileSync(path.join(file.workspace, DB))).toEqual(file.database); expect(fs.readFileSync(path.join(file.backup, WORKSPACE_BACKUP_MANIFEST))).toEqual(file.manifest);
  });
  it("propagates complete-upload disconnect to downstream inspection and writes no response", async () => {
    const file = await fixture(), downstream = deferred<AbortSignal>(); let reads = 0;
    const service = createWorkspaceRecoveryService({ currentWorkspace: () => file.workspace, inspect: async (directory, signal) => {
      downstream.resolve(signal!); await new Promise<void>((_resolve, reject) => { signal!.addEventListener("abort", () => reject(new Error("independent downstream abort")), { once: true }); }); reads++; return inspectWorkspaceRecoveryBackup(directory, signal);
    } });
    const server = await endpoint(service), { client } = server.send(JSON.stringify({ workspace: file.workspace, backup_directory: file.backup }));
    const signal = await downstream.promise, transport = await server.entered; await server.bodyEnded; expect(transport.incoming.complete).toBe(true); expect(signal.aborted).toBe(false);
    const aborted = deferred(); signal.addEventListener("abort", () => aborted.resolve(), { once: true }); client.destroy(); await aborted.promise; await server.responseClosed; await server.adapterDone;
    expect(reads).toBe(0); expect(server.writes).toEqual([]); expect((await server.handled).body).toBeNull();
    expect(fs.readFileSync(path.join(file.workspace, DB))).toEqual(file.database); expect(fs.readFileSync(path.join(file.backup, WORKSPACE_BACKUP_MANIFEST))).toEqual(file.manifest);
  });
  it("discards a real completed inspection held until after disconnect and releases its reserved slot", async () => {
    const file = await fixture(), completed = deferred<AbortSignal>(), resume = deferred(); let calls = 0;
    const service = createWorkspaceRecoveryService({ currentWorkspace: () => file.workspace, inspect: async (...args) => { const result = await inspectWorkspaceRecoveryBackup(...args); if (++calls === 1) { completed.resolve(args[1]!); await resume.promise; } return result; } });
    const server = await endpoint(service), { client } = server.send(JSON.stringify({ workspace: file.workspace, backup_directory: file.backup })); const signal = await completed.promise;
    const aborted = deferred(); signal.addEventListener("abort", () => aborted.resolve(), { once: true }); client.destroy(); await aborted.promise; await server.responseClosed; resume.resolve(); await server.adapterDone;
    expect(server.writes).toEqual([]); expect((await server.handled).body).toBeNull();
    for (let i = 0; i < 4; i++) await expect(service.inspect(file.workspace, file.backup)).resolves.toMatchObject({ file_count: 2 });
    expect(fs.readFileSync(path.join(file.workspace, DB))).toEqual(file.database); expect(fs.readFileSync(path.join(file.backup, WORKSPACE_BACKUP_MANIFEST))).toEqual(file.manifest);
  });
  it("does not abort normal incoming end/close; delivered inspections remain usable for restore", async () => {
    const file = await fixture(), downstream = deferred<AbortSignal>(), resume = deferred();
    const service = createWorkspaceRecoveryService({ currentWorkspace: () => file.workspace, inspect: async (...args) => { downstream.resolve(args[1]!); await resume.promise; return inspectWorkspaceRecoveryBackup(...args); } });
    const server = await endpoint(service), { response } = server.send(JSON.stringify({ workspace: file.workspace, backup_directory: file.backup }));
    const signal = await downstream.promise, transport = await server.entered; await server.bodyEnded; await server.requestClosed; expect(transport.incoming.complete).toBe(true); expect(signal.aborted).toBe(false); resume.resolve();
    const result = await response; await server.responseFinished; await server.responseClosed; await server.adapterDone; expect(result.status).toBe(200); expect(signal.aborted).toBe(false); expect(server.writes).toContain("end");
    const inspection = JSON.parse(result.text), destination = path.join(root, "restored"); expect((await service.restore(file.workspace, inspection.inspection_id, destination, true)).receipt.workspace).toBe(destination);
  });
});
