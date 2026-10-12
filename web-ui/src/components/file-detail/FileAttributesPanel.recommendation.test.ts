import { readFileSync } from "node:fs";
import * as Vue from "vue";
import { createRenderer, nextTick, ref, type Component, type Ref } from "vue";
import { compileScript, parse } from "vue/compiler-sfc";
import { ModuleKind, ScriptTarget, transpileModule } from "typescript";
import * as ui from "element-plus/es";
import ComboTextInput from "phoenix-wing/components/PnwComboTextInput.vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BomFields, BomPreview } from "../../api";
import { useDrawingBomReadonly } from "../../composables/useDrawingBomReadonly";
import { TYPE_CODE_OPTIONS } from "../../utils/typeCodeOptions";
import * as bomNameSource from "../../utils/bomNameSource";

// Independent metadata-only UI fixture; no real model, inventory or disk paths.
const FIELDS: BomFields = {
  repo_rel_path: "synthetic/Example.FCStd", filename: "Example.FCStd",
  PartNumber: "SYNTHETIC-META", PartVersion: "V1", TypeCode: "H", ModelSeries: "SYNTHETIC",
  PartName: "Existing synthetic draft", label: "Synthetic node label",
};
const api = vi.hoisted(() => ({
  fetchBomPrefs: vi.fn(), fetchBomDocumentKinds: vi.fn(), recommendBomField: vi.fn(),
  recommendBomFieldsAll: vi.fn(), saveBom: vi.fn(),
}));
const shell = vi.hoisted(() => ({ appendLog: vi.fn(), setStatus: vi.fn(), openFileDetailForRel: vi.fn() }));
type Context = {
  rel: Ref<string>; preview: Ref<BomPreview | null>; form: Ref<Partial<BomFields>>;
  baseline: Ref<Partial<BomFields>>; pageError: Ref<string>;
  reloadFile: ReturnType<typeof vi.fn>; rememberFilenameDraft: ReturnType<typeof vi.fn>;
};
let context: Context;
vi.mock("../../api", () => api);
vi.mock("../../composables/useFileDetailContext", () => ({ useFileDetailContext: () => context }));
vi.mock("../../composables/useAppShell", () => ({ useAppShell: () => shell }));
vi.mock("phoenix-wing/components/PnwComboTextInput.vue", async () => {
  const { defineComponent, h } = await import("vue");
  return { default: defineComponent({
    props: { modelValue: String, readonly: Boolean },
    setup: props => () => h("input", { value: props.modelValue, readonly: props.readonly }),
  }) };
});
// Replace browser poppers with slot/event adapters, not the panel's logic.
vi.mock("element-plus/es", async () => {
  const { defineComponent, h, inject, provide } = await import("vue");
  const dropdownKey = Symbol("synthetic dropdown"), radioKey = Symbol("synthetic radio");
  type Dropdown = { disabled: () => boolean; command: (value: string) => void };
  type Radio = { disabled: () => boolean; select: (value: string) => void };
  const ElButton = defineComponent({
    inheritAttrs: false, props: { disabled: Boolean, loading: Boolean, size: String },
    setup: (props, { attrs, slots }) => () => h("button", {
      ...attrs, type: "button", disabled: props.disabled || props.loading,
      "data-ui": "button", "data-size": props.size,
    }, slots.default?.()),
  });
  const ElDropdown = defineComponent({
    inheritAttrs: false, props: { disabled: Boolean, size: String, trigger: String, placement: String },
    emits: ["command"],
    setup(props, { attrs, slots, emit }) {
      const command = (value: string) => emit("command", value);
      provide(dropdownKey, { disabled: () => props.disabled, command });
      return () => h("div", {
        ...attrs, "data-ui": "dropdown", "data-disabled": props.disabled, "data-size": props.size,
        "data-trigger": props.trigger,
        // Also permit a stale/open popper to emit: the panel must guard this.
        onCommand: command,
      }, [slots.default?.(), slots.dropdown?.()]);
    },
  });
  const ElDropdownMenu = defineComponent({ setup: (_, { slots }) => () => h("div", { "data-ui": "menu" }, slots.default?.()) });
  const ElDropdownItem = defineComponent({
    props: { command: { type: String, required: true }, disabled: Boolean },
    setup(props, { slots }) {
      const dropdown = inject<Dropdown>(dropdownKey)!;
      return () => h("button", {
        type: "button", disabled: props.disabled, "data-command": props.command,
        onClick: () => { if (!props.disabled && !dropdown.disabled()) dropdown.command(props.command); },
      }, slots.default?.());
    },
  });
  const ElRadioGroup = defineComponent({
    props: { modelValue: String, disabled: Boolean }, emits: ["update:modelValue"],
    setup(props, { slots, emit }) {
      provide(radioKey, { disabled: () => props.disabled, select: (value: string) => emit("update:modelValue", value) });
      return () => h("div", { "data-ui": "radio-group", "data-source": props.modelValue }, slots.default?.());
    },
  });
  const ElRadioButton = defineComponent({
    props: { value: { type: String, required: true } },
    setup(props, { slots }) {
      const radio = inject<Radio>(radioKey)!;
      return () => h("button", {
        type: "button", "data-source-option": props.value, disabled: radio.disabled(),
        onClick: () => { if (!radio.disabled()) radio.select(props.value); },
      }, slots.default?.());
    },
  });
  const ElCheckbox = defineComponent({
    props: { modelValue: Boolean },
    setup: (props, { slots }) => () => h("label", [h("input", { type: "checkbox", checked: props.modelValue }), slots.default?.()]),
  });
  return { ElButton, ElDropdown, ElDropdownMenu, ElDropdownItem, ElRadioGroup, ElRadioButton, ElCheckbox };
});

