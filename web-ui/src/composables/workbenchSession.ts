import type { WorkbenchSessionSnapshot } from "../types/workbench";
import { fetchWorkbenchSession, saveWorkbenchSession } from "../api";

const STORAGE_PREFIX = "phoenix.workbench.v1:";
const LEGACY_STORAGE_PREFIX = "fcdesk.workbench.v1:";

function storageKey(workspacePath: string, prefix = STORAGE_PREFIX): string {
  return `${prefix}${workspacePath}`;
}

function parseWorkbenchSnapshot(raw: string): WorkbenchSessionSnapshot | null {
  try {
    const data = JSON.parse(raw) as WorkbenchSessionSnapshot;
    if (data?.version !== 1 || !Array.isArray(data.tabs) || !data.tabs.length) return null;
    return data;
  } catch {
    return null;
  }
}

export function readLocalWorkbenchSession(workspacePath: string): WorkbenchSessionSnapshot | null {
  if (!workspacePath) return null;
  try {
    const raw = sessionStorage.getItem(storageKey(workspacePath));
    if (raw) {
      const data = parseWorkbenchSnapshot(raw);
      if (data) return data;
    }
    const legacyRaw = sessionStorage.getItem(storageKey(workspacePath, LEGACY_STORAGE_PREFIX));
    if (!legacyRaw) return null;
    const legacy = parseWorkbenchSnapshot(legacyRaw);
    if (!legacy) return null;
    writeLocalWorkbenchSession(workspacePath, legacy);
    sessionStorage.removeItem(storageKey(workspacePath, LEGACY_STORAGE_PREFIX));
    return legacy;
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
  const local = readLocalWorkbenchSession(workspacePath);

  let remote: WorkbenchSessionSnapshot | null = null;
  try {
    remote = await loadRemoteWorkbenchSession();
  } catch {
    /* fall through */
  }

  // 同标签 F5：sessionStorage 通常比 DB 更新；避免空 remote 覆盖本地 Tab
  if (local?.tabs.length) {
    if (!remote?.tabs.length || local.tabs.length >= remote.tabs.length) {
      return local;
    }
    writeLocalWorkbenchSession(workspacePath, remote);
    return remote;
  }

  if (remote?.tabs.length) {
    writeLocalWorkbenchSession(workspacePath, remote);
    return remote;
  }

  return null;
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
