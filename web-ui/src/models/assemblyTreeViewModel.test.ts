import { describe, expect, it } from "vitest";
import {
  assemblyTreeApplyRuleLabels,
  assemblyTreeDisplayLabel,
  assemblyTreeFlatten,
  assemblyTreeInstanceRows,
  assemblyTreeInstancesOf,
  assemblyTreeIsAssembly,
  assemblyTreeIsLabelEdited,
  assemblyTreePendingChanges,
  assemblyTreePendingPatches,
  assemblyTreePrimaryXlinkAttr,
  assemblyTreeRole,
  assemblyTreeStatusLabel,
  assemblyTreeToggleAriaLabel,
  assemblyTreeToggleVisualState,
  assemblyTreeWithLabelEdit,
  type AssemblyTreeNodeViewInput,
} from "./assemblyTreeViewModel";

type Node = AssemblyTreeNodeViewInput & { children?: Node[] };

const child: Node = {
  id: "child",
  host_repo_rel: "root.Assy.FCStd",
  repo_rel_path: "parts/100.001.FCStd",
  basename: "100.001.FCStd",
  resolve_status: "resolved",
  xref_instances: [
    { xlink_file_attr: "parts/100.001.FCStd", link_label: "旧标签" },
    { xlink_file_attr: "parts/100.001.FCStd#2", link_label: "旧标签.001" },
  ],
  ref_count: 2,
  part_number: "100",
  part_version: "001",
  PartName: "泵体",
  children: [],
};

const root: Node = {
  id: "root",
  host_repo_rel: "top.Assy.FCStd",
  repo_rel_path: "sub/root.Assy.FCStd",
  basename: "root.Assy.FCStd",
  resolve_status: "resolved",
  xlink_file_attr: "sub/root.Assy.FCStd",
  link_label: "根装配",
  children: [child],
};

const childrenOf = (node: Node) => node.children ?? [];

describe("assembly tree view model", () => {
  it("按展开状态投影树行，并只在显式展开时投影多实例行", () => {
    expect(assemblyTreeFlatten([root], new Set(), childrenOf).map((row) => [row.node.id, row.depth]))
      .toEqual([["root", 0]]);
    expect(assemblyTreeFlatten([root], new Set(["root"]), childrenOf).map((row) => [row.node.id, row.depth]))
      .toEqual([["root", 0], ["child", 1]]);
    expect(assemblyTreeInstanceRows(child, 1, new Set())).toEqual([]);
    expect(assemblyTreeInstanceRows(child, 1, new Set(["child"]))).toHaveLength(1);
  });

  it("兼容单实例回退，并冻结角色、状态与懒展开语义", () => {
    expect(assemblyTreeInstancesOf(root)).toEqual([
      { xlink_file_attr: "sub/root.Assy.FCStd", link_label: "根装配" },
    ]);
    expect(assemblyTreePrimaryXlinkAttr(root)).toBe("sub/root.Assy.FCStd");
    expect(assemblyTreeIsAssembly(root)).toBe(true);
    expect(assemblyTreeRole(root)).toBe("assembly");
    expect(assemblyTreeStatusLabel("ambiguous")).toBe("歧义");
    expect(assemblyTreeToggleVisualState(root, new Set(), new Set(), false)).toBe("lazy");
    expect(assemblyTreeToggleAriaLabel(root, new Set(), new Set(), false)).toBe("加载并展开该装配的下级子件");
  });

  it("集中标签编辑比较、规则预览与写盘补丁投影", () => {
    const instance = assemblyTreeInstancesOf(child)[0];
    const edited = assemblyTreeWithLabelEdit(new Map(), child.host_repo_rel!, instance, "手工标签");
    expect(assemblyTreeDisplayLabel(edited, child.host_repo_rel!, instance)).toBe("手工标签");
    expect(assemblyTreeIsLabelEdited(edited, child.host_repo_rel!, instance)).toBe(true);
    expect(assemblyTreePendingPatches([root], edited, childrenOf)).toEqual([{
      host_repo_rel: "root.Assy.FCStd",
      xlink_file_attr: "parts/100.001.FCStd",
      link_label: "手工标签",
    }]);
    expect(assemblyTreePendingChanges([root], edited, childrenOf)[0]).toMatchObject({
      old_label: "旧标签",
      new_label: "手工标签",
    });

    const preview = assemblyTreeApplyRuleLabels([root], new Map(), childrenOf);
    expect(preview.filled).toBe(3);
    expect(preview.unchanged).toBe(0);
    expect(preview.noRule).toBe(0);
    expect(assemblyTreePendingPatches([root], preview.edits, childrenOf)).toEqual([
      expect.objectContaining({ link_label: "root.Assy.FCStd" }),
      expect.objectContaining({ link_label: "100.001-泵体" }),
      expect.objectContaining({ link_label: "100.001-泵体" }),
    ]);
  });

  it("缺失节点不生成写盘补丁", () => {
    const missing: Node = { ...child, resolve_status: "missing" };
    const instance = assemblyTreeInstancesOf(missing)[0];
    const edited = assemblyTreeWithLabelEdit(new Map(), missing.host_repo_rel!, instance, "新标签");
    expect(assemblyTreePendingPatches([missing], edited, childrenOf)).toEqual([]);
  });
});
