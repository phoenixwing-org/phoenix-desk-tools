import { createSSRApp } from "vue";
import { renderToString } from "vue/server-renderer";
import { expect, it } from "vitest";
import RenamePreviewTable from "./RenamePreviewTable.vue";
import type { RenamePreview, RenameResults, RenameRow } from "./api";
const row = (id: string): RenameRow => ({ id, root: "/docs", rel: `${id}.md`, target: `${id}.txt`, binary: false, eligible: true, occurrences: 0, diffs: [], truncated: false, message: "待应用" });
const preview: RenamePreview = { plan_id: "plan", roots: ["/docs"], mappings: [], conflicts: [], rows: [row("one"), row("two"), { ...row("blocked"), eligible: false, message: "目标名称已存在" }], expires_at: "", scanned: 3, skipped: 0, warnings: [] };
const render = (data: Partial<{ preview: RenamePreview; results: RenameResults | null; consumed: boolean; totalRows: number }> = {}) => renderToString(createSSRApp(RenamePreviewTable, { preview, results: null, disabled: true, selected: [], ...data }));
it("distinguishes completed, unselected, and blocked rows after a partial application", async () => {
  const html = await render({ consumed: true, results: { applied: 1, failed: 0, results: [{ id: "one", root: "/docs", rel: "one.md", target: "one.txt", status: "applied", message: "已应用并备份", backup: "/backup/one.original" }] } });
  expect(html).toContain("已应用并备份"); expect(html).toContain("/backup/one.original");
  expect(html).toContain("未应用（未选择或请求未确认完成）"); expect(html).toContain("目标名称已存在");
  expect(html).not.toContain("待应用");
});
it("does not claim that a hidden preview has no matches", async () => {
  expect(await render({ preview: { ...preview, rows: [] }, totalRows: 3 })).toContain("当前后缀筛选无匹配文件");
  expect(await render({ preview: { ...preview, rows: [] }, totalRows: 0 })).toContain("没有需要修改的文件");
});
it("shows failures without losing the reason after consuming the plan", async () => {
  const html = await render({ consumed: true, results: { applied: 0, failed: 1, results: [{ id: "one", root: "/docs", rel: "one.md", target: "one.txt", status: "failed", message: "文件在预览后已变化" }] } });
  expect(html).toContain("文件在预览后已变化"); expect(html).not.toContain("待应用");
});

it("lists skipped source rows separately while keeping valid results selectable", async () => {
  const html = await renderToString(createSSRApp(RenamePreviewTable, { preview: { ...preview, rows: [row("safe")], excluded_rules: [{ row: 4, old: "Bad", target: "One", reason: "目标冲突" }] }, results: null, disabled: false, selected: [] }));
  expect(html).toContain("未参与改名的规则（1）"); expect(html).toContain("原规则行"); expect(html).toContain("选择文件 safe.md");
  expect(html).not.toContain("disabled");
});
it("shows the selected ancestor rename in a child folder's final path", async () => {
  const parent = { ...row("parent"), kind: "directory" as const, rel: "Old", target: "New" };
  const child = { ...row("child"), kind: "directory" as const, rel: "Old/SubOld", target: "Old/SubNew" };
  const html = await renderToString(createSSRApp(RenamePreviewTable, { preview: { ...preview, rows: [parent, child] }, results: null, disabled: false, selected: ["parent", "child"] }));
  expect(html).toContain("New/SubNew");
});

it("retains original preview numbers when extension filters hide earlier rows", async () => {
  const html = await renderToString(createSSRApp(RenamePreviewTable, { preview: { ...preview, rows: [preview.rows[2]!] }, allRows: preview.rows, results: null, disabled: false, selected: [] }));
  expect(html).toMatch(/<td[^>]*>3<\/td>/);
  expect(html).not.toMatch(/<td[^>]*>1<\/td>/);
});
