import { isBatchStep, isCurrentPlan, isNativePlan, type ActionDescriptor, type BatchPlan, type BatchRun, type BatchStep, type RunStatus, type StepStatus, type SubjectRef } from "../../../../shared/batch-tasks/contracts";
import type { PagePrimaryProgress } from "../../composables/usePagePrimaryContribution";

export const runStatusLabel: Record<RunStatus, string> = {
  queued: "已排队", running: "采集中", cancel_requested: "已请求取消 · 等待安全边界",
  succeeded: "已完成", partial: "部分完成", failed: "失败", cancelled: "已取消", interrupted: "已中断 · 需重新预览",
};
export const stepStatusLabel: Record<StepStatus, string> = {
  pending: "等待", running: "采集中", succeeded: "成功", failed: "失败", not_applicable: "不适用",
  blocked: "已阻塞", cancelled: "已取消", interrupted: "已中断",
};
type DisplayEffect=ActionDescriptor['effects'][number];
export const effectLabel: Record<DisplayEffect, string> = {
  read_file: "只读源文件", read_cache: "只读缓存（自有临时读锁，不回收已有锁）", write_task_db: "写任务 DB",
  run_native_readonly:"自有 Native 只读进程",write_private_temp:"写自有临时目录（实际关闭后清理）",
};
export const describeEffects = (effects: readonly DisplayEffect[]) => effects.map(effect => effectLabel[effect] ?? effect).join(" · ");
export function describeAction(action: ActionDescriptor): string {
  return `${action.scope === "batch" ? "整批一次" : "逐文件"} · 源文件只读 · ${describeEffects(action.effects)} · 动作 v${action.version}${action.result_schema_version === undefined ? "" : ` · 结果 v${action.result_schema_version}`}${action.algorithm_version === undefined ? "" : ` · 算法 ${action.algorithm_version}`}`;
}
export const batchStepSubjects = (step: BatchStep): readonly SubjectRef[] => isBatchStep(step) ? step.subjects : [step.subject];
export const batchStepTargetLabel = (step: BatchStep): string => isBatchStep(step) ? `整批 ${step.subjects.length} 文件` : step.subject.rel;
export function batchStepMatchesFile(step: BatchStep, query: string): boolean {
  const match = query.trim().toLocaleLowerCase();
  return !match || batchStepSubjects(step).some(subject => subject.rel.toLocaleLowerCase().includes(match));
}
export function projectPreviewSteps(plan: BatchPlan) {
  const subjects = (ids: readonly string[]) => plan.items.filter(item => ids.includes(item.id)).map(item => item.subject);
  if (isCurrentPlan(plan)) return plan.prepared.steps.map(step => ({ id: step.id, action_instance_id: step.action_instance_id, status: step.status, reason: step.reason,
    subjects: subjects(step.target.scope === "batch" ? step.target.item_ids : [step.target.item_id]),
    label: step.target.scope === "batch" ? `整批 ${step.target.item_ids.length} 文件` : subjects([step.target.item_id])[0]?.rel || "文件范围未确认" }));
  if(isNativePlan(plan))return plan.steps.map(step=>({id:step.id,action_instance_id:step.action_instance_id,status:'blocked' as const,
    reason:'Native V3 试点仅供只读查看；当前页面未开放执行',subjects:subjects([step.item_id]),label:subjects([step.item_id])[0]?.rel||'文件范围未确认'}));
  return plan.steps.map(step => ({ id: step.id, action_instance_id: step.action_instance_id, status: step.applicable ? "ready" as const : "not_applicable" as const, reason: step.reason,
    subjects: subjects([step.item_id]), label: subjects([step.item_id])[0]?.rel || "文件范围未确认" }));
}
export function projectRunProgress(run?: BatchRun): PagePrimaryProgress {
  const processed = run ? ["succeeded", "partial"].includes(run.status) ? run.total : Math.min(run.total, run.completed + run.failed) : 0;
  return { label: run?.task_name || "批量任务", state: !run || run.status === "queued" ? "idle"
    : run.status === "succeeded" ? "done" : run.status === "failed" ? "failed" : run.status === "cancelled" ? "cancelled"
    : run.status === "partial" || run.status === "interrupted" ? "warning" : "running",
    completed: processed, total: run?.total ?? 0,
    detail: run ? `${runStatusLabel[run.status]} · 成功 ${run.completed} · 问题 ${run.failed}${run.message ? ` · ${run.message}` : ""}` : "尚未接纳运行" };
}
/** Explicit files only. Empty input never means the whole workspace. */
export function parseSubjectLines(value: string): SubjectRef[] {
  const paths = [...new Set(value.split(/\r?\n/).map(line => line.trim().replace(/\\/g, "/")).filter(Boolean))];
  if (!paths.length) throw new Error("请填写至少一个工作空间相对文件路径");
  if (paths.length > 200) throw new Error("每个任务最多 200 个明确文件");
  return paths.map(rel => {
    if (rel.startsWith("/") || rel.includes(":") || rel.split("/").some(part => !part || part.startsWith(".") || ["node_modules", "__pycache__"].includes(part)) || /[\p{Cc}\p{Cf}\p{Cs}]/u.test(rel)) throw new Error("只允许规范的工作空间相对文件路径；不接受目录、隐藏缓存或路径穿越");
    return { kind: /\.fcstd$/i.test(rel) ? "cad_model" : "file", rel };
  });
}

/** Merge collected inputs into an editable draft, never a plan or execution request. */
export function mergeBatchInputPaths(current: string, incoming: readonly string[]): string {
  const seen = new Set<string>();
  const paths = [...current.split(/\r?\n/), ...incoming].map(path => path.trim().replace(/\\/g, "/")).filter(Boolean).filter(path => {
    const key = path.normalize("NFC").toUpperCase().toLowerCase().normalize("NFC");
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });
  return parseSubjectLines(paths.join("\n")).map(subject => subject.rel).join("\n");
}
