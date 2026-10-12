import { createRenderer, createSSRApp, defineComponent, h, nextTick, ref, type Component } from "vue";
import { renderToString } from "vue/server-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { CadObjectInfoResult } from "./types";
import type { CadLightInfoResult } from "../cad-light-info/types";
import { syntheticLightInfo } from "../cad-light-info/fixtures.test-support";

const state = vi.hoisted(() => ({ full: vi.fn(), light: vi.fn(), appendLog: vi.fn() }));
vi.mock("vue", async original => ({ ...await original<typeof import("vue")>(), useSSRContext: () => ({ modules: new Set<string>() }) }));
vi.mock("./api", () => ({ fetchCadObjectInfo: state.full }));
vi.mock("../cad-light-info/api", () => ({ fetchCadLightInfo: state.light }));
vi.mock("../../composables/useAppShell", () => ({ useAppShell: () => ({ appendLog: state.appendLog }) }));
import CadObjectInfoPanel from "./CadObjectInfoPanel.vue";

const fullFixture = (): CadObjectInfoResult => ({ document: { objects: [], xlinks: [], root_names: [] }, source: { file_size: 120, mtime_ms: 1, document_xml_bytes: 240 }, warnings: [] });
function deferred<T>() { let resolve!: (value: T) => void, reject!: (error: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
type PanelSetup = { mode: "full" | "light"; busy: boolean; error: string; message: string; result: CadObjectInfoResult | null; lightResult: CadLightInfoResult | null; selectMode: (next: "full" | "light") => void; load: () => Promise<void>; cancel: () => void };
type HostNode = { parent: HostNode | null; children: HostNode[] };
const node = (): HostNode => ({ parent: null, children: [] });
const mounted: Array<{ unmount: () => void }> = [];
function mountPanel(initialMode?: "full" | "light") {
  const workspace = ref("/synthetic-workspace"), file = ref("components/model.FCStd"), active = ref(true), busyChange = vi.fn();
  const renderer = createRenderer<HostNode, HostNode>({
    createElement: node, createText: node, createComment: node, setText() {}, setElementText() {}, patchProp() {},
    parentNode: el => el.parent, nextSibling: el => el.parent?.children[el.parent.children.indexOf(el) + 1] ?? null,
    insert(el, parent, anchor) { if (el.parent) el.parent.children.splice(el.parent.children.indexOf(el), 1); el.parent = parent; const index = anchor ? parent.children.indexOf(anchor) : -1; parent.children.splice(index < 0 ? parent.children.length : index, 0, el); },
    remove(el) { if (el.parent) el.parent.children.splice(el.parent.children.indexOf(el), 1); el.parent = null; },
  });
  // Run the actual compiled SFC setup/mounted/disposal lifecycle. Drawing is
  // covered by real-template SSR below and CadLightSummary's rendering tests.
  const lifecyclePanel = { ...CadObjectInfoPanel, render: () => null } as unknown as Component;
  const app = renderer.createApp(defineComponent({ setup: () => () => h(lifecyclePanel, { workspacePath: workspace.value, filePath: file.value, active: active.value, initialMode, onBusyChange: busyChange }) }));
  mounted.push(app); const vm = app.mount(node());
  const child = vm.$.subTree.component;
  if (!child || !("setupState" in child)) throw new Error("Expected the mounted SFC setup state");
  const panel = child.setupState as PanelSetup;
  return { panel, workspace, file, active, busyChange, unmount: () => app.unmount() };
}
async function settle() { await Promise.resolve(); await nextTick(); }
beforeEach(() => { vi.clearAllMocks(); state.full.mockResolvedValue(fullFixture()); state.light.mockResolvedValue(syntheticLightInfo()); });
afterEach(() => { for (const app of mounted.splice(0)) app.unmount(); });

it("keeps the original default full-object automatic read and combined busy notifications", async () => {
  const full = deferred<CadObjectInfoResult>(); state.full.mockReturnValue(full.promise);
  const { panel, busyChange } = mountPanel(); expect(state.full).toHaveBeenCalledTimes(1); expect(state.light).not.toHaveBeenCalled(); expect(panel.mode).toBe("full"); expect(panel.busy).toBe(true); expect(busyChange).toHaveBeenLastCalledWith(true);
  full.resolve(fullFixture()); await settle(); expect(panel.result).toEqual(fullFixture()); expect(panel.busy).toBe(false); expect(busyChange).toHaveBeenLastCalledWith(false);
});
it("mounts a light-only fallback without starting either read until the user explicitly asks", async () => {
  const { panel } = mountPanel("light"); await settle(); expect(panel.mode).toBe("light"); expect(state.full).not.toHaveBeenCalled(); expect(state.light).not.toHaveBeenCalled(); expect(panel.busy).toBe(false);
  await panel.load(); expect(state.light).toHaveBeenCalledExactlyOnceWith("/synthetic-workspace", "components/model.FCStd", expect.any(AbortSignal)); expect(panel.lightResult).toEqual(syntheticLightInfo()); expect(state.full).not.toHaveBeenCalled();
});
it("switches a pending full read to manual light, aborts it and ignores its late success", async () => {
  const full = deferred<CadObjectInfoResult>(); state.full.mockReturnValueOnce(full.promise);
  const { panel, busyChange } = mountPanel(); const signal = state.full.mock.calls[0][2] as AbortSignal;
  panel.selectMode("light"); await settle(); expect(signal.aborted).toBe(true); expect(panel.result).toBeNull(); expect(panel.busy).toBe(false); expect(busyChange).toHaveBeenLastCalledWith(false); expect(state.light).not.toHaveBeenCalled();
  full.resolve(fullFixture()); await settle(); expect(panel.result).toBeNull(); expect(panel.lightResult).toBeNull();
  await panel.load(); expect(panel.lightResult).toEqual(syntheticLightInfo()); panel.selectMode("full"); await settle(); expect(panel.lightResult).toBeNull(); expect(state.full).toHaveBeenCalledTimes(2); expect(panel.result).toEqual(fullFixture());
});
it("switches a pending light read to full, keeps full auto-read and ignores late light errors", async () => {
  const light = deferred<CadLightInfoResult>(); state.light.mockReturnValueOnce(light.promise);
  const { panel } = mountPanel("light"); const pending = panel.load(), signal = state.light.mock.calls[0][2] as AbortSignal;
  panel.selectMode("full"); await settle(); expect(signal.aborted).toBe(true); expect(state.full).toHaveBeenCalledTimes(1); expect(panel.lightResult).toBeNull();
  light.reject(new Error("late synthetic error")); await pending; await settle(); expect(panel.error).toBe(""); expect(panel.result).toEqual(fullFixture()); expect(state.appendLog).not.toHaveBeenCalled();
});
it.each(["file", "workspace", "inactive", "unmount"] as const)("cancels mounted light on %s without automatic reread or stale results", async kind => {
  const light = deferred<CadLightInfoResult>(); state.light.mockReturnValue(light.promise); const context = mountPanel("light"); const pending = context.panel.load(), signal = state.light.mock.calls[0][2] as AbortSignal;
  expect(context.busyChange).toHaveBeenLastCalledWith(true);
  if (kind === "file") context.file.value = "components/other.FCStd";
  if (kind === "workspace") context.workspace.value = "/another-synthetic-workspace";
  if (kind === "inactive") context.active.value = false;
  if (kind === "unmount") context.unmount();
  await nextTick(); expect(signal.aborted).toBe(true); expect(context.panel.lightResult).toBeNull(); expect(context.panel.busy).toBe(false);
  if (kind !== "unmount") expect(context.busyChange).toHaveBeenLastCalledWith(false);
  light.resolve(syntheticLightInfo()); await pending; expect(context.panel.lightResult).toBeNull(); expect(state.light).toHaveBeenCalledTimes(1); expect(state.full).not.toHaveBeenCalled(); expect(state.appendLog).not.toHaveBeenCalled();
  if (kind === "inactive") { context.active.value = true; await nextTick(); expect(state.light).toHaveBeenCalledTimes(1); }
});
it("cancels both readers with one action and does not surface a cancelled late failure", async () => {
  const light = deferred<CadLightInfoResult>(); state.light.mockReturnValue(light.promise); const { panel, busyChange } = mountPanel("light"); const pending = panel.load(); panel.cancel();
  expect((state.light.mock.calls[0][2] as AbortSignal).aborted).toBe(true); expect(panel.busy).toBe(false); expect(busyChange).toHaveBeenLastCalledWith(false); expect(panel.message).toContain("已取消");
  light.reject(new Error("late synthetic failure")); await pending; expect(panel.error).toBe(""); expect(state.appendLog).not.toHaveBeenCalled();
});
it("renders the real manual fallback tabs/read controls and safe readonly scope", async () => {
  const button = defineComponent({ props: ["disabled"], setup: (props, { slots }) => () => h("button", { disabled: props.disabled }, slots.default?.()) });
  const app = createSSRApp(CadObjectInfoPanel, { workspacePath: "/synthetic-workspace", filePath: "components/model.FCStd", initialMode: "light" }); app.component("ElButton", button);
  const html = await renderToString(app);
  for (const text of ["完整对象", "轻量摘要", "需手动点击", "重新读取", "不是 BOM 数量", "不修改文件", "不更新 CAD 索引", "aria-selected=\"true\""]) expect(html).toContain(text);
  expect(state.full).not.toHaveBeenCalled(); expect(state.light).not.toHaveBeenCalled();
});
