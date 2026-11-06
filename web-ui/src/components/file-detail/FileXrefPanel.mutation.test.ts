import fs from "node:fs";
import ts from "typescript";
import * as Vue from "vue";
import { compileScript, compileTemplate, parse } from "vue/compiler-sfc";
import { createRenderer, defineComponent, h, nextTick, ref } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FileDetailXrefsPayload } from "../../api";
import { provideFileDetailContext, type FileDetailContext } from "../../composables/useFileDetailContext";

const mocks = vi.hoisted(() => ({
  shell: {} as Record<string, unknown>, xrefs: vi.fn(), startRefresh: vi.fn(),
  pollRefresh: vi.fn(), cancelRefresh: vi.fn(), startPolling: vi.fn(), syncLabels: vi.fn(),
}));
vi.mock("vue", async original => ({ ...await original<typeof import("vue")>(), useSSRContext: () => ({ modules: new Set<string>() }) }));
vi.mock("../../api", () => ({
  fetchFileDetailXrefs: mocks.xrefs,
  startBomXrefHostRefresh: mocks.startRefresh,
  fetchBomXrefHostRefreshProgress: mocks.pollRefresh,
  cancelBomXrefHostRefresh: mocks.cancelRefresh,
}));
vi.mock("../../composables/useAppShell", () => ({ useAppShell: () => mocks.shell }));
vi.mock("../../composables/useAsyncProgress", async () => {
  const { ref } = await import("vue");
  return { useAsyncProgress: () => ({ state: ref(null), startPolling: mocks.startPolling }) };
});
vi.mock("../../composables/useReferenceLabelSync", async () => {
  const { ref } = await import("vue");
  return { useReferenceLabelSync: () => ({ syncing: ref(false), syncIncomingLabels: mocks.syncLabels }) };
});
vi.mock("../XlinkReplaceDialog.vue", async () => {
  const { defineComponent } = await import("vue");
  return { default: defineComponent({ props: ["open", "hostRepoRel", "edge"], setup: () => () => null }) };
});

import FileXrefPanel from "./FileXrefPanel.vue";

// Use the actual SFC setup, watchers and template in a renderer without a DOM.
// Vitest's server transform supplies setup; only its render function is replaced.
const source = fs.readFileSync(new URL("./FileXrefPanel.vue", import.meta.url), "utf8");
const { descriptor, errors } = parse(source);
expect(errors).toEqual([]);
const id = "xref-mutation-test", bindings = compileScript(descriptor, { id }).bindings;
const compiled = compileTemplate({ source: descriptor.template!.content, filename: "FileXrefPanel.vue", id, compilerOptions: { mode: "function", bindingMetadata: bindings } });
expect(compiled.errors).toEqual([]);
const renderCode = ts.transpileModule(compiled.code, { compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.None } }).outputText;
Object.assign(FileXrefPanel, { render: new Function("Vue", renderCode)(Vue) });

type HostNode = { tag: string; text: string; props: Record<string, unknown>; parent: HostNode | null; children: HostNode[] };
const node = (tag = "", text = ""): HostNode => ({ tag, text, props: {}, parent: null, children: [] });
const mounted: Array<{ unmount: () => void }> = [];
const workspace = ref("/synthetic/xref-workspace");
const hostRel = "examples/Assembly.FCStd";
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function payload(label: string, rel = hostRel): FileDetailXrefsPayload {
  return { rel, index_state: "ready", index_pending: false,
    incoming: { count: 0, direct_count: 0, hosts: [] },
    outgoing: { count: 1, refs: [{ id: 1, host_repo_rel_path: rel, host_file_asset_id: 1,
      xlink_file_attr: `${label}.FCStd`, target_basename: `${label}.FCStd`, target_repo_rel_path: `examples/${label}.FCStd`,
      target_file_asset_id: 2, resolve_status: "resolved", ref_kind: "xlink", link_label: label }] } };
}
function context(): FileDetailContext {
  const ctx: FileDetailContext = {
    rel: ref(hostRel), preview: ref(null), form: ref({}), baseline: ref({}), originalFilename: ref("Assembly.FCStd"),
    loading: ref(false), pageError: ref(""), activeSubTab: ref("xref"), incomingCount: ref(0), outgoingCount: ref(0),
    switchSubTab: tab => { ctx.activeSubTab.value = tab; }, triggerRename: vi.fn(), reloadFile: vi.fn(), refreshXrefCounts: vi.fn(),
    xrefCacheByRel: ref({}), invalidateXrefCache: rel => {
      const next = { ...ctx.xrefCacheByRel.value }; delete next[rel ?? ctx.rel.value]; ctx.xrefCacheByRel.value = next;
    },
    assemblyCacheByKey: ref({}), invalidateAssemblyCache: vi.fn(), xrefMutationSeq: ref(0),
    notifyXrefMutation: rel => { ctx.invalidateXrefCache(rel); ctx.xrefMutationSeq.value++; }, rememberFilenameDraft: vi.fn(),
  };
  return ctx;
}
function mountPanel(ctx: FileDetailContext) {
  const renderer = createRenderer<HostNode, HostNode>({
    createElement: tag => node(tag), createText: text => node("text", text), createComment: text => node("comment", text),
    setText(el, text) { el.text = text; }, setElementText(el, text) { el.text = text; el.children = []; },
    patchProp(el, key, _old, value) { el.props[key] = value; }, parentNode: el => el.parent,
    nextSibling: el => el.parent?.children[el.parent.children.indexOf(el) + 1] ?? null,
    insert(el, parent, anchor) {
      if (el.parent) el.parent.children.splice(el.parent.children.indexOf(el), 1);
      el.parent = parent; const at = anchor ? parent.children.indexOf(anchor) : -1;
      parent.children.splice(at < 0 ? parent.children.length : at, 0, el);
    },
    remove(el) { if (el.parent) el.parent.children.splice(el.parent.children.indexOf(el), 1); el.parent = null; },
  });
  const wrapper = defineComponent({ setup: () => { provideFileDetailContext(ctx); return () => h(FileXrefPanel); } });
  const app = renderer.createApp(wrapper);
  const control = defineComponent({ setup: (_props, { slots }) => () => h("span", slots.default?.()) });
  app.component("ElButton", control); app.component("ElCheckbox", control);
  const root = node("root"); mounted.push(app); app.mount(root); return root;
}
function text(el: HostNode): string { return [el.tag === "comment" ? "" : el.text, ...el.children.map(text)].join(" "); }
async function settle() { await Promise.resolve(); await nextTick(); await Promise.resolve(); await nextTick(); }
function expectReadOnly() {
  for (const [options] of mocks.xrefs.mock.calls) expect(options).toMatchObject({ scope: "both", refreshDisk: false });
  for (const write of [mocks.startRefresh, mocks.pollRefresh, mocks.cancelRefresh, mocks.startPolling, mocks.syncLabels]) expect(write).not.toHaveBeenCalled();
}
beforeEach(() => {
  vi.resetAllMocks(); workspace.value = "/synthetic/xref-workspace";
  mocks.shell = { workspacePath: workspace, appendLog: vi.fn(), setStatus: vi.fn(), openFileDetailForRel: vi.fn() };
  mocks.xrefs.mockResolvedValue(payload("CurrentCopy"));
});
afterEach(() => { for (const app of mounted.splice(0)) app.unmount(); });

