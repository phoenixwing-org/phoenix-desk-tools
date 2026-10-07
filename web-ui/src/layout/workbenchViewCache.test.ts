import { createRenderer, defineComponent, h, KeepAlive, nextTick, onMounted, onUnmounted } from "vue";
import { expect, it } from "vitest";
import { createWorkbenchViewCache } from "./workbenchViewCache";
import type { WorkbenchTab } from "../types/workbench";

type Node = { parent: Node | null; children: Node[] };
const node = (): Node => ({ parent: null, children: [] });
function renderer() {
  return createRenderer<Node, Node>({
    createElement: node, createText: node, createComment: node,
    setText() {}, setElementText() {}, patchProp() {},
    parentNode: el => el.parent,
    nextSibling: el => el.parent?.children[el.parent.children.indexOf(el) + 1] ?? null,
    insert(el, parent, anchor) {
      if (el.parent) el.parent.children.splice(el.parent.children.indexOf(el), 1);
      el.parent = parent;
      const idx = anchor ? parent.children.indexOf(anchor) : -1;
      parent.children.splice(idx < 0 ? parent.children.length : idx, 0, el);
    },
    remove(el) {
      if (el.parent) el.parent.children.splice(el.parent.children.indexOf(el), 1);
      el.parent = null;
    },
  });
}
function tab(id: string): WorkbenchTab { return { id, pageId: "detail", title: id, dirty: false, payloadConsumed: true }; }

it("unmounts replaced/closed tabs, but pinning or switching keeps live edits in the same instance", async () => {
  const mounted: string[] = [], unmounted: string[] = [];
  const Page = defineComponent({
    props: { workbenchTabId: String },
    setup(props) {
      onMounted(() => mounted.push(props.workbenchTabId!));
      onUnmounted(() => unmounted.push(props.workbenchTabId!));
      return () => h("div");
    },
  });
  const cache = createWorkbenchViewCache(() => Page), { render } = renderer(), root = node();
  const first = tab("first"), second = tab("second"), third = tab("third");
  async function show(active: WorkbenchTab, open: WorkbenchTab[]) {
    cache.retain(open.map(tab => tab.id));
    render(h(KeepAlive, { include: open.map(tab => cache.nameFor(tab.id)) }, () => h(cache.componentFor(active), { key: active.id })), root);
    await nextTick();
  }
  await show(first, [first]);
  first.preview = false;
  await show(first, [first]);
  await show(second, [first, second]);
  await show(first, [first, second]);
  expect(mounted).toEqual(["first", "second"]);
  expect(unmounted).toEqual([]);
  await show(third, [first, third]);
  expect(unmounted).toEqual(["second"]);
  await show(first, [first]);
  expect(unmounted).toEqual(["second", "third"]);
  render(null, root);
  expect(unmounted).toEqual(["second", "third", "first"]);
});
