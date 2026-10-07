import { describe, expect, it } from "vitest";
import type { BatchAttributePreview } from "../../api";
import { batchAttributeRowStatus, batchAttributeStatusTone } from "./batchAttributeStatus";
const row: BatchAttributePreview["rows"][number] = { rel: "A.FCStd", object_name: "Body", changes: [
  { field: "PartNumber", current: "", proposed: "100001", source: "文件名", eligible: true, reason: "ready", note: "补充属性" },
  { field: "PartName", current: "name", proposed: "other", source: "索引 + 文件名", eligible: false, reason: "source_conflict", note: "来源冲突" },
] };
describe("batch attribute row status", () => {
  it("gives every state a distinct semantic tone without treating review as failure", () => {
    expect(batchAttributeStatusTone).toEqual({
      pending: "warning", needs_review: "warning", unknown: "warning",
      unchanged: "success", written: "success", writing: "primary", failed: "danger", not_selected: "info",
    });
    expect(batchAttributeRowStatus({ ...row, changes: [{ ...row.changes[0], eligible: false, reason: "unchanged" }] }).label).toBe("一致");
  });
  it("counts only eligible fields and preserves blocked-field context", () => {
    expect(batchAttributeRowStatus(row)).toEqual({ kind: "pending", label: "待写入（1项）", detail: "另有 1 项需确认，勾选只写可写字段" });
  });
  it("never reports a suspect single-letter name as unchanged", () => {
    const change = { ...row.changes[1], current: "S", proposed: "", reason: "invalid_name" as const, note: "零件名仅为一个英文字母" };
    expect(batchAttributeRowStatus({ ...row, changes: [change] }).kind).toBe("needs_review");
  });
  it("distinguishes already-equal values from source conflicts, even with the same target value", () => {
    const change = { ...row.changes[1], proposed: "name" };
    expect(batchAttributeRowStatus({ ...row, changes: [change] }).kind).toBe("needs_review");
    expect(batchAttributeRowStatus({ ...row, changes: [{ ...change, reason: "unchanged", note: "值已一致" }] }).kind).toBe("unchanged");
    expect(batchAttributeRowStatus({ ...row, changes: [{ ...change, reason: undefined, note: "值已一致" }] }).kind).toBe("unchanged");
    expect(batchAttributeRowStatus({ ...row, changes: [] }).kind).toBe("needs_review");
  });
  it("uses only a submitted file's backend result, never a blanket success", () => {
    const execution = { completed: true, submitted: ["PartNumber"] };
    expect(batchAttributeRowStatus(row, { ...execution, writing: true }).label).toBe("写入中（1项）");
    expect(batchAttributeRowStatus(row, { ...execution, result: { rel: row.rel, status: "written", message: "索引未更新" } })).toEqual({ kind: "written", label: "已写入（1项）", detail: "索引未更新" });
    expect(batchAttributeRowStatus(row, { ...execution, result: { rel: row.rel, status: "failed", message: "文件已变化" } })).toEqual({ kind: "failed", label: "写入失败", detail: "文件已变化" });
    expect(batchAttributeRowStatus(row, execution).kind).toBe("unknown");
    expect(batchAttributeRowStatus(row, { completed: true }).kind).toBe("not_selected");
  });
});
