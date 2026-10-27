import fs from "node:fs";
import ts from "typescript";
import * as Vue from "vue";
import { compileScript, compileTemplate, parse } from "vue/compiler-sfc";
import { createRenderer, defineComponent, h, nextTick, ref, type Component, type ComponentInternalInstance, type VNode } from "vue";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { BomPreview } from "../api";
import type { FileDetailContext } from "../composables/useFileDetailContext";
import type { PagePrimaryContribution } from "../composables/usePagePrimaryContribution";

const state = vi.hoisted(() => ({ shell: {} as Record<string, unknown>, context: undefined as FileDetailContext | undefined, primary: undefined as PagePrimaryContribution | undefined, bom: vi.fn(), full: vi.fn(), light: vi.fn(), xrefCounts: vi.fn() }));
vi.mock("vue", async original => ({ ...await original<typeof import("vue")>(), useSSRContext: () => ({ modules: new Set<string>() }) }));
vi.mock("../api", async original => ({ ...await original<typeof import("../api")>(), fetchBom: state.bom, fetchBomXrefCounts: state.xrefCounts }));
vi.mock("../features/cad-object-info/api", () => ({ fetchCadObjectInfo: state.full }));
vi.mock("../features/cad-light-info/api", () => ({ fetchCadLightInfo: state.light }));
vi.mock("../composables/useAppShell", () => ({ useAppShell: () => state.shell }));
vi.mock("../composables/useFileDetailContext", () => ({ provideFileDetailContext: (context: FileDetailContext) => { state.context = context; } }));
vi.mock("../composables/usePageSession", () => ({ usePageSession: () => undefined }));
vi.mock("../composables/usePagePrimaryContribution", () => ({ usePagePrimaryContribution: (_page: string, _tab: string, contribution: PagePrimaryContribution) => { state.primary = contribution; } }));
vi.mock("../composables/useFileThumbnail", async () => ({ useFileThumbnail: () => (awaitedRef()) }));
vi.mock("../composables/useThumbnailGeneration", async () => ({ useThumbnailGeneration: () => (awaitedRef()) }));

vi.mock("phoenix-wing/layout/PnwPageLayout.vue", async () => {
  const { defineComponent, h } = await import("vue"); return { default: defineComponent({ setup: (_p, { slots }) => () => h("main", [slots.header?.(), slots.default?.()]) }) };
});
vi.mock("phoenix-wing/layout/PnwPageHeader.vue", async () => {
  const { defineComponent, h } = await import("vue"); return { default: defineComponent({ setup: (_p, { slots }) => () => h("header", [slots.center?.(), slots.right?.()]) }) };
});
vi.mock("phoenix-wing/layout/PnwPageMainBlock.vue", async () => {
  const { defineComponent, h } = await import("vue"); return { default: defineComponent({ setup: (_p, { slots }) => () => h("section", slots.default?.()) }) };
});
vi.mock("../components/file-detail/FileDrawingPanel.vue", async () => ({ default: await heavyPanel("drawing") }));
vi.mock("../components/file-detail/FileOverviewPanel.vue", async () => ({ default: await heavyPanel("overview") }));
vi.mock("../components/file-detail/FileAttributesPanel.vue", async () => ({ default: await heavyPanel("attributes") }));
vi.mock("../components/file-detail/FileXrefPanel.vue", async () => ({ default: await heavyPanel("xref") }));
vi.mock("../components/file-detail/FileAssemblyPanel.vue", async () => ({ default: await heavyPanel("assembly") }));
vi.mock("../components/file-detail/DrawingBomReadonlyBanner.vue", async () => ({ default: await heavyPanel("drawing-banner") }));
vi.mock("../components/RenameDialog.vue", async () => ({ default: await heavyPanel("rename-dialog") }));
async function heavyPanel(name: string) {
  const { defineComponent, h } = await import("vue"); return defineComponent({ setup: () => () => h("div", { "data-heavy-panel": name }) });
}
function awaitedRef() { return ref(null); }

