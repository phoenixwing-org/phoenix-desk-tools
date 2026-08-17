import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./CodeUuidReplacePage.vue", import.meta.url), "utf8");

describe("CodeUuidReplacePage shared result boundary", () => {
  it("将 Host DTO 映射到 Wing UUID Web Component，不保留第二套结果表", () => {
    expect(source).toContain('from "@phoenix-wing/code-core/ui"');
    expect(source).toContain("pnwCodeDefineUuidResultsPanel()");
    expect(source).toContain("pnwCodeGroupUuidHits(uuidViewHits.value)");
    expect(source).toContain("pnwCodeSelectUuidHitIds(uuidViewHits.value");
    expect(source).toContain("pnwCodeSelectedUuidGroupCount(uuidViewHits.value");
    expect(source).toContain("<pnw-code-uuid-results-panel");
    expect(source).toContain('@pnw-code-uuid-results-action="onUuidResultsAction"');
    expect(source).not.toContain('class="entry-table resizable-hits-table"');
  });

  it("共享组件只发语义事件，Desk Host 负责选择和 Git diff", () => {
    expect(source).toContain('detail.kind === "selection"');
    expect(source).toContain('detail.action !== "gitDiff"');
    expect(source).toContain('previewGitDiff(hit.relativePath, "worktree")');
  });
});
