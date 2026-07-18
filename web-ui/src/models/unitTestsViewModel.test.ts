import { describe, expect, it } from "vitest";
import {
  deriveUnitTestModuleFilter,
  deriveUnitTestRunScopeSelection,
  filterUnitTestCases,
  filterUnitTestModuleSummaries,
  formatUnitTestRunSummary,
  groupUnitTestCasesByModule,
  mergeUnitTestRunOptions,
  syncUnitTestCheckedModules,
  unitTestPassRate,
  type UnitTestCaseViewInput,
} from "./unitTestsViewModel";

const cases: UnitTestCaseViewInput[] = [
  { id: "cad.fail", module: "tests.cad", suite_id: "cad", status: "failed" },
  { id: "cad.pass", module: "tests.cad", suite_id: "cad", status: "passed" },
  { id: "code.error", module: "tests.code", suite_id: "code", status: "error" },
  { id: "platform.skip", module: "tests.platform", suite_id: "platform", status: "skipped" },
];

describe("unit tests view model", () => {
  it("按 suite/status/watchlist/retested 优先级过滤结果", () => {
    const base = {
      suiteIds: new Set(["cad", "code"]),
      statuses: new Set(["failed"]),
      watchlistOnly: true,
      reTestedOnly: false,
      watchlistIds: new Set(["cad.fail", "code.error"]),
      reTestedIds: new Set<string>(),
    };
    expect(filterUnitTestCases(cases, base).map((item) => item.id))
      .toEqual(["cad.fail", "code.error"]);
    expect(filterUnitTestCases(cases, {
      ...base,
      reTestedOnly: true,
      reTestedIds: new Set(["cad.pass"]),
      statuses: new Set(["passed"]),
    }).map((item) => item.id)).toEqual(["cad.pass"]);
  });

  it("由可见 cases 投影模块摘要与稳定分组", () => {
    expect(filterUnitTestModuleSummaries(
      [{ module: "tests.platform" }, { module: "tests.code" }, { module: "tests.cad" }],
      cases.slice(0, 3),
    ).map((item) => item.module)).toEqual(["tests.code", "tests.cad"]);
    expect(groupUnitTestCasesByModule(cases).map(([module, rows]) => [module, rows.length]))
      .toEqual([["tests.cad", 2], ["tests.code", 1], ["tests.platform", 1]]);
  });

  it("新计划保留旧勾选、自动勾选新增模块并剔除已移除模块", () => {
    const initial = syncUnitTestCheckedModules(["a", "b"], [], new Set());
    expect([...initial.checked]).toEqual(["a", "b"]);
    const next = syncUnitTestCheckedModules(["b", "c"], initial.available, new Set(["b"]));
    expect([...next.checked]).toEqual(["b", "c"]);
    expect(next.available).toEqual(["b", "c"]);
  });

  it("集中运行范围摘要与 include_modules 省略规则", () => {
    const plan = {
      total_cases: 8,
      modules: [{ module: "a", case_count: 3 }, { module: "b", case_count: 5 }],
    };
    expect(deriveUnitTestRunScopeSelection(plan, new Set(["b"]))).toEqual({
      modules: 1,
      totalModules: 2,
      cases: 5,
      totalCases: 8,
    });
    expect(deriveUnitTestModuleFilter(true, ["a", "b"], new Set(["b"])))
      .toEqual({ include_modules: ["b"] });
    expect(deriveUnitTestModuleFilter(true, ["a", "b"], new Set(["a", "b"])))
      .toBeUndefined();
  });

  it("合并关注排除、定向用例和模块过滤，不制造空 options", () => {
    expect(mergeUnitTestRunOptions(undefined, [], undefined)).toBeUndefined();
    expect(mergeUnitTestRunOptions(
      { include_cases: ["case-1"] },
      ["ignored-1"],
      { include_modules: ["tests.cad"] },
    )).toEqual({
      exclude_cases: ["ignored-1"],
      include_cases: ["case-1"],
      include_modules: ["tests.cad"],
    });
  });

  it("冻结通过率与成功、失败、终止摘要文案", () => {
    expect(unitTestPassRate({ tests_run: 3, passed: 2, failed: 1, errors: 0 })).toBe(67);
    expect(formatUnitTestRunSummary({
      ok: true,
      suite_label: "CAD",
      duration_ms: 20,
      summary: { tests_run: 3, passed: 3, failed: 0, errors: 0, ignored: 1 },
    })).toBe("CAD：3/3 通过（20 ms） · 忽略 1 条（关注·默认不跑）");
    expect(formatUnitTestRunSummary({
      ok: false,
      suite_label: "Code",
      duration_ms: 30,
      summary: { tests_run: 2, passed: 0, failed: 1, errors: 1, cancelled: 1 },
    })).toBe("Code：已终止 · 已完成 2 条（30 ms） · 失败 1、错误 1");
  });
});
