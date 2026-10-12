/** Lightweight saved XML view. Source XLinks are not instance or BOM quantities. */
export const CAD_LIGHT_FIELD_KEYS = ["PartNumber", "PartVersion", "TypeCode", "ModelSeries", "PartName", "label"] as const;
export const CAD_LIGHT_REFERENCE_STATUSES = ["resolved", "ambiguous", "missing", "self", "non_fcstd"] as const;
export type CadLightReferenceStatus = typeof CAD_LIGHT_REFERENCE_STATUSES[number];
export type CadLightInfoResult = {
  analysis: {
    documentXmlBytes: number;
    objectCount: number;
    xlinks: Array<{ file: string; label: string }>;
    embeddedFields: Partial<Record<typeof CAD_LIGHT_FIELD_KEYS[number], string>>;
  };
  diagnostics: {
    items: Array<{ file: string; label: string; status: CadLightReferenceStatus; targetRelativePath: string | null; candidates: string[]; message: string }>;
    counts: Record<CadLightReferenceStatus, number>;
  };
  source: { file_size: number; mtime_ms: number };
  warnings: string[];
};
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const exact = (value: Record<string, unknown>, keys: readonly string[]) => Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const count = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every(item => typeof item === "string");
const relative = (value: unknown): value is string => typeof value === "string" && !!value && !/[\\\u0000-\u001f\u007f]/.test(value) && !/^[A-Za-z]:\//.test(value)
  && !value.startsWith("/") && value.split("/").every(part => !!part && part !== "." && part !== "..");

/** Validate transport completeness only; classification remains server-owned. */
export function isCadLightInfoResult(value: unknown): value is CadLightInfoResult {
  if (!record(value) || !exact(value, ["analysis", "diagnostics", "source", "warnings"]) || !record(value.analysis) || !record(value.diagnostics) || !record(value.source) || !strings(value.warnings)) return false;
  const { analysis, diagnostics, source } = value;
  if (!exact(analysis, ["documentXmlBytes", "objectCount", "xlinks", "embeddedFields"]) || !count(analysis.documentXmlBytes) || !count(analysis.objectCount)
    || !Array.isArray(analysis.xlinks) || !analysis.xlinks.every(link => record(link) && exact(link, ["file", "label"]) && typeof link.file === "string" && typeof link.label === "string")
    || !record(analysis.embeddedFields) || !Object.entries(analysis.embeddedFields).every(([key, field]) => CAD_LIGHT_FIELD_KEYS.includes(key as typeof CAD_LIGHT_FIELD_KEYS[number]) && typeof field === "string")) return false;
  if (!exact(source, ["file_size", "mtime_ms"]) || !count(source.file_size) || typeof source.mtime_ms !== "number" || !Number.isFinite(source.mtime_ms) || Math.abs(source.mtime_ms) > 8.64e15) return false;
  if (!exact(diagnostics, ["items", "counts"]) || !record(diagnostics.counts) || !exact(diagnostics.counts, CAD_LIGHT_REFERENCE_STATUSES)) return false;
  const counts = diagnostics.counts;
  if (!CAD_LIGHT_REFERENCE_STATUSES.every(status => count(counts[status])) || !Array.isArray(diagnostics.items) || diagnostics.items.length !== analysis.xlinks.length) return false;
  const observed: Record<CadLightReferenceStatus, number> = { resolved: 0, ambiguous: 0, missing: 0, self: 0, non_fcstd: 0 };
  for (const [index, item] of diagnostics.items.entries()) {
    if (!record(item) || !exact(item, ["file", "label", "status", "targetRelativePath", "candidates", "message"]) || typeof item.file !== "string" || typeof item.label !== "string" || typeof item.message !== "string"
      || !CAD_LIGHT_REFERENCE_STATUSES.includes(item.status as CadLightReferenceStatus) || !strings(item.candidates) || !item.candidates.every(relative)
      || !(item.targetRelativePath === null || relative(item.targetRelativePath))) return false;
    // The view pairs these rows by index. Never attach a valid classification
    // to a different source XLink after a malformed/reordered response.
    if (item.file !== analysis.xlinks[index].file.trim().replaceAll("\\", "/")) return false;
    if ((item.status === "resolved" || item.status === "self") && item.targetRelativePath === null) return false;
    if ((item.status === "missing" || item.status === "non_fcstd") && item.targetRelativePath !== null) return false;
    if (item.status === "ambiguous" && item.targetRelativePath !== null && !item.candidates.includes(item.targetRelativePath)) return false;
    observed[item.status as CadLightReferenceStatus]++;
  }
  return CAD_LIGHT_REFERENCE_STATUSES.every(status => observed[status] === counts[status]);
}
