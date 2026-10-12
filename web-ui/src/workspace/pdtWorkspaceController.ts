import {
  pnwCreateWorkspaceController,
  type PnwRecentWorkspaceEntry,
  type PnwWorkspaceController,
  type PnwWorkspaceDescriptor,
  type PnwWorkspaceFailure,
  type PnwWorkspaceLifecycleParticipant,
  type PnwWorkspaceTransitionContext,
} from "phoenix-wing";
import type { LauncherPrefs } from "../types/config";

export type PdtWorkspaceApiValue = {
  path: string;
  name: string;
  workspace_type_id?: string;
};

export type PdtWorkspaceApi = {
  setWorkspace(path: string, signal?: AbortSignal): Promise<PdtWorkspaceApiValue>;
  closeWorkspace(signal?: AbortSignal): Promise<unknown>;
  fetchLauncherPrefs(): Promise<LauncherPrefs>;
  addRecentWorkspace(path: string): Promise<LauncherPrefs>;
  removeRecentWorkspace(path: string): Promise<LauncherPrefs>;
};

export type PdtWorkspaceLifecycle = {
  prepare?(context: PnwWorkspaceTransitionContext): Promise<void> | void;
  applyOpened(workspace: PnwWorkspaceDescriptor): Promise<void>;
  applyClosed(): Promise<void>;
};

export type PdtWorkspaceControllerOptions = {
  api: PdtWorkspaceApi;
  lifecycle: PdtWorkspaceLifecycle;
  initialWorkspace?: PdtWorkspaceApiValue;
  onError?: (failure: PnwWorkspaceFailure) => void;
};

function pdtNormalizeRootPath(value: string): string {
  const normalized = value.trim().replace(/\\/g, "/").replace(/\/+$/, "");
  return /^[a-z]:\//iu.test(normalized)
    ? `${normalized.slice(0, 1).toLocaleLowerCase()}${normalized.slice(1)}`
    : normalized;
}

/** Type edits are persisted by the launcher API, independently of lifecycle snapshots. */
export function pdtRecentWorkspaceType(prefs: LauncherPrefs | null | undefined, rootPath: string, fallback = "mixed"): string {
  return prefs?.recent_workspace_entries?.find(entry => pdtNormalizeRootPath(entry.path) === pdtNormalizeRootPath(rootPath))?.workspace_type_id || fallback;
}

export function pdtWorkspaceId(rootPath: string): string {
  return `local:${pdtNormalizeRootPath(rootPath)}`;
}

export function pdtWorkspaceDescriptor(value: PdtWorkspaceApiValue): PnwWorkspaceDescriptor {
  const rootPath = value.path.trim();
  const normalized = pdtNormalizeRootPath(rootPath);
  const fallbackName = normalized.split("/").filter(Boolean).at(-1) || normalized;
  return {
    workspaceId: pdtWorkspaceId(rootPath),
    name: value.name.trim() || fallbackName,
    rootPath,
    workspaceTypeId: value.workspace_type_id,
    readonly: false,
    capabilities: ["read", "write", "watch", "database", "native-directory-picker"],
  };
}

function pdtRecentEntry(
  path: string,
  name: string | undefined,
  exists: boolean,
  workspaceTypeId?: string,
): PnwRecentWorkspaceEntry {
  const normalized = pdtNormalizeRootPath(path);
  return {
    workspaceId: pdtWorkspaceId(path),
    rootPath: path,
    name: name?.trim() || normalized.split("/").filter(Boolean).at(-1) || normalized,
    availability: exists ? "available" : "missing",
    workspaceTypeId,
  };
}

function pdtRecentFromPrefs(prefs: LauncherPrefs): readonly PnwRecentWorkspaceEntry[] {
  const detailed = prefs.recent_workspace_entries;
  if (detailed?.length) {
    return detailed.map((entry) => pdtRecentEntry(
      entry.path,
      entry.name,
      entry.exists,
      entry.workspace_type_id,
    ));
  }
  return prefs.recent_workspaces.map((path) => pdtRecentEntry(path, undefined, true));
}

function pdtSameWorkspace(
  left: PnwWorkspaceDescriptor | undefined,
  right: PnwWorkspaceDescriptor | undefined,
): boolean {
  return Boolean(left && right && (
    left.workspaceId === right.workspaceId
    || pdtNormalizeRootPath(left.rootPath) === pdtNormalizeRootPath(right.rootPath)
  ));
}

