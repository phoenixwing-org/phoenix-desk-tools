import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(relative: string): string {
  return readFileSync(new URL(relative, import.meta.url), "utf8");
}

describe("AssemblyTreeTable boundary", () => {
  it("组件消费纯树投影，不再内联标签补丁和递归行算法", () => {
    const component = source("./AssemblyTreeTable.vue");
    expect(component).toContain('from "../models/assemblyTreeViewModel"');
    expect(component).toContain("assemblyTreeFlatten");
    expect(component).toContain("assemblyTreePendingPatches");
    expect(component).not.toContain("function flatten(");
    expect(component).not.toContain("function walkNodes(");
    expect(component).not.toContain("function editKey(");
  });

  it("纯模型不访问 Vue、宿主、浏览器、API 或组件", () => {
    const model = source("../models/assemblyTreeViewModel.ts");
    expect(model).not.toMatch(/from ["']vue["']|from ["']\.\.\/api["']|useAppShell|fetchAssemblyTreeByHost|localStorage|window\.|document\.|\.vue["']/);
    expect(model).toContain("assemblyTreeApplyRuleLabels");
    expect(model).toContain("assemblyTreeToggleVisualState");
  });
});
