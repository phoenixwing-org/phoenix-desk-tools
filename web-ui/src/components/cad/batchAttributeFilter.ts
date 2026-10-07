import type { BatchAttributeResult } from "../../api";
import { batchAttributeRowStatus, isBatchAttributeUnchanged } from "./batchAttributeStatus";
import type { BatchAttributeDisplayRow as Row } from "./batchAttributePreviewRows";

export type BatchAttributeFilter = "all" | "pending" | "problem";
export type BatchAttributeExecution = {
  completed?: boolean;
  writing?: boolean;
  writingFiles?: string[];
  submittedSelection?: Record<string, string[]>;
  results?: BatchAttributeResult["results"];
};

export function matchesBatchFilename(rel: string, query: string): boolean {
  return rel.replace(/\\/g, "/").toLocaleLowerCase().includes(query.trim().replace(/\\/g, "/").toLocaleLowerCase());
}

/** Pure view filtering. Never changes a preview, its plan, or the checked files. */
export function filterBatchAttributeRows(
  rows: readonly Row[], query: string, filter: BatchAttributeFilter,
  execution: BatchAttributeExecution = {},
): Row[] {
  const results = new Map(execution.results?.map(result => [result.rel, result]));
  return rows.filter(row => {
    if (!matchesBatchFilename(row.rel, query)) return false;
    if (filter === "all") return true;
    const status = batchAttributeRowStatus(row, {
      ...execution, writing: execution.writing && (!execution.writingFiles || execution.writingFiles.includes(row.rel)), submitted: execution.submittedSelection?.[row.rel], result: results.get(row.rel),
    });
    if (filter === "pending") return !row.diagnosticMessages?.length && status.kind === "pending";
    const problem = !!row.diagnosticMessages?.length || ["needs_review", "failed", "unknown"].includes(status.kind)
      // A partially writable row can still contain a conflict and appear in both filters.
      || row.changes.some(change => !change.eligible && !isBatchAttributeUnchanged(change));
    return problem;
  });
}

export function hiddenBatchSelectionCount(visibleRows: readonly Row[], selections: readonly { rel: string }[]): number {
  const visible = new Set(visibleRows.map(row => row.rel));
  return selections.filter(row => !visible.has(row.rel)).length;
}
