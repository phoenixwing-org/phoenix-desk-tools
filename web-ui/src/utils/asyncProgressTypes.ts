/** 异步任务进度 — 纯类型定义。零 Vue/DOM 依赖，可被 utils 和 store 引用。 */

/** 任务种类 */
export type TaskKind = "fcstd-scan" | "unit-test" | "xref-rebuild";

/** 任务整体状态 */
export type TaskStatus = "running" | "done" | "error" | "cancelled" | "orphaned";

/** 单个步骤状态 */
export type StepStatus = "pending" | "active" | "done" | "error";

/** 单个步骤的错误条目 */
export interface StepError {
  file: string;
  error: string;
}

/** 异步任务中的一个步骤（阶段） */
export interface AsyncProgressStep {
  /** 步骤序号（0‑based） */
  index: number;
  /** 步骤名，如 "遍历文件" / "读取 BOM" / "构建引用表" */
  label: string;
  /** 当前步骤状态 */
  status: StepStatus;
  /** 0‑100 */
  percent: number;
  /** 已处理数 */
  processed: number;
  /** 总数 */
  total: number;
  /** 当前正在处理的文件（仅 active 时有值） */
  currentFile?: string;
  /** 本步骤累计错误 */
  errors: StepError[];
}

/** 异步任务完整状态（Pinia store 中存储的单元） */
export interface AsyncTaskState {
  /** 唯一标识 — 扫描为 scan_id，测试为 run_id */
  taskId: string;
  /** 任务种类 */
  kind: TaskKind;
  /** 显示名称 */
  taskName: string;
  /** 整体状态 */
  status: TaskStatus;
  /** 0‑100 总进度 */
  progressPercent: number;
  /** 当前步骤索引 */
  currentStep: number;
  /** 步骤列表 */
  steps: AsyncProgressStep[];
  /** ISO 8601 启动时间 */
  startedAt?: string;
  /** ISO 8601 完成时间 */
  finishedAt?: string;
  /** 错误消息（整体失败时） */
  error?: string;
  /** 运行日志（最近 N 条） */
  logs: string[];
  /** 文件处理耗时记录（最近 500 条） */
  fileTimings: FileTimingRecord[];
  /** 用户是否已确认查看（非 running 任务需手动确认后才清除） */
  confirmed?: boolean;
}

/** 单个文件的处理耗时记录 */
export interface FileTimingRecord {
  file: string;
  phase: string;
  duration: number;   // ms
  success: boolean;
  error?: string;
}

/** FCStd 扫描的默认步骤标签 */
export const SCAN_STEP_LABELS = ["遍历文件", "读取分析", "构建 BOM 引用表"] as const;

/** 单元测试的默认步骤标签（动态，此处为初始单步） */
export const TEST_STEP_LABEL = "运行测试" as const;
