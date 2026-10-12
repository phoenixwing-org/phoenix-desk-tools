import fs from "node:fs";
import { parse } from "vue/compiler-sfc";
import { createRenderer, createSSRApp, defineComponent, h, nextTick, onServerPrefetch, ref, toValue } from "vue";
import { renderToString } from "vue/server-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../api";
import type { PageSessionApi } from "../../composables/usePageSession";
import type { PagePrimaryContribution } from "../../composables/usePagePrimaryContribution";
const state = vi.hoisted(() => ({ shell: {} as Record<string, unknown>, session: undefined as PageSessionApi | undefined, contribution: undefined as PagePrimaryContribution | undefined, prepare: "" as "" | "inspect" | "backup" | "restore", inspect: vi.fn(), backup: vi.fn(), restore: vi.fn(), release: vi.fn(), prompt: vi.fn() }));
vi.mock("vue", async original => ({ ...await original<typeof import("vue")>(), useSSRContext: () => ({ modules: new Set<string>() }), onActivated: () => undefined, onDeactivated: () => undefined }));
vi.mock("../../composables/useAppShell", () => ({ useAppShell: () => state.shell }));
vi.mock("../../composables/usePageSession", () => ({ usePageSession: (_id: string, session: PageSessionApi) => {
  state.session = session;
  // Explicit test-only user journey before SSR. The production page has no API prefetch.
  if (state.prepare) onServerPrefetch(async () => {
    await session.hydrate({ workspace: "/synthetic-workspace", backupTarget: "/local-output/backup-set", backupDirectory: "/local-output/backup-set", restoreTarget: "/local-output/restored-workspace" });
    const actions = toValue(state.contribution!.sections)![0].actions!;
    if (state.prepare === "backup") await actions[0].run();
    else { await actions[1].run(); if (state.prepare === "restore") await actions[2].run(); }
  });
} }));
vi.mock("../../composables/usePagePrimaryContribution", () => ({ usePagePrimaryContribution: (_page: string, _id: string, contribution: PagePrimaryContribution) => { state.contribution = contribution; } }));
vi.mock("./api", async original => ({ ...await original<typeof import("./api")>(), inspectWorkspaceRecovery: state.inspect, backupWorkspaceRecovery: state.backup, restoreWorkspaceRecovery: state.restore, releaseWorkspaceRecovery: state.release }));
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
import WorkspaceRecoveryPage from "./WorkspaceRecoveryPage.vue";
import { deferred, syntheticBackupReceipt, syntheticBackupTarget, syntheticInspection, syntheticRestoreReceipt, syntheticRestoreTarget, syntheticWorkspace } from "./fixtures.test-support";
const workspace = ref(syntheticWorkspace), activeTab = ref("synthetic-tab"), mounted: Array<{ unmount: () => void }> = [];
const button = defineComponent({ name: "ElButton", props: { disabled: Boolean, loading: Boolean }, setup: (p, { slots }) => () => h("button", { disabled: p.disabled }, slots.default?.()) });
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2030-01-01T00:00:00.000Z")); vi.clearAllMocks();
  workspace.value = syntheticWorkspace; activeTab.value = "synthetic-tab";
  state.shell = { workspacePath: workspace, activeTabId: activeTab, appendLog: vi.fn(), scheduleWorkbenchSave: vi.fn(), consumeTabPageState: vi.fn() };
  state.session = undefined; state.contribution = undefined; state.prepare = "";
  state.inspect.mockResolvedValue(syntheticInspection()); state.backup.mockResolvedValue(syntheticBackupReceipt()); state.restore.mockResolvedValue(syntheticRestoreReceipt()); state.release.mockResolvedValue(undefined); state.prompt.mockImplementation(async request => ({ choiceId: request.choices[0].id }));
});
afterEach(() => { for (const app of mounted.splice(0)) app.unmount(); vi.useRealTimers(); });
async function render() {
  const wrapper = defineComponent({ setup: () => () => h(WorkspaceRecoveryPage, { workbenchTabId: "synthetic-tab" }) });
  const app = createSSRApp(wrapper); app.component("ElButton", button); return renderToString(app);
}
type HostNode = { parent: HostNode | null; children: HostNode[] };
const node = (): HostNode => ({ parent: null, children: [] });
function setupPage() {
  type Setup = { recovery: { runBackup: () => Promise<void>; runInspect: () => Promise<void>; runRestore: () => Promise<void>; backupTarget: string; backupDirectory: string; restoreTarget: string; inspection: unknown; outcome: unknown; status: string; error: string; canRestore: boolean }; expanded: Record<string, boolean> };
  const renderer = createRenderer<HostNode, HostNode>({ createElement: node, createText: node, createComment: node, setText() {}, setElementText() {}, patchProp() {}, parentNode: el => el.parent, nextSibling: el => el.parent?.children[el.parent.children.indexOf(el) + 1] ?? null,
    insert(el, parent, anchor) { if (el.parent) el.parent.children.splice(el.parent.children.indexOf(el), 1); el.parent = parent; const index = anchor ? parent.children.indexOf(anchor) : -1; parent.children.splice(index < 0 ? parent.children.length : index, 0, el); },
    remove(el) { if (el.parent) el.parent.children.splice(el.parent.children.indexOf(el), 1); el.parent = null; },
  });
  const app = renderer.createApp({ ...WorkspaceRecoveryPage, render: () => null }, { workbenchTabId: "synthetic-tab" }); mounted.push(app); const vm = app.mount(node());
  if (!("setupState" in vm.$)) throw new Error("Expected compiled SFC setup state"); return vm.$.setupState as Setup;
}
type AstNode = { type: number; tag?: string; props?: Array<{ type: number; name: string; value?: { content: string }; arg?: { content: string }; exp?: { content: string } }>; children?: AstNode[] };
function elements(source: string) {
  const parsed = parse(source); if (parsed.errors.length || !parsed.descriptor.template?.ast) throw new Error("Invalid complete SFC template");
  const output: AstNode[] = [];
  const visit = (item: AstNode) => { if (item.type === 1) output.push(item); for (const child of item.children ?? []) visit(child); };
  visit(parsed.descriptor.template.ast as unknown as AstNode); return output;
}
function checkBlockContract(source: string): boolean {
  const nodes = elements(source), blocks = nodes.filter(n => n.tag === "WingBlock");
  return blocks.length === 3 && blocks.every((block, index) => {
    const key = ["backup", "restore", "results"][index], title = ["1. 当前库备份", "2. 检查与新目录恢复", "3. 结果与说明"][index];
    return block.props?.some(p => p.name === "title" && p.value?.content === title)
      && block.props?.some(p => p.name === "model" && p.arg?.content === "expanded" && p.exp?.content === `expanded.${key}`)
      && block.children?.some(child => child.tag === "template" && child.props?.some(p => p.name === "slot" && p.arg?.content === "actions"));
  });
}
describe("workspace recovery real SFC and shell lifecycle", () => {
  it("renders all three blocks, safe scope and no automatic API or write on entry", async () => {
    const html = await render(); for (const label of ["备份与恢复", "1. 当前库备份", "2. 检查与新目录恢复", "3. 结果与说明", "新目录名", "选择父目录", "选择已有目录", "不是整工程归档", "私人内容", "不激活", "不会自动重试"]) expect(html).toContain(label);
    expect(html).toContain("尚无有效检查"); for (const fn of [state.inspect, state.backup, state.restore, state.release]) expect(fn).not.toHaveBeenCalled();
  });
  it("registers real Primary actions, current-workspace scope and stage progress", async () => {
    await render(); const contribution = state.contribution!, sections = toValue(contribution.sections)!;
    expect(contribution.title).toBe("备份与恢复"); expect(sections.map(v => v.id)).toEqual(["recovery", "help"]); expect(sections[0].actions?.map(v => v.id)).toEqual(["backup", "inspect", "restore", "cancel"]);
    expect(toValue(sections[0].progress)?.stages).toEqual(["选择 / 检查", "确认", "写入新目录"]); expect(toValue(sections[0].controls![0].kind === "readonly" ? sections[0].controls![0].value : "")).toBe(syntheticWorkspace);
  });
  it("renders server inspection hash/counts/schema/expiry without client proof or automatic restoration", async () => {
    state.prepare = "inspect"; const html = await render(); for (const value of [syntheticInspection().manifest_sha256, syntheticInspection().expires_at, "2 文件", "2 目录", "128 bytes", "77"]) expect(html).toContain(value);
    expect(state.inspect).toHaveBeenCalledTimes(1); expect(state.restore).not.toHaveBeenCalled(); expect(state.backup).not.toHaveBeenCalled();
  });
  it("renders confirmed receipt warnings as escaped text, rather than claiming failure or executing HTML", async () => {
    state.prepare = "backup"; state.backup.mockResolvedValue({ ...syntheticBackupReceipt(), warnings: ["<script>warning</script>"] }); const html = await render();
    expect(html).toContain("最近已确认回执：备份完成"); expect(html).toContain("&lt;script&gt;warning&lt;/script&gt;"); expect(html).not.toContain("<script>"); expect(html).toContain(syntheticBackupTarget);
    expect(state.shell.appendLog).toHaveBeenLastCalledWith(expect.stringContaining("warning"), { source: "workspace_recovery", open: true });
  });
  it("renders explicit incomplete-directory errors and opens Bottom instead of offering successful restoration", async () => {
    state.prepare = "restore"; state.restore.mockRejectedValue(new ApiError("Marker conflict", 409, { code: "conflict", incompleteDirectory: syntheticRestoreTarget })); const html = await render();
    expect(html).toContain("未完成目录"); expect(html).toContain(syntheticRestoreTarget); expect(html).toContain("缺少完成 marker 不算成功"); expect(html).not.toContain("最近已确认回执：隔离恢复完成");
    expect(state.shell.appendLog).toHaveBeenLastCalledWith(expect.stringContaining("未完成目录"), { source: "workspace_recovery", open: true });
  });
  it("consumes this Tab configuration once on mounted lifecycle, never revives forged inspections, confirmations or receipts", async () => {
    const consume = state.shell.consumeTabPageState as ReturnType<typeof vi.fn>;
    consume.mockReturnValue({ workspace: syntheticWorkspace, backupTarget: syntheticBackupTarget, backupDirectory: syntheticBackupTarget, restoreTarget: syntheticRestoreTarget, expanded: { backup: false, restore: true, results: false }, inspection: syntheticInspection(), manifest: { private: "not-restored" }, receipt: syntheticRestoreReceipt(), confirmed: true });
    const page = setupPage(); await nextTick(); expect(consume).toHaveBeenCalledExactlyOnceWith("synthetic-tab"); expect(page.recovery.backupTarget).toBe(syntheticBackupTarget); expect(page.recovery.restoreTarget).toBe(syntheticRestoreTarget); expect(page.expanded).toEqual({ backup: false, restore: true, results: false });
    expect(page.recovery.inspection).toBeNull(); expect(page.recovery.outcome).toBeNull(); expect(page.recovery.canRestore).toBe(false);
    expect(Object.keys(state.session!.serialize()).sort()).toEqual(["backupDirectory", "backupTarget", "expanded", "restoreTarget", "workspace"]);
    for (const fn of [state.inspect, state.backup, state.restore, state.release]) expect(fn).not.toHaveBeenCalled(); activeTab.value = "another-tab"; await nextTick(); activeTab.value = "synthetic-tab"; await nextTick(); expect(consume).toHaveBeenCalledTimes(1);
  });
  it("rejects another workspace's mounted settings, then remembers paths and collapse only per current workspace", async () => {
    (state.shell.consumeTabPageState as ReturnType<typeof vi.fn>).mockReturnValue({ workspace: "/foreign", backupTarget: "/foreign-backup", inspection: syntheticInspection() }); const page = setupPage();
    expect(page.recovery.backupTarget).toBe(""); page.recovery.backupTarget = syntheticBackupTarget; page.expanded.restore = false; workspace.value = "/other-workspace";
    expect(page.recovery.backupTarget).toBe(""); expect(page.expanded.restore).toBe(true); workspace.value = syntheticWorkspace;
    expect(page.recovery.backupTarget).toBe(syntheticBackupTarget); expect(page.expanded.restore).toBe(false); expect(page.recovery.inspection).toBeNull(); expect(state.inspect).not.toHaveBeenCalled(); await nextTick(); expect(state.shell.scheduleWorkbenchSave).toHaveBeenCalled();
  });
  it("backup and restore confirmations use Wing default-cancel and the public choiceId result", async () => {
    const page = setupPage(); page.recovery.backupTarget = syntheticBackupTarget; state.prompt.mockResolvedValue({ choiceId: "cancel" }); await page.recovery.runBackup(); expect(state.backup).not.toHaveBeenCalled();
    expect(state.prompt.mock.calls[0][0]).toMatchObject({ title: "确认当前库备份", defaultChoiceId: "cancel" });
    page.recovery.backupDirectory = syntheticBackupTarget; page.recovery.restoreTarget = syntheticRestoreTarget; await page.recovery.runInspect(); await page.recovery.runRestore(); expect(state.restore).not.toHaveBeenCalled();
    expect(state.prompt.mock.calls[1][0]).toMatchObject({ title: "确认新目录隔离恢复", defaultChoiceId: "cancel" }); expect(state.prompt.mock.calls[1][0].message).toContain(syntheticInspection().manifest_sha256);
  });
  it("actual Tab inactivity aborts a pending inspection and releases a late handle without updating the page", async () => {
    const result = deferred<ReturnType<typeof syntheticInspection>>(); state.inspect.mockReturnValue(result.promise); const page = setupPage(); page.recovery.backupDirectory = syntheticBackupTarget; const pending = page.recovery.runInspect(), signal = state.inspect.mock.calls[0][2] as AbortSignal;
    activeTab.value = "another-tab"; await nextTick(); expect(signal.aborted).toBe(true); result.resolve(syntheticInspection()); await pending; expect(page.recovery.inspection).toBeNull(); expect(state.release).toHaveBeenCalledWith(syntheticWorkspace, syntheticInspection().inspection_id);
  });
  it("refresh releases only current inspection and never implicitly reads or writes", async () => {
    const page = setupPage(); page.recovery.backupDirectory = syntheticBackupTarget; await page.recovery.runInspect(); state.inspect.mockClear(); await state.session!.refresh!(); expect(page.recovery.inspection).toBeNull(); expect(state.inspect).not.toHaveBeenCalled(); expect(state.backup).not.toHaveBeenCalled(); expect(state.restore).not.toHaveBeenCalled();
  });
  it("opens a folded result block on a new explicit failure without retrying the operation", async () => {
    state.inspect.mockRejectedValue(new ApiError("Invalid backup", 409, { code: "invalid_backup" })); const page = setupPage(); page.expanded.results = false; page.recovery.backupDirectory = syntheticBackupTarget; await page.recovery.runInspect(); await nextTick();
    expect(page.expanded.results).toBe(true); expect(state.inspect).toHaveBeenCalledTimes(1); expect(state.backup).not.toHaveBeenCalled(); expect(state.restore).not.toHaveBeenCalled();
  });
  it("parses the entire SFC AST, requiring three collapsible blocks and each header action slot", () => {
    const source = fs.readFileSync(new URL("./WorkspaceRecoveryPage.vue", import.meta.url), "utf8"); expect(checkBlockContract(source)).toBe(true);
    const nodes = elements(source), header = nodes.find(n => n.tag === "PageHeader"); expect(header?.children?.some(n => n.tag === "template" && n.props?.some(p => p.name === "slot" && p.arg?.content === "right"))).toBe(true);
    expect(source).not.toMatch(/v-html|localStorage|window\.confirm|recreatePhoenixDatabase|switchWorkspace|onServerPrefetch/);
  });
  it("detects a mutation after nested header templates, including the final block, without regex truncation", () => {
    const source = fs.readFileSync(new URL("./WorkspaceRecoveryPage.vue", import.meta.url), "utf8");
    expect(checkBlockContract(source.replace('title="3. 结果与说明"', 'title="unexpected-final-block"'))).toBe(false);
    expect(checkBlockContract(source.replace('v-model:expanded="expanded.restore"', 'v-model:expanded="wrong.restore"'))).toBe(false);
  });
});
