import { effectScope, nextTick, reactive } from "vue";
import { afterEach, expect, it, vi } from "vitest";
import { useNameNormalizationLog } from "./useNameNormalizationLog";

const scopes: ReturnType<typeof effectScope>[] = [];
afterEach(() => { for (const scope of scopes.splice(0)) scope.stop(); });
function setup() {
  const state = reactive<Parameters<typeof useNameNormalizationLog>[0]>({ preview: null, attributes: null, renamed: null, renameJob: null, indexUpdate: null, error: "" });
  const append = vi.fn(); const scope = effectScope(); scopes.push(scope);
  scope.run(() => useNameNormalizationLog(state, append));
  return { state, append };
}
it("reveals request failures even when no result row exists", async () => {
  const { state, append } = setup();
  state.error = "analysis expired"; await nextTick();
  expect(append).toHaveBeenCalledWith(expect.stringContaining("analysis expired"), { source: "name_normalize", open: true });
});
it("reports each polled result once, includes host causes, and does not open for successes", async () => {
  const { state, append } = setup();
  const failed = { rel: "parts/source.FCStd", target_rel: "parts/target.FCStd", status: "references_pending" as const, message: "paths fixed; labels pending", failed_hosts: [{ host_repo_rel_path: "assemblies/host.FCStd", error: "multiple target objects" }] };
  state.renamed = { results: [failed] }; await nextTick();
  expect(append).toHaveBeenCalledWith(expect.stringContaining("文件已改名，引用待修正"), expect.objectContaining({ open: true }));
  expect(append.mock.calls[0][0]).toContain("宿主 assemblies/host.FCStd：multiple target objects");
  state.renamed = { results: [{ ...failed }] }; await nextTick();
  expect(append).toHaveBeenCalledTimes(1);
  state.renamed = { results: [failed, { rel: "parts/second.FCStd", target_rel: "parts/new.FCStd", status: "renamed", message: "done" }] }; await nextTick();
  expect(append).toHaveBeenCalledTimes(2);
  expect(append).toHaveBeenLastCalledWith(expect.stringContaining("parts/second.FCStd"), expect.objectContaining({ open: false }));
});
it("opens for attribute, index and job errors, including terminal summaries without file results", async () => {
  const { state, append } = setup();
  state.attributes = { prepared_id: null, results: [{ rel: "parts/A.FCStd", status: "failed", message: "source changed" }] };
  state.indexUpdate = { state: "failed", message: "index unavailable" };
  state.renameJob = { id: "job", state: "failed", total: 2, completed: 0, current_rel: "", results: [], message: "job unavailable" };
  await nextTick();
  expect(append).toHaveBeenCalledTimes(3);
  expect(append.mock.calls.every(call => call[1].open === true)).toBe(true);
});
it("keeps the specific stop cause in skipped-row logs and logs a repeated failure in a fresh preview", async () => {
  const { state, append } = setup();
  const result = { results: [{ rel: "A.FCStd", target_rel: "B.FCStd", status: "skipped" as const, message: "index changed by another operation" }] };
  state.renamed = result; await nextTick();
  expect(append).toHaveBeenLastCalledWith(expect.stringContaining("index changed by another operation"), expect.objectContaining({ open: true }));
  state.preview = { plan_id: "next", batch_dir: "parts", scanned: 0, rows: [], errors: [] };
  state.renamed = { ...result }; await nextTick();
  expect(append).toHaveBeenCalledTimes(2);
});
