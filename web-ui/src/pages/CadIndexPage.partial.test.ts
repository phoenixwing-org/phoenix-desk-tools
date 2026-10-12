import fs from "node:fs";
import { effectScope, nextTick, ref, type EffectScope } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CadIndexDiagnostics, CadIndexScanJob } from "../api";

const state = vi.hoisted(() => ({
  shell: {} as any,
  primary: {} as any,
  prompt: vi.fn(),
  api: { cancelCadIndexScan: vi.fn(), fetchCadIndexDiagnostics: vi.fn(), fetchCadIndexScan: vi.fn(),
    previewCadIndexReset: vi.fn(), resetCadIndex: vi.fn(), startCadIndexScan: vi.fn() },
}));
vi.mock("vue", async importOriginal => ({
  ...await importOriginal<typeof import("vue")>(),
  useSSRContext: () => ({ modules: new Set<string>() }), onUnmounted: () => undefined,
}));
vi.mock("../api", () => state.api);
vi.mock("../composables/useAppShell", () => ({ useAppShell: () => state.shell }));
vi.mock("../composables/usePageSession", () => ({ usePageSession: () => undefined }));
vi.mock("../composables/usePagePrimaryContribution", () => ({
  usePagePrimaryContribution: (_page: string, _tab: string, contribution: any) => { state.primary = contribution; },
}));
vi.mock("phoenix-wing", () => ({ pnwPromptChoice: state.prompt }));
vi.mock("phoenix-wing/layout/PnwPageLayout.vue", () => ({ default: {} }));
vi.mock("phoenix-wing/layout/PnwPageHeader.vue", () => ({ default: {} }));
vi.mock("phoenix-wing/layout/PnwPageMainBlock.vue", () => ({ default: {} }));
vi.mock("phoenix-wing/layout/PnwSidebarBlock.vue", () => ({ default: {} }));
vi.mock("../features/cad-index-search/CadIndexSearchSection.vue", () => ({ default: {} }));

import CadIndexPage from "./CadIndexPage.vue";

// Synthetic index metadata only; no CAD fixtures, real paths or part inventory.
const ready: CadIndexDiagnostics = {
  scanSupported: true, state: "ready", message: "Synthetic complete index", schemaVersion: 13,
  expectedSchemaVersion: 13, totalEntries: 1, missingEntries: 0, lastScanAt: "complete-time",
  latestScan: { id: 1, status: "done", root: "synthetic", at: "complete-time" },
};
const partial: CadIndexDiagnostics = {
  ...ready, state: "attention", message: "索引部分可用；图册可用，BOM 不完整", failedEntries: 1,
  failures: [{ rel: "synthetic/Unreadable.FCStd", message: "Synthetic XML error" }],
  latestScan: { id: 2, status: "partial", root: "synthetic", at: "partial-time" },
};
const running: CadIndexScanJob = {
  id: "synthetic-job", workspace: "synthetic", state: "running", phase: "reading", scanned: 0, message: "Reading",
};
let scope: EffectScope | undefined;
async function settle() { await Promise.resolve(); await nextTick(); await Promise.resolve(); await nextTick(); }
async function setup(): Promise<Record<string, any>> {
  scope = effectScope();
  const page = scope.run(() => (CadIndexPage as any).setup({ workbenchTabId: "synthetic-tab" }, { expose: () => undefined }));
  await settle(); return page;
}
beforeEach(() => {
  vi.clearAllMocks();
  state.shell = { workspacePath: ref("synthetic"), appendLog: vi.fn(), openTab: vi.fn(), openFileDetailForRel: vi.fn() };
  state.primary = {};
  state.prompt.mockResolvedValue({ choiceId: "scan" });
  state.api.fetchCadIndexDiagnostics.mockResolvedValue(ready);
  state.api.startCadIndexScan.mockResolvedValue(running);
  state.api.fetchCadIndexScan.mockResolvedValue({ ...running, state: "done", phase: "committing", message: "Complete",
    result: { scanId: 2, files: 1, parsedFiles: 1, references: 0, bomLines: 0 } });
});
afterEach(() => { scope?.stop(); });

