/** 异步任务进度 — 纯函数。

所有导出函数零 Vue/DOM 依赖，输入明确输出确定，可独立单测。
见 [[frontend-mvc-separation]] 规则。
*/

import type {
  AsyncProgressStep,
  AsyncTaskState,
  StepStatus,
  TaskStatus,
} from "./asyncProgressTypes";
import { SCAN_STEP_LABELS, TEST_STEP_LABEL } from "./asyncProgressTypes";

// 后端类型内联（避免 utils 依赖 api.ts）
interface ScanPhaseDict {
  total: number;
  processed: number;
  skipped?: number;
  failed?: number;
  current_file?: string;
  percent: number;
  errors?: Array<{ rel: string; error: string }>;
}
interface ScanProgressPayload {
  scan_id: string;
  phase: string;
  step: number;
  status: string;
  cancelled: boolean;
  error: string;
  total_cad_files: number;
  total_fcstd_files: number;
  walk: ScanPhaseDict;
  bom: ScanPhaseDict;
  xref: ScanPhaseDict;
}

// ---------------------------------------------------------------------------
// TaskState 工厂
// ---------------------------------------------------------------------------

/** 为 fcstd-scan 创建初始任务状态（3 个 pending 步骤）。 */
export function createScanTaskState(taskId: string, taskName?: string): AsyncTaskState {
  const now = new Date().toISOString();
  return {
    taskId,
    kind: "fcstd-scan",
    taskName: taskName || "FCStd 工程内搜索",
    status: "running",
    progressPercent: 0,
    currentStep: 0,
    startedAt: now,
    logs: [],
    fileTimings: [],
    steps: SCAN_STEP_LABELS.map((label, i) => ({
      index: i,
      label,
      status: (i === 0 ? "active" : "pending") as StepStatus,
      percent: 0,
      processed: 0,
      total: 0,
      errors: [],
    })),
  };
}

