import { afterEach, describe, expect, it, vi } from "vitest";
import { apiOrigin, apiUrl, initializeRuntimeBridge, invokeTauri, isTauriRuntime } from "./runtimeBridge";

const runtime = globalThis as typeof globalThis & {
  __TAURI__?: { core?: { invoke: ReturnType<typeof vi.fn> } };
  __PHOENIX_API_ORIGIN__?: string;
};

afterEach(() => {
  delete runtime.__TAURI__;
  delete runtime.__PHOENIX_API_ORIGIN__;
});

describe("runtime bridge", () => {
  it("keeps browser API requests relative", () => {
    expect(isTauriRuntime()).toBe(false);
    expect(apiOrigin()).toBe("");
    expect(apiUrl("/api/health")).toBe("/api/health");
  });

  it("targets the managed Hono service and invokes native commands in Tauri", async () => {
    const invoke = vi.fn().mockResolvedValue({ cancelled: false, path: "C:/work" });
    runtime.__TAURI__ = { core: { invoke } };
    expect(isTauriRuntime()).toBe(true);
    expect(apiUrl("/api/health")).toBe("http://127.0.0.1:48375/api/health");
    await expect(invokeTauri("pick_workspace_directory", { pathHint: "C:/" }))
      .resolves.toEqual({ cancelled: false, path: "C:/work" });
    expect(invoke).toHaveBeenCalledWith("pick_workspace_directory", { pathHint: "C:/" });
  });

  it("honors an injected API origin", () => {
    runtime.__PHOENIX_API_ORIGIN__ = "http://127.0.0.1:5199/";
    expect(apiUrl("api/health")).toBe("http://127.0.0.1:5199/api/health");
  });

  it("loads the actual managed API origin before the app mounts", async () => {
    const invoke = vi.fn().mockResolvedValue({ api_origin: "http://127.0.0.1:48382" });
    runtime.__TAURI__ = { core: { invoke } };
    await initializeRuntimeBridge();
    expect(apiUrl("/api/health")).toBe("http://127.0.0.1:48382/api/health");
    expect(invoke).toHaveBeenCalledWith("get_runtime_info", undefined);
  });
});
