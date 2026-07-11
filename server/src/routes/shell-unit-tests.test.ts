import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const tempRoots: string[] = [];

async function setupShellWithUnitTests() {
  vi.resetModules();
  const service = await import("../lib/unitTestService.js");
  service.setUnitTestCatalogForTests(service.buildUnitTestCatalogFromList([
    {
      file: "server/src/lib/pdtCodeService.test.ts",
      count: 1,
      tests: ["code index > scans files"],
    },
    {
      file: "packages/catdlg-core/src/emitCatDlg.test.ts",
      count: 1,
      tests: ["emitCatDlg > emits dialog"],
    },
  ]));
  service.setUnitTestCommandRunnerForTests(async () => ({
    status: 0,
    stderr: "",
    stdout: JSON.stringify({
      numTotalTests: 1,
      numPassedTests: 1,
      numFailedTests: 0,
      testResults: [{
        name: "server/src/lib/pdtCodeService.test.ts",
        assertionResults: [{
          ancestorTitles: ["code index"],
          fullName: "code index > scans files",
          title: "scans files",
          status: "passed",
          duration: 4,
          failureMessages: [],
        }],
      }],
    }),
  }));
  const runtimeCatalog = await import("../lib/runtimeCatalogService.js");
  const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "shell-runtime-catalog-"));
  tempRoots.push(runtimeRoot);
  runtimeCatalog.setRuntimeCatalogPathForTests(path.join(runtimeRoot, "runtime-catalog.sqlite"));
  const { shellRoutes } = await import("./shell.js");
  return { shellRoutes, service };
}

afterEach(async () => {
  const service = await import("../lib/unitTestService.js");
  service.setUnitTestCatalogForTests(null);
  service.setUnitTestCommandRunnerForTests(null);
  const runtimeCatalog = await import("../lib/runtimeCatalogService.js");
  runtimeCatalog.setRuntimeCatalogPathForTests(null);
  for (const root of tempRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
  vi.resetModules();
});

describe("shell unit test routes", () => {
  it("serves suites, plans, runtime catalog, and stream results from the unit test service", async () => {
    const { shellRoutes } = await setupShellWithUnitTests();

    const suitesRes = await shellRoutes.request("/api/unit-tests/suites");
    expect(suitesRes.status).toBe(200);
    const suites = await suitesRes.json();
    expect(suites.suites.map((s: any) => s.id)).toEqual(["code", "caa"]);

    const planRes = await shellRoutes.request("/api/unit-tests/plan", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ suites: ["code"], include_case_details: true }),
    });
    expect(planRes.status).toBe(200);
    const plan = await planRes.json();
    expect(plan.total_modules).toBe(1);
    expect(plan.modules[0].cases[0].id).toBe("server/src/lib/pdtCodeService.test.ts > code index > scans files");

    const catalogRes = await shellRoutes.request("/api/runtime-catalog/test-modules?modules=server/src/lib/pdtCodeService.test.ts");
    expect(catalogRes.status).toBe(200);
    const catalog = await catalogRes.json();
    expect(catalog.modules["server/src/lib/pdtCodeService.test.ts"].suite_id).toBe("code");

    const statusRes = await shellRoutes.request("/api/runtime-catalog/status");
    expect(statusRes.status).toBe(200);
    await expect(statusRes.json()).resolves.toMatchObject({
      ok: true,
      counts: { test_modules: 2, test_cases: 2 },
    });

    const searchRes = await shellRoutes.request("/api/runtime-catalog/search?q=scans%20files&entity_type=test_case");
    expect(searchRes.status).toBe(200);
    const search = await searchRes.json();
    expect(search.total).toBe(1);

    const streamRes = await shellRoutes.request("/api/unit-tests/run/stream", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ suites: ["code"], include_modules: ["server/src/lib/pdtCodeService.test.ts"] }),
    });
    expect(streamRes.status).toBe(200);
    const events = (await streamRes.text()).trim().split(/\n/).map((line) => JSON.parse(line));
    expect(events[0].type).toBe("start");
    expect(events.some((e) => e.type === "case_done")).toBe(true);
    const done = events.find((e) => e.type === "done");
    expect(done.result.summary).toMatchObject({ tests_run: 1, passed: 1, failed: 0 });
  });
});
