import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const tempRoots: string[] = [];
const originalHome = process.env.HOME;
const originalUserProfile = process.env.USERPROFILE;

function makeTempRoot(prefix: string) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempRoots.push(root);
  return root;
}

afterEach(() => {
  vi.useRealTimers();
  process.env.HOME = originalHome;
  process.env.USERPROFILE = originalUserProfile;
  vi.resetModules();
  for (const root of tempRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("shell state routes", () => {
  it("persists workspace navigation, workbench session, and incremental logs", async () => {
    const home = makeTempRoot("shell-state-home-");
    const workspace = makeTempRoot("shell-state-workspace-");
    process.env.HOME = home;
    process.env.USERPROFILE = home;
    fs.mkdirSync(path.join(home, ".phoenix"), { recursive: true });
    fs.writeFileSync(
      path.join(home, ".phoenix", "launcher-prefs.json"),
      JSON.stringify({ version: 2, recent_workspaces: [], freecad_dir: "", workspace }),
    );
    vi.resetModules();
    const { setShellShutdownHandler, shellRoutes } = await import("./shell.js");

    const navPatch = await shellRoutes.request("/api/workspace/nav-modules", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: ["code"] }),
    });
    expect(navPatch.status).toBe(200);
    await expect(navPatch.json()).resolves.toEqual({ scope: "code", enabled: ["code"] });
    await expect((await shellRoutes.request("/api/workspace/nav-modules")).json()).resolves.toEqual({
      scope: "code",
      enabled: ["code"],
    });

    const sessionPut = await shellRoutes.request("/api/workbench/session", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ version: 1, active_tab_id: "tab-1", tabs: [{ id: "tab-1", page_id: "home" }] }),
    });
    expect(sessionPut.status).toBe(200);
    await expect(sessionPut.json()).resolves.toMatchObject({
      version: 1,
      session: { version: 1, active_tab_id: "tab-1", tabs: [{ id: "tab-1", page_id: "home" }] },
    });
    await expect((await shellRoutes.request("/api/workbench/session")).json()).resolves.toMatchObject({
      session: { active_tab_id: "tab-1" },
    });

    await expect((await shellRoutes.request("/api/phoenix/database/status")).json()).resolves.toMatchObject({
      database_exists: true,
      needs_recreate: false,
      schema_version: 13,
    });

    for (const text of ["first", "second"]) {
      await shellRoutes.request("/api/shell/log", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text, source: "test" }),
      });
    }
    await expect((await shellRoutes.request("/api/shell/log?after=1")).json()).resolves.toEqual({
      lines: [{ text: "second", source: "test" }],
      total: 2,
    });

    const recreated = await shellRoutes.request("/api/phoenix/database/recreate", { method: "POST" });
    expect(recreated.status).toBe(200);
    await expect(recreated.json()).resolves.toMatchObject({
      status: "recreated",
      removed_files: ["phoenix-workspace.sqlite"],
      schema_version: 13,
    });
    await expect((await shellRoutes.request("/api/workbench/session")).json()).resolves.toMatchObject({
      session: null,
      updated_at: null,
    });

    vi.useFakeTimers();
    let shutdownCalls = 0;
    setShellShutdownHandler(() => { shutdownCalls += 1; });
    const shutdown = await shellRoutes.request("/api/shutdown", { method: "POST" });
    expect(shutdown.status).toBe(200);
    await expect(shutdown.json()).resolves.toEqual({ status: "stopping" });
    await vi.advanceTimersByTimeAsync(100);
    expect(shutdownCalls).toBe(1);
  });
});