function pdtCreateRecentStore(api: PdtWorkspaceApi) {
  return {
    async load() {
      return pdtRecentFromPrefs(await api.fetchLauncherPrefs());
    },
    async save(entries: readonly PnwRecentWorkspaceEntry[]) {
      const currentPrefs = await api.fetchLauncherPrefs();
      const current = pdtRecentFromPrefs(currentPrefs);
      const desiredAvailable = entries
        .filter((entry) => entry.availability === "available")
        .map((entry) => entry.rootPath);
      const desiredKeys = new Set(entries.map((entry) => pdtNormalizeRootPath(entry.rootPath)));

      for (const entry of current) {
        if (!desiredKeys.has(pdtNormalizeRootPath(entry.rootPath))) {
          await api.removeRecentWorkspace(entry.rootPath);
        }
      }

      const currentAvailable = currentPrefs.recent_workspaces.map(pdtNormalizeRootPath);
      const desiredNormalized = desiredAvailable.map(pdtNormalizeRootPath);
      if (
        currentAvailable.length === desiredNormalized.length
        && currentAvailable.every((path, index) => path === desiredNormalized[index])
      ) return;

      for (const path of [...desiredAvailable].reverse()) {
        await api.addRecentWorkspace(path);
      }
    },
  };
}

function pdtCreateLifecycleParticipant(
  api: PdtWorkspaceApi,
  lifecycle: PdtWorkspaceLifecycle,
  transition: { mutated: boolean },
): PnwWorkspaceLifecycleParticipant {
  async function restore(context: PnwWorkspaceTransitionContext): Promise<void> {
    // New Wing also rolls back a participant whose prepare throws. At that point
    // the singleton and page drafts are still intact: do not reopen/reload them.
    if (!transition.mutated) return;
    if (pdtSameWorkspace(context.current, context.target)) { transition.mutated = false; return; }
    // Registry 0.8.0 may pass the cancelled request signal; recovery must still run.
    const signal = context.signal.aborted ? new AbortController().signal : context.signal;
    if (context.current) {
      const restored = pdtWorkspaceDescriptor(await api.setWorkspace(context.current.rootPath, signal));
      if (!pdtSameWorkspace(restored, context.current)) throw new Error("工作空间恢复身份不一致，请重新选择目录");
      await lifecycle.applyOpened(restored);
      transition.mutated = false;
      return;
    }
    await api.closeWorkspace(signal);
    await lifecycle.applyClosed();
    transition.mutated = false;
  }

  return {
    id: "phoenix-desk-workspace",
    async prepare(context) {
      transition.mutated = false;
      await lifecycle.prepare?.(context);
    },
    async commit(context) {
      transition.mutated = true;
      if (context.kind === "close") {
        await api.closeWorkspace(context.signal);
        await lifecycle.applyClosed();
        return;
      }
      if (!context.target) throw new Error("Workspace target is missing during commit");
      await lifecycle.applyOpened(context.target);
    },
    rollback: restore,
  };
}

/**
 * Desk 的后台 API 只维护一个当前 Workspace，因此不能把 host.close(previous)
 * 交给 Wing：切换完成后那会误关刚打开的新目录。关闭和失败恢复由 lifecycle
 * participant 对单例 API 执行，Wing controller 只负责事务顺序与状态投影。
 */
export function pdtCreateWorkspaceController(
  options: PdtWorkspaceControllerOptions,
): PnwWorkspaceController {
  const transition = { mutated: false };
  let initial = options.initialWorkspace
    ? pdtWorkspaceDescriptor(options.initialWorkspace)
    : undefined;

  return pnwCreateWorkspaceController({
    host: {
      async open(request) {
        if (
          initial
          && pdtNormalizeRootPath(initial.rootPath) === pdtNormalizeRootPath(request.rootPath)
        ) {
          const descriptor = initial;
          initial = undefined;
          return descriptor;
        }
        // The server may switch before the response fails or is cancelled, so a
        // missing target descriptor does not prove that no recovery is needed.
        transition.mutated = true;
        return pdtWorkspaceDescriptor(await options.api.setWorkspace(request.rootPath, request.signal));
      },
      // Desk API 是进程级单例；previous/target 的关闭语义由 lifecycle participant 适配。
    },
    participants: [pdtCreateLifecycleParticipant(options.api, options.lifecycle, transition)],
    recentStore: pdtCreateRecentStore(options.api),
    onError: options.onError,
  });
}
