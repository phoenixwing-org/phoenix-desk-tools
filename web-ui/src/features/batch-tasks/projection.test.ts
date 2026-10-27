import { describe, expect, it } from "vitest";
import { batchStepMatchesFile, batchStepSubjects, batchStepTargetLabel, describeAction, describeEffects, mergeBatchInputPaths, parseSubjectLines, projectPreviewSteps, projectRunProgress, runStatusLabel } from "./projection";
import { syntheticAction, syntheticLegacyPlan, syntheticMixedPlan, syntheticNativePlan, syntheticRun } from "./fixtures.test-support";
import type { BatchStep } from "../../../../shared/batch-tasks/contracts";
describe("batch task pure projection", () => {
  it("keeps cancellation requests, partial and interrupted distinct from successful completion", () => {
    expect(projectRunProgress(syntheticRun({ status: "cancel_requested" })).state).toBe("running");
    for (const status of ["partial", "interrupted"] as const) expect(projectRunProgress(syntheticRun({ status })).state).toBe("warning");
    expect(projectRunProgress(syntheticRun({ status: "partial", total: 6, completed: 5, failed: 1 }))).toMatchObject({ completed: 6, total: 6, state: "warning", detail: "部分完成 · 成功 5 · 问题 1" });
    expect(projectRunProgress(syntheticRun({ status: "cancelled", total: 6, completed: 2, failed: 1 })).completed).toBe(3);
    expect(projectRunProgress(syntheticRun({ status: "succeeded" })).state).toBe("done");
    expect(new Set(Object.values(runStatusLabel)).size).toBe(Object.keys(runStatusLabel).length);
  });
  it("only accepts explicit normalized relative files, deduplicating identical paths", () => {
    expect(parseSubjectLines("samples/note.txt\nsamples/note.txt\nmodels/body.FCStd")).toEqual([{ kind: "file", rel: "samples/note.txt" }, { kind: "cad_model", rel: "models/body.FCStd" }]);
    for (const invalid of ["", "/root/file", "C:\\private\\file", "../secret", "samples/", "a/./b", "a/.private/file", "a/__pycache__/file", "node_modules/file", "a:stream"]) expect(() => parseSubjectLines(invalid)).toThrow();
    expect(() => parseSubjectLines(Array.from({ length: 201 }, (_, index) => `files/${index}.txt`).join("\n"))).toThrow("200");
  });
  it("merges basket and workset paths without overwriting draft input or exceeding the explicit budget", () => {
    expect(mergeBatchInputPaths("samples/First.FCStd", ["samples/first.fcstd", "samples/Second.FCStd"])).toBe("samples/First.FCStd\nsamples/Second.FCStd");
    expect(mergeBatchInputPaths("samples/Caf\u00e9.txt", ["samples/Cafe\u0301.txt"])).toBe("samples/Caf\u00e9.txt");
    expect(() => mergeBatchInputPaths("samples/kept.txt", ["../outside.txt"])).toThrow();
    expect(() => mergeBatchInputPaths("samples/kept.txt", Array.from({ length: 200 }, (_, i) => `files/${i}.txt`))).toThrow("200");
  });
  it("matches every subject of one whole-batch history step and keeps legacy file steps readable", () => {
    const batch: BatchStep = { id: "batch", run_id: "run-a", scope: "batch", item_ids: ["first", "last"], subjects: [{ kind: "cad_model", rel: "models/First.FCStd" }, { kind: "cad_model", rel: "models/Last.FCStd" }], action_instance_id: "audit", action_key: "cad.name-audit", status: "succeeded" };
    expect(batchStepTargetLabel(batch)).toBe("整批 2 文件"); expect(batchStepSubjects(batch)).toEqual(batch.subjects); expect(batchStepMatchesFile(batch, "last.FCSTD")).toBe(true); expect(batchStepMatchesFile(batch, "first")).toBe(true); expect(batchStepMatchesFile(batch, "outside")).toBe(false);
    const legacy: BatchStep = { id: "legacy", run_id: "run-a", item_id: "one", subject: { kind: "file", rel: "legacy/note.txt" }, action_instance_id: "metadata", action_key: "file.metadata", status: "succeeded" };
    expect(batchStepTargetLabel(legacy)).toBe("legacy/note.txt"); expect(batchStepMatchesFile(legacy, "NOTE")).toBe(true); expect(batchStepMatchesFile(legacy, " ")).toBe(true);
  });
  it("projects prepared statuses/counts, never turns blocked batch steps into not-applicable file rows", () => {
    const steps = projectPreviewSteps(syntheticMixedPlan(true)); expect(steps).toHaveLength(3); expect(steps[2]).toMatchObject({ label: "整批 2 文件", status: "blocked", reason: "缓存快照不可用" }); expect(steps[2].subjects).toHaveLength(2);
    expect(projectPreviewSteps(syntheticLegacyPlan())[0]).toMatchObject({ label: "samples/note.txt", status: "ready" });
  });
  it("describes source readonly, exact scope/versions/effects and cache lease without inventing file reads", () => {
    const text = describeAction({ ...syntheticAction(), scope: "batch", version: 2, effects: ["read_cache", "write_task_db"], result_schema_version: 3, algorithm_version: "cache-v2" });
    for (const value of ["整批一次", "源文件只读", "只读缓存", "自有临时读锁", "不回收已有锁", "结果 v3", "算法 cache-v2"]) expect(text).toContain(value);
    expect(describeEffects(["read_cache", "write_task_db"])).not.toContain("只读源文件");
  });
  it("projects a pure V3 saved-shape preview as blocked/read-only without upgrading its inert declarations", () => {
    const plan = syntheticNativePlan(), before = JSON.stringify(plan), steps = projectPreviewSteps(plan);
    expect(steps).toEqual([expect.objectContaining({ id: "native-step", label: "samples/IndependentSaved.FCStd", status: "blocked", reason: "Native V3 试点仅供只读查看；当前页面未开放执行", subjects: [{ kind: "file", rel: "samples/IndependentSaved.FCStd", node: "ExampleFeature" }] })]);
    expect(describeEffects(plan.effects)).toBe("只读源文件 · 自有 Native 只读进程 · 写自有临时目录（实际关闭后清理） · 写任务 DB");
    expect(plan).toMatchObject({ execution_allowed: false, kill_allowed: false, lease_release_allowed: false, crypto_verification: "not_performed", native_proof: "not_attested" });
    expect(plan.summary.executable).toBe(1); expect(plan.steps[0].applicable).toBe(true); expect(JSON.stringify(plan)).toBe(before);
    expect(plan.prepared.step.manifest.material).toMatchObject({ resolution_performed: false, density_kg_m3: null, mass_kg: null });
  });
});