import FileDetailPage from "./FileDetailPage.vue";
import CadObjectInfoPanel from "../features/cad-object-info/CadObjectInfoPanel.vue";
import CadLightSummary from "../features/cad-light-info/CadLightSummary.vue";
import { syntheticLightInfo } from "../features/cad-light-info/fixtures.test-support";

/** Vitest transforms Vue SFCs for SSR. Compile their *actual* templates to
 * client render functions only in this test, retaining the real SFC setup and
 * its bindings/lifecycle. No handwritten imitation of the fallback branch. */
function addClientRender(component: unknown, filename: URL) {
  const source = fs.readFileSync(filename, "utf8"), { descriptor, errors } = parse(source);
  expect(errors).toEqual([]);
  const id = "readonly-detail-test", bindings = compileScript(descriptor, { id }).bindings;
  const compiled = compileTemplate({ source: descriptor.template!.content, filename: filename.pathname, id, compilerOptions: { mode: "function", bindingMetadata: bindings } });
  expect(compiled.errors).toEqual([]);
  const code = ts.transpileModule(compiled.code, { compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.None } }).outputText;
  Object.assign(component as object, { render: new Function("Vue", code)(Vue) });
}
addClientRender(FileDetailPage, new URL("./FileDetailPage.vue", import.meta.url));
addClientRender(CadObjectInfoPanel, new URL("../features/cad-object-info/CadObjectInfoPanel.vue", import.meta.url));
addClientRender(CadLightSummary, new URL("../features/cad-light-info/CadLightSummary.vue", import.meta.url));

