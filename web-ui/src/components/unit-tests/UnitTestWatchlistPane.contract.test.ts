import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(relative: string): string {
  return readFileSync(new URL(relative, import.meta.url), "utf8");
}

function functionSource(page: string, name: string, nextName: string): string {
  const body = page.match(new RegExp(`async function ${name}\\([\\s\\S]*?(?=\\n(?:async )?function ${nextName})`, "u"))?.[0];
  if (!body) throw new Error(`${name} source not found`);
  return body;
}

describe("UnitTestWatchlistPane 契约", () => {
  const page = source("../../pages/UnitTestsPage.vue");
  const pane = source("./UnitTestWatchlistPane.vue");

  it("Page 保留确认框、localStorage utility、Pinia、catalog 与 prune 责任", () => {
    const paneScript = pane.match(/<script setup lang="ts">([\s\S]*?)<\/script>/u)?.[1] ?? pane;
    expect(page).toContain("pnwPromptChoice({");
    expect(page).toContain('title: "移出关注列表"');
    expect(page).toContain('title: "清空关注列表"');
    expect(page).toContain("removeWatchlistEntry(row.id)");
    expect(page).toContain("clearWatchlist()");
    expect(page).toContain("pageStore.pruneWatchlistChecked");
    expect(page).toContain("fetchTestCaseCatalog");
    expect(page).toContain("fetchTestModuleCatalog");
    expect(paneScript).not.toMatch(/pnwPromptChoice|localStorage|useUnitTestsPageStore|fetchTest|useAppShell|useUnitTestRunController/u);
  });

  it("单条与勾选复测 payload 仍由 Page 组装", () => {
    const selected = functionSource(page, "onRunWatchlistSelected", "onRerunWatchlistEntry");
    const single = functionSource(page, "onRerunWatchlistEntry", "onRunSingleModule");
    expect(selected).toContain("runOptions: { include_cases: [...watchlistChecked.value] }");
    expect(selected).toContain('suiteIds: ["all"]');
    expect(selected).toContain('runMode: "watchlist"');
    expect(single).toContain("if (running.value) return");
    expect(single).toContain("runOptions: { include_cases: [row.id] }");
    expect(single).toContain("rerunningWatchlistId.value = row.id");
    expect(single).toContain("rerunningWatchlistId.value = null");
  });

  it("冻结既有全部复测问题：无勾选时拒绝且 payload 只取 checked IDs", () => {
    const run = page.match(/async function onRun\([\s\S]*?(?=\nasync function onRunWatchlistSelected)/u)?.[0];
    if (!run) throw new Error("UnitTestsPage onRun not found");
    expect(run).toContain('if (mode === "watchlist" && !watchlistCheckedCount.value)');
    expect(run).toContain('shell.setStatus("请至少勾选一条用例后再复测")');
    expect(run).toContain("const targetIds = watchlistCheckedCount.value");
    expect(run).toContain("? [...watchlistChecked.value]");
    expect(run).toContain(": watchlist.value.map((e) => e.id)");
    expect(run).toContain("runOptions = { include_cases: targetIds }");
  });

  it("Pane 拥有关注 DOM、横向滚动与 running 禁用规则，不建第二状态", () => {
    expect(page).toContain("<UnitTestWatchlistPane");
    expect(page).not.toContain('class="watchlist-table"');
    expect(pane).toContain(':disabled="running || !selectedCount"');
    expect(pane).toContain(':disabled="running && rerunningId !== row.id"');
    expect(pane).toContain("emit('runSelected')");
    expect(pane).toContain("emit('runWatchlist')");
    expect(pane).toMatch(/\.watchlist-table-wrap\s*\{[\s\S]*?overflow-x:\s*auto;/u);
    expect(pane).toMatch(/\.watchlist-table\s*\{[\s\S]*?min-width:\s*680px;/u);
    expect(pane).not.toMatch(/\bref\(|\breactive\(|defineModel/u);
  });

  it("Pane 自带从 Page 迁移的表格与辅助文字样式", () => {
    expect(pane).toMatch(/\.watchlist-table\s*\{[\s\S]*?font-size:\s*0\.82rem;/u);
    expect(pane).toMatch(/\.watchlist-table th,\s*\n\.watchlist-table td\s*\{[\s\S]*?border:\s*1px solid var\(--border\);[\s\S]*?padding:\s*6px 8px;/u);
    expect(pane).toMatch(/\.watchlist-table th\s*\{[\s\S]*?background:\s*#f9fafb;[\s\S]*?font-weight:\s*600;/u);
    expect(pane).toMatch(/\.mono\s*\{[\s\S]*?font-family:\s*ui-monospace, monospace;[\s\S]*?font-size:\s*0\.78rem;/u);
    expect(pane).toMatch(/\.muted\s*\{[\s\S]*?color:\s*var\(--muted\);/u);
    expect(pane).toMatch(/\.small\s*\{[\s\S]*?font-size:\s*0\.76rem;/u);
  });
});