/** 为 unit-test 创建初始任务状态。 */
export function createTestTaskState(
  taskId: string,
  totalModules?: number,
  taskName?: string,
): AsyncTaskState {
  const now = new Date().toISOString();
  return {
    taskId,
    kind: "unit-test",
    taskName: taskName || "单元测试",
    status: "running",
    progressPercent: 0,
    currentStep: 0,
    startedAt: now,
    logs: [],
    fileTimings: [],
    steps: [
      {
        index: 0,
        label: TEST_STEP_LABEL,
        status: "active",
        percent: 0,
        processed: 0,
        total: totalModules || 0,
        errors: [],
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// 步骤状态判定（纯函数）
// ---------------------------------------------------------------------------

/** 根据当前步骤索引和步骤自身数据，返回该步骤应显示的状态。 */
export function computeStepStatus(step: AsyncProgressStep, currentStepIndex: number): StepStatus {
  if (step.status === "error") return "error";
  if (step.percent >= 100 && step.processed > 0) return "done";
  if (step.index === currentStepIndex) return "active";
  if (step.index < currentStepIndex) {
    return step.processed > 0 ? "done" : "pending";
  }
  return "pending";
}

// ---------------------------------------------------------------------------
// 进度百分比计算
// ---------------------------------------------------------------------------

/** 从步骤列表计算总进度百分比（等权平均）。 */
export function computeProgressPercent(steps: AsyncProgressStep[]): number {
  if (steps.length === 0) return 0;
  const sum = steps.reduce((acc, s) => acc + Math.min(100, Math.max(0, s.percent)), 0);
  return Math.round(sum / steps.length);
}

// ---------------------------------------------------------------------------
// 终态判断
// ---------------------------------------------------------------------------

/** 返回 status 是否为终态（不再轮询）。 */
export function isTerminal(status: TaskStatus): boolean {
  return status === "done" || status === "error" || status === "cancelled" || status === "orphaned";
}

// ---------------------------------------------------------------------------
// 集合操作（给 store getter 用）
// ---------------------------------------------------------------------------

/** 过滤出活跃（running）任务。 */
export function filterActiveTasks(tasks: AsyncTaskState[]): AsyncTaskState[] {
  return tasks.filter((t) => t.status === "running");
}

/** 按 startedAt 倒序排序（最新的在前）。 */
export function sortTasksByTime(tasks: AsyncTaskState[]): AsyncTaskState[] {
  return [...tasks].sort(
    (a, b) => (b.startedAt || "").localeCompare(a.startedAt || ""),
  );
}

/** 是否存在运行中的任务。 */
export function hasRunningTasks(tasks: AsyncTaskState[]): boolean {
  return tasks.some((t) => t.status === "running");
}

// ---------------------------------------------------------------------------
// 日志
// ---------------------------------------------------------------------------

const MAX_LOGS = 200;

/** 追加一条日志到任务状态（不可变）。超过 MAX_LOGS 时截断旧日志。 */
export function appendTaskLog(prev: AsyncTaskState, message: string): AsyncTaskState {
  const logs = [...prev.logs, `[${new Date().toLocaleTimeString()}] ${message}`];
  if (logs.length > MAX_LOGS) {
    logs.splice(0, logs.length - MAX_LOGS);
  }
  return { ...prev, logs };
}

// ---------------------------------------------------------------------------
// 轮询结果 → TaskState 更新（不可变）
// ---------------------------------------------------------------------------

function _phaseToStep(payload: ScanPhaseDict, label: string, index: number): AsyncProgressStep {
  const total = payload.total || 0;
  const processed = (payload.processed || 0) + (payload.skipped || 0);
  const failed = payload.failed || 0;
  const percent = total > 0 ? Math.round(((processed + failed) / total) * 100) : 0;
  return {
    index,
    label,
    status: percent >= 100 ? "done" : "active",
    percent,
    processed,
    total,
    currentFile: payload.current_file || undefined,
    errors: (payload.errors || []).map((e) => ({ file: e.rel, error: e.error })),
  };
}

/** 将 ScanProgressPayload 映射为更新后的 AsyncTaskState（不可变）。 */
export function updateTaskFromPoll(
  prev: AsyncTaskState,
  payload: ScanProgressPayload,
): AsyncTaskState {
  // 已终态（取消/完成/错误）不再被后端新消息覆盖
  if (isTerminal(prev.status)) return prev;
  const phaseNames = ["walk", "bom", "xref"] as const;
  const steps: AsyncProgressStep[] = SCAN_STEP_LABELS.map((label, i) => {
    const phaseKey = phaseNames[i];
    const phaseData = (payload as unknown as Record<string, ScanPhaseDict>)[phaseKey];
    if (!phaseData) {
      // 保留旧步骤
      return prev.steps[i] || {
        index: i,
        label,
        status: "pending" as StepStatus,
        percent: 0,
        processed: 0,
        total: 0,
        errors: [],
      };
    }
    return _phaseToStep(phaseData, label, i);
  });

  // 根据后端 phase 确定当前步骤
  const currentStep = payload.step || 0;

  // 更新步骤状态
  for (const step of steps) {
    step.status = computeStepStatus(step, currentStep);
  }

  const status = payload.status as TaskStatus;
  const progressPercent = computeProgressPercent(steps);

  // 阶段切换日志
  let logs = prev.logs;
  if (currentStep !== prev.currentStep) {
    const stepLabel = SCAN_STEP_LABELS[currentStep] || `步骤 ${currentStep}`;
    logs = [...logs, `[${new Date().toLocaleTimeString()}] → ${stepLabel}`];
    if (logs.length > MAX_LOGS) logs = logs.slice(-MAX_LOGS);
  }

  return {
    ...prev,
    status,
    progressPercent,
    currentStep,
    steps,
    logs,
    error: payload.error || undefined,
    finishedAt: isTerminal(status) ? new Date().toISOString() : prev.finishedAt,
  };
}

// ---------------------------------------------------------------------------
// 流事件 → TaskState 更新（不可变）
// ---------------------------------------------------------------------------

interface StreamStartEvent {
  type: "start";
  run_id?: string;
  suite_id: string;
  total_modules: number;
  total_cases: number;
}
interface StreamModuleStartEvent {
  type: "module_start";
  module: string;
  module_index: number;
  module_total: number;
}
interface StreamModuleDoneEvent {
  type: "module_done";
  module: string;
  summary: { cases: number; errors: number; failures: number; skipped: number };
}
interface StreamCaseStartEvent {
  type: "case_start";
  id: string;
  module: string;
  suite_id: string;
  class_name: string;
  method: string;
}
interface StreamCaseDoneEvent {
  type: "case_done";
  completed: number;
  total: number;
}
interface StreamDoneEvent {
  type: "done" | "cancelled";
}
interface StreamErrorEvent {
  type: "error";
  message: string;
}

type StreamEvent =
  | StreamStartEvent
  | StreamModuleStartEvent
  | StreamModuleDoneEvent
  | StreamCaseStartEvent
  | StreamCaseDoneEvent
  | StreamDoneEvent
  | StreamErrorEvent;

/** 将单元测试流事件累积为更新后的 AsyncTaskState（不可变）。

  调用方每次收到一个事件就调用一次，传入上一步的 state。
*/
export function updateTaskFromStreamEvent(
  prev: AsyncTaskState,
  event: StreamEvent,
): AsyncTaskState {
  // 已终态不再被新事件覆盖（cancel 后再来事件应忽略）
  if (isTerminal(prev.status)) return prev;
  const steps = prev.steps.map((s) => ({ ...s, errors: [...s.errors] }));

  switch (event.type) {
    case "start": {
      // 单元测试以用例数为进度单位（粒度更细），total = total_cases
      const totalCases = event.total_cases || 0;
      const firstStep = steps[0];
      if (firstStep) {
        firstStep.total = totalCases;
      }
      return { ...prev, steps, currentStep: 0 };
    }
    case "module_start": {
      // 仅更新当前模块名，不修改进度数字（避免与 case_done 冲突）
      const active = steps.find((s) => s.status === "active");
      if (active) {
        active.currentFile = event.module;
      }
      return { ...prev, steps };
    }
    case "case_done": {
      // 以 completed/total_cases 驱动进度（step.total = total_cases）
      const step = steps[0];
      if (step && step.total > 0) {
        step.processed = event.completed;
        step.percent = Math.round((event.completed / step.total) * 100);
      }
      return { ...prev, steps, progressPercent: computeProgressPercent(steps) };
    }
    case "case_start":
      // case_start 不影响进度，仅作为信息事件忽略
      return prev;
    case "module_done": {
      // 不覆盖 case_done 的进度，仅做安全保护（≥已有值）
      const step = steps[0];
      if (step && step.total > 0 && step.processed >= step.total) {
        step.percent = 100;
        step.status = "done";
      }
      return { ...prev, steps, progressPercent: computeProgressPercent(steps) };
    }
    case "done": {
      const finishedSteps = steps.map((s) => ({
        ...s,
        status: "done" as StepStatus,
        percent: 100,
      }));
      return {
        ...prev,
        status: "done",
        progressPercent: 100,
        steps: finishedSteps,
        finishedAt: new Date().toISOString(),
      };
    }
    case "cancelled": {
      return {
        ...prev,
        status: "cancelled",
        finishedAt: new Date().toISOString(),
        progressPercent: computeProgressPercent(steps),
      };
    }
    case "error": {
      return {
        ...prev,
        status: "error",
        error: event.message,
        finishedAt: new Date().toISOString(),
        progressPercent: computeProgressPercent(steps),
      };
    }
    default:
      return prev;
  }
}

// ---------------------------------------------------------------------------
// 文件耗时统计（纯函数）
// ---------------------------------------------------------------------------

import type { FileTimingRecord } from "./asyncProgressTypes";

/** 追加一条文件处理耗时记录。不可变更新，超 500 条截头。 */
export function recordFileTiming(
  prev: AsyncTaskState,
  file: string,
  phase: string,
  duration: number,
  success: boolean,
  error?: string,
): AsyncTaskState {
  if (!file) return prev;
  const record: FileTimingRecord = { file, phase, duration, success, ...(error ? { error } : {}) };
  const timings = [...prev.fileTimings, record];
  if (timings.length > 500) timings.splice(0, timings.length - 500);
  return { ...prev, fileTimings: timings };
}

/** 平均耗时 (ms)，空返回 0 */
export function averageFileDuration(timings: FileTimingRecord[]): number {
  if (timings.length === 0) return 0;
  const sum = timings.reduce((a, t) => a + t.duration, 0);
  return Math.round(sum / timings.length);
}

/** 最快耗时 (ms)，空返回 0 */
export function fastestFileDuration(timings: FileTimingRecord[]): number {
  if (timings.length === 0) return 0;
  return timings.reduce((min, t) => Math.min(min, t.duration), Infinity);
}

/** 最慢耗时 (ms)，空返回 0 */
export function slowestFileDuration(timings: FileTimingRecord[]): number {
  if (timings.length === 0) return 0;
  return timings.reduce((max, t) => Math.max(max, t.duration), -Infinity);
}

/** 预估剩余时间 (秒)，基于平均耗时 × 剩余文件数 */
export function estimateRemaining(timings: FileTimingRecord[], remaining: number): number {
  if (timings.length === 0 || remaining <= 0) return 0;
  return Math.round((averageFileDuration(timings) * remaining) / 1000);
}

/** 格式化毫秒为可读字符串 */
export function formatDuration(ms: number): string {
  if (ms <= 0) return "0";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

/** 格式化秒为 XmXs */
export function formatSeconds(sec: number): string {
  if (sec <= 0) return "0s";
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return s > 0 ? `${m}m${s}s` : `${m}m`;
}
