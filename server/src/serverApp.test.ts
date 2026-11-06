import { describe, expect, it } from "vitest";
import { createPhoenixServerApp } from "./serverApp.js";

describe("Phoenix server app", () => {
  it("allows the Tauri UI and rejects unrelated browser origins", async () => {
    const app = createPhoenixServerApp();
    const allowed = await app.request("/api/health", {
      headers: { Origin: "http://tauri.localhost" },
    });
    expect(allowed.status).toBe(200);
    expect(allowed.headers.get("access-control-allow-origin")).toBe("http://tauri.localhost");
    await expect(allowed.clone().json()).resolves.toMatchObject({
      status: "ok",
      service: "phoenix-node",
      protocol_version: 1,
      app_version: "0.5.0",
    });

    const tauriDev = await app.request("/api/health", {
      headers: { Origin: "http://localhost:49373" },
    });
    expect(tauriDev.status).toBe(200);
    expect(tauriDev.headers.get("access-control-allow-origin")).toBe("http://localhost:49373");

    const rejected = await app.request("/api/health", {
      headers: { Origin: "http://localhost:5173" },
    });
    expect(rejected.status).toBe(403);
    await expect(rejected.json()).resolves.toMatchObject({ detail: expect.stringMatching(/origin/i) });

    const localTool = await app.request("/api/health");
    expect(localTool.status).toBe(200);
  });

  it("mounts MCP management behind the same origin boundary without granting command authority", async () => {
    const app = createPhoenixServerApp();
    const rejected = await app.request("/api/freecad-mcp/install/apply", {
      method: "POST", headers: {Origin: "https://unrelated.invalid", "Content-Type": "application/json"},
      body: JSON.stringify({plan_id: "invalid", confirmed: true}),
    });
    expect(rejected.status).toBe(403);
    const constrained = await app.request("/api/freecad-mcp/connection/check", {
      method: "POST", headers: {Origin: "http://localhost:49373", "Content-Type": "application/json"},
      body: JSON.stringify({revision: "invalid", command: "untrusted"}),
    });
    expect(constrained.status).toBe(400);
    await expect(constrained.json()).resolves.toMatchObject({code: "invalid_request"});
    for (const control of ["start", "stop"]) {
      const route = `/api/freecad-mcp/instance/${control}`;
      expect((await app.request(route, {
        method: "POST", headers: {Origin: "https://unrelated.invalid", "Content-Type": "application/json"}, body: "{}",
      })).status).toBe(403);
      const invalid = await app.request(route, {
        method: "POST", headers: {Origin: "http://localhost:49373", "Content-Type": "application/json"}, body: "{}",
      });
      expect(invalid.status).toBe(400);
      await expect(invalid.json()).resolves.toMatchObject({code: "invalid_request"});
    }
  });

  it("mounts saved assembly inspection without admitting repair authority", async () => {
    const app = createPhoenixServerApp();
    const body = JSON.stringify({ workspacePath: "not-read", filePath: "Host.FCStd", write: true });
    const rejected = await app.request("/api/cad/assembly-maintenance/inspect", {
      method: "POST", headers: { Origin: "https://unrelated.invalid", "Content-Type": "application/json" }, body,
    });
    expect(rejected.status).toBe(403);
    const constrained = await app.request("/api/cad/assembly-maintenance/inspect", {
      method: "POST", headers: { Origin: "http://localhost:49373", "Content-Type": "application/json" }, body,
    });
    expect(constrained.status).toBe(400);
    await expect(constrained.json()).resolves.toMatchObject({ code: "invalid_arguments" });
    expect((await app.request("/api/cad/assembly-maintenance/update", { method: "POST", body: "{}" })).status).toBe(404);
  });

  it("keeps assembly preview/publication behind origin and frozen-plan request boundaries", async () => {
    const app = createPhoenixServerApp();
    for (const command of ["start", "status", "cancel", "publish", "reconcile", "history"]) {
      const url = `/api/cad/assembly-maintenance/update/${command}`;
      const body = JSON.stringify({ workspacePath: "not-read", filePath: "Host.FCStd", script: "untrusted", nativeProof: {} });
      expect((await app.request(url, { method: "POST", headers: { Origin: "https://unrelated.invalid", "Content-Type": "application/json" }, body })).status).toBe(403);
      const rejected = await app.request(url, { method: "POST", headers: { Origin: "http://localhost:49373", "Content-Type": "application/json" }, body });
      expect(rejected.status).toBe(400);
      await expect(rejected.json()).resolves.toMatchObject({ code: "assembly_update_request_failed" });
    }
  });
});
