import { describe, expect, it } from "vitest";
import type { PagePrimarySection } from "../../composables/usePagePrimaryContribution";
import {
  primarySectionCountLabel,
  primarySectionLayout,
  primarySectionStateKey,
} from "./primaryPanelViewModel";

const noop = () => undefined;

describe("Primary panel ViewModel", () => {
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
    expect(primarySectionStateKey("code_index", "tab-a", "scope")).toBe("tab-a:scope");
    expect(primarySectionStateKey("code_index", "tab-b", "scope")).not.toBe("tab-a:scope");
    expect(primarySectionStateKey("code_index", "", "scope")).toBe("code_index:scope");
  });
});
