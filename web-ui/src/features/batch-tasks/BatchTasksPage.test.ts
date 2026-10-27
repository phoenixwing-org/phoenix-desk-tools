import fs from "node:fs";
import { createSSRApp, defineComponent, h, toValue } from "vue";
import { renderToString } from "vue/server-renderer";
import { createPinia } from "pinia";
import { beforeEach, expect, it, vi } from "vitest";
import { parse } from "vue/compiler-sfc";
import { createBatchTasksController, type BatchTasksController } from "./controller";
import type { BatchTasksApi } from "./api";
import type { PagePrimaryContribution } from "../../composables/usePagePrimaryContribution";
import { syntheticAction, syntheticMixedPlan, syntheticNativePlan, syntheticPlan, syntheticRun, syntheticTask } from "./fixtures.test-support";
const state = vi.hoisted(() => ({ controller: undefined as unknown as BatchTasksController, contribution: undefined as PagePrimaryContribution | undefined, open: vi.fn() }));
vi.mock("./application", async () => { const { ref } = await import("vue"); return { batchTasksController: new Proxy({}, { get: (_target, key) => Reflect.get(state.controller, key) }), openBatchTasksTool: state.open, batchTasksAutoMonitorEnabled: ref(true), setBatchTasksAutoMonitorEnabled: vi.fn() }; });
vi.mock("../../composables/usePagePrimaryContribution", () => ({ usePagePrimaryContribution: (_page: string, _tab: string | undefined, contribution: PagePrimaryContribution) => { state.contribution = contribution; } }));
vi.mock("phoenix-wing/layout/PnwPageLayout.vue", async () => { const { defineComponent, h } = await import("vue"); return { default: defineComponent({ setup: (_p, { slots }) => () => h("main", [slots.header?.(), slots.default?.()]) }) }; });
vi.mock("phoenix-wing/layout/PnwPageHeader.vue", async () => { const { defineComponent, h } = await import("vue"); return { default: defineComponent({ props: ["title"], setup: (p, { slots }) => () => h("header", [h("h1", p.title), slots.center?.(), slots.right?.()]) }) }; });
import BatchTasksPage from "./BatchTasksPage.vue";
let api: BatchTasksApi;
beforeEach(async () => {
  api = { actions: vi.fn().mockResolvedValue({ actions: [syntheticAction()] }), tasks: vi.fn().mockResolvedValue({ tasks: [syntheticTask()] }), runs: vi.fn().mockResolvedValue({ runs: [syntheticRun({ status: "cancel_requested", cancel_requested: true })] }), save: vi.fn(), archive: vi.fn(), preview: vi.fn(), admit: vi.fn(), detail: vi.fn(), cancel: vi.fn(), byRequest: vi.fn(), backup: vi.fn(), retryDrafts: vi.fn().mockResolvedValue({ run_id: "run-a", groups: [] }) };
  state.controller = createBatchTasksController(api); state.controller.setWorkspace("/independent-workspace");
  for (let index = 0; index < 8; index++) await Promise.resolve();
});
async function render() { const app = createSSRApp(defineComponent({ setup: () => () => h(BatchTasksPage, { workbenchTabId: "batch-tab" }) })); app.use(createPinia()); return renderToString(app); }
it("renders the real management view and declares a Primary without automatic execution", async () => {
  const html = await render();
  for (const text of ["批量任务详情", "保存定义", "准备运行 / 预览", "关闭显示不取消", "已请求取消", "等待安全边界", "运行与历史", "最多 200 个"]) expect(html).toContain(text);
  expect(api.admit).not.toHaveBeenCalled(); expect(api.cancel).not.toHaveBeenCalled(); expect(state.contribution?.title).toBe("批量任务管理");
  const source = fs.readFileSync(new URL("./BatchTasksPage.vue", import.meta.url), "utf8"); expect(parse(source).errors).toEqual([]); expect(source).not.toMatch(/onUnmounted|onDeactivated|v-html|invokeTauri/);
});
it("renders escaped object/action results and keeps cancellation distinct", async () => {
  state.controller.state.detail = { run: syntheticRun({ status: "partial" }), steps: [{ id: "step-a", run_id: "run-a", item_id: "item-a", subject: { kind: "file", rel: "samples/note.txt" }, action_instance_id: "action-a", action_key: "file.metadata", status: "succeeded", result: { text: "<script>independent</script>" } }], events: [] };
  const html = await render(); expect(html).toContain("步骤明细（文件 / 整批）"); expect(html).toContain("部分完成"); expect(html).toContain("&lt;script&gt;independent&lt;/script&gt;"); expect(html).not.toContain("<script>");
});
it("renders actual V2 file/batch steps, blocked reasons and frozen metadata instead of N times M", async () => {
  state.controller.state.plan = syntheticMixedPlan(true);
  state.controller.state.actions.push({ ...syntheticAction(), key: "synthetic.compare-cache", title: "当前目录标题", scope: "batch", version: 9, effects: ["read_file", "read_cache", "write_task_db"], algorithm_version: "current-not-frozen" });
  const html = await render();
  for (const text of ["文件步骤 2", "整批步骤 1", "就绪 2", "阻塞 1", "实际冻结步骤（3）", "整批 2 文件", "缓存快照不可用", "synthetic.compare-cache@2", "结果 v3", "frozen-compare-v2", "自有临时读锁", "freshness: unverified", "不回收已有锁"]) expect(html).toContain(text);
  expect(html).not.toContain("2 文件 × 2 动作"); expect(api.admit).not.toHaveBeenCalled();
});
it("renders V2 whole-batch subjects without a fake first-file subject alongside old V1 history", async () => {
  state.controller.state.detail = { run: syntheticRun({ status: "partial" }), events: [], steps: [
    { id: "old-file", run_id: "run-a", item_id: "old-item", subject: { kind: "file", rel: "legacy/note.txt" }, action_instance_id: "legacy", action_key: "file.metadata", status: "succeeded" },
    { id: "batch", run_id: "run-a", scope: "batch", item_ids: ["one", "two"], subjects: [{ kind: "cad_model", rel: "selected/First.FCStd" }, { kind: "cad_model", rel: "selected/Second.FCStd" }], action_instance_id: "compare", action_key: "synthetic.compare-cache", status: "blocked", message: "缓存无法核对", result: { freshness: "unverified" } },
  ] };
  const html = await render(); for (const text of ["legacy/note.txt", "整批 2 文件", "selected/First.FCStd", "selected/Second.FCStd", "已阻塞", "缓存新鲜度：unverified"]) expect(html).toContain(text);
});
it("does not render unavailable V2 fingerprints or sizes as empty SHA or zero bytes", async () => {
  state.controller.state.plan = syntheticPlan(true); const html = await render();
  expect(html).toContain("大小未知"); expect(html).toContain("未取得源文件指纹"); expect(html).toContain("已阻塞"); expect(html).not.toContain("0 bytes");
});
it("offers only lookup for a legacy admission pointer", async () => {
  state.controller.state.admission = { plan_id: "legacy-plan", digest: "old-digest", client_request_id: "old-request", confirmed: true };
  const html = await render(); expect(html).toContain("旧版指针仅用于核对原运行"); expect(html).toContain("核对原请求"); expect(html).not.toContain("按原请求重试接纳");
});
it("renders pure V3 effects and blocked read-only steps with admission disabled even for a fresh executable-looking wrapper", async () => {
  state.controller.state.plan = syntheticNativePlan();
  expect(state.controller.busy.value).toBe(false); expect(state.controller.dirty.value).toBe(false); expect(state.controller.state.admission).toBeNull();
  const html = await render();
  for (const text of ["Native V3 试点预览", "当前页面仅供只读查看，不授予执行权", "历史与预览数据不授予执行或终止进程权限", "自有 Native 只读进程", "写自有临时目录（实际关闭后清理）", "实际冻结步骤（1）", "已阻塞", "Native V3 试点仅供只读查看；当前页面未开放执行", "samples/IndependentSaved.FCStd"]) expect(html).toContain(text);
  const confirm = [...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)].find(match => match[2].includes("确认只读范围并加入队列"));
  expect(confirm).toBeTruthy(); expect(confirm![1]).toMatch(/\bdisabled(?:[\s=>]|$)/);
  expect(api.admit).not.toHaveBeenCalled(); expect(api.cancel).not.toHaveBeenCalled(); expect(state.controller.state.plan.protocol_version).toBe(3);
});
it("renders the input basket, explicit action order and collapsible block header actions", async () => {
  const html = await render();
  for (const text of ["待选文件", "自动监控", "执行顺序", "↑ 上移", "↓ 下移", "1. 任务定义", "3. 运行与历史", "只看问题项", "失败/中断项再试"]) expect(html).toContain(text);
  const source = fs.readFileSync(new URL("./BatchTasksPage.vue", import.meta.url), "utf8");
  expect(source.match(/<WingBlock\b/g)).toHaveLength(3);
  expect(source.match(/<template #actions>/g)).toHaveLength(3);
  expect(api.save).not.toHaveBeenCalled(); expect(api.admit).not.toHaveBeenCalled();
});
it("keeps Save / Check / Run in the fixed view header and moves task navigation into Primary", async () => {
  const html = await render();
  const header = html.match(/<header\b[\s\S]*?<\/header>/)?.[0] || "";
  for (const label of ["保存", "点检", "运行"]) expect(header).toMatch(new RegExp(`>${label}<`));
  const source = fs.readFileSync(new URL("./BatchTasksPage.vue", import.meta.url), "utf8");
  const headerTemplate = source.match(/<PageHeader\b[\s\S]*?<\/PageHeader>/)?.[0] || "";
  expect(headerTemplate).toContain('<template #right>');
  expect(headerTemplate).not.toContain('<template #actions>');
  expect(html).not.toContain('class="task-list"');
  const content = state.contribution?.content;
  expect(content?.component).toBeTruthy();
  const props = toValue(content!.props!);
  expect(props.tasks).toEqual(state.controller.state.tasks);
  expect(props.steps).toEqual(expect.arrayContaining([expect.objectContaining({ id: "definition" }), expect.objectContaining({ id: "preview" }), expect.objectContaining({ id: "history" })]));
  expect(typeof props.onNavigate).toBe("function");
  expect(api.admit).not.toHaveBeenCalled();
});
it("uses natural-height Main blocks rather than the sidebar's 100-percent fill layout", async () => {
  const source = fs.readFileSync(new URL("./BatchTasksPage.vue", import.meta.url), "utf8");
  expect(parse(source).errors).toEqual([]);
  expect(source).toMatch(/\.batch-tasks-page \.task-flow-block\.pnw-sidebar-block\s*\{[^}]*height:\s*auto;[^}]*flex:\s*0 0 auto/);
  expect(source).toMatch(/\.task-flow-block :deep\(\.pnw-sidebar-block-body\)\s*\{[^}]*flex:\s*0 0 auto/);
});
it("lets Primary steps locate any section without saving, checking or running", async () => {
  await render();
  const props = toValue(state.contribution!.content!.props!);
  const navigate = props.onNavigate as (id: string) => Promise<void>;
  for (const id of ["preview", "history", "definition"]) await navigate(id);
  expect(api.save).not.toHaveBeenCalled(); expect(api.preview).not.toHaveBeenCalled(); expect(api.admit).not.toHaveBeenCalled();
  expect(api.cancel).not.toHaveBeenCalled(); expect(state.controller.state.notice).toContain("尚无点检预览");
});
it("offers grouped retry drafts without rendering a direct retry execution button", async () => {
  state.controller.state.detail = { run: syntheticRun({ status: "partial" }), events: [], steps: [{ id: "failed", run_id: "run-a", item_id: "one", subject: { kind: "file", rel: "samples/note.txt" }, action_instance_id: "action-a", action_key: "file.metadata", status: "failed", message: "source changed" }] };
  state.controller.state.retryRunId = "run-a";
  state.controller.state.retryGroups = [{ id: "action-a", action_instance_id: "action-a", action_key: "file.metadata", action_title: "文件基本信息", action_version: 1, scope: "file", failed_steps: 1, available: true, draft: { name: "重新核对", subjects: [{ kind: "file", rel: "samples/note.txt" }], actions: syntheticTask().actions } }];
  const html = await render();
  for (const text of ["失败项重试候选", "载入重试草稿", "必须保存、重新预览并再次确认", "不会重跑原运行的成功项"]) expect(html).toContain(text);
  expect(api.retryDrafts).not.toHaveBeenCalled(); expect(api.save).not.toHaveBeenCalled(); expect(api.admit).not.toHaveBeenCalled();
});
