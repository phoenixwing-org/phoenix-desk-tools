import fs from "node:fs";
import { computed, effectScope, ref, type EffectScope } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const testState = vi.hoisted(() => ({
  shell: {} as any,
  shared: {} as any,
  mounted: [] as Array<() => Promise<void>>,
  unmounted: [] as Array<() => void>,
  contributions: {} as Record<string, any>,
  sheets: {} as Record<string, any>,
  busy: undefined as any,
  api: Object.fromEntries([
    "fetchStepBatchPrefs", "previewStepBatch", "runStepBatch", "saveStepBatchPrefs",
    "fetchSwStepPrefs", "previewSwStepExport", "runSwStepExport", "saveSwStepPrefs",
    "fetchPartDedupPrefs", "scanPartDedup", "exportPartDedupCsv", "savePartDedupPrefs",
  ].map(name => [name, vi.fn()])),
}));

vi.mock("vue", async (importOriginal) => ({
  ...await importOriginal<typeof import("vue")>(),
  useSSRContext: () => ({ modules: new Set<string>() }),
  onMounted: (callback: () => Promise<void>) => testState.mounted.push(callback),
  onUnmounted: (callback: () => void) => testState.unmounted.push(callback),
}));
vi.mock("../api", () => testState.api);
vi.mock("../composables/useAppShell", () => ({ useAppShell: () => testState.shell }));
vi.mock("../composables/useCadBatchDirectory", () => ({ useCadBatchDirectory: () => testState.shared }));
vi.mock("../composables/useFreecadTaskGate", () => ({
  useFreecadTaskGate: () => ({ blocked: { value: false }, assertFreecadForTask: () => true, hint: "" }),
}));
vi.mock("../composables/usePagePrimaryContribution", () => ({
  usePagePrimaryContribution: (page: string, _tab: string, contribution: any) => { testState.contributions[page] = contribution; },
}));
vi.mock("../composables/useStepBatchPropertySheet", () => ({
  STEP_VIEW_FIT_OPTIONS: [{ value: "none", label: "None" }],
  useStepBatchPropertySheet: (page: string, options: any) => { testState.sheets[page] = options; },
}));
vi.mock("../composables/useSwStepExportPropertySheet", () => ({
  useSwStepExportPropertySheet: (page: string, options: any) => { testState.sheets[page] = options; },
}));
vi.mock("../composables/usePartDedupPropertySheet", () => ({
  PART_DEDUP_EXTENSION_OPTIONS: [".FCStd"],
  usePartDedupPropertySheet: (page: string, options: any) => { testState.sheets[page] = options; },
}));
vi.mock("phoenix-wing/layout/PnwPageLayout.vue", () => ({ default: {} }));
vi.mock("phoenix-wing/layout/PnwPageHeader.vue", () => ({ default: {} }));

import StepBatchPage from "./StepBatchPage.vue";
import SwStepExportPage from "./SwStepExportPage.vue";
import PartDedupPage from "./PartDedupPage.vue";

const configs = [
  { component: StepBatchPage, filename: "StepBatchPage.vue", page: "step_batch", directory: "stepDir", fetch: "fetchStepBatchPrefs", save: "saveStepBatchPrefs", action: "onPreview", api: "previewStepBatch", result: "preview", run: "onRun", runApi: "runStepBatch", directoryField: "step_dir",
    prefs: { step_dir: "old-per-tool", out_dir: "output", skip_existing: true, view_fit: "none", step_recursive: false },
    response: { batch_count: 2, top_level: 2, deep_total: 0, step_dir_display: "Parts" } },
  { component: SwStepExportPage, filename: "SwStepExportPage.vue", page: "sw_step_export", directory: "sourceDir", fetch: "fetchSwStepPrefs", save: "saveSwStepPrefs", action: "onPreview", api: "previewSwStepExport", result: "modelCount", run: "onRun", runApi: "runSwStepExport", directoryField: "source_dir",
    prefs: { source_dir: "old-per-tool", out_step_dir: "output", recursive_scan: false, com_available: true, platform: "win32" },
    response: { model_count: 2, source_display: "Parts", prefs: { com_available: true, platform: "win32" } } },
  { component: PartDedupPage, filename: "PartDedupPage.vue", page: "part_dedup", directory: "scanDir", fetch: "fetchPartDedupPrefs", save: "savePartDedupPrefs", action: "onScan", api: "scanPartDedup", result: "scanResult", run: "onExport", runApi: "exportPartDedupCsv", directoryField: "scan_dir",
    prefs: { scan_dir: "old-per-tool", extension: ".FCStd", code_len: 6, ver_len: 3, check_code: true, check_version: true, code_must_be_digit: true },
    response: { summary: "2 files", file_count: 2, stats: {}, results: { name_dup: [], code_dup: [], ver_dup: [] } } },
];
let scope: EffectScope | undefined;

beforeEach(() => {
  vi.clearAllMocks();
  testState.mounted = [];
  testState.unmounted = [];
  testState.contributions = {};
  testState.sheets = {};
  testState.shell = { workspacePath: ref("/workspace"), appendLog: vi.fn(), setStatus: vi.fn(), goToPage: vi.fn() };
  const directory = ref("Parts");
  testState.shared = {
    directory,
    disabled: ref(false),
    section: { id: "cad-batch-directory", title: "搜索目录", controls: [] },
    scopeKey: computed(() => JSON.stringify([testState.shell.workspacePath.value, directory.value])),
    bindBusy: (busy: any) => { testState.busy = busy; },
    validate: vi.fn(async () => true),
  };
  for (const config of configs) {
    testState.api[config.fetch].mockResolvedValue(config.prefs);
    testState.api[config.save].mockResolvedValue(config.prefs);
    testState.api[config.api].mockResolvedValue(config.response);
  }
});

