import { reactive } from "vue";

type CollectionStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export const BATCH_COLLECTION_LIMIT = 200;
const STORAGE_KEY = "phoenix-desk.batch-input-collection.v1:";
const MAX_STORED_BYTES = 500_000;

/** Compare identities conservatively without changing the exact path sent by the file view. */
export const batchCollectionIdentity = (rel: string): string => rel.normalize("NFC").toUpperCase().toLowerCase().normalize("NFC");

export function validateBatchCollectionPath(value: unknown): string {
  if (typeof value !== "string" || !value || value.length > 2048 || value !== value.trim()
    || /[\\:\p{Cc}\p{Cf}\p{Cs}]/u.test(value) || value.startsWith("/")
    || value.split("/").some(part => !part || part === "." || part === ".." || part.startsWith(".")
      || ["node_modules", "__pycache__"].includes(part.toLowerCase()))) {
    throw new Error("只能加入明确的工作空间相对文件；目录、越界路径、隐藏文件及缓存目录不能加入批次。");
  }
  return value;
}

function uniquePaths(paths: readonly unknown[]): string[] {
  const seen = new Set<string>();
  return paths.map(validateBatchCollectionPath).filter(rel => {
    const key = batchCollectionIdentity(rel);
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });
}

/** Input preferences only: no filesystem scan, API request, task creation or execution authority.
 * Callers must supply file-only rows from a captured view, never a directory to expand. */
export function createBatchTaskCollection(storage?: CollectionStorage) {
  const entries = reactive(new Map<string, { paths: string[]; warning: string }>());
  function entry(workspace: string) {
    if (!workspace.trim()) throw new Error("请先选择工作空间。");
    let current = entries.get(workspace);
    if (current) return current;
    current = { paths: [], warning: "" };
    try {
      const raw = storage?.getItem(STORAGE_KEY + encodeURIComponent(workspace));
      if (raw) {
        if (raw.length > MAX_STORED_BYTES) throw new Error("too large");
        const saved: unknown = JSON.parse(raw);
        if (!saved || typeof saved !== "object" || !("version" in saved) || saved.version !== 1
          || !("paths" in saved) || !Array.isArray(saved.paths) || saved.paths.length > BATCH_COLLECTION_LIMIT) throw new Error("invalid input preferences");
        current.paths = uniquePaths(saved.paths);
      }
    } catch {
      current.warning = "待选文件缓存无效或不可读取，未恢复；已保存任务不受影响。";
    }
    entries.set(workspace, current);
    return entries.get(workspace)!;
  }
  function persist(workspace: string, current: { paths: string[]; warning: string }): boolean {
    try {
      if (!storage) throw new Error("storage unavailable");
      if (current.paths.length) storage.setItem(STORAGE_KEY + encodeURIComponent(workspace), JSON.stringify({ version: 1, paths: current.paths }));
      else storage.removeItem(STORAGE_KEY + encodeURIComponent(workspace));
      current.warning = ""; return true;
    } catch {
      current.warning = "浏览器存储不可用：待选文件仅在本次会话保留；任务仍需保存到 DB。";
      return false;
    }
  }
  function pathsFor(workspace: string): readonly string[] {
    return workspace.trim() ? Object.freeze([...entry(workspace).paths]) : Object.freeze([]);
  }
  function warningFor(workspace: string): string { return workspace.trim() ? entry(workspace).warning : ""; }
  function add(workspace: string, paths: readonly string[]) {
    const current = entry(workspace), incoming = uniquePaths(paths);
    const merged = uniquePaths([...current.paths, ...incoming]);
    if (merged.length > BATCH_COLLECTION_LIMIT) throw new Error(`每批最多 ${BATCH_COLLECTION_LIMIT} 个明确文件；当前待选 ${current.paths.length} 个，请缩小筛选后再加入。`);
    const added = merged.length - current.paths.length;
    current.paths = merged;
    const persisted = persist(workspace, current);
    return { added, duplicates: paths.length - added, total: merged.length, persisted };
  }
  function remove(workspace: string, rel: string) {
    const current = entry(workspace), key = batchCollectionIdentity(validateBatchCollectionPath(rel));
    current.paths = current.paths.filter(path => batchCollectionIdentity(path) !== key);
    return persist(workspace, current);
  }
  function clear(workspace: string) { const current = entry(workspace); current.paths = []; return persist(workspace, current); }
  return { pathsFor, warningFor, add, remove, clear };
}

let sharedCollection: ReturnType<typeof createBatchTaskCollection> | undefined;
export function useBatchTaskCollection() {
  if (!sharedCollection) {
    let storage: CollectionStorage | undefined;
    try { storage = globalThis.localStorage; } catch { /* Session-only input remains usable. */ }
    sharedCollection = createBatchTaskCollection(storage);
  }
  return sharedCollection;
}
