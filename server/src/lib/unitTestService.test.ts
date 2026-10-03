import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildUnitTestCatalogFromList,
  buildPackagedRuntimeCatalog,
  buildUnitTestPlan,
  buildUnitTestSuites,
  cancelUnitTestRun,
  parseVitestJsonRun,
  runUnitTests,
  sourceVitestEnvironment,
  setUnitTestCatalogForTests,
  setUnitTestCommandRunnerForTests,
  testCaseCatalog,
  testModuleCatalog,
  vitestCaseNamePattern,
  type VitestModule,
} from "./unitTestService.js";

afterEach(() => {
  setUnitTestCatalogForTests(null);
  setUnitTestCommandRunnerForTests(null);
});

function sampleCatalog() {
  const modules: VitestModule[] = [
    {
      file: "server/src/lib/pdtCodeService.test.ts",
      count: 2,
      tests: ["code index > scans files", "code uuid > applies selected hits"],
    },
    {
      file: "server/src/lib/pnwBomXrefService.test.ts",
      count: 1,
      tests: ["pnwBomXrefService > reads Auto CAD index data"],
    },
    {
      file: "packages/catdlg-core/src/emitCatDlg.test.ts",
      count: 1,
      tests: ["emitCatDlg > emits dialog"],
    },
  ];
  return buildUnitTestCatalogFromList(modules);
}

describe("unitTestService catalog and plan", () => {
  it("removes packaged runtime overrides from source Vitest children", () => {
    const env = sourceVitestEnvironment({
      PATH: "test-path",
      PHOENIX_PACKAGED: "1",
      PHOENIX_USER_DATA_DIR: "wrong-user-data",
      PHOENIX_NATIVE_BIN_DIR: "wrong-bin",
    });

    expect(env.PATH).toBe("test-path");
    expect(env.CI).toBe("true");
    expect(env.PHOENIX_REPO_ROOT).toBeTruthy();
    expect(env.PHOENIX_PACKAGED).toBeUndefined();
    expect(env.PHOENIX_USER_DATA_DIR).toBeUndefined();
    expect(env.PHOENIX_NATIVE_BIN_DIR).toBeUndefined();
  });

  it("builds code/cad/caa suites from vitest modules", () => {
    const suites = buildUnitTestSuites(sampleCatalog());
    expect(suites.map((s) => s.id)).toEqual(["code", "cad", "caa"]);
    expect(suites.find((s) => s.id === "code")?.module_count).toBe(1);
  });

  it("filters plan by suite, module, include cases, and exclude cases", () => {
    const catalog = sampleCatalog();
    const target = "server/src/lib/pdtCodeService.test.ts > code index > scans files";
    const skipped = "server/src/lib/pdtCodeService.test.ts > code uuid > applies selected hits";
    const plan = buildUnitTestPlan({
      suites: ["code"],
      include_modules: ["server/src/lib/pdtCodeService.test.ts"],
      include_cases: [target, skipped],
      exclude_cases: [skipped],
      include_case_details: true,
    }, catalog);
    expect(plan.total_modules).toBe(1);
    expect(plan.total_cases).toBe(1);
    expect(plan.ignored_cases).toBe(1);
    expect(plan.modules[0].cases?.[0].id).toBe(target);
  });

  it("returns runtime catalog maps keyed by module and case id", () => {
    const catalog = sampleCatalog();
    const modules = testModuleCatalog(["server/src/lib/pdtCodeService.test.ts"], catalog).modules;
    expect(modules["server/src/lib/pdtCodeService.test.ts"].suite_id).toBe("code");
    const cases = testCaseCatalog(["packages/catdlg-core/src/emitCatDlg.test.ts > emitCatDlg > emits dialog"], catalog).cases;
    expect(cases["packages/catdlg-core/src/emitCatDlg.test.ts > emitCatDlg > emits dialog"].method_name).toBe("emits dialog");
  });

  it("builds packaged runtime suites without depending on source Vitest files", () => {
    const catalog = buildPackagedRuntimeCatalog();
    const suites = buildUnitTestSuites(catalog);

    expect(catalog.load_errors).toEqual([]);
    expect(catalog.modules.length).toBeGreaterThan(0);
    expect(catalog.modules.every((module) => module.backend === "runtime")).toBe(true);
    expect(suites.map((suite) => suite.id)).toEqual(["code", "cad", "platform", "caa"]);
    expect(suites.every((suite) => suite.backend === "runtime")).toBe(true);
  });
});

