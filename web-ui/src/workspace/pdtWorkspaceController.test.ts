import { describe, expect, it, vi } from "vitest";
import { computed, ref } from "vue";
import type { LauncherPrefs } from "../types/config";
import {
  pdtCreateWorkspaceController,
  pdtRecentWorkspaceType,
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
  it("updates a controlled recent type from saved prefs without reopening or reloading the page", () => {
    const prefs = ref(launcher(["/work/a"]));
    prefs.value.recent_workspace_entries![0]!.workspace_type_id = "cad";
    const displayed = computed(() => pdtRecentWorkspaceType(prefs.value, "/work/a/", "cad"));
    expect(displayed.value).toBe("cad");
    prefs.value = { ...prefs.value, recent_workspace_entries: [{ path: "/work/a", exists: true, workspace_type_id: "code" }] };
    expect(displayed.value).toBe("code");
    expect(pdtRecentWorkspaceType(prefs.value, "/work/absent", "mixed")).toBe("mixed");
  });
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
    expect(host.mock.setWorkspace).toHaveBeenNthCalledWith(2, "/work/a", expect.any(AbortSignal));
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

  it("does not reopen or rehydrate the current workspace when close preparation fails", async () => {
    const host = api(), opened = vi.fn(async () => {}), closed = vi.fn(async () => {});
    const controller = pdtCreateWorkspaceController({
      api: host.mock, initialWorkspace: { path: "/work/a", name: "a" },
      lifecycle: {
        prepare(context) { if (context.kind === "close") throw new Error("session save failed"); },
        applyOpened: opened, applyClosed: closed,
      },
    });
    await controller.initialize(); await controller.requestOpen({ rootPath: "/work/a" });
    opened.mockClear();
    await expect(controller.requestClose()).resolves.toMatchObject({ status: "rejected" });
    expect(host.mock.setWorkspace).not.toHaveBeenCalled();
    expect(host.mock.closeWorkspace).not.toHaveBeenCalled();
    expect(opened).not.toHaveBeenCalled(); expect(closed).not.toHaveBeenCalled();
    expect(controller.getSnapshot().current?.rootPath).toBe("/work/a");
  });

  it("restores the singleton even when opening mutates it but returns no target", async () => {
    const host = api(), set = host.mock.setWorkspace, opened = vi.fn(async () => {});
    const performSet = vi.mocked(set).getMockImplementation()!;
    vi.mocked(host.mock.setWorkspace).mockImplementationOnce(async (path, signal) => {
      // A transport failure can happen after the server has changed its current workspace.
      await performSet(path, signal);
      throw new Error("response interrupted");
    });
    const controller = pdtCreateWorkspaceController({
      api: host.mock, initialWorkspace: { path: "/work/a", name: "a" },
      lifecycle: { applyOpened: opened, async applyClosed() {} },
    });
    await controller.initialize(); await controller.requestOpen({ rootPath: "/work/a" });
    opened.mockClear();
    await expect(controller.requestSwitch({ rootPath: "/work/b" })).resolves.toMatchObject({ status: "rejected" });
    expect(set).toHaveBeenNthCalledWith(2, "/work/a", expect.any(AbortSignal));
    expect(opened).toHaveBeenCalledWith(expect.objectContaining({ rootPath: "/work/a" }));
    expect(host.active()).toBe("/work/a");
  });

  it("uses a live recovery signal after close is cancelled following a server mutation", async () => {
    const host = api(), performClose = vi.mocked(host.mock.closeWorkspace).getMockImplementation()!;
    const abort = new AbortController(), opened = vi.fn(async () => {});
    vi.mocked(host.mock.closeWorkspace).mockImplementationOnce(async signal => {
      await performClose(signal); abort.abort(); throw new Error("close response cancelled");
    });
    const controller = pdtCreateWorkspaceController({
      api: host.mock, initialWorkspace: { path: "/work/a", name: "a" },
      lifecycle: { applyOpened: opened, async applyClosed() {} },
    });
    await controller.initialize(); await controller.requestOpen({ rootPath: "/work/a" });
    opened.mockClear();
    await expect(controller.requestClose({ signal: abort.signal })).resolves.toMatchObject({ status: "cancelled" });
    const recoverySignal = vi.mocked(host.mock.setWorkspace).mock.calls[0][1];
    expect(recoverySignal).toBeInstanceOf(AbortSignal); expect(recoverySignal?.aborted).toBe(false);
    expect(host.active()).toBe("/work/a"); expect(opened).toHaveBeenCalledOnce();
  });

  it("reports a recovery identity mismatch instead of applying another workspace", async () => {
    const host = api(), opened = vi.fn(async () => {}), onError = vi.fn();
    vi.mocked(host.mock.setWorkspace)
      .mockRejectedValueOnce(new Error("open failed"))
      .mockResolvedValueOnce({ path: "/work/unexpected", name: "unexpected" });
    const controller = pdtCreateWorkspaceController({
      api: host.mock, initialWorkspace: { path: "/work/a", name: "a" }, onError,
      lifecycle: { applyOpened: opened, async applyClosed() {} },
    });
    await controller.initialize(); await controller.requestOpen({ rootPath: "/work/a" });
    opened.mockClear();
    await expect(controller.requestSwitch({ rootPath: "/work/b" })).resolves.toMatchObject({ status: "rejected" });
    expect(opened).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining("恢复身份不一致") }));
  });
});
