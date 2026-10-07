import type { BatchAttributePreview } from "../../api";

export type BatchAttributeDisplayRow = BatchAttributePreview["rows"][number] & {
  /** Read/inspection failures are display-only: they never become a writable plan. */
  diagnosticMessages?: string[];
  name_draft_invalid?: boolean;
};

export function batchAttributePreviewRows(preview: BatchAttributePreview | null | undefined): BatchAttributeDisplayRow[] {
  if (!preview) return [];
  const rows = new Map<string, BatchAttributeDisplayRow>(preview.rows.map(row => [row.rel, { ...row }]));
  for (const item of [...preview.skipped, ...preview.errors]) {
    const row = rows.get(item.rel) ?? { rel: item.rel, object_name: "", changes: [] };
    row.diagnosticMessages = [...new Set([...(row.diagnosticMessages ?? []), item.message])];
    rows.set(item.rel, row);
  }
  return [...rows.values()];
}
