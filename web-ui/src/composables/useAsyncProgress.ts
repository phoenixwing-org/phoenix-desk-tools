/** 异步任务进度 Composable — Controller 连线层。

  负责 Vue 生命周期、API 调用、Store 更新。
  不包含纯计算逻辑（委托给 utils/asyncProgress.ts）。
*/

import { computed, ref } from "vue";
import type { TaskKind } from "../utils/asyncProgressTypes";
import {
  appendTaskLog,
  createScanTaskState,
  createTestTaskState,
  isTerminal,
  recordFileTiming,
  updateTaskFromPoll,
  updateTaskFromStreamEvent,
} from "../utils/asyncProgress";
import { useAsyncTaskStore } from "../stores/asyncTasks";
import {
  type ScanProgressPayload,
  type UnitTestStreamEvent,
  type UnitTestRunResult,
  fetchFcstdMapScanProgress,
  cancelFcstdMapScan,
  fetchFcstdMapScanResume,
} from "../api";

interface PollOptions {
  taskName?: string;
  interval?: number;
  /** 同种类任务只允许一个实例（默认 false） */
  singleton?: boolean;
}

interface StreamOptions {
  taskName?: string;
  /** 同种类任务只允许一个实例（默认 false） */
  singleton?: boolean;
}

/** 单任务进度控制器。每个页面调用一次，管理一个任务实例。 */
export function useAsyncProgress(kind: TaskKind) {
  const store = useAsyncTaskStore();

  // ── 响应式状态 ──
  const taskId = ref("");
  const isRunning = ref(false);

  /** 从 store 取出的当前任务状态 */
  const state = computed(() => {
    if (!taskId.value) return null;
    return store.tasks[taskId.value] ?? null;
  });

  /** 0‑100 总进度 */
  const progressPercent = computed(() => state.value?.progressPercent ?? 0);

  /** 步骤列表 */
  const steps = computed(() => state.value?.steps ?? []);

  /** 当前任务名 */
  const taskName = computed(() => state.value?.taskName ?? "");

  // ── 内部变量 ──
  let _pollTimer: ReturnType<typeof setInterval> | null = null;
  let _cancelFn: ((id: string) => Promise<unknown>) | null = null;

  function _stopPolling() {
    if (_pollTimer !== null) {
      clearInterval(_pollTimer);
      _pollTimer = null;
    }
  }

  // ── 扫描（轮询模式） ──

  async function startPolling(
    startFn: () => Promise<{ scan_id: string }>,
    pollFn: (scanId: string) => Promise<ScanProgressPayload>,
    cancelFn: (scanId: string) => Promise<unknown>,
    opts?: PollOptions,
  ): Promise<void> {
    // 单例约束：检测冲突（running / orphaned / 未确认的完成）
    if (opts?.singleton) {
      const conflict = Object.values(store.tasks).find(
        (t) => t.kind === kind && (
          t.status === "running" ||
          t.status === "orphaned" ||
          (t.status !== "running" && !t.confirmed)
        ),
      );
      if (conflict) {
        if (conflict.status === "running") {
          store.setFullscreen(true);
          return;
        }
        // orphaned 或 未确认完成 → 抛出给调用方
        throw {
          __conflict: true,
          taskId: conflict.taskId,
          taskName: conflict.taskName,
          status: conflict.status,
        } as const;
      }
    }

    _stopPolling();

    const id = (await startFn()).scan_id;
    taskId.value = id;
    isRunning.value = true;
    _cancelFn = cancelFn;
    store.registerCancel(id, () => cancelFn(id));

    // 创建初始任务状态 + 自动展开浮层
    let current = createScanTaskState(id, opts?.taskName);
    current = appendTaskLog(current, `开始扫描 — 工作空间 ${id}`);
    store.upsertTask(current);
    store.setFullscreen(true); // 自动全屏让用户看到

    // 开始轮询
    const interval = opts?.interval ?? 500;
    let _lastFile = "";
    let _lastFileTime = performance.now();

    _pollTimer = setInterval(async () => {
      try {
        const payload = await pollFn(id);
        current = store.tasks[id];
        if (!current) return;

        // -- 文件耗时追踪：current_file 变化时记录 --
        const activeStep = current.steps[current.currentStep];
        const curFile =
          (payload.bom as { current_file?: string } | undefined)?.current_file ||
          (payload.xref as { current_file?: string } | undefined)?.current_file ||
          (payload.walk as { current_file?: string } | undefined)?.current_file ||
          "";
        if (curFile && curFile !== _lastFile) {
          const now = performance.now();
          if (_lastFile) {
            const duration = Math.round(now - _lastFileTime);
            const phaseLabel = activeStep?.label || "";
            current = {
              ...current,
              fileTimings: [
                ...(current.fileTimings || []),
                { file: _lastFile, phase: phaseLabel, duration, success: true },
              ].slice(-500),
            };
          }
          _lastFile = curFile;
          _lastFileTime = now;
        }

        const prevErrors = current.steps.reduce((s, step) => s + step.errors.length, 0);

        const updated = updateTaskFromPoll(current, payload);
        store.upsertTask(updated);
        current = updated;

        // 新增错误日志
        const newErrors = updated.steps.reduce((s, step) => s + step.errors.length, 0) - prevErrors;
        if (newErrors > 0) {
          const withLog = appendTaskLog(current, `⚠ ${newErrors} 个文件读取失败`);
          store.upsertTask(withLog);
          current = withLog;
        }

        if (isTerminal(updated.status)) {
          const finalLog = appendTaskLog(
            current,
            updated.status === "done"
              ? `✓ 扫描完成 · CAD ${payload.total_cad_files} · FCStd ${payload.total_fcstd_files}`
              : updated.status === "error"
                ? `✗ 扫描出错: ${updated.error || "未知错误"}`
                : `⊗ 扫描已取消`,
          );
          store.upsertTask(finalLog);
          store.unregisterCancel(id);
          _stopPolling();
          isRunning.value = false;
        }
      } catch (_err) {
        // 轮询失败不停止
      }
    }, interval);
  }

  // ── 测试（流模式） ──

  async function startStreaming(
    streamFn: (
      onEvent: (event: UnitTestStreamEvent) => void,
    ) => Promise<UnitTestRunResult>,
    cancelFn: (runId: string) => Promise<unknown>,
    opts?: StreamOptions,
  ): Promise<UnitTestRunResult | undefined> {
    // 单例约束：同种类任务已运行时拒绝新启动
    if (opts?.singleton && store.hasRunning) {
      const existing = Object.values(store.tasks).find(
        (t) => t.kind === kind && t.status === "running",
      );
      if (existing) return;
    }

    // 生成临时 taskId
    const id = `test-${Date.now()}`;
    taskId.value = id;
    isRunning.value = true;
    _cancelFn = cancelFn;
    store.registerCancel(id, () => cancelFn(taskId.value));

    const initial = createTestTaskState(id, undefined, opts?.taskName);
    store.upsertTask(initial);
    store.setFullscreen(true); // 自动全屏让用户看到

    let streamResult: UnitTestRunResult | undefined;
    try {
      streamResult = await streamFn((event: UnitTestStreamEvent) => {
        // 始终从 ref 读取有效 ID（避免 stale closure 吞事件）
        const effectiveId = taskId.value;
        const current = store.tasks[effectiveId];
        if (!current) return;

        // 提取 run_id（start 事件带回）
        if (event.type === "start" && event.run_id && event.run_id !== id) {
          taskId.value = event.run_id;
          store.unregisterCancel(id);
          store.registerCancel(event.run_id, () => cancelFn(event.run_id));
          store.removeTask(id);
          const renamed = { ...current, taskId: event.run_id };
          store.upsertTask(renamed);
        }

        const realId = taskId.value;
        const c = store.tasks[realId];
        if (!c) return;
        // 已是终态则跳过后续事件（如全部模块加载失败已在 start 中标记 error，阻止后续 done 覆盖）
        if (isTerminal(c.status)) return;

        const updated = updateTaskFromStreamEvent(c, event as Parameters<typeof updateTaskFromStreamEvent>[1]);
        store.upsertTask(updated);

        // ── logs / errors / timings（新架构统一在此产出）──
        let enriched = updated;
        switch (event.type) {
          case "start": {
            const mods = event.total_modules || 0;
            const cases = event.total_cases || 0;
            enriched = appendTaskLog(enriched, `${event.suite_label || event.suite_id || "单元测试"} · 总计 ${mods} 模块 ${cases} 用例`);
            // 模块导入错误 → 记入 overlay 日志和 errors
            const loadErrs = (event as any).load_errors as string[] | undefined;
            if (loadErrs?.length) {
              for (const err of loadErrs) {
                enriched = appendTaskLog(enriched, `✗ 加载失败: ${err}`);
              }
              if (!cases && !mods) {
                // 全部模块加载失败 → 标记为错误
                enriched = { ...enriched, status: "error" as const, error: loadErrs[0], finishedAt: new Date().toISOString() };
              }
            }
            break;
          }
          case "module_start":
            enriched = appendTaskLog(enriched, `→ [${event.suite_id || ""}] ${event.module} (${event.module_index}/${event.module_total})`);
            break;
          case "case_done": {
            const cs = (event as any).case;
            if (cs) {
              enriched = recordFileTiming(enriched, cs.method || cs.id || "", cs.module || "", cs.duration_ms || 0, cs.status === "passed", cs.status !== "passed" ? (cs.message || "") : undefined);
              if (cs.status === "failed" || cs.status === "error") {
                enriched = appendTaskLog(enriched, `✗ ${cs.method || cs.id}: ${cs.message || "失败"}`);
                if (enriched.steps[0]) {
                  enriched = {
                    ...enriched,
                    steps: enriched.steps.map((s, i) =>
                      i === 0 ? { ...s, errors: [...s.errors, { file: cs.method || cs.id || "", error: cs.message || "失败" }].slice(-50) } : s
                    ),
                  };
                }
              }
            }
            break;
          }
          case "module_done": {
            const summary = (event as any).summary;
            if (summary) {
              enriched = appendTaskLog(enriched, `✓ ${summary.module}: ${summary.passed}/${summary.tests_run} 通过`);
            }
            break;
          }
          case "done": {
            const result = (event as any).result;
            if (result?.summary) {
              const s = result.summary;
              enriched = appendTaskLog(enriched, `完成 · ${s.passed || 0} 通过 ${s.failed || 0} 失败 ${s.errors || 0} 错误 ${s.skipped || 0} 跳过 · ${s.tests_run || 0} 用例 ${s.modules || 0} 模块`);
            }
            break;
          }
          case "error":
            enriched = appendTaskLog(enriched, `✗ ${event.message || "未知错误"}`);
            break;
        }

        if (enriched !== updated) {
          store.upsertTask(enriched);
        }

        if (isTerminal(enriched.status)) {
          isRunning.value = false;
        }
      });
    } catch (err) {
      const effectiveId = taskId.value;
      const c = store.tasks[effectiveId];
      if (c) {
        store.upsertTask({
          ...c,
          status: "error",
          error: err instanceof Error ? err.message : String(err),
          finishedAt: new Date().toISOString(),
        });
      }
      isRunning.value = false;
    }
    return streamResult;
  }

  // ── 取消 ──

  async function cancel() {
    if (!_cancelFn || !taskId.value) return;
    try {
      await _cancelFn(taskId.value);
    } catch {
      /* ignore */
    }
    _stopPolling();
    const c = store.tasks[taskId.value];
    if (c) {
      store.upsertTask({
        ...c,
        status: "cancelled",
        finishedAt: new Date().toISOString(),
      });
    }
    isRunning.value = false;
  }

  // ── 页面刷新恢复 ──

  async function resume(): Promise<boolean> {
    store.hydrate();

    if (kind === "fcstd-scan") {
      try {
        const result = await fetchFcstdMapScanResume();
        if (result.active && result.scan_id) {
          taskId.value = result.scan_id;
          isRunning.value = true;
          _cancelFn = cancelFcstdMapScan;

          // 如果有 progress 快照，直接恢复
          if (result.progress) {
            const current = store.tasks[result.scan_id];
            const base = current || createScanTaskState(result.scan_id);
            const updated = updateTaskFromPoll(base, result.progress as ScanProgressPayload);
            store.upsertTask(updated);
          }

          // 服务重启后标记为 orphaned
          if (result.source === "db") {
            const current = store.tasks[result.scan_id];
            if (current) {
              store.upsertTask({ ...current, status: "orphaned" });
            }
            isRunning.value = false;
            return true;
          }

          // 恢复轮询
          _pollTimer = setInterval(async () => {
            try {
              const payload = await fetchFcstdMapScanProgress(result.scan_id!);
              const c = store.tasks[result.scan_id!];
              if (!c) return;
              const updated = updateTaskFromPoll(c, payload);
              store.upsertTask(updated);
              if (isTerminal(updated.status)) {
                _stopPolling();
                isRunning.value = false;
              }
            } catch {
              /* tolerate network blips */
            }
          }, 1000);

          return true;
        }
      } catch {
        /* resume not available */
      }
    }
    return false;
  }

  // ── 浮层 UI 控制（委托 store） ──

  function minimize() {
    store.setMinimized(true);
  }

  function restore() {
    store.setMinimized(false);
  }

  function close() {
    _stopPolling();
    if (taskId.value) {
      store.unregisterCancel(taskId.value);
      store.removeTask(taskId.value);
    }
    isRunning.value = false;
    taskId.value = "";
  }

  function dispose() {
    _stopPolling();
    if (taskId.value) {
      store.unregisterCancel(taskId.value);
      store.removeTask(taskId.value);
    }
    isRunning.value = false;
    taskId.value = "";
  }

  return {
    // 状态
    taskId,
    state,
    store,  // 暴露给页面做手动清理
    isRunning,
    progressPercent,
    steps,
    taskName,
    overlayMinimized: computed(() => store.overlayMinimized),

    // 启动
    startPolling,
    startStreaming,

    // 控制
    cancel,
    resume,
    minimize,
    restore,
    close,
    dispose,
  };
}
