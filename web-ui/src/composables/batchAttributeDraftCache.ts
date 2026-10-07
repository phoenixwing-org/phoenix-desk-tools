import type { BatchAttributePreview } from "../api";
export type DraftStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export type AttributeDraftCache = { version: 1; preview: BatchAttributePreview; names: Record<string, string> };
export function draftStorage(): DraftStorage | undefined {
  try { return typeof window === "undefined" ? undefined : window.localStorage; } catch { return undefined; }
}
export function attributeDraftKey(workspace: string, directory: string, overwrite: boolean, source: string, includeDrawings = false) {
  return `desk:batch-attribute-drafts:v1:${JSON.stringify([workspace, directory.trim() || ".", overwrite, source, includeDrawings])}`;
}
export function readAttributeDrafts(storage: DraftStorage | undefined, key: string): AttributeDraftCache | null {
  try {
    const raw = storage?.getItem(key); if (!raw || raw.length > 4_000_000) return null;
    const data = JSON.parse(raw) as AttributeDraftCache;
    if (data.version !== 1 || !data.names || typeof data.names !== "object" || Array.isArray(data.names) || Object.values(data.names).some(v => typeof v !== "string")
      || !data.preview || !Array.isArray(data.preview.rows) || data.preview.rows.length > 1000 || !Array.isArray(data.preview.errors) || !Array.isArray(data.preview.skipped)
      || typeof data.preview.batch_dir !== "string" || typeof data.preview.overwrite !== "boolean" || !Number.isFinite(data.preview.scanned)
      || [...data.preview.errors, ...data.preview.skipped].some(item => !item || typeof item.rel !== "string" || typeof item.message !== "string")
      || data.preview.rows.some(row => !row || typeof row.rel !== "string" || typeof row.object_name !== "string" || (row.name_editable !== undefined && typeof row.name_editable !== "boolean") || !Array.isArray(row.changes) || row.changes.some(c => !c || !["PartNumber", "PartVersion", "TypeCode", "ModelSeries", "PartName"].includes(c.field) || typeof c.current !== "string" || typeof c.proposed !== "string" || typeof c.eligible !== "boolean" || typeof c.source !== "string" || typeof c.note !== "string"))) return null;
    // A disk-backed preview plan is never restored from browser storage.
    data.preview.plan_id = "";
    return data;
  } catch { return null; }
}
export function validDraftName(value: string) {
  const name = value.trim();
  return !!name && !/^[a-z]$/i.test(name.normalize("NFKC")) && new TextEncoder().encode(name).length <= 255 && !/[<>:"/\\|?*\x00-\x1f]/.test(name) && !name.includes("..") && !/[. ]$/.test(name) && !/\.(?:assy|drawing|fcstd)$/i.test(name);
}
