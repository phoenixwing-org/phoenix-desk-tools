import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const page = readFileSync(new URL("../../pages/UnitTestsPage.vue", import.meta.url), "utf8");
const pane = readFileSync(new URL("./UnitTestRunScopePane.vue", import.meta.url), "utf8");

function singleModuleCommand(): string {
  const source = page.match(
    /async function onRunSingleModule\([\s\S]*?(?=\nwatch\()/u,
  )?.[0];
  if (!source) throw new Error("UnitTestsPage onRunSingleModule not found");
  return source;
}

describe("UnitTestRunScopePane 契约", () => {
  it("Page 保留单模块命令 payload，并在 running/plan loading 时拒绝", () => {
    const command = singleModuleCommand();
    expect(command).toContain("if (running.value || runPlanLoading.value) return");
    expect(command).toContain("suiteIds: [mod.suiteId]");
    expect(command).toContain("runOptions: { include_modules: [mod.module] }");
    expect(command).toContain("logLabel: shortModule(mod.module)");
    expect(command).toContain("lastRunSuiteIds: [...runChecked.value]");
  });

  it("Pane 拥有套件、模块、全选、排序和行内运行的受控动作与禁用规则", () => {
    expect(pane).toContain('v-for="suite in runnableSuites"');
    expect(pane).toContain("emit('suiteChange', suite.id, Boolean($event))");
    expect(pane).toContain("emit('allModulesChange', Boolean($event))");
    expect(pane).toContain("emit('moduleChange', row.module, Boolean($event))");
    expect(pane).toContain('v-model="moduleSortBy"');
    expect(pane).toContain("emit('runModule', row)");
    expect(pane).toContain(':row-class-name="rowClass"');
    expect(pane).toContain("{{ row.moduleLabel }}");
    expect(pane).toContain("{{ row.description }}");
    expect(pane).toContain("{{ row.suiteLabel }}");
    expect(pane).toContain(':data-module="row.module"');
    expect(pane).toContain(':disabled="running || planLoading"');
    expect(pane).toContain(':disabled="planLoading || (running && rerunningModule !== row.module)"');
  });

  it("Pane 拥有加载、错误、空计划和内部纵横滚动，不吸收 Host 状态", () => {
    expect(pane).toContain("加载计划…");
    expect(pane).toContain("{{ planError }}");
    expect(pane).toContain("当前计划没有可执行模块");
    expect(pane).toMatch(/\.run-scope-list\s*\{[\s\S]*?max-height:\s*min\(40vh, 320px\);[\s\S]*?overflow:\s*auto;/u);
    expect(pane).toMatch(/\.run-scope-table\s*\{[\s\S]*?min-width:\s*820px;/u);
    expect(pane).not.toMatch(/useUnitTestsPageStore|useUnitTestPlanController|useUnitTestRunController|useAppShell|usePagePrimaryContribution|localStorage|sessionStorage|from ["']\.\.\/\.\.\/api["']/u);
    expect(page).toContain("<UnitTestRunScopePane");
    expect(page).toContain("usePagePrimaryContribution");
  });

  it("折叠入口是独立原生按钮，不把套件 checkbox 嵌入 button", () => {
    expect(pane).toContain('type="button"');
    expect(pane).toContain('class="run-toolbar-toggle"');
    expect(pane).toContain(':aria-expanded="!collapsed"');
    expect(pane).toContain(':aria-controls="scopeBodyId"');
    expect(pane).toContain('<div class="run-chips">');
  });
});
