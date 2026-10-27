import fs from "node:fs";
import { parse } from "vue/compiler-sfc";
import { computed, createRenderer, createSSRApp, defineComponent, h, nextTick, onServerPrefetch, ref, toValue } from "vue";
import { renderToString } from "vue/server-renderer";
import { ID_INJECTION_KEY, ZINDEX_INJECTION_KEY } from "element-plus";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { PageSessionApi } from "../../composables/usePageSession";
import type { PagePrimaryContribution } from "../../composables/usePagePrimaryContribution";
import type { useDrawingBatch } from "./useDrawingBatch";
import type { useDrawingLineWidths } from "./useDrawingLineWidths";
const state = vi.hoisted(() => ({ shell: {} as Record<string, unknown>, session: undefined as PageSessionApi | undefined, contribution: undefined as PagePrimaryContribution | undefined, prepare: "", validate: vi.fn(), boundBusy: undefined as unknown, audit: vi.fn(), generation: vi.fn(), apply: vi.fn(), start: vi.fn(), getJob: vi.fn(), cancel: vi.fn(), templates: vi.fn(), prompt: vi.fn(), widthLoad: vi.fn(), widthSave: vi.fn() }));
vi.mock("vue", async original => ({ ...await original<typeof import("vue")>(), useSSRContext: () => ({ modules: new Set<string>() }), onActivated: () => undefined, onDeactivated: () => undefined }));
vi.mock("../../composables/useAppShell", () => ({ useAppShell: () => state.shell }));
vi.mock("../../composables/usePageSession", () => ({ usePageSession: (_id: string, api: PageSessionApi) => { state.session = api; } }));
vi.mock("../../composables/usePagePrimaryContribution", () => ({ usePagePrimaryContribution: (_page: string, _id: string, contribution: PagePrimaryContribution) => {
  state.contribution = contribution;
  if (state.prepare) onServerPrefetch(async () => { const actions = toValue(contribution.sections)!.find(item => item.id === "scope")!.actions!; await actions.find(item => item.id === `${state.prepare}-preview`)!.run(); });
} }));
vi.mock("../../composables/useCadBatchDirectory", async () => {
  const { computed, ref } = await import("vue");
  return { useCadBatchDirectory: (workspace: { value: string }) => { const directory = ref("demo"); return { directory, scopeKey: computed(() => `${workspace.value}/${directory.value}`), disabled: ref(false), validate: state.validate, bindBusy: (value: unknown) => { state.boundBusy = value; }, section: { id: "cad-batch-directory", title: "搜索目录", description: "测试目录" } }; } };
});
vi.mock("./api", () => ({ previewDrawingAudit: state.audit, previewDrawingGeneration: state.generation, applyDrawingAudit: state.apply, startDrawingGeneration: state.start, fetchDrawingBatchJob: state.getJob, cancelDrawingBatchJob: state.cancel, fetchDrawingTemplates: state.templates, fetchDrawingLineWidths: state.widthLoad, saveDrawingLineWidths: state.widthSave }));
vi.mock("phoenix-wing", () => ({ pnwPromptChoice: state.prompt }));
vi.mock("phoenix-wing/layout/PnwPageLayout.vue", async () => { const { defineComponent, h } = await import("vue"); return { default: defineComponent({ setup: (_p, { slots }) => () => h("main", [slots.header?.(), slots.default?.()]) }) }; });
vi.mock("phoenix-wing/layout/PnwPageHeader.vue", async () => { const { defineComponent, h } = await import("vue"); return { default: defineComponent({ props: ["title"], setup: (p, { slots }) => () => h("header", [h("h1", p.title), slots.right?.()]) }) }; });
vi.mock("phoenix-wing/layout/PnwSidebarBlock.vue", async () => { const { defineComponent, h } = await import("vue"); return { default: defineComponent({ props: ["title", "expanded"], setup: (p, { slots }) => () => h("section", [h("header", [h("h2", p.title), slots.suffix?.(), slots.actions?.()]), p.expanded ? slots.default?.() : null]) }) }; });
import DrawingBatchPage from "./DrawingBatchPage.vue";
import { syntheticAudit, syntheticGeneration, syntheticJob } from "./fixtures.test-support";
const workspace = ref("/example"), tab = ref("example-tab"), mounted: Array<{ unmount(): void }> = [];
const button = defineComponent({ props: { disabled: Boolean }, setup: (p, { slots }) => () => h("button", { disabled: p.disabled }, slots.default?.()) });
const simple = defineComponent({ setup: (_p, { slots }) => () => h("span", slots.default?.()) });
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2035-01-01T00:00:00.000Z")); vi.clearAllMocks();
  workspace.value = "/example"; tab.value = "example-tab"; state.prepare = ""; state.session = undefined; state.contribution = undefined;
  state.shell = { workspacePath: workspace, activeTabId: tab, appendLog: vi.fn(), openTab: vi.fn(), requestTreeRescan: vi.fn(), openFileDetailForRel: vi.fn(), consumeTabPageState: vi.fn(), scheduleWorkbenchSave: vi.fn() };
  state.validate.mockImplementation(async () => !toValue(state.boundBusy as ReturnType<typeof computed<boolean>>));
  state.audit.mockResolvedValue(syntheticAudit()); state.generation.mockResolvedValue(syntheticGeneration()); state.apply.mockResolvedValue(syntheticJob()); state.start.mockResolvedValue(syntheticJob({ kind: "generation" })); state.getJob.mockResolvedValue(syntheticJob()); state.prompt.mockResolvedValue({ choiceId: "cancel" });
  state.widthLoad.mockResolvedValue({ contour_line_width_mm: 0.5, dimension_line_width_mm: 0.25 }); state.widthSave.mockImplementation(async (_workspace, values) => ({ ...values }));
});
afterEach(() => { for (const app of mounted.splice(0)) app.unmount(); vi.useRealTimers(); });
async function render() {
  const app = createSSRApp(defineComponent({ setup: () => () => h(DrawingBatchPage, { workbenchTabId: "example-tab" }) })); app.component("ElButton", button);
  app.provide(ID_INJECTION_KEY, { prefix: 101, current: 0 });
  app.provide(ZINDEX_INJECTION_KEY, { current: 0 });
  for (const name of ["ElInput", "ElInputNumber", "ElSelect", "ElOption", "ElCheckbox"]) app.component(name, simple);
  return renderToString(app);
}
type HostNode = { parent: HostNode | null; children: HostNode[] };
const node = (): HostNode => ({ parent: null, children: [] });
function setupPage() {
  type Unwrap<T> = { [K in keyof T]: T[K] extends { value: infer V } ? V : T[K] };
  type Setup = { drawing: Unwrap<ReturnType<typeof useDrawingBatch>>; lineWidths: Unwrap<ReturnType<typeof useDrawingLineWidths>>; expanded: { audit: boolean; generation: boolean }; recursive: boolean; preview(kind: "audit" | "generation"): Promise<void> };
  const renderer = createRenderer<HostNode, HostNode>({ createElement: node, createText: node, createComment: node, setText() {}, setElementText() {}, patchProp() {}, parentNode: el => el.parent, nextSibling: el => el.parent?.children[el.parent.children.indexOf(el) + 1] || null,
    insert(el, parent, anchor) { if (el.parent) el.parent.children.splice(el.parent.children.indexOf(el), 1); el.parent = parent; const index = anchor ? parent.children.indexOf(anchor) : -1; parent.children.splice(index < 0 ? parent.children.length : index, 0, el); }, remove(el) { if (el.parent) el.parent.children.splice(el.parent.children.indexOf(el), 1); el.parent = null; },
  });
  const app = renderer.createApp({ ...DrawingBatchPage, render: () => null }, { workbenchTabId: "example-tab" }); mounted.push(app); const vm = app.mount(node());
  if (!("setupState" in vm.$)) throw new Error("Expected real SFC setup"); return vm.$.setupState as Setup;
}
it("renders two real collapsible blocks with header actions and no automatic read or write", async () => {
  const html = await render();
  for (const text of ["1. 图纸校核与修正", "2. 批量出图初稿", "不依赖 CAD 索引", "校核预览", "应用所选修正", "出图预览", "生成所选初稿", "中文注释字体"]) expect(html).toContain(text);
  for (const fn of [state.audit, state.generation, state.apply, state.start, state.templates, state.widthLoad, state.widthSave]) expect(fn).not.toHaveBeenCalled();
  const source = fs.readFileSync(new URL("./DrawingBatchPage.vue", import.meta.url), "utf8");
  const parsed = parse(source); expect(parsed.errors).toEqual([]);
  expect(source.match(/<WingBlock /g)).toHaveLength(2); expect(source.match(/<template #actions>/g)).toHaveLength(2);
  expect(source).not.toMatch(/v-html|onServerPrefetch|switchWorkspace|recreatePhoenixDatabase/);
  expect(source).toContain("onDeactivated(() => { mountedActive.value = false;");
});
it("renders explicit workspace-only line-width controls and does not pretend unsaved inputs have reached previews", async () => {
  const html = await render(); for (const text of ["轮廓线宽（mm）", "尺寸及界线线宽（mm）", "读取已保存线宽", "保存当前工作空间线宽", "尚未读取当前工作空间有效配置", "输入尚未保存", "不用于当前校核或出图预览", "不写机器设置"]) expect(html).toContain(text);
  expect(state.widthLoad).not.toHaveBeenCalled(); expect(state.widthSave).not.toHaveBeenCalled();
  const source = fs.readFileSync(new URL("./DrawingBatchPage.vue", import.meta.url), "utf8"); expect(source).toContain("useDrawingLineWidths"); expect(source).not.toContain("/api/drawing-research/defaults"); expect(source).not.toContain("JSON.stringify({ workspace, scope");
});
it("saves the two workspace widths through the real controller and clears both existing previews, never applying CAD", async () => {
  const page = setupPage(); await page.lineWidths.load(); await page.preview("audit"); await page.preview("generation"); expect(page.drawing.audit).not.toBeNull(); expect(page.drawing.generation).not.toBeNull();
  page.lineWidths.contour = 0.7; page.lineWidths.dimension = 0.3; expect(page.lineWidths.dirty).toBe(true); await page.lineWidths.save();
  expect(state.widthSave).toHaveBeenCalledExactlyOnceWith("/example", { contour_line_width_mm: 0.7, dimension_line_width_mm: 0.3 }, expect.any(AbortSignal)); expect(page.drawing.audit).toBeNull(); expect(page.drawing.generation).toBeNull(); expect(page.lineWidths.notice).toContain("重新预览"); expect(state.apply).not.toHaveBeenCalled(); expect(state.start).not.toHaveBeenCalled();
});
it("shows an unconfirmed save in Bottom and ignores a later old-workspace success", async () => {
  const page = setupPage(); state.widthSave.mockRejectedValueOnce(new Error("independent connection lost")); await page.lineWidths.save(); expect(page.lineWidths.error).toContain("保存结果未确认"); expect(state.shell.appendLog).toHaveBeenCalledWith(expect.stringContaining("保存结果未确认"), { source: "drawing_batch", open: true });
  let resolve!: (value: { contour_line_width_mm: number; dimension_line_width_mm: number }) => void; state.widthSave.mockReturnValueOnce(new Promise(done => { resolve = done; })); const pending = page.lineWidths.save(); workspace.value = "/other-independent"; resolve({ contour_line_width_mm: 0.7, dimension_line_width_mm: 0.3 }); await pending;
  expect(page.lineWidths.saved).toBeNull(); expect(page.lineWidths.error).toBe(""); expect(page.lineWidths.contour).toBe(0.5); expect(page.lineWidths.dimension).toBe(0.25);
});
it("does not let Primary run an old CAD plan while workspace line widths are being saved", async () => {
  const page = setupPage(); await page.preview("audit"); page.drawing.selectAllAudit(true); state.prompt.mockResolvedValue({ choiceId: "apply" });
  let resolve!: (value: { contour_line_width_mm: number; dimension_line_width_mm: number }) => void; state.widthSave.mockReturnValueOnce(new Promise(done => { resolve = done; })); const save = page.lineWidths.save();
  const action = toValue(state.contribution!.sections)!.find(section => section.id === "scope")!.actions!.find(item => item.id === "audit-apply")!; expect(toValue(action.disabled)).toBe(true); await action.run(); expect(state.apply).not.toHaveBeenCalled();
  resolve({ contour_line_width_mm: 0.5, dimension_line_width_mm: 0.25 }); await save; expect(page.drawing.audit).toBeNull();
});
it("renders escaped per-issue current/proposed/status and prevents manual/conflict/error checkbox writes", async () => {
  const value = syntheticAudit(); value.rows[0].issues[1].current = "<script>example</script>"; state.audit.mockResolvedValue(value); state.prepare = "audit";
  const html = await render();
  expect(html).toContain("&lt;script&gt;example&lt;/script&gt;"); expect(html).not.toContain("<script>");
  expect(html).toContain("冲突，保持原值"); expect(html).toContain("人工处理"); expect(html).toContain("资源不完整");
  const checkboxes = [...html.matchAll(/<input([^>]*aria-label="选择问题[^>]*)>/g)].map(match => match[1]);
  expect(checkboxes).toHaveLength(4); expect(checkboxes[0]).not.toContain("disabled");
  for (const attrs of checkboxes.slice(1)) expect(attrs).toContain("disabled");
  expect(state.validate).toHaveBeenCalledOnce(); expect(state.audit).toHaveBeenCalledOnce();
  expect(state.apply).not.toHaveBeenCalled(); expect(state.shell.appendLog).toHaveBeenCalledWith(expect.stringContaining("资源不完整"), { source: "drawing_batch", open: true });
});
it("renders output paths, material source and planned paper/scale without starting generation", async () => {
  state.prepare = "generation"; const html = await render();
  for (const text of ["demo/ShapeA.Drawing.FCStd", "demo/ShapeA.Drawing.pdf", "demo/ShapeA.Original.pdf", "参考PDF（身份候选，工程要求未识别）", "无参考PDF也生成研究稿", "默认允许没有参考 PDF", "Example alloy", "model", "1:2", "节点待确认"]) expect(html).toContain(text);
  expect(state.start).not.toHaveBeenCalled();
});
it("shows every manual PDF path and escaped reason without silently adopting it or claiming no candidates", async () => {
  const response = syntheticGeneration(), row = response.rows[0]; response.rows = [row];
  delete row.reference_pdf; row.reference_status = "manual";
  row.reference_candidates = [
    { rel: "demo/Independent-legacy.Drawing.pdf", status: "manual", message: "旧说明缺少最终 SHA，来源需人工核对" },
    { rel: "demo/Independent-unknown.pdf", status: "manual", message: "<script>untrusted</script> 未知版次" },
    { rel: "demo/Independent-visible.pdf", status: "candidate", message: "仅为可见身份候选" },
  ];
  state.generation.mockResolvedValue(response); state.prepare = "generation";
  const html = await render();
  for (const text of ["参考PDF来源需人工核对", "未采用为原参考", "demo/Independent-legacy.Drawing.pdf", "demo/Independent-unknown.pdf", "demo/Independent-visible.pdf", "旧说明缺少最终 SHA", "&lt;script&gt;untrusted&lt;/script&gt; 未知版次", "仅从 3D 生成无原图研究稿"]) expect(html).toContain(text);
  expect(html).not.toContain("<script>"); expect(html).not.toContain("未找到可核对候选");
  expect(html.match(/aria-label="选择出图/g)).toHaveLength(1); expect(html).not.toMatch(/(?:href|src)="demo\/Independent-/);
  expect(state.start).not.toHaveBeenCalled(); expect(state.apply).not.toHaveBeenCalled();
  const page = setupPage(); await page.preview("generation");
  expect(page.drawing.referenceCandidate(row)).toBe(false); expect(page.drawing.generation?.rows[0].reference_pdf).toBeUndefined(); expect(page.drawing.selectedGeneration).toEqual([]);
});
it("keeps manual PDF evidence out of the existing only-reference generation gate", async () => {
  const response = syntheticGeneration(), row = response.rows[0]; response.rows = [row];
  row.reference_status = "manual"; row.reference_pdf = "demo/Independent-unverified.pdf";
  row.reference_candidates = [{ rel: row.reference_pdf, status: "manual", message: "保存线索不足，不能复作原参考" }];
  state.generation.mockResolvedValue(response);
  const page = setupPage(); page.drawing.allowWithoutPdf = false; await page.preview("generation"); page.drawing.selectAllGeneration(true);
  expect(page.drawing.referenceCandidate(row)).toBe(false); expect(page.drawing.canGenerateRow(row)).toBe(false); expect(page.drawing.generationIds).toEqual([]); expect(page.drawing.canStartGeneration).toBe(false);
  await page.drawing.startGeneration(); expect(state.prompt).not.toHaveBeenCalled(); expect(state.start).not.toHaveBeenCalled();
});
it("renders missing-material evidence as manual and explains the 100-issue boundary", async () => {
  const value = syntheticAudit();
  value.rows[0].issues.push({ id: "unknown-material", kind: "material", location: "Template", field: "part_material", current: "", proposed: "", status: "manual", message: "缺少源材料/明确配置，需人工确认；保留原图材料" });
  state.audit.mockResolvedValue(value); state.prepare = "audit";
  const html = await render(); expect(html).toContain("缺少源材料/明确配置，需人工确认");
  expect(html.match(/<input[^>]*aria-label="选择问题 demo\/ShapeA.Drawing.FCStd part_material"[^>]*>/)?.[0]).toContain("disabled");
  const source = fs.readFileSync(new URL("./DrawingBatchPage.vue", import.meta.url), "utf8");
  expect(source).toContain("每次最多 500 个文件、每份最多 100 个问题");
  expect(source).toContain("不会截断、消费预览或自动应用");
  expect(state.apply).not.toHaveBeenCalled();
});
it("uses the public default-cancel confirmation and explicitly acknowledges closing targets", async () => {
  const page = setupPage(); await page.preview("audit"); page.drawing.selectAllAudit(true); await page.drawing.applyAudit();
  expect(state.prompt).toHaveBeenCalledWith(expect.objectContaining({ defaultChoiceId: "cancel", title: "确认批量图纸修正", choices: expect.arrayContaining([expect.objectContaining({ id: "apply", label: "已关闭目标，应用勾选" })]) }));
  expect(state.apply).not.toHaveBeenCalled();
  state.prompt.mockResolvedValue({ choiceId: "apply" }); await page.drawing.applyAudit(); expect(state.apply).toHaveBeenCalledOnce();
});
it("hydrates only workspace settings, not injected plans, jobs, selections or confirmations", async () => {
  (state.shell.consumeTabPageState as ReturnType<typeof vi.fn>).mockReturnValue({ workspace: "/example", recursive: true, expanded: { audit: false, generation: true }, audit: syntheticAudit(), generation: syntheticGeneration(), job: syntheticJob(), selectedIssues: { "drawing-a": ["ready-a"] }, confirmed: true });
  const page = setupPage(); await nextTick();
  expect(page.recursive).toBe(true); expect(page.expanded).toEqual({ audit: false, generation: true });
  expect(page.drawing.audit).toBeNull(); expect(page.drawing.generation).toBeNull(); expect(page.drawing.job).toBeNull(); expect(page.drawing.selectedIssues).toEqual({});
  expect(Object.keys(state.session!.serialize()).sort()).toEqual(["expanded", "recursive", "workspace"]);
  expect(state.session!.hydrate({ workspace: "/foreign", recursive: false })).toBe(false);
  expect(state.audit).not.toHaveBeenCalled(); expect(state.apply).not.toHaveBeenCalled();
});
it("remembers recursion/collapse per workspace and preserves original shared CAD directory", () => {
  const page = setupPage(); page.recursive = true; page.expanded.audit = false; page.drawing.paper = "A2";
  workspace.value = "/other"; expect(page.recursive).toBe(false); expect(page.expanded.audit).toBe(true); expect(page.drawing.paper).toBe("auto");
  workspace.value = "/example"; expect(page.recursive).toBe(true); expect(page.expanded.audit).toBe(false);
  expect(state.session!.serialize()).toMatchObject({ workspace: "/example", recursive: true });
  expect(state.audit).not.toHaveBeenCalled(); expect(state.apply).not.toHaveBeenCalled();
});
it("defaults new previews to auto paper and renders the actual backend paper, scale and selection reason", async () => {
  const page = setupPage(); expect(page.drawing.paper).toBe("auto"); await page.preview("generation"); expect(state.generation).toHaveBeenCalledWith("/example", expect.objectContaining({ paper: "auto" }), expect.any(AbortSignal));
  const response = syntheticGeneration(); Object.assign(response.rows[0], { paper: "A3", scale: "1:1", contour_line_width_mm: 0.7, dimension_line_width_mm: 0.3, message: "Independent layout fits A3 at 1:1" }); state.generation.mockResolvedValue(response); state.prepare = "generation";
  const html = await render(); expect(html).toContain("A3 · 1:1"); expect(html).toContain("Independent layout fits A3 at 1:1"); expect(html).toContain("本次线宽：轮廓 0.7 mm / 尺寸及界线 0.3 mm"); expect(html).toContain("A1/A0 仅作后备"); expect(html).toContain("明确选择模板时以该模板为准");
  const parsed = parse(fs.readFileSync(new URL("./DrawingBatchPage.vue", import.meta.url), "utf8")); expect(parsed.errors).toEqual([]);
});
it("invalidates a preview on real Tab inactivity and ignores a late response", async () => {
  let resolve!: (value: ReturnType<typeof syntheticAudit>) => void; state.audit.mockReturnValue(new Promise(done => { resolve = done; }));
  const page = setupPage(), pending = page.preview("audit"); await nextTick();
  const signal = state.audit.mock.calls[0][2] as AbortSignal; tab.value = "other-tab"; await nextTick(); expect(signal.aborted).toBe(true);
  resolve(syntheticAudit()); await pending; expect(page.drawing.audit).toBeNull(); expect(state.apply).not.toHaveBeenCalled();
});
it("refresh clears previews only, with no implicit scan or new write", async () => {
  const page = setupPage(); await page.preview("audit"); page.drawing.selectAllAudit(true); state.audit.mockClear();
  await state.session!.refresh!(); expect(page.drawing.audit).toBeNull(); expect(page.drawing.selectedIssues).toEqual({});
  expect(state.audit).not.toHaveBeenCalled(); expect(state.apply).not.toHaveBeenCalled();
});
it("keeps per-file remaining visibility warnings in both result views and opens Bottom", async () => {
  const warning = "仍有未选隐藏元素，需人工确认，未自动修改";
  state.apply.mockResolvedValue(syntheticJob({ status: "completed", completed: 1, results: [{ id: "drawing-a", rel: "demo/ShapeA.Drawing.FCStd", status: "completed", message: "所选问题已修正", warnings: [warning], manual_review_required: true }] }));
  state.prompt.mockResolvedValue({ choiceId: "apply" });
  const page = setupPage(); await page.preview("audit"); page.drawing.selectAllAudit(true); await page.drawing.applyAudit();
  expect(page.drawing.job?.results[0].warnings).toEqual([warning]);
  expect(state.shell.appendLog).toHaveBeenCalledWith(expect.stringContaining(warning), { source: "drawing_batch", open: true });
  const source = fs.readFileSync(new URL("./DrawingBatchPage.vue", import.meta.url), "utf8");
  expect(source.match(/v-for="warning in result.warnings"/g)).toHaveLength(2);
});
