import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(relative: string): string {
  return readFileSync(new URL(relative, import.meta.url), "utf8");
}

describe("AssemblyTreeTable boundary", () => {
  it("组件消费纯树投影和可注入展开 Controller，不再内联递归/懒加载算法", () => {
    const component = source("./AssemblyTreeTable.vue");
    const controller = source("../composables/useAssemblyTreeController.ts");
    expect(component).toContain('from "../models/assemblyTreeViewModel"');
    expect(component).toContain('from "./assembly-tree/AssemblyTreeRowGroup.vue"');
    expect(component).toContain("useAssemblyTreeController");
    expect(controller).toContain("assemblyTreeFlatten");
    expect(controller).toContain("fetchSubtree?: (");
    expect(controller).toContain("const pending = inFlight.get(node.id)");
    expect(controller).toContain("requestGeneration === generation");
    expect(component).toContain("assemblyTreePendingPatches");
    expect(component).not.toContain("fetchAssemblyTreeByHost");
    expect(component).not.toContain("async function ensureSubtree");
    expect(component).not.toContain("function flatten(");
    expect(component).not.toContain("function walkNodes(");
    expect(component).not.toContain("function editKey(");
    expect(component).not.toContain('class="tree-item"');
    expect(component).not.toContain('class="label-input"');
  });

  it("纯模型不访问 Vue、宿主、浏览器、API 或组件", () => {
    const model = source("../models/assemblyTreeViewModel.ts");
    expect(model).not.toMatch(/from ["']vue["']|from ["']\.\.\/api["']|useAppShell|fetchAssemblyTreeByHost|localStorage|window\.|document\.|\.vue["']/);
    expect(model).toContain("assemblyTreeApplyRuleLabels");
    expect(model).toContain("assemblyTreeToggleVisualState");
  });

  it("行渲染器只消费受控投影并上抛语义事件，不拥有 Host 或第二份状态", () => {
    const row = source("./assembly-tree/AssemblyTreeRowGroup.vue");
    expect(row).toContain("ReadonlyMap<string, string>");
    expect(row).toContain('"label-input": [node: AssemblyTreeNode');
    expect(row).toContain('"replace-xlink": [node: AssemblyTreeNode]');
    expect(row).toContain('import type { AssemblyTreeNode } from "../../api"');
    expect(row).not.toMatch(/import\s+(?!type\b)[^;]*from ["'][^"']*api["']/u);
    expect(row).not.toMatch(/useAppShell|fetchAssemblyTreeByHost|XlinkReplaceDialog|localStorage|sessionStorage|\bref\(|\breactive\(/u);
  });
});
