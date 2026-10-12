import { createServer as createHttpServer, request, type Server } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createServer as createViteServer } from "vite";
import { describe, expect, it } from "vitest";
import { localApiProxy } from "./localApiProxy";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

async function listen(server: Server) {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No loopback address");
  return `http://127.0.0.1:${address.port}`;
}

describe("local API proxy cancellation", () => {
  it.each([
    { name: "complete POST waiting for response", partial: false },
    { name: "unfinished POST body", partial: true },
  ])("disconnects upstream for $name", async ({ partial }) => {
    const entered = deferred(), disconnected = deferred();
    const root = await mkdtemp(path.join(os.tmpdir(), "desk-proxy-cancel-"));
    const upstream = createHttpServer((incoming, outgoing) => {
      incoming.on("error", () => { /* expected incomplete request */ });
      outgoing.once("close", () => { if (!outgoing.writableFinished) disconnected.resolve(); });
      if (partial) entered.resolve();
      else { incoming.resume(); incoming.once("end", entered.resolve); }
    });
    let vite: Awaited<ReturnType<typeof createViteServer>> | undefined;
    let client: ReturnType<typeof request> | undefined;
    try {
      const target = await listen(upstream);
      vite = await createViteServer({ configFile: false, root, logLevel: "silent", appType: "custom",
        server: { host: "127.0.0.1", port: 0, hmr: false, watch: null, proxy: { "/api": localApiProxy(target) } } });
      await vite.listen();
      const address = vite.httpServer?.address();
      if (!address || typeof address === "string") throw new Error("No proxy address");
      client = request(`http://127.0.0.1:${address.port}/api/probe`, { method: "POST", headers: { "Content-Length": "2" } });
      client.on("error", () => { /* client deliberately disconnects */ });
      if (partial) client.write("{"); else client.end("{}");
      await entered.promise;
      client.destroy();
      await disconnected.promise;
      expect(client.destroyed).toBe(true);
    } finally {
      client?.destroy();
      await vite?.close();
      upstream.closeAllConnections();
      await new Promise<void>(resolve => upstream.close(() => resolve()));
      await rm(root, { recursive: true, force: true });
    }
  }, 10_000);

  it("does not cancel normal request end or completed response close", async () => {
    const ended = deferred();
    let premature = false;
    const root = await mkdtemp(path.join(os.tmpdir(), "desk-proxy-normal-"));
    const upstream = createHttpServer((incoming, outgoing) => {
      incoming.resume();
      incoming.once("end", () => { outgoing.end("ok"); });
      outgoing.once("close", () => { premature = !outgoing.writableFinished; ended.resolve(); });
    });
    let vite: Awaited<ReturnType<typeof createViteServer>> | undefined;
    try {
      const target = await listen(upstream);
      vite = await createViteServer({ configFile: false, root, logLevel: "silent", appType: "custom",
        server: { host: "127.0.0.1", port: 0, hmr: false, watch: null, proxy: { "/api": localApiProxy(target) } } });
      await vite.listen();
      const address = vite.httpServer?.address();
      if (!address || typeof address === "string") throw new Error("No proxy address");
      const response = await fetch(`http://127.0.0.1:${address.port}/api/probe`, { method: "POST", body: "{}" });
      expect(await response.text()).toBe("ok");
      await ended.promise;
      expect(premature).toBe(false);
    } finally {
      await vite?.close();
      upstream.closeAllConnections();
      await new Promise<void>(resolve => upstream.close(() => resolve()));
      await rm(root, { recursive: true, force: true });
    }
  }, 10_000);
});
