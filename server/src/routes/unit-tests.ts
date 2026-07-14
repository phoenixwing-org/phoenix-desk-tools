import { Hono } from "hono";
import { caaLog } from "../caaLog.js";
import {
  caaVitestModules,
  discoverUnitTestCatalog,
  parseVitestList,
  parseVitestResult,
  runUnitTests,
  type VitestModule,
} from "../lib/unitTestService.js";
import { syncRuntimeCatalog } from "../lib/runtimeCatalogService.js";

export const unitTestRoutes = new Hono();

export { parseVitestList, parseVitestResult, type VitestModule };

export function refreshRuntimeCatalog() {
  try {
    const catalog = discoverUnitTestCatalog(true);
    const result = syncRuntimeCatalog(catalog);
    caaLog(
      `runtime-catalog: ${result.added_or_updated.test_modules} modules / ` +
      `${result.added_or_updated.test_cases} cases -> SQLite`,
    );
    return result;
  } catch (err: any) {
    caaLog(`runtime-catalog: sync failed -> ${err.message || err}`);
    throw err;
  }
}

unitTestRoutes.get("/ping", (c) => c.json({ ok: true }));

unitTestRoutes.get("/suites", (c) => {
  try {
    return c.json({ modules: caaVitestModules(discoverUnitTestCatalog()) });
  } catch (err: any) {
    return c.json({ detail: err.message || String(err), modules: [] }, 500);
  }
});

unitTestRoutes.post("/refresh", (c) => {
  try {
    return c.json(refreshRuntimeCatalog());
  } catch (err: any) {
    return c.json({ detail: err.message || String(err) }, 500);
  }
});

unitTestRoutes.post("/run", async (c) => {
  const body = await c.req.json().catch(() => ({})) as { modules?: string[] };
  const modules = Array.isArray(body.modules) ? body.modules.map(String) : [];
  const result = await runUnitTests({
    suites: ["caa"],
    include_modules: modules.length ? modules : undefined,
  });
  return c.json({
    ok: result.ok,
    passed: result.summary.passed,
    failed: result.summary.failed + result.summary.errors,
    output: result.failures.map((f) => `${f.id}: ${f.message}`).join("\n").slice(-2000),
  });
});
