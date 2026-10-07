import { createSSRApp } from "vue";
import { readFileSync } from "node:fs";
import { renderToString } from "vue/server-renderer";
import { describe, expect, it } from "vitest";
import type { BatchAttributePreview } from "../../api";
import BatchAttributePreviewTable from "./BatchAttributePreviewTable.vue";

const rows: BatchAttributePreview["rows"] = [{ rel: "parts/one.FCStd", object_name: "Body", changes: [
  { field: "PartNumber", current: "100001", proposed: "100001", source: "索引", eligible: false, note: "值已一致" },
  { field: "PartVersion", current: "001", proposed: "002", source: "文件名", eligible: true, note: "覆盖" },
  { field: "PartName", current: "", proposed: "新的名称", source: "索引", eligible: false, note: "来源冲突，需单文件确认" },
] }, { rel: "parts/two.FCStd", object_name: "Assembly", changes: [] }];
const render = (busy = false) => renderToString(createSSRApp(BatchAttributePreviewTable, {
  rows, busy, selection: { "parts/one.FCStd": ["PartVersion"] },
}));

describe("one-file-per-row attribute preview", () => {
  it("offers an editable target and an independent row write button, retaining drafts read-only for writes after refresh", async () => {
    const props = { rows: [{ ...rows[0], name_editable: true }], busy: false, selection: {} };
    const html = await renderToString(createSSRApp(BatchAttributePreviewTable, props));
    expect(html).toContain('aria-label="目标零件名 parts/one.FCStd" value="新的名称"');
    expect(html).toContain('aria-label="写入文件 parts/one.FCStd"');
    const restored = await renderToString(createSSRApp(BatchAttributePreviewTable, { ...props, requiresPreview: true }));
    expect(restored).toMatch(/<button[^>]*disabled[^>]*aria-label="写入文件 parts\/one.FCStd"/);
    expect(restored).toContain('aria-label="选择文件 parts/one.FCStd" disabled');
    const locked = await renderToString(createSSRApp(BatchAttributePreviewTable, { ...props, submittedSelection: { "parts/one.FCStd": ["PartVersion"] }, results: [{ rel: "parts/one.FCStd", status: "written", message: "done" }] }));
    expect(locked).not.toContain('aria-label="目标零件名'); expect(locked).not.toContain('aria-label="写入文件');
  });
  it("leaves both scrolling axes to Wing instead of creating a nested horizontal scroll trap", () => {
    const source = readFileSync(new URL("./BatchAttributePreviewTable.vue", import.meta.url), "utf8");
    expect(source).not.toMatch(/overflow(?:-[xy])?\s*:|overscroll-behavior\s*:|@wheel|preventDefault/);
    const page = readFileSync(new URL("../../pages/BatchAttributesPage.vue", import.meta.url), "utf8");
    expect(page).toContain('phoenix-wing/layout/PnwPageLayout.vue');
    expect(page).not.toContain(':body-scroll="false"');
  });
  it("uses one table, two data rows and exactly one checkbox per file", async () => {
    const html = await render();
    expect(html.match(/<table\b/g)).toHaveLength(1);
    expect(html.match(/<tr\b/g)).toHaveLength(3);
    expect(html.match(/type="checkbox"/g)).toHaveLength(2);
    expect(html).toContain('aria-label="选择文件 parts/one.FCStd" checked');
    expect(html).toContain('aria-label="选择文件 parts/two.FCStd" disabled');
    expect(html).toContain("待写入（1项）");
    expect(html).toContain(">状态</th>");
    expect(html).not.toContain("可写字段</th>");
  });
  it("links each file to its detail view without coupling navigation to selection", async () => {
    const rel = "零件/支架 #1&2.FCStd";
    const html = await renderToString(createSSRApp(BatchAttributePreviewTable, {
      rows: [{ ...rows[0], rel }], busy: false, selection: {},
    }));
    expect(html).toContain(`href="?page=file_detail&amp;rel=${encodeURIComponent(rel)}"`);
    expect(html).toContain(`title="编辑属性：${rel.replace("&", "&amp;")}"`);
    const source = readFileSync(new URL("./BatchAttributePreviewTable.vue", import.meta.url), "utf8");
    expect(source).toContain(`@click.exact.prevent="emit('openFile', row.rel)"`);
    const page = readFileSync(new URL("../../pages/BatchAttributesPage.vue", import.meta.url), "utf8");
    expect(page).toContain(`@open-file="shell.openFileDetailForRel($event, { subTab: 'edit' })"`);
  });
  it("uses warning tags and pale notes for review, and a green consistent tag", async () => {
    const html = await renderToString(createSSRApp(BatchAttributePreviewTable, {
      rows: [rows[1], { ...rows[0], changes: [rows[0].changes[0]] }], busy: false, selection: {},
    }));
    expect(html).toMatch(/data-status="needs_review"[\s\S]*?el-tag--warning[\s\S]*?>需确认</);
    expect(html).toMatch(/data-status="unchanged"[\s\S]*?el-tag--success[\s\S]*?>一致</);
    expect(html).not.toContain("已一致</");
    expect(await render()).toMatch(/class="field-note-warning"[^>]*>来源冲突，需单文件确认</);
  });
  it("renders equal values once, highlights only writable differences and retains conflict reasons", async () => {
    const html = await render();
    expect(html.match(/>100001</g)).toHaveLength(1);
    expect(html.match(/class="value-pending"/g)).toHaveLength(1);
    expect(html.match(/>当前</g)).toHaveLength(2);
    expect(html.match(/>目标</g)).toHaveLength(2);
    expect(html).toContain("来源冲突，需单文件确认");
    expect(html).toContain("（空）");
    expect(html).not.toContain("<fieldset");
    expect(html.match(/待写入/g)).toHaveLength(1);
  });
  it("renders unreadable files in the same table with a detail link and a non-writable warning row", async () => {
    const html = await renderToString(createSSRApp(BatchAttributePreviewTable, {
      rows: [{ rel: "parts/multi.FCStd", object_name: "", changes: [], diagnosticMessages: ["包含多个独立 BOM 根对象，请在文件详情逐个确认"] }],
      busy: false, selection: {},
    }));
    expect(html.match(/<table\b/g)).toHaveLength(1);
    expect(html).toContain('href="?page=file_detail&amp;rel=parts%2Fmulti.FCStd"');
    expect(html).toContain('aria-label="选择文件 parts/multi.FCStd" disabled');
    expect(html).toContain('colspan="5" class="diagnostic-cell"');
    expect(html).toContain("包含多个独立 BOM 根对象，请在文件详情逐个确认");
    expect(html).toContain('data-status="needs_review"');
    expect(html).toContain('el-tag--warning');
    expect(html).not.toContain('class="value-pending"');
    expect(html).not.toContain("<ul");
  });
  it("retains the table headings when a filter has no matches", async () => {
    const html = await renderToString(createSSRApp(BatchAttributePreviewTable, { rows: [], busy: false, selection: {} }));
    expect(html).toContain("文件 / 根对象</th>");
    expect(html).toContain('colspan="8" class="empty-row"');
    expect(html).toContain("当前筛选无匹配文件");
  });
  it("disables every row while writing/confirming and preserves keyboard focusability", async () => {
    const html = await render(true);
    expect(html.match(/<input[^>]* disabled/g)).toHaveLength(2);
    expect(html).toContain('tabindex="0"');
    expect(html).toContain('scope="row"');
  });
  it("keeps the preview as a read-only snapshot after writing, without pending yellow or false success", async () => {
    const html = await renderToString(createSSRApp(BatchAttributePreviewTable, {
      rows: [...rows, { ...rows[0], rel: "parts/not-selected.FCStd" }], busy: false, selection: {}, completed: true,
      submittedSelection: { "parts/one.FCStd": ["PartVersion"] },
      results: [{ rel: "parts/one.FCStd", status: "written", message: "已写入，索引未更新" }],
    }));
    expect(html).toContain("已写入（1项）");
    expect(html).toContain("已写入，索引未更新");
    expect(html).toContain("未写入");
    expect(html.match(/<input[^>]* disabled/g)).toHaveLength(3);
    expect(html).not.toContain('class="value-pending"');
    expect(html).not.toContain("待写入");
  });
});
