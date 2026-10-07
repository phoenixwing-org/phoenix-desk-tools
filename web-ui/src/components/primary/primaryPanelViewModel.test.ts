import { describe, expect, it } from "vitest";
import type { PagePrimarySection } from "../../composables/usePagePrimaryContribution";
import {
  primaryPanelBlocks,
  primarySectionCountLabel,
  primarySectionLayout,
  primarySectionStateKey,
} from "./primaryPanelViewModel";

const noop = () => undefined;

describe("Primary panel ViewModel", () => {
  it("puts navigation first without reordering other sections or changing their identity", () => {
    const scope = { id: "scope", title: "范围" };
    const tools = { id: "tools", title: "功能", placement: "before-context" as const };
    const result = { id: "result", title: "结果" };
    const blocks = primaryPanelBlocks([scope, tools, result]);
    expect(blocks.map(block => block.key)).toEqual(["section:tools", "context", "status", "section:scope", "section:result"]);
    expect(blocks[0]).toMatchObject({ section: tools });
    expect(primaryPanelBlocks([scope]).map(block => block.key)).toEqual(["context", "status", "section:scope"]);
    expect(primaryPanelBlocks([]).map(block => block.key)).toEqual(["context", "status"]);
  });
  it("compacts homogeneous readonly and boolean sections only", () => {
    const readonly: PagePrimarySection = {
      id: "stats",
      title: "统计",
      controls: [
        { id: "all", kind: "readonly", label: "全部", value: 12 },
        { id: "ready", kind: "readonly", label: "就绪", value: 8 },
      ],
    };
    const booleans: PagePrimarySection = {
      id: "options",
      title: "选项",
      controls: [
        { id: "cpp", kind: "boolean", label: "C++", modelValue: true, onUpdate: noop },
        { id: "header", kind: "boolean", label: "头文件", modelValue: true, onUpdate: noop },
      ],
    };
    const mixed: PagePrimarySection = {
      id: "scope",
      title: "范围",
      controls: [
        { id: "path", kind: "text", label: "路径", modelValue: ".", onUpdate: noop },
        { id: "recursive", kind: "boolean", label: "递归", modelValue: true, onUpdate: noop },
      ],
    };

    expect(primarySectionLayout(readonly)).toBe("readonly-grid");
    expect(primarySectionLayout(booleans)).toBe("boolean-grid");
    expect(primarySectionLayout(mixed)).toBe("stack");
  });

  it("projects concise section metadata and isolates collapse state by tab", () => {
    const section: PagePrimarySection = {
      id: "scope",
      title: "范围",
      controls: [{ id: "path", kind: "readonly", label: "路径", value: "." }],
      actions: [{ id: "scan", label: "扫描", run: noop }],
    };

    expect(primarySectionCountLabel(section)).toBe("1 项 · 1 操作");
    expect(primarySectionStateKey("code_ignore", "tab-a", "scope")).toBe("tab-a:scope");
    expect(primarySectionStateKey("code_ignore", "tab-b", "scope")).not.toBe("tab-a:scope");
    expect(primarySectionStateKey("code_ignore", "", "scope")).toBe("code_ignore:scope");
  });

  it("opts readonly metadata into label/value rows without affecting mixed forms", () => {
    const section: PagePrimarySection = {
      id: "properties", title: "属性", readonlyLayout: "properties",
      controls: [
        { id: "path", kind: "readonly", label: "工作空间", value: "/workspace/example" },
        { id: "count", kind: "readonly", label: "文件数", value: 23 },
      ],
    };
    expect(primarySectionLayout(section)).toBe("properties");
    expect(primarySectionLayout({ ...section, readonlyLayout: undefined })).toBe("readonly-grid");
    expect(primarySectionLayout({ ...section, controls: [] })).toBe("stack");
    expect(primarySectionLayout({ ...section, controls: [...section.controls!,
      { id: "search", kind: "text", label: "搜索", modelValue: "", onUpdate: noop },
    ] })).toBe("stack");
  });
});
