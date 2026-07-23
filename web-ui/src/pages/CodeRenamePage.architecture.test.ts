import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const source = fs.readFileSync(path.resolve(__dirname, "CodeRenamePage.vue"), "utf8");

describe("Code rename shared results UI architecture", () => {
  it("consumes the Wing projection and Web Component without a private result table", () => {
    expect(source).toContain("pnwCodeDefineRenameResultsPanel()");
    expect(source).toContain("<pnw-code-rename-results-panel");
    expect(source).toContain("pnwCodeProjectRenameResults");
    expect(source).not.toContain("<el-table");
    expect(source).not.toContain("result-status");
  });
});
