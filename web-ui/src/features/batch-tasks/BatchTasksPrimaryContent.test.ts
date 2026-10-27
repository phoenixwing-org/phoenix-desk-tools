import fs from "node:fs";
import { createSSRApp, defineComponent, h } from "vue";
import { renderToString } from "vue/server-renderer";
import { describe, expect, it, vi } from "vitest";
import { parse } from "vue/compiler-sfc";
import BatchTasksPrimaryContent from "./BatchTasksPrimaryContent.vue";
import { syntheticTask } from "./fixtures.test-support";

function props() {
  return {
    tasks: [syntheticTask(), syntheticTask({ id: "archived", name: "Independent archived task", archived: true, revision: 2 })],
    selectedTaskId: "task-a", busy: false, showArchived: false,
    onShowArchived: vi.fn(), onSelectTask: vi.fn(), onNew: vi.fn(), onDuplicate: vi.fn(),
    steps: [
      { id: "definition", title: "任务定义", description: "明确文件与动作", state: "current" as const },
      { id: "preview", title: "点检预览", description: "还没有预览时也可定位并查看说明", state: "pending" as const },
      { id: "results", title: "运行结果", description: "查看记录，不自动运行", state: "ready" as const },
    ],
    onNavigate: vi.fn(), onRefresh: vi.fn(), onBackup: vi.fn(),
  };
}
async function render(p: ReturnType<typeof props> & Record<string, unknown>) {
  return renderToString(createSSRApp(defineComponent({ setup: () => () => h(BatchTasksPrimaryContent, p) })));
}

describe("batch task Primary — saved selection and navigation only", () => {
  it("renders saved task cards, current selection and two strip blocks without doing any work", async () => {
    const p = props(), html = await render(p);
    for (const text of ["已保存任务", "独立合成任务", "1 个文件", "1 个动作", "r1", "流程导航", "新建", "复制", "刷新", "备份", "仅导航，不保存或执行任务"]) expect(html).toContain(text);
    expect(html).not.toContain("Independent archived task");
    expect(html).toMatch(/class="task-card selected"[^>]*aria-current="true"/);
    expect(html.match(/pnw-sidebar-block--strip/g)).toHaveLength(2);
    for (const callback of [p.onNew, p.onDuplicate, p.onSelectTask, p.onNavigate, p.onRefresh, p.onBackup, p.onShowArchived]) expect(callback).not.toHaveBeenCalled();
  });

  it("filters archived tasks only for display and never changes the task snapshots", async () => {
    const p = props(), before = JSON.stringify(p.tasks);
    const html = await render({ ...p, showArchived: true });
    expect(html).toContain("Independent archived task"); expect(html).toContain("已归档");
    expect(html).toMatch(/type="checkbox"[^>]*checked/);
    expect(html.match(/class="task-card/g)).toHaveLength(2);
    expect(JSON.stringify(p.tasks)).toBe(before); expect(p.onShowArchived).not.toHaveBeenCalled();
  });

  it("leaves all navigation steps available even when pending or the parent is busy", async () => {
    const p = props(), html = await render({ ...p, busy: true });
    const navigation = [...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)].filter(match => match[1].includes("step-link"));
    expect(navigation).toHaveLength(3);
    for (const match of navigation) expect(match[1]).not.toMatch(/\bdisabled(?:[\s=>]|$)/);
    expect(navigation[0][1]).toContain('aria-current="step"');
    expect(navigation[1][1]).toContain("step-pending");
    expect(navigation[1][2]).toContain("待准备");
    expect(html).toMatch(/class="task-card selected"[^>]*disabled/);
    expect(p.onNavigate).not.toHaveBeenCalled();
  });

  it("escapes untrusted task names and step descriptions in both text and attributes", async () => {
    const p = props(); p.tasks[0].name = '<script>untrusted task</script>';
    p.steps[0].title = '<img src=x onerror="bad()">';
    p.steps[0].description = '\" autofocus onfocus=\"bad() <script>step</script>';
    const html = await render(p);
    expect(html).toContain("&lt;script&gt;untrusted task&lt;/script&gt;");
    expect(html).toContain("&lt;img src=x onerror=&quot;bad()&quot;&gt;");
    expect(html).toContain("&lt;script&gt;step&lt;/script&gt;");
    expect(html).not.toContain("<script>"); expect(html).not.toContain("<img src=x");
    expect(html).not.toMatch(/title="" autofocus/);
  });

  it("renders empty state and disables saved-task duplication when nothing is selected", async () => {
    const p = props(), html = await render({ ...p, tasks: [], selectedTaskId: "" });
    expect(html).toContain("还没有已保存任务");
    expect(html).toMatch(/<button[^>]*disabled[^>]*>复制<\/button>/);
    expect(html).not.toContain('aria-label="已保存任务列表"');
  });

  it("projects monitor information without gaining execution or cancellation authority", async () => {
    const p = props(), openMonitor = vi.fn();
    const html = await render({ ...p, progress: { label: "Independent read-only run", state: "running", completed: 1, total: 3, detail: "Waiting for receipt" }, onOpenMonitor: openMonitor });
    for (const text of ["Independent read-only run", "Waiting for receipt", "任务监控"]) expect(html).toContain(text);
    expect(openMonitor).not.toHaveBeenCalled();
    const plain = await render(p); expect(plain).not.toContain("primary-monitor");
  });

  it("keeps source dependencies presentational and explicitly overrides Wing's full-height block defaults", () => {
    const source = fs.readFileSync(new URL("./BatchTasksPrimaryContent.vue", import.meta.url), "utf8");
    expect(parse(source).errors).toEqual([]);
    expect(source.match(/<WingBlock\b/g)).toHaveLength(2);
    expect(source.match(/variant="strip"/g)).toHaveLength(2);
    expect(source.match(/height: 'auto', flex: 'none'/g)).toHaveLength(2);
    expect(source).toContain(".pnw-sidebar-block-body){height:auto!important;flex:none!important");
    expect(source).toContain('@click="onNavigate(step.id)"');
    expect(source).toContain('@click="onSelectTask(task)"');
    expect(source).not.toMatch(/from ["'][^"']*(?:application|service|api|controller)["']/);
    expect(source).not.toMatch(/v-html|\bfetch\s*\(|\badmit\s*\(|\bcancel\s*\(/);
  });
});
