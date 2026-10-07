import { expect, it } from "vitest";
import { labelRowState } from "./resultViewModel";
import type { LabelRow, LabelJob } from "./api";
const row: LabelRow = { rel: "A.ASSY.FCStd", total: 3, pending: 3, issues: 0, eligible: true, status: "needs_fix", message: "3 changes" };
it("distinguishes normal, pending, unselected, unknown and written without claiming unsent files succeeded", () => {
  expect(labelRowState(row, null, [], false)).toMatchObject({ group: "pending", label: "待修正" });
  expect(labelRowState({ ...row, status: "normal", pending: 0 }, null, [], false).label).toBe("正常");
  expect(labelRowState(row, null, [], true).label).toBe("未勾选");
  expect(labelRowState(row, null, [row.rel], true).label).toBe("结果待确认");
  const job: LabelJob = { id: "job", state: "attention", total: 1, completed: 1, current_rel: "", message: "index failed", index_state: "failed", results: [{ rel: row.rel, status: "written", count: 3, message: "saved" }] };
  expect(labelRowState(row, job, [row.rel], true)).toMatchObject({ label: "已修正", detail: "saved" });
});
