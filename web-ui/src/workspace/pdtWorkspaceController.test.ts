import { describe, expect, it, vi } from "vitest";
import type { LauncherPrefs } from "../types/config";
import {
  pdtCreateWorkspaceController,
  type PdtWorkspaceApi,
} from "./pdtWorkspaceController";

function launcher(paths: string[]): LauncherPrefs {
  return {
    version: 2,
    recent_workspaces: [...paths],
    recent_workspace_entries: paths.map((path) => ({
      path,
      name: path.split("/").at(-1),
      exists: true,
    })),
    freecad_dir: "",
    shell_layout: {} as LauncherPrefs["shell_layout"],
  };
}

function api(initialPath = "/work/a") {
  let active = initialPath;
  let recent = [initialPath];
  const value = (path: string) => ({ path, name: path.split("/").at(-1) || path });
  const mock: PdtWorkspaceApi = {
    setWorkspace: vi.fn(async (path) => {
      active = path;
      recent = [path, ...recent.filter((entry) => entry !== path)];
      return value(path);
    }),
    closeWorkspace: vi.fn(async () => { active = ""; }),
    fetchLauncherPrefs: vi.fn(async () => launcher(recent)),
    addRecentWorkspace: vi.fn(async (path) => {
      recent = [path, ...recent.filter((entry) => entry !== path)];
      return launcher(recent);
    }),
    removeRecentWorkspace: vi.fn(async (path) => {
      recent = recent.filter((entry) => entry !== path);
      return launcher(recent);
    }),
  };
  return { mock, active: () => active };
}

describe("Desk Workspace controller adapter", () => {
  it("seeds the existing singleton without reopening it, then switches and closes through lifecycle", async () => {
    const host = api();
    const applied: string[] = [];
    const controller = pdtCreateWorkspaceController({
      api: host.mock,
      initialWorkspace: { path: "/work/a", name: "a", workspace_type_id: "cad" },
      lifecycle: {
        async applyOpened(workspace) { applied.push(`open:${workspace.rootPath}`); },
        async applyClosed() { applied.push("closed"); },
      },
    });

    await controller.initialize();
    await expect(controller.requestOpen({ rootPath: "/work/a" }))
      .resolves.toMatchObject({ status: "opened" });
    expect(host.mock.setWorkspace).not.toHaveBeenCalled();
    expect(controller.getSnapshot().current?.workspaceTypeId).toBe("cad");

    await expect(controller.requestSwitch({ rootPath: "/work/b" }))
      .resolves.toMatchObject({ status: "switched" });
    expect(host.active()).toBe("/work/b");
    expect(controller.getSnapshot().current?.rootPath).toBe("/work/b");

    await expect(controller.requestClose()).resolves.toMatchObject({ status: "closed" });
    expect(host.mock.closeWorkspace).toHaveBeenCalledOnce();
    expect(applied).toEqual(["open:/work/a", "open:/work/b", "closed"]);
  });

  it("restores the previous singleton workspace when consumer commit fails", async () => {
    const host = api();
    const applied: string[] = [];
    const controller = pdtCreateWorkspaceController({
      api: host.mock,
      initialWorkspace: { path: "/work/a", name: "a" },
      lifecycle: {
        async applyOpened(workspace) {
          applied.push(workspace.rootPath);
          if (workspace.rootPath === "/work/b") throw new Error("hydrate failed");
        },
        async applyClosed() { /* not reached */ },
      },
    });

    await controller.initialize();
    await controller.requestOpen({ rootPath: "/work/a" });
    const result = await controller.requestSwitch({ rootPath: "/work/b" });

    expect(result).toMatchObject({
      status: "rejected",
      error: { code: "participant-failure", participantId: "phoenix-desk-workspace" },
    });
    expect(host.active()).toBe("/work/a");
    expect(controller.getSnapshot().current?.rootPath).toBe("/work/a");
    expect(host.mock.setWorkspace).toHaveBeenNthCalledWith(1, "/work/b", expect.any(AbortSignal));
    expect(host.mock.setWorkspace).toHaveBeenNthCalledWith(2, "/work/a");
    expect(applied).toEqual(["/work/a", "/work/b", "/work/a"]);
  });

  it("projects and removes recent workspaces through the existing launcher API", async () => {
    const host = api();
    const controller = pdtCreateWorkspaceController({
      api: host.mock,
      lifecycle: {
        async applyOpened() { /* projection only */ },
        async applyClosed() { /* projection only */ },
      },
    });
    await controller.initialize();
    const [entry] = controller.getSnapshot().recent;
    expect(entry).toMatchObject({ rootPath: "/work/a", availability: "available" });

    await controller.removeRecent(entry!.workspaceId);
    expect(host.mock.removeRecentWorkspace).toHaveBeenCalledWith("/work/a");
    expect(controller.getSnapshot().recent).toEqual([]);
  });
});
