import { describe, expect, it } from "vitest";
import type { BatchAttributePreview } from "../../api";
import { batchAttributePreviewRows } from "./batchAttributePreviewRows";
import { filterBatchAttributeRows } from "./batchAttributeFilter";

const preview: BatchAttributePreview = {
  plan_id: "test-plan", batch_dir: "parts", scanned: 3, overwrite: false,
  rows: [{ rel: "parts/ready.FCStd", object_name: "Body", changes: [{ field: "PartName", current: "", proposed: "支架", source: "文件名", eligible: true, reason: "ready", note: "补充属性" }] }],
  skipped: [{ rel: "parts/drawing.Drawing.FCStd", message: "图纸请打开源模型" }],
  errors: [{ rel: "parts/multi.FCStd", message: "包含多个独立 BOM 根对象，请在文件详情逐个确认" }],
};
describe("unified batch attribute preview rows", () => {
  it("keeps readable, skipped and failed files in one table and searchable by the same path", () => {
    const snapshot = JSON.stringify(preview);
    const rows = batchAttributePreviewRows(preview);
    expect(rows.map(row => row.rel)).toEqual(["parts/ready.FCStd", "parts/drawing.Drawing.FCStd", "parts/multi.FCStd"]);
    expect(filterBatchAttributeRows(rows, "", "pending").map(row => row.rel)).toEqual(["parts/ready.FCStd"]);
    expect(filterBatchAttributeRows(rows, "", "problem").map(row => row.rel)).toEqual(["parts/drawing.Drawing.FCStd", "parts/multi.FCStd"]);
    expect(filterBatchAttributeRows(rows, "multi", "problem")[0].diagnosticMessages).toEqual([preview.errors[0].message]);
    expect(rows.slice(1).every(row => row.changes.length === 0)).toBe(true);
    expect(JSON.stringify(preview)).toBe(snapshot);
  });
  it("coalesces diagnostics by file without creating a writable field or duplicate file rows", () => {
    const rows = batchAttributePreviewRows({ ...preview, errors: [
      ...preview.errors, preview.errors[0], { rel: "parts/multi.FCStd", message: "请检查对象分组" },
      { rel: "parts/ready.FCStd", message: "预览不完整" },
    ] });
    expect(rows).toHaveLength(3);
    expect(rows[2].diagnosticMessages).toEqual([preview.errors[0].message, "请检查对象分组"]);
    expect(filterBatchAttributeRows(rows, "", "pending")).toEqual([]);
    expect(preview.rows[0].changes[0].eligible).toBe(true);
  });
  it("keeps the empty state empty until an explicit preview exists", () => {
    expect(batchAttributePreviewRows(null)).toEqual([]);
    expect(batchAttributePreviewRows(undefined)).toEqual([]);
  });
});