function clientPanel(): Component {
  // Vite's node test pipeline compiles imported .vue files for SSR. Compile the
  // real source as a client SFC explicitly so this suite exercises real template
  // event bindings and mounted reactive updates, without an SSR-context shim.
  const source = readFileSync(new URL("./FileAttributesPanel.vue", import.meta.url), "utf8");
  const { descriptor } = parse(source, { filename: "FileAttributesPanel.vue" });
  const script = compileScript(descriptor, { id: "synthetic-attributes", inlineTemplate: true, templateOptions: { ssr: false } });
  const compiled = transpileModule(script.content, {
    compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const dependencies: Record<string, unknown> = {
    vue: Vue, "../../api": api,
    "../../composables/useFileDetailContext": { useFileDetailContext: () => context },
    "../../composables/useDrawingBomReadonly": { useDrawingBomReadonly },
    "../../composables/useAppShell": { useAppShell: () => shell },
    "phoenix-wing/components/PnwComboTextInput.vue": { __esModule: true, default: ComboTextInput },
    "../../utils/typeCodeOptions": { TYPE_CODE_OPTIONS },
    "../../utils/bomNameSource": bomNameSource,
  };
  const module = { exports: {} as { default?: Component } };
  const require = (name: string) => {
    if (!(name in dependencies)) throw new Error(`Unexpected SFC test dependency: ${name}`);
    return dependencies[name];
  };
  new Function("require", "module", "exports", compiled)(require, module, module.exports);
  if (!module.exports.default) throw new Error("Client SFC compilation did not produce a component");
  return module.exports.default;
}
const FileAttributesPanel = clientPanel();

type HostNode = {
  kind: string; text: string; props: Record<string, unknown>;
  parent: HostNode | null; children: HostNode[];
  value: string; addEventListener: (event: string, listener: unknown) => void; getRootNode: () => null;
};
const node = (kind = "root", text = ""): HostNode => ({
  kind, text, props: {}, parent: null, children: [], value: "",
  addEventListener: () => {}, getRootNode: () => null,
});
function renderer() {
  return createRenderer<HostNode, HostNode>({
    createElement: tag => node(tag), createText: value => node("#text", value), createComment: value => node("#comment", value),
    setText: (el, value) => { el.text = value; },
    setElementText: (el, value) => { el.text = value; el.children = []; },
    patchProp: (el, key, _previous, value) => { el.props[key] = value; },
    parentNode: el => el.parent,
    nextSibling: el => el.parent?.children[el.parent.children.indexOf(el) + 1] ?? null,
    insert(el, parent, anchor) {
      if (el.parent) el.parent.children.splice(el.parent.children.indexOf(el), 1);
      el.parent = parent;
      const index = anchor ? parent.children.indexOf(anchor) : -1;
      parent.children.splice(index < 0 ? parent.children.length : index, 0, el);
    },
    remove(el) {
      if (el.parent) el.parent.children.splice(el.parent.children.indexOf(el), 1);
      el.parent = null;
    },
  });
}
function descendants(root: HostNode): HostNode[] { return [root, ...root.children.flatMap(descendants)]; }
function text(root: HostNode): string { return root.text + root.children.map(text).join(""); }
function find(root: HostNode, predicate: (value: HostNode) => boolean): HostNode {
  const found = descendants(root).find(predicate);
  if (!found) throw new Error("Expected synthetic UI control not found");
  return found;
}
const dropdown = (root: HostNode) => find(root, el => el.props["data-ui"] === "dropdown");
const menuItem = (root: HostNode, command: string) => find(root, el => el.props["data-command"] === command);
const toolbarButton = (root: HostNode, label: string) => find(root, el => el.kind === "button" && text(el).trim() === label);
const fieldRow = (root: HostNode, label: string) => find(root, el => el.props.role === "group" && el.props["aria-label"] === label);
function click(el: HostNode) {
  expect(el.props.disabled).not.toBe(true);
  (el.props.onClick as (() => void))();
}
async function settle() {
  await Promise.resolve(); await nextTick(); await Promise.resolve(); await nextTick();
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
const mounted: Array<{ unmount: () => void }> = [];
async function mountPanel(overrides: { readonly?: boolean; rel?: string } = {}) {
  context = {
    rel: ref(overrides.rel ?? FIELDS.repo_rel_path),
    preview: ref({
      rel_path: FIELDS.repo_rel_path, fields: { ...FIELDS }, is_fcstd: true, bom_readonly: overrides.readonly ?? false,
      source_note: "Synthetic", abs_path_display: "", embedded_warning: null,
      file_size_bytes: null, file_size_display: null,
      document_kinds: { part: true, assembly: false, drawing: false, display: "零件", recommended_suffix: ".FCStd" },
    }),
    form: ref({ ...FIELDS }), baseline: ref({ ...FIELDS }), pageError: ref(""),
    reloadFile: vi.fn().mockResolvedValue(undefined), rememberFilenameDraft: vi.fn(),
  };
  const root = node(), app = renderer().createApp(FileAttributesPanel);
  for (const [name, component] of Object.entries(ui)) app.component(name, component as Component);
  mounted.push(app); app.mount(root); await settle();
  return root;
}
beforeEach(() => {
  vi.clearAllMocks();
  // Vue's real v-model directive runs on memory inputs. They never belong to
  // a browser Document/ShadowRoot, but those constructor checks must exist.
  vi.stubGlobal("Document", class SyntheticDocument {});
  vi.stubGlobal("ShadowRoot", class SyntheticShadowRoot {});
  vi.stubGlobal("document", { activeElement: null });
  api.fetchBomPrefs.mockResolvedValue(null);
  api.fetchBomDocumentKinds.mockResolvedValue({ document_kinds: { part: true, assembly: false, drawing: false, display: "零件", recommended_suffix: ".FCStd" } });
  api.recommendBomField.mockResolvedValue({ field: "PartName", value: FIELDS.PartName, source_note: "Existing PartName", filled: true });
  api.recommendBomFieldsAll.mockResolvedValue({ results: {}, filled_keys: [] });
  api.saveBom.mockResolvedValue({ status: "ok" });
});
afterEach(() => { for (const app of mounted.splice(0)) app.unmount(); vi.unstubAllGlobals(); });

describe("PartName explicit recommendation menu", () => {
  it("offers exactly three compact source commands only on the PartName row", async () => {
    const root = await mountPanel();
    expect(descendants(root).filter(el => el.props["data-ui"] === "dropdown")).toHaveLength(1);
    const menu = dropdown(fieldRow(root, "零件名称"));
    expect(menu.props).toMatchObject({ "data-size": "small", "data-trigger": "click", "data-disabled": false });
    expect(descendants(menu).filter(el => el.props["data-command"]).map(el => [el.props["data-command"], text(el)]))
      .toEqual([["default", "按默认规则"], ["filename", "从文件名推荐"], ["label", "从节点标签推荐"]]);
    const trigger = find(menu, el => el.props["aria-label"] === "推荐零件名称来源");
    expect(trigger.props.title).toBe("默认规则保留已有有效 PartName；明确来源仅替换本行草稿");
    for (const label of ["文件名", "零件号", "版本", "类型码", "型号系列", "标签"])
      expect(toolbarButton(fieldRow(root, label), "推荐").props["data-ui"]).toBe("button");
  });

  it("keeps a valid PartName draft and delegates default priority with the global source without explicit override", async () => {
    const root = await mountPanel(), before = { ...context.form.value };
    click(menuItem(root, "default")); await settle();
    expect(api.recommendBomField).toHaveBeenCalledWith(FIELDS.repo_rel_path, "PartName", before,
      { part: true, assembly: true, drawing: true }, "label");
    expect(api.recommendBomField.mock.calls[0]).toHaveLength(5);
    expect(context.form.value).toEqual(before);
    expect(api.saveBom).not.toHaveBeenCalled(); expect(context.reloadFile).not.toHaveBeenCalled();
  });

  it("explicit filename replaces only PartName draft and does not switch the page-wide label source", async () => {
    const root = await mountPanel(), before = { ...context.form.value };
    api.recommendBomField.mockResolvedValueOnce({ field: "PartName", value: "Filename proposal", filled: true, source_note: "文件名" });
    click(menuItem(root, "filename")); await settle();
    expect(api.recommendBomField).toHaveBeenCalledWith(FIELDS.repo_rel_path, "PartName", before,
      { part: true, assembly: true, drawing: true }, "filename", true);
    expect(context.form.value).toEqual({ ...before, PartName: "Filename proposal" });
    expect(find(root, el => el.props["data-ui"] === "radio-group").props["data-source"]).toBe("label");
    click(menuItem(root, "default")); await settle();
    expect(api.recommendBomField.mock.calls[1].slice(4)).toEqual(["label"]);
    expect(api.saveBom).not.toHaveBeenCalled(); expect(context.rememberFilenameDraft).not.toHaveBeenCalled();
  });

  it("explicit node label does not switch a page-wide filename source, including later ordinary recommendations", async () => {
    const root = await mountPanel();
    click(find(root, el => el.props["data-source-option"] === "filename")); await settle();
    const before = { ...context.form.value };
    api.recommendBomField.mockResolvedValueOnce({ field: "PartName", value: "Node label proposal", filled: true, source_note: "节点标签" });
    click(menuItem(root, "label")); await settle();
    expect(api.recommendBomField).toHaveBeenCalledWith(FIELDS.repo_rel_path, "PartName", before,
      { part: true, assembly: true, drawing: true }, "label", true);
    expect(context.form.value).toEqual({ ...before, PartName: "Node label proposal" });
    expect(find(root, el => el.props["data-ui"] === "radio-group").props["data-source"]).toBe("filename");
    api.recommendBomField.mockResolvedValueOnce({ field: "PartVersion", value: "V2", filled: true, source_note: "Synthetic version" });
    click(toolbarButton(fieldRow(root, "版本"), "推荐")); await settle();
    expect(api.recommendBomField.mock.calls[1].slice(1, 2)).toEqual(["PartVersion"]);
    expect(api.recommendBomField.mock.calls[1].slice(4)).toEqual(["filename"]);
    expect(context.form.value).toEqual({ ...before, PartName: "Node label proposal", PartVersion: "V2" });
    expect(api.saveBom).not.toHaveBeenCalled();
  });

  it("shows a node-label refusal without changing the draft, then clears it when filename recommendation succeeds", async () => {
    const root = await mountPanel(), before = { ...context.form.value };
    api.recommendBomField.mockRejectedValueOnce(new Error("节点标签无法有效推荐，请人工确认"));
    click(menuItem(root, "label")); await settle();
    expect(context.pageError.value).toContain("节点标签无法有效推荐");
    expect(context.form.value).toEqual(before); expect(api.saveBom).not.toHaveBeenCalled();
    expect(dropdown(root).props["data-disabled"]).toBe(false);
    api.recommendBomField.mockResolvedValueOnce({ field: "PartName", value: "Recovered filename proposal", filled: true, source_note: "文件名" });
    click(menuItem(root, "filename")); await settle();
    expect(context.pageError.value).toBe("");
    expect(context.form.value).toEqual({ ...before, PartName: "Recovered filename proposal" });
    expect(api.recommendBomField.mock.calls[1].slice(4)).toEqual(["filename", true]);
    expect(api.saveBom).not.toHaveBeenCalled(); expect(context.reloadFile).not.toHaveBeenCalled();
  });

  it("disables an open menu during another field recommendation and rejects stale command emissions", async () => {
    const root = await mountPanel(), dispatch = dropdown(root).props.onCommand as (command: string) => void;
    const reload = toolbarButton(root, "重新读取").props.onClick as () => void;
    const pending = deferred<{ field: string; value: string; filled: boolean; source_note: string }>();
    api.recommendBomField.mockReturnValueOnce(pending.promise);
    click(toolbarButton(fieldRow(root, "版本"), "推荐")); await settle();
    expect(dropdown(root).props["data-disabled"]).toBe(true);
    expect(toolbarButton(root, "重新读取").props.disabled).toBe(true);
    for (const command of ["default", "filename", "label"]) expect(menuItem(root, command).props.disabled).toBe(true);
    dispatch("filename"); await settle();
    reload(); await settle(); expect(context.reloadFile).not.toHaveBeenCalled();
    expect(api.recommendBomField).toHaveBeenCalledTimes(1);
    expect(context.form.value.PartName).toBe(FIELDS.PartName);
    pending.resolve({ field: "PartVersion", value: "V2", filled: true, source_note: "Synthetic version" }); await settle();
    expect(dropdown(root).props["data-disabled"]).toBe(false);
    expect(toolbarButton(root, "重新读取").props.disabled).toBe(false);
    click(toolbarButton(root, "重新读取")); await settle(); expect(context.reloadFile).toHaveBeenCalledTimes(1);
  });

  it.each(["draft", "rel", "preview"] as const)("ignores a delayed recommendation after the %s changes [case %#]", async change => {
    const root = await mountPanel();
    const pending = deferred<{ field: string; value: string; filled: boolean; source_note: string }>();
    api.recommendBomField.mockReturnValueOnce(pending.promise);
    click(menuItem(root, "filename")); await settle();
    if (change === "draft") context.form.value = { ...context.form.value, PartName: "New user draft while waiting" };
    else if (change === "rel") context.rel.value = "synthetic/Other.FCStd";
    else context.preview.value = { ...context.preview.value!, fields: { ...FIELDS } };
    const currentDraft = { ...context.form.value };
    pending.resolve({ field: "PartName", value: "Expired proposal", filled: true, source_note: "文件名" }); await settle();
    expect(context.form.value).toEqual(currentDraft);
    expect(context.pageError.value).toBe("");
    expect(shell.setStatus).toHaveBeenLastCalledWith("推荐已过期，请重试");
    expect(api.saveBom).not.toHaveBeenCalled(); expect(context.reloadFile).not.toHaveBeenCalled();
    expect(dropdown(root).props["data-disabled"]).toBe(false);
  });

  it("accepts a delayed recommendation when the form object is replaced with unchanged scalar drafts", async () => {
    const root = await mountPanel();
    const pending = deferred<{ field: string; value: string; filled: boolean; source_note: string }>();
    api.recommendBomField.mockReturnValueOnce(pending.promise);
    click(menuItem(root, "filename")); await settle();
    context.form.value = { ...context.form.value };
    pending.resolve({ field: "PartName", value: "Current proposal", filled: true, source_note: "文件名" }); await settle();
    expect(context.form.value).toEqual({ ...FIELDS, PartName: "Current proposal" });
    expect(shell.setStatus).toHaveBeenLastCalledWith("PartName ← 文件名");
    expect(api.saveBom).not.toHaveBeenCalled();
  });

  it("disables every menu command during recommend-all without spawning a single-field request", async () => {
    const root = await mountPanel(), dispatch = dropdown(root).props.onCommand as (command: string) => void;
    const pending = deferred<{ results: Record<string, unknown>; filled_keys: string[] }>();
    api.recommendBomFieldsAll.mockReturnValueOnce(pending.promise);
    click(toolbarButton(root, "全部推荐")); await settle();
    expect(dropdown(root).props["data-disabled"]).toBe(true);
    dispatch("label"); await settle(); expect(api.recommendBomField).not.toHaveBeenCalled();
    pending.resolve({ results: {}, filled_keys: [] }); await settle();
    expect(dropdown(root).props["data-disabled"]).toBe(false);
  });

  it.each(["save", "detect"] as const)("disables recommendation while the %s action is busy [case %#]", async action => {
    const root = await mountPanel(), dispatch = dropdown(root).props.onCommand as (command: string) => void;
    const pending = deferred<unknown>();
    const target = action === "save" ? api.saveBom : api.fetchBomDocumentKinds;
    target.mockReturnValueOnce(pending.promise);
    click(toolbarButton(root, action === "save" ? "写入文件" : "识别类型")); await settle();
    expect(dropdown(root).props["data-disabled"]).toBe(true);
    dispatch("filename"); await settle(); expect(api.recommendBomField).not.toHaveBeenCalled();
    pending.resolve(action === "save" ? { status: "ok" } : { document_kinds: {
      part: true, assembly: false, drawing: false, display: "零件", recommended_suffix: ".FCStd",
    } }); await settle();
    expect(dropdown(root).props["data-disabled"]).toBe(false);
  });

  it("hides PartName actions for readonly drawings and rejects a command from a previously open menu", async () => {
    const root = await mountPanel(), dispatch = dropdown(root).props.onCommand as (command: string) => void;
    context.preview.value = { ...context.preview.value!, bom_readonly: true };
    await settle(); dispatch("label"); await settle();
    expect(descendants(root).some(el => el.props["data-ui"] === "dropdown")).toBe(false);
    expect(descendants(root).some(el => el.props.role === "group" && el.props["aria-label"] === "零件名称")).toBe(false);
    expect(fieldRow(root, "文件名")).toBeTruthy();
    expect(api.recommendBomField).not.toHaveBeenCalled(); expect(api.saveBom).not.toHaveBeenCalled();
  });

  it("disables the menu when no relative file is selected and ignores unknown commands", async () => {
    const root = await mountPanel({ rel: "" }), dispatch = dropdown(root).props.onCommand as (command: string) => void;
    expect(dropdown(root).props["data-disabled"]).toBe(true);
    dispatch("filename"); dispatch("unknown"); await settle();
    expect(api.recommendBomField).not.toHaveBeenCalled(); expect(context.form.value).toEqual(FIELDS);
  });
});
