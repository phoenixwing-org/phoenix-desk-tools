import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const tempRoots: string[] = [];
const originalHome = process.env.HOME;
const originalUserProfile = process.env.USERPROFILE;

function makeTempRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "shell-launcher-config-"));
  tempRoots.push(root);
  return root;
}

function makeWorkspaceRoot() {
  const root = fs.mkdtempSync(path.join(process.cwd(), ".shell-launcher-workspace-"));
  tempRoots.push(root);
  return root;
}

afterEach(() => {
  process.env.HOME = originalHome;
  process.env.USERPROFILE = originalUserProfile;
  vi.resetModules();
  for (const root of tempRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("launcher config routes", () => {
  it("returns the frontend app-config contract instead of the raw config file", async () => {
    const home = makeTempRoot();
    process.env.HOME = home;
    process.env.USERPROFILE = home;
    vi.resetModules();
    const { shellRoutes } = await import("./shell.js");

    const payload = await (await shellRoutes.request("/api/config/app")).json() as any;
    expect(payload.title).toBe("Phoenix 桌面工具");
    expect(payload.navigation.length).toBeGreaterThan(0);
    expect(payload.toolbar).toEqual({ items: [] });
    expect(payload.workbench.pages).toBeTruthy();
    expect(payload.workspace_dotfile).toBe(".phoenix/phoenix-workspace.sqlite");
    expect(payload.launcher_config_path).toContain("launcher-prefs.json");
    expect(payload.app).toBeUndefined();
  });

  it("persists and normalizes launcher navigation modules", async () => {
    const home = makeTempRoot();
    process.env.HOME = home;
    process.env.USERPROFILE = home;
    vi.resetModules();
    const { shellRoutes } = await import("./shell.js");

    const patch = await shellRoutes.request("/api/config/launcher/nav-modules", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: ["code", "unknown", "code"] }),
    });
    expect(patch.status).toBe(200);
    await expect(patch.json()).resolves.toEqual({ enabled: ["code"] });

    await expect((await shellRoutes.request("/api/config/launcher/nav-modules")).json()).resolves.toEqual({ enabled: ["code"] });
    await expect((await shellRoutes.request("/api/config/launcher")).json()).resolves.toMatchObject({
      nav_modules: { enabled: ["code"] },
    });

    const saved = JSON.parse(fs.readFileSync(path.join(home, ".phoenix", "launcher-prefs.json"), "utf8"));
    expect(saved.nav_modules).toEqual({ enabled: ["code"] });

    const reset = await shellRoutes.request("/api/config/launcher/nav-modules", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: [] }),
    });
    await expect(reset.json()).resolves.toEqual({ enabled: ["cad", "code"] });
  });

  it("persists shell layout and restores all launcher defaults", async () => {
    const home = makeTempRoot();
    process.env.HOME = home;
    process.env.USERPROFILE = home;
    vi.resetModules();
    const { shellRoutes } = await import("./shell.js");

    const patch = await shellRoutes.request("/api/config/launcher/shell-layout", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ right_panel_open: false, left_panel_width_px: 999, unknown: true }),
    });
    expect(patch.status).toBe(200);
    await expect(patch.json()).resolves.toMatchObject({
      right_panel_open: false,
      left_panel_width_px: 560,
      workset_panel_dock: "right",
      workset_panel_open: false,
    });

    const invalid = await shellRoutes.request("/api/config/launcher/shell-layout", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ right_panel_open: "no" }),
    });
    expect(invalid.status).toBe(400);

    const reset = await shellRoutes.request("/api/config/launcher/reset-factory", { method: "POST" });
    expect(reset.status).toBe(200);
    await expect(reset.json()).resolves.toMatchObject({
      version: 2,
      recent_workspaces: [],
      freecad_dir: "",
      shell_layout: { right_panel_open: true, left_panel_width_px: 300 },
      nav_modules: { enabled: ["cad", "code"] },
    });
  });

  it("keeps recent-list changes separate from workspace activation", async () => {
    const home = makeTempRoot();
    const workspace = makeWorkspaceRoot();
    process.env.HOME = home;
    process.env.USERPROFILE = home;
    vi.resetModules();
    const { shellRoutes } = await import("./shell.js");

    const added = await shellRoutes.request("/api/config/launcher/recent/add", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: workspace }),
    });
    expect(added.status).toBe(200);
    await expect(added.json()).resolves.toMatchObject({ recent_workspaces: [workspace] });
    await expect((await shellRoutes.request("/api/workspace")).json()).resolves.toEqual({ path: "", name: "" });

    const activated = await shellRoutes.request("/api/workspace", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: workspace }),
    });
    expect(activated.status).toBe(200);
    await expect(activated.json()).resolves.toMatchObject({
      path: workspace,
      nav_modules: { scope: "all", enabled: ["cad", "code"] },
    });
    await expect((await shellRoutes.request("/api/onboarding/status")).json()).resolves.toEqual({
      workspace_ok: true,
      workspace_path: workspace,
      freecad_ok: false,
      index_scanned: false,
      last_scan_at: "",
    });

    const removed = await shellRoutes.request("/api/config/launcher/recent/remove", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: workspace }),
    });
    await expect(removed.json()).resolves.toMatchObject({ recent_workspaces: [], shell_layout: {} });
    await expect((await shellRoutes.request("/api/workspace")).json()).resolves.toEqual({
      path: workspace,
      name: path.basename(workspace),
    });
    await expect((await shellRoutes.request("/api/onboarding/status")).json()).resolves.toMatchObject({
      workspace_ok: false,
      workspace_path: workspace,
    });
  });

  it("activates the workspace even when workspace-local nav prefs cannot be read", async () => {
    const home = makeTempRoot();
    const workspace = makeWorkspaceRoot();
    process.env.HOME = home;
    process.env.USERPROFILE = home;
    fs.mkdirSync(path.join(workspace, ".phoenix"), { recursive: true });
    fs.writeFileSync(path.join(workspace, ".phoenix", "phoenix-workspace.sqlite"), "not sqlite");
    vi.resetModules();
    const { shellRoutes } = await import("./shell.js");

    const activated = await shellRoutes.request("/api/workspace", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: workspace }),
    });

    expect(activated.status).toBe(200);
    await expect(activated.json()).resolves.toMatchObject({
      path: workspace,
      nav_modules: { scope: "all", enabled: ["cad", "code"] },
      nav_warning: expect.any(String),
    });
    await expect((await shellRoutes.request("/api/workspace")).json()).resolves.toEqual({
      path: workspace,
      name: path.basename(workspace),
    });
  });

  it("prunes missing recent workspaces while preserving valid entries", async () => {
    const home = makeTempRoot();
    const workspace = makeWorkspaceRoot();
    const missing = path.join(path.dirname(workspace), `${path.basename(workspace)}-missing`);
    process.env.HOME = home;
    process.env.USERPROFILE = home;
    fs.mkdirSync(path.join(home, ".phoenix"), { recursive: true });
    fs.writeFileSync(
      path.join(home, ".phoenix", "launcher-prefs.json"),
      JSON.stringify({
        version: 2,
        recent_workspaces: [workspace, missing],
        freecad_dir: "",
      }),
    );
    vi.resetModules();
    const { shellRoutes } = await import("./shell.js");

    const response = await shellRoutes.request("/api/config/launcher/recent/prune", { method: "POST" });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      recent_workspaces: [workspace],
      pruned_count: 1,
    });
  });
});