describe("CAD partial index diagnostics", () => {
  it("restores persisted failures on entry, opens the bottom output and does not duplicate the same revision", async () => {
    state.api.fetchCadIndexDiagnostics.mockResolvedValue(partial);
    const page = await setup();
    expect(page.stateLabel.value).toBe("部分可用"); expect(page.latestScanLabel.value).toBe("部分可用");
    expect(page.failedEntries.value).toBe(1); expect(page.failures.value).toEqual(partial.failures);
    expect(page.canScan.value).toBe(true);
    expect(state.shell.appendLog).toHaveBeenCalledWith(expect.stringContaining("synthetic/Unreadable.FCStd：Synthetic XML error"),
      { source: "cad_index", open: true });
    await page.refresh(); expect(state.shell.appendLog).toHaveBeenCalledTimes(1);
  });

  it("shows partial completion as a warning and preserves the total failure count while limiting details to 100", async () => {
    const failures = Array.from({ length: 105 }, (_, index) => ({ rel: `synthetic/Entry${index}.FCStd`, message: `Synthetic error ${index}` }));
    state.api.fetchCadIndexDiagnostics.mockResolvedValueOnce(ready).mockResolvedValue({ ...partial, failedEntries: 105, failures });
    state.api.fetchCadIndexScan.mockResolvedValue({ ...running, state: "done", phase: "committing", message: "索引部分可用",
      result: { scanId: 2, files: 1, parsedFiles: 1, references: 0, bomLines: 0, partial: true, failed_count: 105, failures } });
    const page = await setup(); await page.scan();
    expect(page.scanStateLabel.value).toBe("部分可用");
    expect(state.primary.sections[0]).toMatchObject({ id: "scope", title: "索引维护" });
    expect(state.primary.sections[0].progress.value.state).toBe("warning");
    expect(page.failedEntries.value).toBe(105); expect(page.failures.value).toHaveLength(100);
    expect(state.shell.appendLog).toHaveBeenCalledTimes(1);
    const [output, options] = state.shell.appendLog.mock.calls[0];
    expect(output).toContain("105 个文件"); expect(output).toContain("图册可用，BOM 不完整");
    expect(output).toContain("Synthetic error 99"); expect(output).not.toContain("Synthetic error 100");
    expect(output).toContain("其余 5 项"); expect(options).toEqual({ source: "cad_index", open: true });
  });

  it("keeps complete legacy responses usable without new failure fields or warning output", async () => {
    const page = await setup(); await page.scan();
    expect(page.scanStateLabel.value).toBe("已完成"); expect(page.failedEntries.value).toBe(0);
    expect(page.failures.value).toEqual([]); expect(page.partial.value).toBe(false);
    expect(state.primary.sections[0]).toMatchObject({ id: "scope", title: "索引维护" });
    expect(state.primary.sections[0].progress.value.state).toBe("done");
    expect(state.shell.appendLog).not.toHaveBeenCalled();
  });

  it("does not turn a partial marker into complete when old metadata omits its failure details", async () => {
    state.api.fetchCadIndexDiagnostics.mockResolvedValue({ ...ready, state: "attention", latestScan: partial.latestScan });
    const page = await setup();
    expect(page.stateLabel.value).toBe("部分可用"); expect(page.partial.value).toBe(true);
    expect(page.failedEntries.value).toBe(0); expect(page.failures.value).toEqual([]);
    expect(state.shell.appendLog).toHaveBeenCalledWith(expect.stringContaining("BOM 不完整"), { source: "cad_index", open: true });
  });

  it("does not reuse an old partial job's failures after refreshing a newer complete revision", async () => {
    state.api.fetchCadIndexDiagnostics.mockResolvedValueOnce(ready).mockResolvedValue(partial);
    state.api.fetchCadIndexScan.mockResolvedValue({ ...running, state: "done", phase: "committing", message: "Partial",
      result: { scanId: 2, files: 1, parsedFiles: 1, references: 0, bomLines: 0, partial: true, failed_count: 1, failures: partial.failures } });
    const page = await setup(); await page.scan();
    expect(page.partial.value).toBe(true);
    state.api.fetchCadIndexDiagnostics.mockResolvedValue({ ...ready, latestScan: { ...ready.latestScan!, id: 3 } });
    await page.refresh();
    expect(page.currentResult.value).toBeNull(); expect(page.partial.value).toBe(false);
    expect(page.failedEntries.value).toBe(0); expect(page.failures.value).toEqual([]);
  });

  it("makes incomplete status and its failure list explicit in the page template and scan confirmation", () => {
    const source = fs.readFileSync(new URL("./CadIndexPage.vue", import.meta.url), "utf8");
    expect(source).toContain('<p v-if="currentResult?.partial" role="status">索引部分可用');
    expect(source).toContain("已索引 {{ currentResult.parsedFiles }} 个正常文件");
    expect(source).toContain('<details v-if="partial" class="index-failures">');
    expect(source).toContain("{{ failure.rel }}"); expect(source).toContain("{{ failure.message }}");
    expect(source).toContain("图册可用，但 BOM 不完整");
    expect(source).not.toContain("完整扫描成功后才提交索引");
  });
});