describe("mounted reference panel consumes published xref mutations", () => {
  it("rereads the shared index without refreshing disk and replaces previously cached rows", async () => {
    const ctx = context(); ctx.xrefCacheByRel.value = { [hostRel]: payload("SavedCopy") };
    const root = mountPanel(ctx); await settle();
    expect(text(root)).toContain("SavedCopy.FCStd"); expect(mocks.xrefs).not.toHaveBeenCalled();
    ctx.notifyXrefMutation(); await settle();
    expect(mocks.xrefs).toHaveBeenCalledExactlyOnceWith({ rel: hostRel, scope: "both", transitive: false, limit: 500, refreshDisk: false });
    expect(text(root)).toContain("CurrentCopy.FCStd"); expect(text(root)).not.toContain("SavedCopy.FCStd");
    expect(ctx.xrefCacheByRel.value[hostRel]).toEqual(payload("CurrentCopy")); expect(ctx.outgoingCount.value).toBe(1);
    expectReadOnly();
  });

  it("does not fetch a hidden panel on mutation, then reads current rows when references become active", async () => {
    const ctx = context(); ctx.activeSubTab.value = "overview";
    const root = mountPanel(ctx); await settle(); ctx.notifyXrefMutation(); await settle();
    expect(mocks.xrefs).not.toHaveBeenCalled();
    ctx.activeSubTab.value = "xref"; await settle();
    expect(mocks.xrefs).toHaveBeenCalledTimes(1); expect(text(root)).toContain("CurrentCopy.FCStd"); expectReadOnly();
  });

  it("does not let a previous same-file read overwrite the rows loaded after a mutation", async () => {
    const old = deferred<FileDetailXrefsPayload>(); mocks.xrefs.mockReturnValueOnce(old.promise);
    const ctx = context(), root = mountPanel(ctx); await settle();
    ctx.notifyXrefMutation(); await settle(); expect(mocks.xrefs).toHaveBeenCalledTimes(2);
    old.resolve(payload("PreviousCopy")); await settle();
    expect(text(root)).toContain("CurrentCopy.FCStd"); expect(text(root)).not.toContain("PreviousCopy.FCStd");
    expect(ctx.xrefCacheByRel.value[hostRel]).toEqual(payload("CurrentCopy")); expectReadOnly();
  });

  it.each(["resolve", "reject"] as const)("ignores a previous workspace's late %s after a same-relative-file mutation", async outcome => {
    const old = deferred<FileDetailXrefsPayload>(); mocks.xrefs.mockReturnValueOnce(old.promise);
    const ctx = context(), root = mountPanel(ctx); await settle();
    workspace.value = "/synthetic/another-xref-workspace"; ctx.xrefCacheByRel.value = {}; ctx.notifyXrefMutation(); await settle();
    expect(mocks.xrefs).toHaveBeenCalledTimes(2); expect(text(root)).toContain("CurrentCopy.FCStd");
    if (outcome === "resolve") old.resolve(payload("OtherWorkspaceCopy")); else old.reject(new Error("Synthetic stale workspace read"));
    await settle();
    expect(text(root)).toContain("CurrentCopy.FCStd"); expect(text(root)).not.toContain("OtherWorkspaceCopy.FCStd");
    expect(ctx.pageError.value).toBe(""); expect(ctx.xrefCacheByRel.value[hostRel]).toEqual(payload("CurrentCopy")); expectReadOnly();
  });
});
