import { expect, it } from "vitest";
import { cadIndexReadStateLabel, cadIndexReadStateWarning, xrefCountsFromPayload } from "./cadIndexState";

it("does not describe absent or legacy status as verified freshness", () => {
  expect(cadIndexReadStateLabel()).toBe("未检查");
  expect(cadIndexReadStateLabel({})).toBe("未检查");
  expect(cadIndexReadStateWarning({})).toBe("");
});

it("projects the same revision into Primary without inventing target-file or BOM-line counts", () => {
  const counts = xrefCountsFromPayload({
    rel: "parts/Bracket.FCStd", incoming: { count: 4, direct_count: 2, hosts: [] },
    outgoing: { count: 3, refs: [] }, scan_id: 7, freshness_scope: "file",
    index_state: "stale", index_stale: true, index_reason: "partial_refresh",
    bom_index_state: "stale", bom_index_stale: true,
  });
  expect(counts).toMatchObject({ outgoing_count: 3, direct_incoming_count: 2, scan_id: 7, freshness_scope: "file" });
  expect(counts).not.toHaveProperty("flat_lines");
  expect(counts).not.toHaveProperty("outgoing");
  expect(cadIndexReadStateLabel(counts)).toBe("递归 BOM 待更新");
});
it("keeps pending and partial-refresh stale visibly separate from ready counts", () => {
  expect(cadIndexReadStateLabel({ index_pending: true })).toBe("待完整扫描");
  expect(cadIndexReadStateWarning({ index_state: "incomplete" })).toContain("未完成");
  expect(cadIndexReadStateLabel({ index_stale: true, bom_index_stale: true })).toBe("递归 BOM 待更新");
  expect(cadIndexReadStateWarning({ index_state: "stale" })).toContain("现有引用投影");
  expect(cadIndexReadStateWarning({ index_state: "ready", bom_index_pending: true })).toContain("完整 BOM");
  expect(cadIndexReadStateLabel({ index_state: "ready" })).toBe("已有索引");
  expect(cadIndexReadStateWarning({ index_state: "ready" })).toBe("");
});
