import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(relative: string): string {
  return readFileSync(new URL(relative, import.meta.url), "utf8");
}

describe("UnitTestResultPane 契约", () => {
  const page = source("../../pages/UnitTestsPage.vue");
  const pane = source("./UnitTestResultPane.vue");

  it("Pane 拥有结果 DOM、case 展开与横滚，Page 保留过滤状态和运行编排", () => {
    expect(page).toContain("<UnitTestResultPane");
    expect(page).not.toContain('class="results-card"');
    expect(page).not.toContain('class="case-list"');
    expect(page).toContain("filterUnitTestCases");
    expect(page).toContain("filterUnitTestModuleSummaries");
    expect(page).toContain("useUnitTestRunController");
    expect(pane).toContain('data-testid="unit-test-result-pane"');
    expect(pane).toContain("const expandedCase = ref<string | null>(null)");
    expect(pane).toMatch(/\.module-table-wrap\s*\{\s*overflow-x:\s*auto;/u);
    expect(pane).toMatch(/\.data-table\s*\{[^}]*min-width:\s*660px;/u);
  });

  it("Pane 只消费 API types 和 UI-neutral ViewModel，不访问 Store、Host、Transport 或存储", () => {
    const script = pane.match(/<script setup lang="ts">([\s\S]*?)<\/script>/u)?.[1] ?? pane;
    expect(script).not.toMatch(/useUnitTestsPageStore|useAppShell|useUnitTestRunController|fetchUnitTest|runUnitTests|pnwPromptChoice|localStorage|sessionStorage/u);
    expect(script).toContain("groupUnitTestCasesByModule");
    expect(script).toContain("unitTestStatusLabel");
  });
});
