import { describe, expect, it } from "vitest";
import { buildKtCodegenBatchReport, type KtCodegenBatchReportItem } from "./ktCodegenBatchReport";

function item(patch: Partial<KtCodegenBatchReportItem> = {}): KtCodegenBatchReportItem {
  return {
    documentId: "a.json",
    fileName: "a.json",
    displayPath: "codegen/a.json",
    health: "success",
    change: "unchanged",
    reasonCode: "content-unchanged",
    errorCount: 0,
    preflightRegionCount: 1,
    preflightArtifactCount: 1,
    preflightDiagnosticCount: 0,
    preflightErrorCount: 0,
    modifiedFileCount: 0,
    writtenRegionCount: 0,
    elapsedMilliseconds: 10,
    message: "内容一致",
    issues: [],
    ...patch,
  };
}

describe("Desk Codegen batch report", () => {
  it("keeps health and source change as independent dimensions", () => {
    const report = buildKtCodegenBatchReport({
      startedAt: "2026-07-22T00:00:00.000Z",
      completedAt: "2026-07-22T00:00:01.250Z",
      items: [
        item({ documentId: "a", change: "updated", modifiedFileCount: 1 }),
        item({ documentId: "b", health: "error", change: "not-applied", message: "预检失败" }),
      ],
    });
    expect(report.summary).toMatchObject({
      subject: "2 份 JSON",
      applyKind: "batch",
      itemCount: 2,
      health: "error",
      change: "partial",
    });
    expect(report.elapsedMs).toBe(1250);
  });

  it("reports a successful zero-write batch as content unchanged", () => {
    const report = buildKtCodegenBatchReport({
      startedAt: "2026-07-22T00:00:00.000Z",
      completedAt: "2026-07-22T00:00:01.000Z",
      items: [item(), item({ documentId: "b", fileName: "b.json" })],
    });
    expect(report.summary.health).toBe("success");
    expect(report.summary.change).toBe("unchanged");
  });
});
