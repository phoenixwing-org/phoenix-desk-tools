import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./ReorderMembersPage.vue", import.meta.url), "utf8");

describe("ReorderMembersPage shared results boundary", () => {
  it("消费 Wing 成员排序 Web Component，不保留第二套结果表", () => {
    expect(source).toContain('from "@phoenix-wing/code-core/ui"');
    expect(source).toContain("pnwCodeDefineReorderMembersPanel()");
    expect(source).toContain("const reorderPanelMessage = computed");
    expect(source).toContain("<pnw-code-reorder-members-panel");
    expect(source).toContain('@pnw-code-reorder-members-action="onReorderPanelAction"');
    expect(source).not.toContain('class="changed-table"');
    expect(source).not.toContain("<el-table-column label=\"操作\"");
  });

  it("共享组件只发语义动作，Desk Host 校验结果行后处理 Git 与 Revert", () => {
    expect(source).toContain('detail.kind !== "reorderAction"');
    expect(source).toContain("!row || !canGitActions(row)");
    expect(source).toContain('detail.action === "gitDiff"');
    expect(source).toContain('previewGitDiff(path, "worktree")');
    expect(source).toContain('detail.action === "revert"');
    expect(source).toContain("await onRevertFile(row)");
  });
});
