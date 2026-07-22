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
      app_version: "0.3.0",
    });

    const rejected = await app.request("/api/health", {
      headers: { Origin: "https://example.com" },
    });
    expect(rejected.status).toBe(403);
    await expect(rejected.json()).resolves.toMatchObject({ detail: expect.stringMatching(/origin/i) });

    const localTool = await app.request("/api/health");
    expect(localTool.status).toBe(200);
  });
});
