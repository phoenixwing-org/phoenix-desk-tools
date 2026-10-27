import { createSSRApp } from "vue";
import { renderToString } from "vue/server-renderer";
import { describe, expect, it } from "vitest";
import type { BatchStep } from "../../../../shared/batch-tasks/contracts";
import { inspectSelectedCadNames } from "../../../../shared/cad-name-audit/model";
import BatchTaskResult from "./BatchTaskResult.vue";
import { formatBatchResultBytes, summarizeBatchStepResult } from "./resultSummary";

const step = (action_key: string, result?: Record<string, unknown>): BatchStep => ({ id: "step-a", run_id: "run-a", item_id: "item-a", subject: { kind: "file", rel: "samples/Independent.FCStd" }, action_instance_id: "action-a", action_key, status: "succeeded", ...(result === undefined ? {} : { result }) });
const values = (input: BatchStep) => summarizeBatchStepResult(input).facts.map(fact => fact.value);

describe("readable batch observations", () => {
  it("shows byte/hash metadata and never converts missing sizes into zero", () => {
    expect(formatBatchResultBytes(2048)).toBe("2048 bytes（2.00 KiB）"); expect(formatBatchResultBytes(0)).toBe("0 bytes");
    expect(formatBatchResultBytes(null)).toBe("大小未知");
    expect(values(step("file.metadata", { bytes: 12, extension: ".txt", sha256: "a".repeat(64) }))).toEqual(["12 bytes", ".txt", "a".repeat(64)]);
    expect(values(step("file.metadata", {}))).toContain("大小未知");
    expect(values(step("file.metadata", { sha256: "not-a-hash" }))).toContain("未取得有效 SHA-256");
  });
  it("shows text statistics without the file contents", () => {
    const summary = summarizeBatchStepResult(step("file.text-stats", { encoding: "UTF-8", lines: 0, characters: 0, words: 0 }));
    expect(summary.facts.map(fact => fact.value)).toEqual(["UTF-8", "0", "0", "0"]); expect(summary.notices.join()).toContain("不保存或显示文件原文");
  });
  it("renders actual saved-property fields and labels material as text, not density", () => {
    const summary = summarizeBatchStepResult(step("cad.saved-properties", { source: "saved_document_xml", physical_material: false, objects: [{ name: "Feature", type: "Part::Feature", label: "示例", material: "材料描述", properties: { PartNumber: "DEMO", PartVersion: "007", PartName: "示例零件", PartType: "H", ModelSeries: "LAB" } }] }));
    expect(summary.tables[0].rows[0]).toEqual(["Feature", "Part::Feature", "示例", "DEMO", "007", "示例零件", "H", "LAB", "材料描述"]);
    expect(summary.notices.join()).toContain("不代表物性、密度或重量"); expect(summary.notices.join()).toContain("没有计算质量");
  });
  it("keeps duplicate links and unverified target semantics", () => {
    const link = { file: "selected/Example.FCStd", label: "Example" };
    const summary = summarizeBatchStepResult(step("cad.saved-links", { link_count: 2, links: [link, link], target_resolution: "not_attempted" }));
    expect(summary.tables[0].rows).toHaveLength(2); expect(summary.notices.join()).toContain("不等于 BOM"); expect(summary.notices.join()).toContain("回退宿主");
  });
  it("shows saved drawing counts and keeps structure unknown", () => {
    const summary = summarizeBatchStepResult(step("cad.saved-drawing", { counts: { techdraw_objects: 4, pages: 1, views: 0, dimensions: 2 }, types: [{ type: "TechDraw::DrawPage", count: 1 }], structured_fields: { page_view_links: "unknown", template_links: "unknown", editable_texts: "unknown", dimension_references: "unknown" } }));
    expect(summary.facts.map(fact => fact.value)).toEqual(["4", "1", "0", "2"]); expect(summary.tables.at(-1)?.rows.every(row => row[1] === "未知（未投影）")).toBe(true);
    expect(summary.notices.join()).toContain("不验证");
  });
  it("distinguishes cache missing/unsupported/history from new measurements", () => {
    const missing = summarizeBatchStepResult(step("cad.geometry-cache", { status: "missing", reason: "row_missing", freshness: "unverified" }));
    expect(missing.facts.map(fact => fact.value)).toEqual(["缺失", "未验证（unverified）", "当前文件没有尺寸缓存"]);
    const present = summarizeBatchStepResult(step("cad.geometry-cache", { status: "record", cached_box: { x_mm: 12, y_mm: 8.25, z_mm: 4 }, freshness: "fresh", source_measurement: false, updated_at: "2035-01-01T00:00:00.000Z", algorithm_version: 1 }));
    expect(present.facts.map(fact => fact.value)).toContain("12 × 8.25 × 4 mm"); expect(present.facts.map(fact => fact.value)).toContain("未验证（unverified）"); expect(present.notices.join()).toContain("不是本次新测尺寸");
    const unsupported = summarizeBatchStepResult(step("cad.geometry-cache", { status: "unknown", reason: "unsupported_algorithm", cached_box: { x_mm: 12, y_mm: 8, z_mm: 4 } }));
    expect(unsupported.facts.some(fact => fact.label === "缓存 XYZ")).toBe(false);
    expect(values(step("cad.geometry-cache", { status: "constructor" }))[0]).toBe("未知");
  });
  it("uses the real name-audit DTO's group arrays and manual reasons", () => {
    const dto = inspectSelectedCadNames([{ item_id: "a", rel: "first/DEMO42.007-Bracket.FCStd", sha256: "a".repeat(64) }, { item_id: "b", rel: "second/DEMO42.007-Bracket.FCStd", sha256: "b".repeat(64) }]);
    const summary = summarizeBatchStepResult(step("cad.name-audit", { ...dto }));
    expect(summary.facts.find(fact => fact.label === "选中文件")?.value).toBe("2"); expect(summary.facts.find(fact => fact.label === "完全同名组数")?.value).toBe("1");
    expect(summary.tables.find(table => table.title === "完全同名")?.rows[0][1]).toContain("first/DEMO42.007-Bracket.FCStd");
    expect(summary.notices.join()).toContain("不是已保存的零件号");
    const incomplete = summarizeBatchStepResult(step("cad.name-audit", { selected: 2, inspected: 1, complete: false, manual: [{ rel: "selected/Unknown.FCStd", reason: "需要确认" }] }));
    expect(incomplete.tables[0].rows).toEqual([["selected/Unknown.FCStd", "需要确认"]]); expect(incomplete.notices.join()).not.toContain("未发现上述重复");
  });
  it("does not invent results for pending/failed or unknown action data", () => {
    expect(summarizeBatchStepResult({ ...step("file.metadata"), status: "pending" }).notices).toEqual(["步骤尚未开始，暂无结果"]);
    expect(summarizeBatchStepResult({ ...step("file.metadata"), status: "failed", message: "读取被拒绝" }).notices).toEqual(["读取被拒绝"]);
    const unknown = summarizeBatchStepResult(step("future.action", { arbitrary: true })); expect(unknown.title).toBe("未识别的观察结果"); expect(unknown.raw).toContain('"arbitrary": true');
  });
  it("renders escaped text, readable tables and collapsed raw JSON", async () => {
    const input = step("cad.saved-properties", { objects: [{ name: "<script>independent</script>", type: "Part::Feature", label: "<img src=x onerror=bad>", properties: {} }] });
    const html = await renderToString(createSSRApp(BatchTaskResult, { step: input }));
    expect(html).toContain("对象属性"); expect(html).toContain("&lt;script&gt;independent&lt;/script&gt;"); expect(html).not.toContain("<script>"); expect(html).not.toContain("<img src=x");
    expect(html).toContain("原始结果 JSON"); expect(html).not.toMatch(/<details[^>]*\bopen/);
  });
});
