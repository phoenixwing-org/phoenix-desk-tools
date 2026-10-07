import { createSSRApp } from "vue";
import { renderToString } from "vue/server-renderer";
import { describe, expect, it, vi } from "vitest";
import type { AssemblyTreeNode } from "../api";
import AssemblyTreeTable from "./AssemblyTreeTable.vue";

const shell = vi.hoisted(() => ({
  openFileDetailForRel: vi.fn(),
  setStatus: vi.fn(),
}));

vi.mock("../composables/useAppShell", () => ({
  useAppShell: () => shell,
}));

function node(overrides: Partial<AssemblyTreeNode> = {}): AssemblyTreeNode {
  return {
    id: "resolved",
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
    link_labels: ["泵体实例"],
    xref_instances: [{ xlink_file_attr: "../parts/Pump.FCStd", link_label: "泵体实例" }],
    rule_label: "PN-01.A-泵体",
    ref_count: 1,
    file_role: "part",
    children: [],
    ...overrides,
  };
}

const child = node({ id: "child", basename: "Child.FCStd", repo_rel_path: "parts/Child.FCStd" });
const root = node({
  id: "root",
  basename: "Root.Assy.FCStd",
  repo_rel_path: "assemblies/Root.Assy.FCStd",
  file_role: "assembly",
  link_label: "根装配",
  children: [child],
});
const missing = node({
  id: "missing",
  repo_rel_path: "",
  basename: "Lost.FCStd",
  resolve_status: "missing",
  link_label: "缺失实例",
});
const ambiguous = node({
  id: "ambiguous",
  basename: "Shared.FCStd",
  resolve_status: "ambiguous",
  link_label: "共享实例",
  ref_count: 3,
  link_labels: ["共享实例", "共享实例.001", "共享实例.002"],
  xref_instances: [
    { xlink_file_attr: "Shared.FCStd", link_label: "共享实例" },
    { xlink_file_attr: "Shared.FCStd#2", link_label: "共享实例.001" },
    { xlink_file_attr: "Shared.FCStd#3", link_label: "共享实例.002" },
  ],
});

async function render(overrides: Record<string, unknown> = {}): Promise<string> {
  return renderToString(createSSRApp(AssemblyTreeTable, {
    nodes: [root, missing, ambiguous],
    loading: false,
    editable: true,
    treeDepth: "full",
    xlinkReplace: true,
    labelEdits: true,
    savingLabels: false,
    ...overrides,
  }));
}

function text(html: string): string {
  return html.replace(/<[^>]+>/gu, " ").replace(/\s+/gu, " ").trim();
}

describe("AssemblyTreeTable characterization", () => {
  it("真实 SSR 保留五列、根/子层级、状态和工具栏", async () => {
    const html = await render();
    const visible = text(html);
    expect(visible).toContain("# 链接标签 数量 状态 目标文件");
    expect(html).toContain('value="泵体实例"');
    expect(visible).toContain("Root.Assy.FCStd");
    expect(visible).toContain("Child.FCStd");
    expect(visible).toContain("缺失");
    expect(visible).toContain("歧义");
    expect(visible).toContain("改链接");
    expect(visible).toContain("全部展开");
    expect(visible).toContain("全部折叠");
    expect(visible).toContain("有待应用标签");
    expect((html.match(/<tbody[^>]*>[\s\S]*?<\/tbody>/u)?.[0].match(/<tr(?:\s|>)/gu) ?? [])).toHaveLength(4);
  });

  it("缺失与歧义行保持只读，已解析行保留输入 key 与悬浮操作", async () => {
    const html = await render();
    expect((html.match(/class="label-input/g) ?? [])).toHaveLength(2);
    expect((html.match(/value="泵体实例"/gu) ?? [])).toHaveLength(2);
    expect(html).not.toContain('value="共享实例"');
    expect(html).not.toContain('value="缺失实例"');
    expect(html).not.toContain('class="col-action"');
    expect((html.match(/class="row-actions"/gu) ?? [])).toHaveLength(4);
  });

  it("真实 SSR 保留 loading、empty、只读和无操作列分支", async () => {
    expect(text(await render({ loading: true }))).toContain("加载装配树…");
    expect(text(await render({ nodes: [] }))).toContain("无下级引用（或引用表未构建）");
    const readonly = await render({ editable: false, xlinkReplace: false, labelEdits: false });
    expect(readonly).not.toContain('class="label-input');
    expect(readonly).not.toContain('class="col-action"');
    expect(text(readonly)).not.toContain("标签已修改，点「应用」后写回 FCStd");
  });
});
