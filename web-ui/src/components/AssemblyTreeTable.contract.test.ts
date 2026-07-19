import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import AssemblyTreeTable from "./AssemblyTreeTable.vue";

const source = readFileSync(new URL("./AssemblyTreeTable.vue", import.meta.url), "utf8");
const rowSource = readFileSync(
  new URL("./assembly-tree/AssemblyTreeRowGroup.vue", import.meta.url),
  "utf8",
);

describe("AssemblyTreeTable public contract", () => {
  it("冻结七个公开 props 与默认值", () => {
    const component = AssemblyTreeTable as unknown as {
      props?: Record<string, { default?: unknown }>;
    };
    expect(Object.keys(component.props ?? {})).toEqual(expect.arrayContaining([
      "nodes",
      "loading",
      "editable",
      "treeDepth",
      "xlinkReplace",
      "labelEdits",
      "savingLabels",
    ]));
    expect(Object.keys(component.props ?? {})).toHaveLength(7);
    expect(component.props?.editable?.default).toBe(true);
    expect(component.props?.treeDepth?.default).toBe("first");
    expect(component.props?.xlinkReplace?.default).toBe(true);
    expect(component.props?.labelEdits?.default).toBe(false);
    expect(component.props?.savingLabels?.default).toBe(false);
  });

  it("冻结五个上行事件及脏状态 payload", () => {
    const component = AssemblyTreeTable as unknown as { emits?: string[] };
    expect(component.emits).toEqual(expect.arrayContaining([
      "edits-change",
      "need-full-depth",
      "xref-replaced",
      "discard-label-edits",
      "apply-label-edits",
    ]));
    expect(component.emits).toHaveLength(5);
    expect(source).toContain('"edits-change": [hasEdits: boolean]');
  });

  it("冻结六个 defineExpose 方法，Host 仍可读取补丁并控制树", () => {
    const exposeBody = source.match(/defineExpose\(\{([\s\S]*?)\}\);/u)?.[1] ?? "";
    const names = exposeBody
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
    expect(names).toEqual([
      "getPendingPatches",
      "getPendingLabelChanges",
      "hasEdits",
      "resetEdits",
      "expandAllTree",
      "applyRuleLabelsPreview",
    ]);
  });

  it("冻结表壳、五列、工具栏与弹窗装配位置", () => {
    expect(source).toContain('<div v-else class="table-scroll">');
    expect(source).toContain('<table class="asm-tree-table">');
    expect(source).toContain('<th class="col-tree">链接标签</th>');
    expect(source).toContain('<th class="col-file">目标文件</th>');
    expect(source).toContain('<th class="col-qty">数量</th>');
    expect(source).toContain('<th class="col-status">状态</th>');
    expect(source).toContain('v-if="showXlinkActionCol" class="col-action"');
    expect(source).toContain('class="asm-tree-toolbar"');
    expect(source).toContain("<XlinkReplaceDialog");
    expect(rowSource).toContain(':key="`${node.id}-${editKey(node.host_repo_rel, instancesOf(node)[0].xlink_file_attr)}`"');
  });
});
