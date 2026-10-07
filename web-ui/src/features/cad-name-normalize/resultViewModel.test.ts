import { expect, it } from "vitest";
import { filterNameRows, nameDetailRel, namePreviewRows, nameRowState, renameRowState } from "./resultViewModel";
import type { NameRow, RenameAnalysis } from "./api";
const row: NameRow = { rel: "parts/A.FCStd", target_rel: "parts/侧板.FCStd", object_name: "Body", current_name: "A", proposed_name: "侧板", current_label: "001.001-侧板", proposed_label: "001.001-侧板", attributes_changed: true, rename_changed: true, eligible: true, status: "needs_fix", message: "待勾选", warnings: [] };
it("links to the source before rename and follows only confirmed disk moves", () => {
  expect(nameDetailRel(row.rel)).toBe(row.rel);
  for (const status of ["renamed", "references_pending", "failed", "uncertain"] as const) {
    const result = { rel: row.rel, target_rel: row.target_rel, status, message: "result" };
    expect(nameDetailRel(row.rel, { results: [result] })).toBe(status === "renamed" || status === "references_pending" ? row.target_rel : row.rel);
    if (status === "uncertain") expect(nameDetailRel(row.rel, { results: [{ ...result, rename_log_id: 1 }] })).toBe(row.target_rel);
  }
});
it("separates normal, correctable differences and blocked diagnostics", () => {
  expect(nameRowState(row)).toMatchObject({ label: "需修正", tone: "warning" });
  expect(nameRowState({ ...row, eligible: false, status: "normal" })).toMatchObject({ label: "正常", tone: "success" });
  expect(nameRowState({ ...row, eligible: false, status: "needs_review", message: "collision" })).toMatchObject({ label: "需确认", detail: "collision" });
  const rows = namePreviewRows({ plan_id: "p", batch_dir: ".", scanned: 1, rows: [row], errors: [{ rel: "broken.FCStd", message: "read failure" }] });
  expect(rows[1]).toMatchObject({ eligible: false, status: "needs_review" });
});
it("filters source or target filenames and status without changing data or selections", () => {
  const rows = [row, { ...row, rel: "ok.FCStd", target_rel: "ok.FCStd", status: "normal" as const }].map(row => ({ row, state: nameRowState(row) }));
  expect(filterNameRows(rows, "侧板", "needs_fix")).toEqual([rows[0]]);
  expect(filterNameRows(rows, "PARTS\\a", "all")).toEqual([rows[0]]);
  expect(filterNameRows(rows, "", "normal")).toEqual([rows[1]]);
  expect(rows).toHaveLength(2);
});
it("does not mark attributes-only success as fully normal when the file still needs renaming", () => {
  expect(nameRowState(row, { attributes: { prepared_id: "p", results: [{ rel: row.rel, status: "written", message: "属性已写入" }] } }).group).toBe("needs_fix");
  expect(nameRowState(row, { attributeSubmitted: [row.rel], attributeDone: true }).label).toBe("结果待确认");
});
it("shows completed, pending-reference, failed and unknown outcomes independently", () => {
  const analysis: RenameAnalysis["rows"][number] = { rel: row.rel, target_rel: row.target_rel, eligible: true, status: "needs_fix", message: "待改名", hosts: [], outside_scope: [] };
  expect(renameRowState(analysis, { renamed: { results: [{ rel: row.rel, target_rel: row.target_rel, status: "renamed", message: "全部完成" }] } })).toMatchObject({ group: "normal", tone: "success" });
  expect(renameRowState(analysis, { renamed: { results: [{ rel: row.rel, target_rel: row.target_rel, status: "references_pending", message: "引用未修正" }] } }).group).toBe("needs_fix");
  expect(renameRowState(analysis, { renamed: { results: [{ rel: row.rel, target_rel: row.target_rel, status: "failed", message: "fail" }] } })).toMatchObject({ group: "needs_review", tone: "danger" });
  expect(renameRowState(analysis, { renameDone: true, renameSubmitted: [row.rel] }).label).toBe("结果待确认");
});