type HostNode = { tag: string; text: string; props: Record<string, unknown>; style: { display: string }; parent: HostNode | null; children: HostNode[] };
const node = (tag = "", text = ""): HostNode => ({ tag, text, props: {}, style: { display: "" }, parent: null, children: [] });
const mounted: Array<{ unmount: () => void }> = [];
const workspace = ref("/synthetic-workspace");
function deferred<T>() { let resolve!: (value: T) => void, reject!: (reason: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function preview(rel = "components/model.FCStd"): BomPreview {
  return { rel_path: rel, fields: { repo_rel_path: rel, filename: rel.split("/").at(-1)!, PartNumber: "example", PartVersion: "draft", TypeCode: "generic", ModelSeries: "", PartName: "Independent fixture", label: "Saved fixture" }, source_note: "Synthetic read-only fixture", abs_path_display: "", is_fcstd: true,
    document_kinds: { part: true, assembly: false, drawing: false, display: "part", recommended_suffix: ".FCStd" }, embedded_warning: null, file_size_bytes: 120, file_size_display: "120", xref_counts: { outgoing_count: 0, direct_incoming_count: 0 } };
}
const button = defineComponent({ props: { disabled: Boolean }, setup: (props, { slots }) => () => h("button", { disabled: props.disabled }, slots.default?.()) });
const alert = defineComponent({ props: ["title"], setup: props => () => h("div", { role: "alert" }, props.title) });
const group = defineComponent({ setup: (_p, { slots }) => () => h("div", slots.default?.()) });
function mountPage() {
  const renderer = createRenderer<HostNode, HostNode>({
    createElement: tag => node(tag), createText: text => node("text", text), createComment: text => node("comment", text),
    setText(el, text) { el.text = text; }, setElementText(el, text) { el.text = text; el.children = []; }, patchProp(el, key, _old, value) { el.props[key] = value; },
    parentNode: el => el.parent, nextSibling: el => el.parent?.children[el.parent.children.indexOf(el) + 1] ?? null,
    insert(el, parent, anchor) { if (el.parent) el.parent.children.splice(el.parent.children.indexOf(el), 1); el.parent = parent; const at = anchor ? parent.children.indexOf(anchor) : -1; parent.children.splice(at < 0 ? parent.children.length : at, 0, el); },
    remove(el) { if (el.parent) el.parent.children.splice(el.parent.children.indexOf(el), 1); el.parent = null; },
  });
  const app = renderer.createApp(FileDetailPage as Component, { workbenchTabId: "example-detail-tab" });
  for (const [name, component] of Object.entries({ ElButton: button, ElAlert: alert, ElRadioGroup: group, ElRadioButton: button })) app.component(name, component);
  const root = node("root"); mounted.push(app); const vm = app.mount(root);
  return { app, root, instance: vm.$, context: state.context!, unmount: () => app.unmount() };
}
function findPanel(vnode: VNode): ComponentInternalInstance | null {
  if (vnode.component?.type === CadObjectInfoPanel) return vnode.component;
  if (vnode.component) { const child = findPanel(vnode.component.subTree); if (child) return child; }
  if (Array.isArray(vnode.children)) for (const child of vnode.children) { if (child && typeof child === "object" && "type" in child) { const found = findPanel(child as VNode); if (found) return found; } }
  return null;
}
function text(el: HostNode): string { return [el.tag === "comment" ? "" : el.text, ...el.children.map(text)].join(" "); }
function elements(el: HostNode, accept: (value: HostNode) => boolean): HostNode[] { return [...accept(el) ? [el] : [], ...el.children.flatMap(child => elements(child, accept))]; }
async function settle() { await Promise.resolve(); await nextTick(); await Promise.resolve(); await nextTick(); }
beforeEach(() => {
  vi.resetAllMocks(); workspace.value = "/synthetic-workspace"; state.context = undefined; state.primary = undefined;
  state.bom.mockResolvedValue(preview()); state.light.mockResolvedValue(syntheticLightInfo()); state.xrefCounts.mockResolvedValue({ outgoing_count: 0, direct_incoming_count: 0 });
  state.shell = { workspacePath: workspace, consumeTabPayload: vi.fn().mockReturnValueOnce({ fileDetail: { rel: "components/model.FCStd" } }), consumeTabPageState: vi.fn(), getTab: vi.fn().mockReturnValue({ pageId: "file_detail", contextKey: "components/model.FCStd", subtitle: "components/model.FCStd" }),
    updateTab: vi.fn(), rerouteFileDetailTab: vi.fn(), scheduleWorkbenchSave: vi.fn(), setStatus: vi.fn(), setTabDirty: vi.fn(), registerPageMessages: vi.fn(), appendLog: vi.fn(), keepTab: vi.fn(), openFileDetailForRel: vi.fn() };
});
afterEach(() => { for (const app of mounted.splice(0)) app.unmount(); });

it("contributes saved Rigid instances to ASSY Primary and clears them when opening a part", async () => {
  const assy = preview("components/fixture.ASSY.FCStd"); assy.document_kinds!.assembly = true;
  assy.assembly_links = [{ object_name: "Sub", label: "Sub stage", rigid: false, target_file: "Child.FCStd", target_object_name: "Assembly" }];
  state.bom.mockResolvedValueOnce(assy).mockResolvedValueOnce(preview());
  const page = mountPage(); await settle();
  const sections = () => Vue.toValue(state.primary?.sections) || [];
  expect(sections().find(section => section.id === "assembly-rigid")?.controls).toEqual([expect.objectContaining({ label: "Sub stage（Sub）", value: "否 · 柔性", kind: "readonly" })]);
  await page.context.reloadFile("components/model.FCStd"); await settle();
  expect(sections().some(section => section.id === "assembly-rigid")).toBe(false);
});
it("opens Bottom with the exact disconnected joint end, without attempting a repair", async () => {
  const assy = preview("components/fixture.ASSY.FCStd"); assy.document_kinds!.assembly = true;
  assy.assembly_joint_issues = [{ object_name: "Joint", label: "Pivot", reference: "Reference2", reason: "empty_reference", target_object_name: null }];
  state.bom.mockResolvedValue(assy); mountPage(); await settle();
  expect(state.shell.appendLog).toHaveBeenCalledExactlyOnceWith(expect.stringContaining("Pivot（Joint）· Reference2：连接端为空"), { source: "file_detail", open: true });
  expect(state.full).not.toHaveBeenCalled();
});

it("mounts the genuine light fallback after BOM selection rejects, without inventing a writable preview or auto-reading", async () => {
  const pending = deferred<BomPreview>(); state.bom.mockReturnValue(pending.promise); const page = mountPage();
  expect(state.bom).toHaveBeenCalledExactlyOnceWith("components/model.FCStd", "/synthetic-workspace"); await nextTick(); expect(text(page.root)).toContain("载入中");
  pending.reject(new Error("Synthetic BOM root selection failed")); await settle();
  expect(page.context.preview.value).toBeNull(); expect(page.context.form.value).toEqual({}); expect(page.context.baseline.value).toEqual({}); expect(page.context.originalFilename.value).toBe("");
  expect(text(page.root)).toContain("常规属性读取失败"); expect(text(page.root)).toContain("此处不提供属性写入或改名");
  expect(elements(page.root, el => "data-heavy-panel" in el.props)).toHaveLength(0);
  const panel = findPanel(page.instance.subTree); expect(panel?.props.initialMode).toBe("light");
  if (!panel || !("setupState" in panel)) throw new Error("Expected mounted readonly panel");
  const setup = panel.setupState as { mode: string; load: () => Promise<void> }; expect(setup.mode).toBe("light"); expect(state.full).not.toHaveBeenCalled(); expect(state.light).not.toHaveBeenCalled();
  const rename = elements(page.root, el => el.tag === "button" && text(el).trim() === "改名"); expect(rename).toHaveLength(1); expect(rename[0].props.disabled).toBe(true); expect(state.shell.keepTab).not.toHaveBeenCalled();
  await setup.load(); await settle(); expect(state.light).toHaveBeenCalledExactlyOnceWith("/synthetic-workspace", "components/model.FCStd", expect.any(AbortSignal)); expect(text(page.root)).toContain("Document.xml 原始 240 字节"); expect(state.full).not.toHaveBeenCalled();
});

it.each(["resolve", "reject"] as const)("ignores a previous workspace's late %s while the new file request stays authoritative", async outcome => {
  const old = deferred<BomPreview>(), current = deferred<BomPreview>(); state.bom.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise); const page = mountPage();
  workspace.value = "/other-synthetic-workspace"; const loaded = page.context.reloadFile("components/current.FCStd");
  expect(state.bom.mock.calls[1]).toEqual(["components/current.FCStd", "/other-synthetic-workspace"]);
  if (outcome === "resolve") old.resolve(preview("components/obsolete.FCStd")); else old.reject(new Error("obsolete synthetic failure"));
  await settle(); expect(page.context.loading.value).toBe(true); expect(page.context.preview.value).toBeNull(); expect(page.context.pageError.value).toBe(""); expect(findPanel(page.instance.subTree)).toBeNull(); expect(state.shell.updateTab).not.toHaveBeenCalled();
  current.resolve(preview("components/current.FCStd")); await loaded; await settle();
  expect(page.context.rel.value).toBe("components/current.FCStd"); expect(page.context.preview.value?.rel_path).toBe("components/current.FCStd"); expect(page.context.form.value.filename).toBe("current.FCStd"); expect(page.context.loading.value).toBe(false); expect(page.context.pageError.value).toBe("");
  expect(state.shell.updateTab).toHaveBeenCalledExactlyOnceWith("example-detail-tab", { title: "current.FCStd", subtitle: "components/current.FCStd" }); expect(state.shell.appendLog).not.toHaveBeenCalled();
});

it.each(["resolve", "reject"] as const)("does not update tab/status/log or refill state after unmount and a late %s", async outcome => {
  const pending = deferred<BomPreview>(); state.bom.mockReturnValue(pending.promise); const page = mountPage(); page.unmount();
  const update = state.shell.updateTab as ReturnType<typeof vi.fn>, status = state.shell.setStatus as ReturnType<typeof vi.fn>, log = state.shell.appendLog as ReturnType<typeof vi.fn>;
  update.mockClear(); status.mockClear(); log.mockClear();
  if (outcome === "resolve") pending.resolve(preview()); else pending.reject(new Error("late synthetic failure"));
  await settle(); expect(page.context.preview.value).toBeNull(); expect(page.context.form.value).toEqual({}); expect(page.context.rel.value).toBe(""); expect(update).not.toHaveBeenCalled(); expect(status).not.toHaveBeenCalled(); expect(log).not.toHaveBeenCalled(); expect(state.full).not.toHaveBeenCalled(); expect(state.light).not.toHaveBeenCalled();
});
