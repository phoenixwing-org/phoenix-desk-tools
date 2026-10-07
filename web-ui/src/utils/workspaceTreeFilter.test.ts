import { expect, it } from "vitest";
import type { TreeNode } from "../api";
import { countTreeFiles, fileMatchesTreeFilter, filterTreeNode } from "./workspaceTreeFilter";

const file = (name: string, directory = "demo/parts"): TreeNode => ({ name, path: `${directory}/${name}`, type: "file" });
it("matches all whitespace-separated terms, case-insensitively, across filename and path", () => {
  const node = file("710101.001-支架.FCStd");
  expect(fileMatchesTreeFilter(node, "  DEMO\t支架  001 ")).toBe(true);
  expect(fileMatchesTreeFilter(node, "支架\u3000001")).toBe(true);
  expect(fileMatchesTreeFilter(node, "支架 002")).toBe(false);
  expect(fileMatchesTreeFilter(node, " ")).toBe(true);
});
it("keeps only matching files and their ancestor branches without changing the source tree", () => {
  const tree: TreeNode = { name: "demo", path: "demo", type: "dir", children: [
    { name: "parts", path: "demo/parts", type: "dir", children: [file("710101.001-支架.FCStd"), file("710101.002-支架.FCStd"), file("710102.001-面板.FCStd")] },
  ] };
  const result = filterTreeNode(tree, "支架 001")!;
  expect(countTreeFiles(result)).toBe(1);
  expect(result.children?.[0].children?.[0].name).toBe("710101.001-支架.FCStd");
  expect(countTreeFiles(tree)).toBe(3);
  expect(filterTreeNode(tree, "not present")).toBeNull();
});
