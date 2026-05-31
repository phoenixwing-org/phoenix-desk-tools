import type { WorkbenchSessionSnapshot } from "../types/workbench";
import { fetchWorkbenchSession, saveWorkbenchSession } from "../api";

const STORAGE_PREFIX = "fcdesk.workbench.v1:";

function storageKey(workspacePath: string): string {
  return `${STORAGE_PREFIX}${workspacePath}`;
}

export function readLocalWorkbenchSession(workspacePath: string): WorkbenchSessionSnapshot | null {
  if (!workspacePath) return null;
  try {
    const raw = sessionStorage.getItem(storageKey(workspacePath));
    if (!raw) return null;
    const data = JSON.parse(raw) as WorkbenchSessionSnapshot;
    if (data?.version !== 1 || !Array.isArray(data.tabs) || !data.tabs.length) return null;
    return data;
  } catch {
    return null;
  }
}

export function writeLocalWorkbenchSession(workspacePath: string, snapshot: WorkbenchSessionSnapshot): void {
  if (!workspacePath) return;
  try {
    sessionStorage.setItem(storageKey(workspacePath), JSON.stringify(snapshot));
  } catch {
    /* quota */
  }
}

export async function loadRemoteWorkbenchSession(): Promise<WorkbenchSessionSnapshot | null> {
  const payload = await fetchWorkbenchSession();
  const session = payload.session;
  if (!session || session.version !== 1) return null;
  const tabs = session.tabs;
  if (!Array.isArray(tabs) || !tabs.length) return null;
  return {
    version: 1,
    activeTabId: String(session.active_tab_id ?? session.activeTabId ?? ""),
    tabs: tabs.map((t: Record<string, unknown>) => ({
      id: String(t.id ?? ""),
      pageId: String(t.pageId ?? t.page_id ?? ""),
      title: String(t.title ?? ""),
      subtitle: t.subtitle != null ? String(t.subtitle) : undefined,
      contextKey: t.contextKey != null ? String(t.contextKey) : undefined,
      pageState:
        t.pageState && typeof t.pageState === "object"
          ? (t.pageState as Record<string, unknown>)
          : undefined,
    })),
  };
}

export async function persistRemoteWorkbenchSession(snapshot: WorkbenchSessionSnapshot): Promise<void> {
  await saveWorkbenchSession({
    version: 1,
    active_tab_id: snapshot.activeTabId,
    tabs: snapshot.tabs.map((t) => ({
      id: t.id,
      pageId: t.pageId,
      page_id: t.pageId,
      title: t.title,
      subtitle: t.subtitle,
      contextKey: t.contextKey,
      pageState: t.pageState,
    })),
  });
}

export async function loadWorkbenchSession(workspacePath: string): Promise<WorkbenchSessionSnapshot | null> {
  try {
    const remote = await loadRemoteWorkbenchSession();
    if (remote) {
      writeLocalWorkbenchSession(workspacePath, remote);
      return remote;
    }
  } catch {
    /* fall through */
  }
  return readLocalWorkbenchSession(workspacePath);
}

export async function saveWorkbenchSessionAll(
  workspacePath: string,
  snapshot: WorkbenchSessionSnapshot,
): Promise<void> {
  writeLocalWorkbenchSession(workspacePath, snapshot);
  try {
    await persistRemoteWorkbenchSession(snapshot);
  } catch {
    /* local cache still helps F5 */
  }
}