afterEach(() => {
  for (const dispose of testState.unmounted) dispose();
  scope?.stop();
});

async function setup(component: unknown): Promise<Record<string, any>> {
  scope = effectScope();
  const bindings = scope.run(() => (component as any).setup({ workbenchTabId: "test-tab" }, { expose: () => undefined }));
  for (const mount of testState.mounted) await mount();
  return bindings;
}

describe.each(configs)("$filename shared batch scope", (config) => {
  it("uses the same directory in Primary, property sheet and request, without restoring per-tool directories", async () => {
    const bindings = await setup(config.component);
    expect(bindings[config.directory]).toBe(testState.shared.directory);
    expect(testState.sheets[config.page][config.directory]).toBe(testState.shared.directory);
    expect(testState.shared.directory.value).toBe("Parts");
    const sections = testState.contributions[config.page].sections.value;
    expect(sections[1]).toBe(testState.shared.section);
    expect(sections.flatMap((section: any) => section.controls ?? []).some((control: any) => ["source", "dir"].includes(control.id))).toBe(false);
    await bindings.onSave();
    expect(testState.api[config.save]).toHaveBeenCalledWith(expect.objectContaining({ [config.directoryField]: "Parts" }));
    expect(testState.shared.directory.value).toBe("Parts");
  });

  it("validates before busy, blocks invalid preview/scan and execution without real work", async () => {
    const bindings = await setup(config.component);
    if (config.result === "scanResult") bindings.scanResult.value = config.response;
    testState.shared.validate.mockImplementation(async () => {
      expect(testState.busy.value).toBe(false);
      return false;
    });
    await bindings[config.action]();
    await bindings[config.run]();
    expect(testState.shared.validate).toHaveBeenCalledTimes(2);
    expect(testState.api[config.api]).not.toHaveBeenCalled();
    expect(testState.api[config.runApi]).not.toHaveBeenCalled();
    expect(testState.busy.value).toBe(false);
  });

  it("does not save preferences or claim a busy lock while another tool owns the shared scope", async () => {
    const bindings = await setup(config.component);
    testState.shared.disabled.value = true;
    await bindings.onSave();
    expect(testState.api[config.save]).not.toHaveBeenCalled();
    expect(testState.shared.validate).not.toHaveBeenCalled();
    expect(testState.busy.value).toBe(false);
  });

  it("clears results synchronously on scope change and ignores delayed replies from the previous workspace", async () => {
    const bindings = await setup(config.component);
    await bindings[config.action]();
    expect(bindings[config.result].value).not.toBeNull();
    testState.shared.directory.value = "Other";
    expect(bindings[config.result].value).toBeNull();

    let resolve!: (value: any) => void;
    testState.api[config.api].mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    const request = bindings[config.action]();
    await Promise.resolve();
    expect(testState.busy.value).toBe(true);
    testState.shell.workspacePath.value = "/different-workspace";
    testState.shell.setStatus.mockClear();
    resolve(config.response);
    await request;
    expect(bindings[config.result].value).toBeNull();
    expect(testState.shell.setStatus).not.toHaveBeenCalled();
    expect(testState.busy.value).toBe(false);
  });

  it("keeps Wing layout/body defaults and header actions without the legacy outer padding class", () => {
    const source = fs.readFileSync(new URL(config.filename, import.meta.url), "utf8");
    expect(source).toContain('import PageLayout from "phoenix-wing/layout/PnwPageLayout.vue"');
    expect(source).toMatch(/<PageLayout class="desk-page-layout(?: dedup-page)?" title="[^"]+">\s*<template #header>/u);
    expect(source).toContain("<template #right>");
    expect(source).not.toMatch(/class="page tool-page/u);
    expect(source).not.toContain(":body-inset=");
    expect(source).not.toContain(":body-scroll=");
  });

  it.each(["directory-return", "workspace-return", "unmount"])("ignores a delayed business reply after %s", async (change) => {
    const bindings = await setup(config.component);
    let resolve!: (value: any) => void;
    testState.api[config.api].mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    const request = bindings[config.action]();
    await Promise.resolve();
    expect(testState.busy.value).toBe(true);
    if (change === "directory-return") {
      testState.shared.directory.value = "Other";
      testState.shared.directory.value = "Parts";
    } else if (change === "workspace-return") {
      testState.shell.workspacePath.value = "/other";
      testState.shell.workspacePath.value = "/workspace";
    } else {
      for (const dispose of testState.unmounted.splice(0)) dispose();
    }
    testState.shell.setStatus.mockClear();
    testState.shell.appendLog.mockClear();
    resolve(config.response);
    await request;
    expect(bindings[config.result].value).toBeNull();
    expect(testState.shell.setStatus).not.toHaveBeenCalled();
    expect(testState.shell.appendLog).not.toHaveBeenCalled();
    expect(testState.busy.value).toBe(false);
  });

  it.each(["workspace-return", "unmount"])("ignores a delayed preference-save reply after %s", async (change) => {
    const bindings = await setup(config.component);
    let resolve!: (value: any) => void;
    testState.api[config.save].mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    const request = bindings.onSave();
    if (change === "workspace-return") {
      testState.shell.workspacePath.value = "/other";
      testState.shell.workspacePath.value = "/workspace";
    } else {
      for (const dispose of testState.unmounted.splice(0)) dispose();
    }
    resolve({ ...config.prefs, out_dir: "stale-output", out_step_dir: "stale-output" });
    await request;
    expect(testState.shell.setStatus).not.toHaveBeenCalled();
    expect(testState.shared.directory.value).toBe("Parts");
    if (config.page === "step_batch") expect(bindings.outDir.value).toBe("output");
    if (config.page === "sw_step_export") expect(bindings.outStepDir.value).toBe("output");
  });
});
