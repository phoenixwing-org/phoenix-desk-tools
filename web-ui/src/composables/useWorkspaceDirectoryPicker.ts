import { ref } from "vue";
import { ElMessage } from "element-plus";
import { pickWorkspaceDirectory } from "../api";
import { useAppShell } from "./useAppShell";
import { useOnboardingStore } from "../stores/onboarding";
import { confirmCloseTabsBeforeWorkspacePick } from "./tabCloseConfirm";

export type WorkspacePickResult =
  | { ok: true; path: string }
  | { ok: false; reason: "busy" | "cancelled" | "tabs_blocked" | "invalid" | "error"; path?: string };

function normalizePath(p: string) {
  return p.trim().replace(/\\/g, "/");
}

function isSameWorkspacePath(a: string, b: string) {
  const x = normalizePath(a);
  const y = normalizePath(b);
  return Boolean(x && y && x === y);
}

export function useWorkspaceDirectoryPicker() {
  const shell = useAppShell();
  const onboarding = useOnboardingStore();
  const picking = ref(false);

  function isWorkspaceBlockingTab(pageId: string) {
    return pageId !== "home" && pageId !== "welcome" && pageId !== "config";
  }

  function openToolTabTitles(): string[] {
    return shell.tabs.value.filter((t) => isWorkspaceBlockingTab(t.pageId)).map((t) => t.title);
  }

  function workspaceSwitchBlocked(targetPath: string) {
    return openToolTabTitles().length > 0 && !isSameWorkspacePath(targetPath, shell.workspacePath.value);
  }

  /** 选目录前先检查未关页面；确认后在成功选目录后关闭全部 Tab。 */
  async function confirmOpenTabsBeforePick(): Promise<boolean> {
    const tabTitles = openToolTabTitles();
    if (!tabTitles.length) return true;
    return confirmCloseTabsBeforeWorkspacePick(tabTitles, shell.toolTabDirtyTitles());
  }

  async function applyWorkspaceSwitch(
    picked: string,
    opts?: {
      closeConfig?: boolean;
      enterWorkbench?: boolean;
      logSource?: string;
    },
  ): Promise<WorkspacePickResult> {
    await shell.switchWorkspace(picked);
    await onboarding.refreshStatus();

    if (!onboarding.workspaceOk) {
      ElMessage.error("所选目录无法作为工作空间，请检查路径是否可读。");
      shell.setStatus("工作空间无效");
      return { ok: false, reason: "invalid", path: picked };
    }

    shell.setStatus(`工作空间: ${picked}`);
    if (opts?.logSource) {
      shell.appendLog(`已打开工作空间 ${picked}`, { source: opts.logSource, open: true });
    }

    if (opts?.closeConfig !== false && shell.configOverlayOpen.value) {
      shell.closeConfig();
    }

    if (opts?.enterWorkbench !== false) {
      await shell.enterWorkbenchFromWelcome();
    }

    return { ok: true, path: picked };
  }

  async function pickAndOpenWorkspace(opts?: {
    pathHint?: string;
    onPicked?: (path: string) => void;
    closeConfig?: boolean;
    enterWorkbench?: boolean;
    logSource?: string;
  }): Promise<WorkspacePickResult> {
    if (picking.value) return { ok: false, reason: "busy" };

    const tabTitlesBeforePick = openToolTabTitles();
    const closeTabsAfterPick = await confirmOpenTabsBeforePick();
    if (!closeTabsAfterPick) {
      shell.setStatus("已取消打开工作空间");
      return { ok: false, reason: "tabs_blocked" };
    }
    const willCloseTabs = tabTitlesBeforePick.length > 0;

    picking.value = true;
    try {
      const hint = opts?.pathHint?.trim() || shell.workspacePath.value;
      const data = await pickWorkspaceDirectory(hint);
      if (data.cancelled || !data.path?.trim()) {
        shell.setStatus("已取消选择目录");
        return { ok: false, reason: "cancelled" };
      }

      const picked = data.path.trim();
      opts?.onPicked?.(picked);

      if (willCloseTabs) {
        shell.discardAllToolTabs();
      }

      return await applyWorkspaceSwitch(picked, opts);
    } catch (e) {
      const msg = String(e);
      ElMessage.error(msg);
      if (opts?.logSource) {
        shell.appendLog(msg, { source: opts.logSource });
      } else {
        shell.setStatus(msg);
      }
      return { ok: false, reason: "error" };
    } finally {
      picking.value = false;
    }
  }

  return { picking, pickAndOpenWorkspace, workspaceSwitchBlocked };
}
