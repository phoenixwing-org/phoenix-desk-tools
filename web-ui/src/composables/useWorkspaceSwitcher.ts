import { computed } from "vue";
import { removeRecentWorkspace } from "../api";
import { useAppShell, type AppShellContext } from "./useAppShell";

export function useWorkspaceSwitcher(shell?: AppShellContext) {
  const ctx = shell ?? useAppShell();

  const workspacePath = computed(() => ctx.workspacePath.value);
  const recent = computed(() => ctx.launcher.value?.recent_workspaces ?? []);

  const workspaceShort = computed(() => {
    const p = workspacePath.value;
    if (!p) return "未打开工作空间";
    const norm = p.replace(/\\/g, "/");
    const name = norm.split("/").pop() || p;
    return name.length > 28 ? `…${name.slice(-25)}` : name;
  });

  async function pickRecent(path: string) {
    if (path === workspacePath.value) return;
    if (!window.confirm(`切换到工作空间？\n\n${path}`)) return;
    try {
      await ctx.switchWorkspace(path);
    } catch (e) {
      ctx.setStatus(String(e));
    }
  }

  async function closeCurrentWorkspace() {
    return ctx.requestCloseWorkspace();
  }

  async function removeRecent(path: string, event: MouseEvent) {
    event.stopPropagation();
    if (!window.confirm(`从最近列表中移除？\n\n${path}`)) return;
    try {
      await removeRecentWorkspace(path);
      await ctx.reloadLauncher();
      ctx.setStatus("已从最近列表移除");
    } catch (e) {
      ctx.setStatus(String(e));
    }
  }

  function openConfig() {
    ctx.openConfig();
  }

  return {
    workspacePath,
    workspaceShort,
    recent,
    pickRecent,
    removeRecent,
    openConfig,
    closeCurrentWorkspace,
  };
}