describe("parseVitestJsonRun", () => {
  it("converts Vitest JSON reporter output to the frontend result shape", () => {
    const json = JSON.stringify({
      numTotalTests: 2,
      numPassedTests: 1,
      numFailedTests: 1,
      testResults: [{
        name: "server/src/lib/pdtCodeService.test.ts",
        assertionResults: [
          { ancestorTitles: ["code index"], fullName: "code index scans files", title: "scans files", status: "passed", duration: 5, failureMessages: [] },
          { ancestorTitles: ["code uuid"], fullName: "code uuid applies selected hits", title: "applies selected hits", status: "failed", duration: 7, failureMessages: ["boom"] },
        ],
      }],
    });
    const result = parseVitestJsonRun(json, 12);
    expect(result.ok).toBe(false);
    expect(result.summary).toMatchObject({ tests_run: 2, passed: 1, failed: 1, modules: 1 });
    expect(result.failures[0].message).toBe("boom");
  });
});

describe("runUnitTests cancellation", () => {
  it("runs selected packaged checks through the existing stream contract", async () => {
    setUnitTestCatalogForTests(buildPackagedRuntimeCatalog());
    const eventTypes: string[] = [];
    const result = await runUnitTests({
      suites: ["code"],
      include_modules: ["runtime/code/source-codec"],
    }, (event) => eventTypes.push(event.type));

    expect(result.ok).toBe(true);
    expect(result.summary).toMatchObject({ tests_run: 1, passed: 1, failed: 0, errors: 0 });
    expect(result.cases[0]).toMatchObject({ module: "runtime/code/source-codec", status: "passed" });
    expect(eventTypes).toEqual(["start", "module_start", "case_done", "module_done", "done"]);
  });

  it("returns a cancelled terminal result and unregisters the active run", async () => {
    setUnitTestCatalogForTests(sampleCatalog());
    const runner = vi.fn(async () => ({ status: 0, stdout: "", stderr: "" }));
    setUnitTestCommandRunnerForTests(runner);
    const eventTypes: string[] = [];
    let runId = "";

    const result = await runUnitTests({ suites: ["code"] }, (event) => {
      eventTypes.push(event.type);
      if (event.type === "start") {
        runId = event.run_id;
        expect(cancelUnitTestRun(runId)).toBe(true);
      }
    });

    expect(runner).not.toHaveBeenCalled();
    expect(result.summary.cancelled).toBe(1);
    expect(result.ok).toBe(false);
    expect(eventTypes).toContain("cancelled");
    expect(cancelUnitTestRun(runId)).toBe(false);
  });

  it("converts catalog separators to Vitest full-name matching and rejects a false zero-test success", async () => {
    expect(vitestCaseNamePattern("suite > nested > runs [a+b]")).toBe("suite nested runs \\[a\\+b\\]");
    const catalog = sampleCatalog();
    setUnitTestCatalogForTests(catalog);
    setUnitTestCommandRunnerForTests(async () => ({
      status: 0,
      stderr: "",
      stdout: JSON.stringify({ numTotalTests: 0, numPassedTests: 0, numFailedTests: 0, testResults: [] }),
    }));
    const module = catalog.modules.find((item) => item.module === "server/src/lib/pdtCodeService.test.ts")!;
    const target = module.cases[0].id;

    const result = await runUnitTests({
      suites: ["code"],
      include_modules: [module.module],
      include_cases: [target],
    });

    expect(result.ok).toBe(false);
    expect(result.summary).toMatchObject({ tests_run: 0, errors: 1, load_errors: 1 });
  });
});
