import { describe, expect, it } from "vitest";
import type { BatchAttributePreview } from "../../api";
import { filterBatchAttributeRows, hiddenBatchSelectionCount, matchesBatchFilename } from "./batchAttributeFilter";

type Row = BatchAttributePreview["rows"][number];
const ready: Row["changes"][number] = { field: "PartName", current: "old", proposed: "支架", eligible: true, reason: "ready", source: "文件名", note: "覆盖已有值" };
const conflict: Row["changes"][number] = { ...ready, field: "PartNumber", eligible: false, reason: "source_conflict", note: "来源冲突" };
const rows: Row[] = [
  { rel: "parts/支架.ASSY.FCStd", object_name: "Assembly", changes: [ready] },
  { rel: "parts/Bolt.FCStd", object_name: "Body", changes: [{ ...ready, eligible: false, reason: "unchanged", note: "值已一致" }] },
  { rel: "other/Review.FCStd", object_name: "Body", changes: [conflict] },
  { rel: "other/Mixed.FCStd", object_name: "Body", changes: [ready, conflict] },
  { rel: "other/Empty.FCStd", object_name: "Body", changes: [] },
];
const rels = (items: Row[]) => items.map(row => row.rel);

describe("batch attribute result filters", () => {
  it("combines filename/path search with status entirely on the supplied snapshot", () => {
    const snapshot = JSON.stringify(rows);
    expect(rels(filterBatchAttributeRows(rows, " PARTS/ ", "all"))).toEqual(rows.slice(0, 2).map(row => row.rel));
    expect(rels(filterBatchAttributeRows(rows, " 支架 ", "pending"))).toEqual([rows[0].rel]);
    expect(filterBatchAttributeRows(rows, "支架", "problem")).toEqual([]);
    expect(filterBatchAttributeRows(rows, "", "all")).toEqual(rows);
    expect(JSON.stringify(rows)).toBe(snapshot);
  });
  it("includes writable rows under pending, not unchanged rows, and keeps partial conflicts under problems", () => {
    expect(rels(filterBatchAttributeRows(rows, "", "pending"))).toEqual([rows[0].rel, rows[3].rel]);
    expect(rels(filterBatchAttributeRows(rows, "", "problem"))).toEqual(rows.slice(2).map(row => row.rel));
  });
  it("honors failures and uncertain submitted results, without declaring unchecked rows failed", () => {
    const execution = { completed: true, submittedSelection: { [rows[0].rel]: ["PartName"] }, results: [{ rel: rows[0].rel, status: "failed" as const, message: "changed" }] };
    expect(filterBatchAttributeRows(rows, "支架", "problem", execution)).toEqual([rows[0]]);
    expect(filterBatchAttributeRows(rows, "支架", "problem", { ...execution, results: [] })).toEqual([rows[0]]);
    expect(filterBatchAttributeRows(rows, "支架", "pending", execution)).toEqual([]);
    expect(filterBatchAttributeRows(rows, "支架", "pending", { ...execution, results: [{ ...execution.results[0], status: "written" }] })).toEqual([]);
    expect(filterBatchAttributeRows(rows, "支架", "pending", { completed: true })).toEqual([]);
    expect(filterBatchAttributeRows(rows, "支架", "pending", { writing: true, submittedSelection: execution.submittedSelection })).toEqual([]);
  });
  it("uses literal case-insensitive substrings, not regex or property-value matching", () => {
    expect(matchesBatchFilename("parts/A[1].FCStd", "a[1]")).toBe(true);
    expect(matchesBatchFilename("parts/A1.FCStd", "a[1]")).toBe(false);
    expect(matchesBatchFilename("parts/Bolt.FCStd", "parts\\BOLT")).toBe(true);
    expect(filterBatchAttributeRows(rows, "来源冲突", "all")).toEqual([]);
  });
  it("counts hidden selections without dropping them or selecting invisible files", () => {
    const selections = [{ rel: rows[0].rel, fields: ["PartName"] }, { rel: rows[3].rel, fields: ["PartName"] }];
    const snapshot = JSON.stringify(selections);
    expect(hiddenBatchSelectionCount(filterBatchAttributeRows(rows, "支架", "pending"), selections)).toBe(1);
    expect(hiddenBatchSelectionCount([], selections)).toBe(2);
    expect(hiddenBatchSelectionCount(rows, selections)).toBe(0);
    expect(JSON.stringify(selections)).toBe(snapshot);
  });
});
