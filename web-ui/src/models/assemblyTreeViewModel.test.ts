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
  assemblyTreeRemainingPatches,
  assemblyTreeCanLoadSourceChildren,
  assemblyTreeLabelRecommendation,
  assemblyTreeLabelDiffersFromRule,
  assemblyTreeTargetFile,
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
  it("被动推荐与显式填入使用同一规则，不改原值；最终文件与直接引用分开", () => {
    const instance = { xlink_file_attr: "assembly.FCStd", host_object_name: "Link", target_object_name: "Projection",
      link_label: "旧总成名", rule_label: "DEMO-P.001-示例销", resolved_target_repo_rel: "parts/Pin.FCStd", direct_target_repo_rel: "assemblies/Root.Assy.FCStd" };
    const projected = { ...child, xref_instances: [instance] };
    expect(assemblyTreeLabelRecommendation(projected, instance)).toBe("DEMO-P.001-示例销");
    expect(assemblyTreeLabelDiffersFromRule(projected, instance)).toBe(true);
    expect(assemblyTreeLabelDiffersFromRule(projected, instance, "DEMO-P.001–示例销")).toBe(false);
    expect(assemblyTreePendingPatches([projected], new Map(), childrenOf)).toEqual([]);
    expect(instance.link_label).toBe("旧总成名");
    expect(assemblyTreeLabelRecommendation(projected, { ...instance, rule_error: "歧义" })).toBe("");
    expect(assemblyTreeLabelRecommendation(projected, { ...instance, rule_label: "" })).toBe("");
    expect(assemblyTreeTargetFile(projected)).toEqual({ repoRelPath: "parts/Pin.FCStd", basename: "Pin.FCStd",
      viaRepoRelPath: "assemblies/Root.Assy.FCStd", viaBasename: "Root.Assy.FCStd" });
    expect(assemblyTreeTargetFile(projected, { ...instance, direct_target_repo_rel: "./parts/Pin.FCStd" }).viaRepoRelPath).toBe("");
    expect(assemblyTreeTargetFile(child).repoRelPath).toBe(child.repo_rel_path);
    expect(projected.xref_instances[0].xlink_file_attr).toBe("assembly.FCStd");
  });
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
    expect(assemblyTreeRole({ ...root, structure_source: "host_objects", file_role: "part" })).toBe("part");
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

  it("同文件不同对象独立推荐，重复点击不撤销草稿，撤销仅影响一行", () => {
    const node: Node = { ...child, structure_source: "host_objects", xref_instances: [
      { xlink_file_attr: "same.FCStd", host_object_name: "LinkA", target_object_name: "PartA", link_label: "wrong", rule_label: "主轴" },
      { xlink_file_attr: "same.FCStd", host_object_name: "LinkB", target_object_name: "PartB", link_label: "wrong", rule_label: "轴套.001" },
    ] };
    const first = assemblyTreeApplyRuleLabels([node], new Map(), childrenOf);
    expect(first.filled).toBe(2);
    const again = assemblyTreeApplyRuleLabels([node], first.edits, childrenOf);
    expect(again.filled).toBe(0);
    expect(again.edits).toEqual(first.edits);
    const patches = assemblyTreePendingPatches([node], again.edits, childrenOf);
    expect(patches.map(p => [p.host_object_name, p.link_label])).toEqual([["LinkA", "主轴"], ["LinkB", "轴套.001"]]);
    expect(assemblyTreeRemainingPatches(patches, [patches[0]], [])).toEqual([patches[1]]);
    expect(assemblyTreeRemainingPatches(patches, [patches[0]], [{ host_repo_rel: node.host_repo_rel! }])).toEqual(patches);
    expect(assemblyTreeRemainingPatches(patches, [patches[0]], [{ host_repo_rel: "" }])).toEqual(patches);
    const undone = assemblyTreeWithLabelEdit(again.edits, node.host_repo_rel!, node.xref_instances![0], "wrong");
    expect(assemblyTreePendingPatches([node], undone, childrenOf)).toEqual([patches[1]]);
    expect(assemblyTreeCanLoadSourceChildren(node)).toBe(false);
  });

  it("层级序号不受折叠影响，对象无建议不回退成文件根名称", () => {
    expect(assemblyTreeFlatten([root, child], new Set(["root"]), childrenOf).map(row => row.position)).toEqual(["1", "1.1", "2"]);
    expect(assemblyTreeFlatten([root, child], new Set(), childrenOf).map(row => row.position)).toEqual(["1", "2"]);
    const invalid: Node = { ...child, xref_instances: [{ xlink_file_attr: "same.FCStd", host_object_name: "LinkA", target_object_name: "missing", rule_label: "", rule_error: "目标缺失" }] };
    expect(assemblyTreeApplyRuleLabels([invalid], new Map(), childrenOf)).toMatchObject({ filled: 0, noRule: 1 });
  });
});
