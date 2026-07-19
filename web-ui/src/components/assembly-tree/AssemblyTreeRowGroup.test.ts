import { createSSRApp } from "vue";
import { renderToString } from "vue/server-renderer";
import { describe, expect, it } from "vitest";
import type { AssemblyTreeNode } from "../../api";
import AssemblyTreeRowGroup from "./AssemblyTreeRowGroup.vue";

const node: AssemblyTreeNode = {
  id: "multi",
  host_repo_rel: "assemblies/Root.Assy.FCStd",
  repo_rel_path: "parts/Pump.FCStd",
  basename: "Pump.FCStd",
  resolve_status: "ambiguous",
  xlink_file_attr: "../parts/Pump.FCStd",
  part_number: "PN-01",
  part_version: "A",
  part_key: "PN-01.A",
  TypeCode: "Part",
  ModelSeries: "PUMP",
  PartName: "泵体",
  label: "Pump",
  link_label: "泵体实例",
  link_labels: ["泵体实例", "泵体实例.001", "泵体实例.002"],
  xref_instances: [
    { xlink_file_attr: "../parts/Pump.FCStd", link_label: "泵体实例" },
    { xlink_file_attr: "../parts/Pump.FCStd#2", link_label: "泵体实例.001" },
    { xlink_file_attr: "../parts/Pump.FCStd#3", link_label: "泵体实例.002" },
  ],
  rule_label: "PN-01.A-泵体",
  ref_count: 3,
  file_role: "part",
  children: [],
};

function props(overrides: Record<string, unknown> = {}) {
  return {
    node,
    depth: 1,
    edits: new Map<string, string>(),
    treeExpanded: false,
    instanceExpanded: true,
    hasSubtree: false,
    subtreeLoading: false,
    editable: true,
    xlinkReplace: true,
    showXlinkActionCol: true,
    ...overrides,
  };
}

async function render(overrides: Record<string, unknown> = {}): Promise<string> {
  return renderToString(createSSRApp(AssemblyTreeRowGroup, props(overrides)));
}

describe("AssemblyTreeRowGroup", () => {
  it("真实 SSR 以三个同级 TR 渲染主行和两个实例行", async () => {
    const html = await render();
    expect((html.match(/<tr(?:\s|>)/gu) ?? [])).toHaveLength(3);
    expect((html.match(/<td(?:\s|>)/gu) ?? [])).toHaveLength(15);
    expect(html).toContain('class="row-ambiguous"');
    expect(html).toContain('style="padding-left:22px;"');
    expect(html).toContain('style="padding-left:54px;"');
    expect(html).toContain('value="泵体实例"');
    expect(html).toContain('value="泵体实例.001"');
    expect(html).toContain('value="泵体实例.002"');
    expect(html).toContain("改链接");
  });

  it("只读、无操作列和折叠实例均由受控 props 决定", async () => {
    const html = await render({ editable: false, xlinkReplace: false, showXlinkActionCol: false, instanceExpanded: false });
    expect((html.match(/<tr(?:\s|>)/gu) ?? [])).toHaveLength(1);
    expect(html).not.toContain('class="label-input');
    expect(html).not.toContain('class="col-action"');
    expect(html).not.toContain("改链接");
  });

  it("公开十个只读 props 与五个语义事件，不公开第二份状态", () => {
    const component = AssemblyTreeRowGroup as unknown as {
      props?: Record<string, unknown>;
      emits?: string[];
    };
    expect(Object.keys(component.props ?? {})).toEqual(expect.arrayContaining([
      "node",
      "depth",
      "edits",
      "treeExpanded",
      "instanceExpanded",
      "hasSubtree",
      "subtreeLoading",
      "editable",
      "xlinkReplace",
      "showXlinkActionCol",
    ]));
    expect(Object.keys(component.props ?? {})).toHaveLength(10);
    expect(component.emits).toEqual([
      "toggle",
      "toggle-instances",
      "label-input",
      "open-file",
      "replace-xlink",
    ]);
  });
});
