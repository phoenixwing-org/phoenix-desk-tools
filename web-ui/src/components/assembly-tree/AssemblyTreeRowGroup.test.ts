import { createSSRApp } from "vue";
import { renderToString } from "vue/server-renderer";
import { describe, expect, it } from "vitest";
import type { AssemblyTreeNode } from "../../api";
import AssemblyTreeRowGroup from "./AssemblyTreeRowGroup.vue";
import { assemblyTreeEditKey } from "../../models/assemblyTreeViewModel";

const node: AssemblyTreeNode = {
  id: "multi",
  host_repo_rel: "assemblies/Root.Assy.FCStd",
  repo_rel_path: "parts/Pump.FCStd",
  basename: "Pump.FCStd",
  resolve_status: "resolved",
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
    position: "2.1",
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
  it("目标文件主链接为最终零件，经由总成仅在 tooltip，且位于最后一列", async () => {
    const html = await render({ instanceExpanded: false, node: { ...node, xref_instances: [{ ...node.xref_instances[0],
      resolved_target_repo_rel: "parts/ActualPin.FCStd", direct_target_repo_rel: "assemblies/Via.Assy.FCStd" }] } });
    const cells = [...html.matchAll(/<td\b[\s\S]*?<\/td>/g)].map(match => match[0]);
    expect(cells).toHaveLength(5);
    expect(cells[4]).toContain('title="parts/ActualPin.FCStd\n经由：assemblies/Via.Assy.FCStd"');
    expect(cells[4]).toContain("ActualPin.FCStd");
    expect(cells[4].replace(/<[^>]*>/g, "")).not.toContain("经由");
    expect(cells[4]).toContain('class="row-actions"');
  });
  it("真实 SSR 以三个同级 TR 渲染主行和两个实例行", async () => {
    const html = await render();
    expect((html.match(/<tr(?:\s|>)/gu) ?? [])).toHaveLength(3);
    expect((html.match(/<td(?:\s|>)/gu) ?? [])).toHaveLength(15);
    expect(html).toMatch(/class="col-position"[^>]*>2\.1<\/td>/);
    expect(html).toContain('style="padding-left:22px;"');
    expect(html).toContain('style="padding-left:54px;"');
    expect(html).toContain('value="泵体实例"');
    expect(html).toContain('value="泵体实例.001"');
    expect(html).toContain('value="泵体实例.002"');
    expect(html).toContain("改链接");
  });

  it("只读、无悬浮操作和折叠实例均由受控 props 决定", async () => {
    const html = await render({ editable: false, xlinkReplace: false, showXlinkActionCol: false, instanceExpanded: false });
    expect((html.match(/<tr(?:\s|>)/gu) ?? [])).toHaveLength(1);
    expect(html).not.toContain('class="label-input');
    expect(html).not.toContain('class="col-action"');
    expect(html).not.toContain("改链接");
  });

  it("加载即标记差异并展示逐实例推荐，不自动填值或生成待应用草稿", async () => {
    const identified = { ...node, xref_instances: [
      { xlink_file_attr: "parts.FCStd", host_object_name: "A", target_object_name: "Body", link_label: "错误总成名", rule_label: "泵体.001" },
      { xlink_file_attr: "parts.FCStd", host_object_name: "B", target_object_name: "Body", link_label: "错误总成名", rule_label: "泵体.002" },
    ] };
    const html = await render({ node: identified });
    expect((html.match(/value="错误总成名"/g) ?? [])).toHaveLength(2);
    expect(html).toContain('title="推荐：泵体.001"');
    expect(html).toContain('title="推荐：泵体.002"');
    expect(html).toContain("label-input-mismatch");
    expect(html).toContain("待修正");
    expect(html).not.toContain("label-input-edited");
    expect(html).not.toContain("待应用");
    expect((html.match(/class="btn-recommendation"/g) ?? [])).toHaveLength(2);
    const filled = await render({ node: identified, edits: new Map(identified.xref_instances.map(instance =>
      [assemblyTreeEditKey(node.host_repo_rel, instance.xlink_file_attr, instance), instance.rule_label])) });
    expect(filled).toContain('value="泵体.001"');
    expect(filled).toContain("待应用");
    expect(filled).not.toContain('title="推荐：');
    expect(filled).toContain('class="row-actions"');
    expect(filled).not.toContain('class="col-action"');
  });

  it("折叠实例差异只保留状态，不增加提示行；规则缺失或歧义不误报", async () => {
    const safe = { xlink_file_attr: "part.FCStd", host_object_name: "A", target_object_name: "Body", link_label: "泵体.001", rule_label: "泵体.001" };
    const grouped = { ...node, xref_instances: [safe, { ...safe, host_object_name: "B", link_label: "旧标签", rule_label: "泵体.002" }] };
    const html = await render({ node: grouped, instanceExpanded: false });
    expect(html).not.toContain("点击数量查看");
    expect(html).toContain("待修正");
    expect(html).not.toContain("label-input-mismatch");
    const blocked = await render({ node: { ...node, xref_instances: [{ ...safe, rule_label: "", rule_error: "目标对象缺失" }] } });
    expect(blocked).not.toContain('class="label-recommendation"');
    expect(blocked).not.toContain("label-input-mismatch");
    expect(blocked).toContain("需确认");
  });

  it("增加行定位与逐实例应用事件，不公开第二份状态", () => {
    const component = AssemblyTreeRowGroup as unknown as {
      props?: Record<string, unknown>;
      emits?: string[];
    };
    expect(Object.keys(component.props ?? {})).toEqual(expect.arrayContaining([
      "node",
      "depth",
      "position",
      "edits",
      "treeExpanded",
      "instanceExpanded",
      "hasSubtree",
      "subtreeLoading",
      "editable",
      "xlinkReplace",
      "showXlinkActionCol",
    ]));
    expect(Object.keys(component.props ?? {})).toHaveLength(11);
    expect(component.emits).toEqual([
      "toggle",
      "toggle-instances",
      "label-input",
      "open-file",
      "replace-xlink",
      "apply-label-instance",
    ]);
  });
});
