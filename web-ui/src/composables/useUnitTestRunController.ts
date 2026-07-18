import { ref } from "vue";
import {
  cancelUnitTestRun,
  runUnitTestsStream,
  type UnitTestCaseResult,
  type UnitTestRunOptions,
  type UnitTestRunResult,
  type UnitTestStreamEvent,
} from "../api";
import { formatUnitTestRunSummary } from "../models/unitTestsViewModel";
import { useAppShell, type AppShellContext } from "./useAppShell";
import { useAsyncProgress } from "./useAsyncProgress";

export type UnitTestRunMode = "full" | "watchlist";

export interface UnitTestRunRequest {
  readonly suiteIds: string[];
  readonly runOptions?: UnitTestRunOptions;
  readonly logLabel: string;
  readonly lastRunSuiteIds?: string[];
  readonly runMode?: UnitTestRunMode;
}

export type UnitTestRunHost = Pick<AppShellContext, "appendLog" | "setStatus">;
export type UnitTestProgressPort = Pick<ReturnType<typeof useAsyncProgress>, "startStreaming" | "cancel">;

export interface UnitTestRunTransport {
  readonly runStream: (
    suites: string[],
    onEvent: (event: UnitTestStreamEvent) => void,
    options?: UnitTestRunOptions,
  ) => Promise<UnitTestRunResult>;
  readonly cancelRun: (runId: string) => Promise<unknown>;
}

export interface UseUnitTestRunControllerOptions {
  readonly onCaseDone?: (testCase: UnitTestCaseResult) => void;
  readonly onCompleted?: (
    result: UnitTestRunResult,
    request: UnitTestRunRequest,
  ) => void | Promise<void>;
  readonly host?: UnitTestRunHost;
  readonly progress?: UnitTestProgressPort;
  readonly transport?: UnitTestRunTransport;
}

const defaultTransport: UnitTestRunTransport = {
  runStream: runUnitTestsStream,
  cancelRun: cancelUnitTestRun,
};

/** 单元测试流式运行 Controller；范围/session/watchlist/history 仍归 Page。 */
export function useUnitTestRunController(options: UseUnitTestRunControllerOptions = {}) {
  const host = options.host ?? useAppShell();
  const progress = options.progress ?? useAsyncProgress("unit-test");
  const transport = options.transport ?? defaultTransport;
  const running = ref(false);
  const cancelling = ref(false);
  const result = ref<UnitTestRunResult | null>(null);

  async function execute(request: UnitTestRunRequest): Promise<UnitTestRunResult | null> {
    if (running.value) return null;
    running.value = true;
    cancelling.value = false;
    result.value = null;
    host.appendLog(`[单元测试] 运行 ${request.logLabel}…`, {
      source: "unit_tests",
      open: true,
    });

    try {
      result.value = (await progress.startStreaming(
        (onEvent) => transport.runStream(request.suiteIds, (event) => {
          if (event.type === "start" && event.load_errors.length) {
            for (const error of event.load_errors) {
              host.appendLog(`  ✗ 加载 ${error}`, { source: "unit_tests" });
            }
          }
          if (event.type === "case_done") {
            options.onCaseDone?.(event.case);
          }
          onEvent(event);
        }, { ...request.runOptions }),
        (runId) => transport.cancelRun(runId),
        { taskName: "单元测试" },
      )) ?? null;

      if (!result.value) {
        host.appendLog("测试运行未返回结果", { source: "unit_tests" });
        host.setStatus("测试运行未返回结果");
        return null;
      }

      await options.onCompleted?.(result.value, request);
      const message = formatUnitTestRunSummary(result.value);
      host.appendLog(message, { source: "unit_tests" });
      host.setStatus(message);
      if (!result.value.ok && result.value.failures.length) {
        for (const failure of result.value.failures.slice(0, 5)) {
          host.appendLog(`  ✗ ${failure.id}: ${failure.message}`, { source: "unit_tests" });
        }
      }
      return result.value;
    } catch (error) {
      const message = String(error);
      if (message.includes("终止") || message.includes("aborted")) {
        host.appendLog("[单元测试] 运行已终止", { source: "unit_tests" });
        host.setStatus("运行已终止");
      } else {
        host.appendLog(message, { source: "unit_tests" });
        host.setStatus(message);
      }
      return null;
    } finally {
      running.value = false;
      cancelling.value = false;
    }
  }

  function cancel(): void {
    if (!running.value || cancelling.value) return;
    cancelling.value = true;
    host.appendLog("[单元测试] 请求终止…（当前用例结束后停止）", {
      source: "unit_tests",
    });
    host.setStatus("正在终止…");
    void progress.cancel();
  }

  return {
    running,
    cancelling,
    result,
    execute,
    cancel,
  };
}
