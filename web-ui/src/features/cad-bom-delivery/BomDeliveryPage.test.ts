import fs from "node:fs";
import { parse } from "vue/compiler-sfc";
import { createRenderer, createSSRApp, defineComponent, h, nextTick, onServerPrefetch, ref, toValue } from "vue";
import { renderToString } from "vue/server-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PageSessionApi } from "../../composables/usePageSession";
import type { PagePrimaryContribution } from "../../composables/usePagePrimaryContribution";
const state = vi.hoisted(() => ({
  shell: {} as Record<string, unknown>, session: undefined as PageSessionApi | undefined,
  contribution: undefined as PagePrimaryContribution | undefined,
  prepareRender: false,
  preview: vi.fn(), export: vi.fn(), release: vi.fn(), prompt: vi.fn(),
}));
vi.mock("vue", async original => ({ ...await original<typeof import("vue")>(), useSSRContext: () => ({ modules: new Set<string>() }), onActivated: () => undefined, onDeactivated: () => undefined }));
vi.mock("../../composables/useAppShell", () => ({ useAppShell: () => state.shell }));
vi.mock("../../composables/usePageSession", () => ({ usePageSession: (_id: string, session: PageSessionApi) => { state.session = session; } }));
vi.mock("../../composables/usePagePrimaryContribution", () => ({ usePagePrimaryContribution: (_page: string, _id: string, contribution: PagePrimaryContribution) => {
  state.contribution = contribution;
  // Test-only explicit journey action before SSR. Production page has no prefetch hook.
  if (state.prepareRender) onServerPrefetch(async () => { await toValue(contribution.sections)![0].actions![0].run(); });
} }));
vi.mock("./api", async original => ({ ...await original<typeof import("./api")>(), previewBomDelivery: state.preview, exportBomDelivery: state.export, releaseBomDelivery: state.release }));
vi.mock("phoenix-wing", () => ({ pnwPromptChoice: state.prompt }));
vi.mock("phoenix-wing/layout/PnwPageLayout.vue", async () => {
  const { defineComponent, h } = await import("vue");
  return { default: defineComponent({ setup: (_p, { slots }) => () => h("main", [slots.header?.(), slots.default?.()]) }) };
});
vi.mock("phoenix-wing/layout/PnwPageHeader.vue", async () => {
  const { defineComponent, h } = await import("vue");
  return { default: defineComponent({ props: ["title"], setup: (p, { slots }) => () => h("header", [h("h1", p.title), slots.right?.()]) }) };
});
vi.mock("phoenix-wing/layout/PnwSidebarBlock.vue", async () => {
  const { defineComponent, h } = await import("vue");
  return { default: defineComponent({ props: ["title", "expanded"], setup: (p, { slots }) => () => h("section", [h("header", [h("h2", p.title), slots.suffix?.(), slots.actions?.()]), p.expanded ? slots.default?.() : null]) }) };
});
import BomDeliveryPage from "./BomDeliveryPage.vue";
import { syntheticPreview, syntheticReceipt } from "./fixtures.test-support";
const mounted: Array<{ unmount: () => void }> = [];
const workspace = ref("/example"), activeTab = ref("example-tab");
const button = defineComponent({ name: "ElButton", props: { disabled: Boolean, loading: Boolean }, setup: (p, { slots }) => () => h("button", { disabled: p.disabled }, slots.default?.()) });
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2030-01-01T00:00:00.000Z")); vi.clearAllMocks();
  workspace.value = "/example"; activeTab.value = "example-tab";
  state.shell = { workspacePath: workspace, activeTabId: activeTab, appendLog: vi.fn(), scheduleWorkbenchSave: vi.fn(), openTab: vi.fn(), consumeTabPageState: vi.fn() };
  state.session = undefined; state.contribution = undefined; state.prepareRender = false;
  state.preview.mockResolvedValue(syntheticPreview()); state.export.mockResolvedValue(syntheticReceipt()); state.release.mockResolvedValue(undefined); state.prompt.mockResolvedValue({ choiceId: "export" });
});
afterEach(() => { for (const app of mounted.splice(0)) app.unmount(); vi.useRealTimers(); });
async function render() {
  const wrapper = defineComponent({ setup: () => () => h(BomDeliveryPage, { workbenchTabId: "example-tab" }) });
  const app = createSSRApp(wrapper); app.component("ElButton", button);
  return renderToString(app);
}
type HostNode = { parent: HostNode | null; children: HostNode[] };
const node = (): HostNode => ({ parent: null, children: [] });
function setupPage() {
  type Setup = { delivery: { runPreview: () => Promise<void>; runExport: () => Promise<void>; targetSetting: string; directorySetting: string; preview: unknown; receipt: unknown; canExport: boolean }; expanded: Record<string, boolean> };
  const renderer = createRenderer<HostNode, HostNode>({
    createElement: node, createText: node, createComment: node,
    setText() {}, setElementText() {}, patchProp() {},
    parentNode: el => el.parent, nextSibling: el => el.parent?.children[el.parent.children.indexOf(el) + 1] ?? null,
    insert(el, parent, anchor) {
      if (el.parent) el.parent.children.splice(el.parent.children.indexOf(el), 1);
      el.parent = parent; const index = anchor ? parent.children.indexOf(anchor) : -1;
      parent.children.splice(index < 0 ? parent.children.length : index, 0, el);
    },
    remove(el) { if (el.parent) el.parent.children.splice(el.parent.children.indexOf(el), 1); el.parent = null; },
  });
  // Real SFC setup and Vue mounted lifecycle on a synthetic host. Only drawing
  // is omitted here; the separate SSR tests exercise the actual page template.
  const app = renderer.createApp({ ...BomDeliveryPage, render: () => null }, { workbenchTabId: "example-tab" });
  mounted.push(app); const vm = app.mount(node());
  if (!("setupState" in vm.$)) throw new Error("Expected compiled SFC setup state");
  return vm.$.setupState as Setup;
}
describe("BOM delivery migrated shell and server-owned workflow", () => {
  it("renders the real SFC with all three headers, disabled migration actions, and no automatic preview", async () => {
    const html = await render();
    for (const title of ["BOM交付", "1. 预检与导出", "2. 推送与审核", "3. 历史与重试", "迁移中 · 未开放"]) expect(html).toContain(title);
    expect(html).toContain("不自动扫描或创建目录"); expect(html).toContain("整个工作空间");
    const buttons = [...html.matchAll(/<button([^>]*)>([\s\S]*?)<\/button>/g)].map(match => ({ disabled: /\sdisabled(?:\s|$)/.test(match[1]), label: match[2].replace(/<[^>]*>/g, "").trim() }));
    expect(buttons).toContainEqual({ disabled: true, label: "推送" }); expect(buttons).toContainEqual({ disabled: true, label: "重试推送" });
    expect(state.preview).not.toHaveBeenCalled(); expect(state.export).not.toHaveBeenCalled();
  });
  it("registers explicit Primary scope/actions/progress without borrowing batch tool navigation", async () => {
    await render();
    const c = state.contribution!;
    expect(c.title).toBe("BOM交付");
    const sections = toValue(c.sections)!;
    expect(sections.map(section => section.id)).toEqual(["scope", "help"]);
    expect(sections[0].actions?.map(action => action.id)).toEqual(["preview", "export", "cancel", "index"]);
  });
  it("renders escaped preview metadata and at most 50 BOM hosts and 50 direct items per page", async () => {
    const value = syntheticPreview();
    const parent = value.envelope.boms[0];
    state.preview.mockResolvedValue({ ...value, envelope: { ...value.envelope,
      boms: Array.from({ length: 51 }, (_, i) => ({ ...parent, bomKey: `example-host-${i}`, name: `<script>host-${i}</script>`, items: Array.from({ length: 51 }, (_, j) => ({ ...parent.items[0], partNo: `example-item-${j}` })) })),
    } });
    state.prepareRender = true;
    const html = await render();
    expect(html).toContain(value.envelope.transferId); expect(html).toContain(value.envelope.payloadHash);
    expect(html).toContain("51 直接 BOM"); expect(html).toContain("每页 50"); expect(html).toContain("直接数量 qty（非递归）");
    expect(html).toContain("example-host-49"); expect(html).not.toContain("example-host-50"); expect(html).toContain("example-item-49"); expect(html).not.toContain("example-item-50");
    expect(html).toContain("&lt;script&gt;"); expect(html).not.toContain("<script>"); expect(state.export).not.toHaveBeenCalled();
  });
  it("stores only workspace target/directory/collapse, rejecting another workspace and ignoring injected handles", async () => {
    const page = setupPage(); await page.delivery.runPreview(); await page.delivery.runExport();
    page.delivery.targetSetting = "/example/result.json"; page.delivery.directorySetting = "/output"; page.expanded.push = true;
    const snapshot = state.session!.serialize();
    expect(Object.keys(snapshot).sort()).toEqual(["directory", "expanded", "target", "workspace"]);
    expect(JSON.stringify(snapshot)).not.toContain(syntheticPreview().preview_id); expect(JSON.stringify(snapshot)).not.toContain("payloadHash"); expect(JSON.stringify(snapshot)).not.toContain("receipt");
    expect(state.session!.hydrate({ ...snapshot, workspace: "/other" })).toBe(false);
    expect(state.session!.hydrate({ ...snapshot, preview_id: syntheticPreview().preview_id, envelope: syntheticPreview().envelope })).toBe(true);
    expect(state.session!.serialize()).toEqual(snapshot); expect(state.session!.isDirty()).toBe(false);
    expect(state.prompt.mock.calls[0][0]).toMatchObject({ defaultChoiceId: "cancel", title: "确认离线 BOM 导出" });
    expect(state.prompt.mock.calls[0][0].message).toContain("不覆盖已有不同内容");
  });
  it("consumes this tab's saved settings once on real mount without previewing, exporting or restoring forged handles", async () => {
    const consume = state.shell.consumeTabPageState as ReturnType<typeof vi.fn>;
    consume.mockReturnValue({ workspace: "/example", target: "/example/restored.json", directory: "/output", expanded: { preflight: false, push: true, history: true }, preview_id: syntheticPreview().preview_id, preview: syntheticPreview(), envelope: syntheticPreview().envelope, receipt: syntheticReceipt() });
    const page = setupPage(); await nextTick();
    expect(consume).toHaveBeenCalledExactlyOnceWith("example-tab");
    expect(page.delivery.targetSetting).toBe("/example/restored.json"); expect(page.delivery.directorySetting).toBe("/output");
    expect(page.expanded).toEqual({ preflight: false, push: true, history: true });
    expect(page.delivery.preview).toBeNull(); expect(page.delivery.receipt).toBeNull(); expect(page.delivery.canExport).toBe(false);
    expect(state.preview).not.toHaveBeenCalled(); expect(state.export).not.toHaveBeenCalled(); expect(state.release).not.toHaveBeenCalled();
    activeTab.value = "other-tab"; await nextTick(); activeTab.value = "example-tab"; await nextTick(); expect(consume).toHaveBeenCalledTimes(1);
  });
  it("rejects another workspace's mounted settings and all injected handles", async () => {
    const consume = state.shell.consumeTabPageState as ReturnType<typeof vi.fn>;
    consume.mockReturnValue({ workspace: "/other", target: "/other/not-restored.json", directory: "/foreign-output", expanded: { preflight: false, push: true, history: true }, preview: syntheticPreview(), receipt: syntheticReceipt() });
    const page = setupPage(); await nextTick();
    expect(page.delivery.targetSetting).toBe(""); expect(page.delivery.directorySetting).toBe(""); expect(page.expanded).toEqual({ preflight: true, push: false, history: false });
    expect(page.delivery.preview).toBeNull(); expect(page.delivery.receipt).toBeNull(); expect(state.preview).not.toHaveBeenCalled(); expect(state.export).not.toHaveBeenCalled(); expect(state.release).not.toHaveBeenCalled();
  });
  it("respects the public prompt result object; decline cannot export", async () => {
    state.prompt.mockResolvedValue({ choiceId: "cancel" }); const page = setupPage(); await page.delivery.runPreview(); await page.delivery.runExport(); expect(state.export).not.toHaveBeenCalled();
  });
  it("remembers block collapse only within each workspace", () => {
    const page = setupPage(); page.expanded.push = true; page.expanded.preflight = false;
    workspace.value = "/other"; expect(page.expanded).toEqual({ preflight: true, push: false, history: false });
    workspace.value = "/example"; expect(page.expanded).toEqual({ preflight: false, push: true, history: false }); expect(state.preview).not.toHaveBeenCalled();
  });
  it("parses the SFC and binds three collapsible Wing blocks with header-right actions", () => {
    const source = fs.readFileSync(new URL("./BomDeliveryPage.vue", import.meta.url), "utf8"), parsed = parse(source);
    expect(parsed.errors).toEqual([]); expect(parsed.descriptor.template).toBeTruthy();
    expect(source.match(/<WingBlock /g)).toHaveLength(3); expect(source.match(/<template #actions>/g)).toHaveLength(3);
    for (const key of ["preflight", "push", "history"]) expect(source).toContain(`v-model:expanded="expanded.${key}"`);
    expect(source).toContain("const pageSize = 50"); expect(source).toContain("直接数量 qty（非递归）");
    expect(source).not.toMatch(/v-html|localStorage|switchWorkspace|cadBatchToolsSection/);
    expect(source).toContain("Desk producer 接收端尚待适配，推送/历史重试未开放");
  });
});
