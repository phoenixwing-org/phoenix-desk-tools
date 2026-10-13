import fs from "node:fs";
import * as Vue from "vue";
import { compileTemplate, parse } from "vue/compiler-sfc";
import { afterEach, expect, it } from "vitest";
import type { TaskDraft } from "./api";

// Compile the production page's checkbox markup on a synthetic Vue host;
// no browser, workspace, API operation or real CAD sample is involved.
const source = fs.readFileSync(new URL("./RenameTasksPage.vue", import.meta.url), "utf8");
const template = parse(source).descriptor.template!.content;
const controls = template.match(/<div class="inline-row"><el-checkbox[\s\S]*?<\/div>/)![0];
const compiled = compileTemplate({ source: controls, filename: "RenameTaskScopes.vue", id: "synthetic-scopes" });
if (compiled.errors.length) throw new Error(String(compiled.errors));
const code = compiled.code.replace(/import \{([^}]+)\} from "vue"/g, (_all, names: string) => `const {${names.replace(/\bas\b/g, ":")}} = Vue`)
  .replace("export function render", "function render");
const render = new Function("Vue", `${code}\nreturn render;`)(Vue);
type HostNode = { parent: HostNode | null; children: HostNode[] };
const node = (): HostNode => ({ parent: null, children: [] });
const mounted: Array<{ unmount: () => void }> = [];
afterEach(() => { for (const app of mounted.splice(0)) app.unmount(); });

function setup(directories = false, filenames = true, contents = true) {
  const draft = Vue.reactive<TaskDraft>({ name: "Synthetic", roots: ["/example"], mappings: [], directories, filenames, contents, include_stem: false });
  const switches = new Map<string, (checked: boolean) => void>();
  const checkbox = Vue.defineComponent({ props: { modelValue: Boolean, disabled: Boolean }, emits: ["update:modelValue", "change"], setup: (p, { emit, slots }) => () => {
    const children = slots.default?.() || [];
    const label = children.map(child => typeof child.children === "string" ? child.children : "").join("");
    switches.set(label, checked => { if (!p.disabled) { emit("update:modelValue", checked); emit("change", checked); } });
    return Vue.h("input", { checked: p.modelValue, disabled: p.disabled });
  } });
  const renderer = Vue.createRenderer<HostNode, HostNode>({
    createElement: node, createText: node, createComment: node,
    setText() {}, setElementText() {}, patchProp() {},
    parentNode: el => el.parent, nextSibling: el => el.parent?.children[el.parent.children.indexOf(el) + 1] || null,
    insert(el, parent, anchor) { if (el.parent) el.parent.children.splice(el.parent.children.indexOf(el), 1); el.parent = parent; const index = anchor ? parent.children.indexOf(anchor) : -1; parent.children.splice(index < 0 ? parent.children.length : index, 0, el); },
    remove(el) { if (el.parent) el.parent.children.splice(el.parent.children.indexOf(el), 1); el.parent = null; },
  });
  const app = renderer.createApp({ setup: () => ({ rename: { draft }, busy: false }), render });
  app.component("ElCheckbox", checkbox); mounted.push(app); app.mount(node());
  return { draft, toggle: (label: string, checked: boolean) => {
    const update = switches.get(label); if (!update) throw new Error(`Missing scope checkbox: ${label}`); update(checked);
  } };
}

it("lets folders join both file scopes without clearing them, and deselects each independently", async () => {
  const { draft, toggle } = setup();
  toggle("文件夹名", true); await Vue.nextTick();
  expect(draft).toMatchObject({ directories: true, filenames: true, contents: true });
  toggle("文件名", false); await Vue.nextTick();
  expect(draft).toMatchObject({ directories: true, filenames: false, contents: true });
  toggle("文件内容", false); await Vue.nextTick();
  expect(draft).toMatchObject({ directories: true, filenames: false, contents: false });
  toggle("文件名", true); toggle("文件内容", true); await Vue.nextTick();
  expect(draft).toMatchObject({ directories: true, filenames: true, contents: true });
  toggle("文件夹名", false);
  expect(draft).toMatchObject({ directories: false, filenames: true, contents: true });
});

it("lets both file scopes join a folders-only task", () => {
  const { draft, toggle } = setup(true, false, false);
  toggle("文件名", true); toggle("文件内容", true);
  expect(draft).toMatchObject({ directories: true, filenames: true, contents: true });
});

it("keeps file suffix filters available while directory scope is selected", () => {
  expect(template).toContain("<RenameExtensionFilter :filters=");
  expect(template).not.toContain('v-if="!rename.draft.directories"');
  expect(template).toContain("目录取消勾选不改变子文件勾选");
});
