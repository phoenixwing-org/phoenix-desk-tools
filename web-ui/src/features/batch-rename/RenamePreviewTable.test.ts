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
it("projects selected nested folder moves for file names and content-only rows", async () => {
  const parent = { ...row("parent"), kind: "directory" as const, rel: "Old", target: "New" };
  const child = { ...row("child"), kind: "directory" as const, rel: "Old/SubOld", target: "Old/SubNew" };
  const file = { ...row("file"), kind: "file" as const, rel: "Old/SubOld/source.md", target: "Old/SubOld/target.md" };
  const content = { ...row("content"), rel: "Old/SubOld/notes.txt", target: "Old/SubOld/notes.txt" };
  const html = await renderToString(createSSRApp(RenamePreviewTable, { preview: { ...preview, rows: [parent, child, file, content] }, results: null, disabled: false, selected: ["parent", "child", "file"] }));
  expect(html).toContain("New/SubNew/target.md"); expect(html).toContain("New/SubNew/notes.txt");
});
it("ignores unselected and blocked ancestors and prefers actual result paths after apply", async () => {
  const parent = { ...row("parent"), kind: "directory" as const, rel: "Old", target: "New", eligible: false };
  const child = { ...row("child"), kind: "directory" as const, rel: "Old/SubOld", target: "Old/SubNew" };
  const file = { ...row("file"), rel: "Old/SubOld/source.md", target: "Old/SubOld/target.md" };
  const data = { preview: { ...preview, rows: [parent, child, file] }, results: null, disabled: false, selected: ["parent", "file"] };
  const before = await renderToString(createSSRApp(RenamePreviewTable, data));
  expect(before).toContain("Old/SubOld/target.md"); expect(before).not.toContain("New/SubNew/target.md");
  const after = await renderToString(createSSRApp(RenamePreviewTable, { ...data, selected: ["child", "file"], results: { applied: 1, failed: 1, results: [{ id: "file", root: "/docs", rel: file.rel, target: "Old/SubOld/target.md", status: "applied", message: "已应用；父目录未改名" }] } }));
  expect(after).toContain("Old/SubOld/target.md"); expect(after).not.toContain("Old/SubNew/target.md");
});
it("uses the full preview for selected ancestor projection when a display subset is supplied", async () => {
  const parent = { ...row("parent"), kind: "directory" as const, rel: "Old", target: "New" };
  const file = { ...row("file"), rel: "Old/source.md", target: "Old/target.md" };
  const html = await renderToString(createSSRApp(RenamePreviewTable, { preview: { ...preview, rows: [file] }, allRows: [parent, file], results: null, disabled: false, selected: ["parent", "file"] }));
  expect(html).toContain("New/target.md");
});
it("shows unselected files under only successfully moved folders after partial apply", async () => {
  const parent = { ...row("parent"), kind: "directory" as const, rel: "Old", target: "New" };
  const file = { ...row("file"), rel: "Old/source.md", target: "Old/target.md" };
  const data = { preview: { ...preview, rows: [parent, file] }, disabled: false, selected: ["parent"], consumed: true };
  const applied = await renderToString(createSSRApp(RenamePreviewTable, { ...data, results: { applied: 1, failed: 0, results: [{ id: "parent", root: "/docs", rel: "Old", target: "New", status: "applied", message: "目录已改名" }] } }));
  expect(applied).toContain("New/source.md"); expect(applied).not.toContain("New/target.md");
  const failed = await renderToString(createSSRApp(RenamePreviewTable, { ...data, results: { applied: 0, failed: 1, results: [{ id: "parent", root: "/docs", rel: "Old", target: "Old", status: "failed", message: "目录发生变化" }] } }));
  expect(failed).not.toContain("New/source.md"); expect(failed).not.toContain("Old/target.md");
});

it("retains original preview numbers when extension filters hide earlier rows", async () => {
  const html = await renderToString(createSSRApp(RenamePreviewTable, { preview: { ...preview, rows: [preview.rows[2]!] }, allRows: preview.rows, results: null, disabled: false, selected: [] }));
  expect(html).toMatch(/<td[^>]*>3<\/td>/);
  expect(html).not.toMatch(/<td[^>]*>1<\/td>/);
});
