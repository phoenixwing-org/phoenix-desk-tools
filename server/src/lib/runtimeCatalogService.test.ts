import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildUnitTestCatalogFromList } from "./unitTestService.js";
import {
  runtimeCatalogStatus,
  runtimeTestCaseMap,
  runtimeTestModuleMap,
  searchRuntimeCatalog,
  syncRuntimeCatalog,
} from "./runtimeCatalogService.js";

const tempRoots: string[] = [];

function tempCatalogOptions() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "runtime-catalog-"));
  tempRoots.push(root);
  const appConfigPath = path.join(root, "app_config.json");
  fs.writeFileSync(appConfigPath, JSON.stringify({
    navigation: [
      { id: "code_index", page: "code_index", label: "Code 索引", description: "索引源码", module: "code" },
      { id: "caa_dialog", page: "caa_dialog", label: "CAA 对话框", module: "code" },
    ],
  }), "utf8");
  return {
    databasePath: path.join(root, ".phoenix", "runtime-catalog.sqlite"),
    appConfigPath,
  };
}

function sampleCatalog() {
  return buildUnitTestCatalogFromList([
    {
      file: "server/src/lib/pdtCodeService.test.ts",
      count: 2,
      tests: ["code index > scans files", "code uuid > replaces selected hit"],
    },
    {
      file: "packages/catdlg-core/src/emitCatDlg.test.ts",
      count: 1,
      tests: ["emitCatDlg > emits dialog"],
    },
  ]);
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("runtimeCatalogService", () => {
  it("persists pages, suites, Vitest modules, cases, and searchable metadata", () => {
    const options = tempCatalogOptions();
    const catalog = sampleCatalog();
    const synced = syncRuntimeCatalog(catalog, options);

    expect(synced.added_or_updated).toEqual({ pages: 2, test_modules: 2, test_cases: 3 });
    const status = runtimeCatalogStatus(options);
    expect(status).toMatchObject({ ok: true, exists: true, schema_version: 2 });
    expect(status.counts).toEqual({ pages: 2, test_modules: 2, test_cases: 3, suites: 4 });

    const moduleName = "server/src/lib/pdtCodeService.test.ts";
    const modules = runtimeTestModuleMap([moduleName], options).modules as Record<string, any>;
    expect(modules[moduleName]).toMatchObject({ suite_id: "code", case_count: 2 });
    expect(modules[moduleName].description_zh).toContain("code index");

    const caseId = `${moduleName} > code index > scans files`;
    const cases = runtimeTestCaseMap([caseId], options).cases as Record<string, any>;
    expect(cases[caseId]).toMatchObject({ method_name: "scans files", suite_id: "code" });

    expect(searchRuntimeCatalog({ q: "Code 索引", entity_type: "page" }, options).total).toBe(1);
    expect(searchRuntimeCatalog({ q: "replaces selected", suite_id: "code" }, options).total).toBe(1);
  });

  it("full sync removes modules and cases that no longer exist", () => {
    const options = tempCatalogOptions();
    syncRuntimeCatalog(sampleCatalog(), options);
    const next = buildUnitTestCatalogFromList([{
      file: "server/src/lib/pdtCodeService.test.ts",
      count: 1,
      tests: ["code index > scans files"],
    }]);

    syncRuntimeCatalog(next, options);

    expect(runtimeCatalogStatus(options).counts).toMatchObject({ test_modules: 1, test_cases: 1 });
    expect(runtimeTestModuleMap(["packages/catdlg-core/src/emitCatDlg.test.ts"], options).modules).toEqual({});
  });
});
