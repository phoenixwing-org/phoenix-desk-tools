import { createSSRApp } from "vue";
import { renderToString } from "vue/server-renderer";
import { ID_INJECTION_KEY } from "element-plus";
import { expect, it } from "vitest";
import TreeBranch from "./TreeBranch.vue";
import type { TreeNode } from "../api";

const node: TreeNode = { type: "dir", name: "Workspace", path: "", children: [
  { type: "dir", name: "Parts", path: "parts", children: [{ type: "file", name: "Plate.FCStd", path: "parts/Plate.FCStd" }] },
] };
async function render(expansion = new Map<string, boolean>(), searching = false) {
  const app = createSSRApp(TreeBranch, { node, selected: null, expansion, searching });
  app.provide(ID_INJECTION_KEY, { prefix: 1, current: 0 });
  return renderToString(app);
}
it("opens only the workspace root by default and does not mount collapsed children", async () => {
  const html = await render();
  expect(html).toContain("Workspace"); expect(html).toContain("Parts");
  expect(html).not.toContain("Plate.FCStd");
  expect(html).toContain('aria-expanded="false"');
});
it("restores explicit folder/root state and expands filtered matches temporarily", async () => {
  expect(await render(new Map([["parts", true]]))).toContain("Plate.FCStd");
  expect(await render(new Map([["", false]]))).not.toContain("Parts");
  expect(await render(new Map(), true)).toContain("Plate.FCStd");
});
