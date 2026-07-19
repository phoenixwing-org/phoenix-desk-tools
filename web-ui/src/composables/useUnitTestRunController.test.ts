import { describe, expect, it } from "vitest";
import type {
  UnitTestCaseResult,
  UnitTestRunResult,
  UnitTestStreamEvent,
} from "../api";
import {
  useUnitTestRunController,
  type UnitTestProgressPort,
  type UnitTestRunHost,
  type UnitTestRunTransport,
} from "./useUnitTestRunController";

function testCase(index = 1, status: UnitTestCaseResult["status"] = "failed"): UnitTestCaseResult {
  return {
    id: `case-${index}`,
    suite_id: "code",
    module: "tests.test_demo",
    class_name: "DemoTests",
    method: `test_${index}`,
    status,
    duration_ms: 12,
    message: status === "passed" ? "" : `failure-${index}`,
    traceback: "",
  };
}

function runResult(overrides: Partial<UnitTestRunResult> = {}): UnitTestRunResult {
  const failure = testCase();
  return {
    ok: false,
    suite_id: "code",
    suite_label: "Code",
    duration_ms: 100,
    summary: {
      tests_run: 2,
      passed: 1,
      failed: 1,
      errors: 0,
      skipped: 0,
      modules: 1,
      ignored: 2,
    },
    modules: [{ module: "tests.test_demo", tests_run: 2, passed: 1, failed: 1, errors: 0, skipped: 0 }],
    cases: [testCase(2, "passed"), failure],
    failures: [failure],
    ...overrides,
  };
}

function hostRecorder() {
  const logs: string[] = [];
  const statuses: string[] = [];
  const host: UnitTestRunHost = {
    appendLog: (message) => { logs.push(message); },
    setStatus: (message) => { statuses.push(message); },
  };
  return { host, logs, statuses };
}

describe("useUnitTestRunController", () => {
  it("通过注入端口运行 stream，转发事件并在结果日志前完成 Page hooks", async () => {
    const { host, logs, statuses } = hostRecorder();
    const forwarded: UnitTestStreamEvent[] = [];
    const cancelledRunIds: string[] = [];
    let registeredCancel: ((runId: string) => Promise<unknown>) | undefined;
    let taskName = "";
    const order: string[] = [];
    const completedCases: string[] = [];
    const output = runResult({ failures: Array.from({ length: 6 }, (_, index) => testCase(index + 1)) });

    const progress: UnitTestProgressPort = {
      startStreaming: async (stream, cancel, options) => {
        registeredCancel = cancel;
        taskName = options?.taskName ?? "";
        return stream((event) => { forwarded.push(event); });
      },
      cancel: async () => undefined,
    };
    let controller: ReturnType<typeof useUnitTestRunController>;
    const transport: UnitTestRunTransport = {
      runStream: async (suites, onEvent, options) => {
        expect(controller.running.value).toBe(true);
        expect(suites).toEqual(["code"]);
        expect(options).toEqual({ include_modules: ["tests.test_demo"] });
        onEvent({
          type: "start",
          run_id: "run-7",
          suite_id: "code",
          suite_label: "Code",
          total_modules: 1,
          total_cases: 2,
          modules: ["tests.test_demo"],
          load_errors: ["broken module"],
        });
        onEvent({ type: "case_done", case: testCase(), completed: 1, total: 2 });
        return output;
      },
      cancelRun: async (runId) => { cancelledRunIds.push(runId); },
    };
    controller = useUnitTestRunController({
      host,
      progress,
      transport,
      onCaseDone: (entry) => { completedCases.push(entry.id); },
      onCompleted: () => { order.push("completed"); },
    });

    const result = await controller.execute({
      suiteIds: ["code"],
      runOptions: { include_modules: ["tests.test_demo"] },
      logLabel: "Code · 1/2 模块",
    });
    order.push("returned");

    expect(result).toEqual(output);
    expect(controller.result.value).toEqual(output);
    expect(controller.running.value).toBe(false);
    expect(taskName).toBe("单元测试");
    expect(forwarded.map((event) => event.type)).toEqual(["start", "case_done"]);
    expect(completedCases).toEqual(["case-1"]);
    expect(order).toEqual(["completed", "returned"]);
    expect(logs[0]).toBe("[单元测试] 运行 Code · 1/2 模块…");
    expect(logs).toContain("  ✗ 加载 broken module");
    expect(logs.filter((message) => message.startsWith("  ✗ case-"))).toHaveLength(5);
    expect(statuses.at(-1)).toContain("失败 1");
    await registeredCancel?.("run-7");
    expect(cancelledRunIds).toEqual(["run-7"]);
  });

  it("无结果时保持 null、写入明确状态并在 finally 解锁", async () => {
    const { host, logs, statuses } = hostRecorder();
    const progress: UnitTestProgressPort = {
      startStreaming: async () => undefined,
      cancel: async () => undefined,
    };
    const transport: UnitTestRunTransport = {
      runStream: async () => runResult(),
      cancelRun: async () => undefined,
    };
    const controller = useUnitTestRunController({ host, progress, transport });

    await expect(controller.execute({ suiteIds: ["code"], logLabel: "Code" })).resolves.toBeNull();
    expect(controller.result.value).toBeNull();
    expect(controller.running.value).toBe(false);
    expect(logs).toContain("测试运行未返回结果");
    expect(statuses).toContain("测试运行未返回结果");
  });

  it.each([
    [new Error("运行已终止"), "运行已终止"],
    [new Error("aborted by user"), "运行已终止"],
    [new Error("offline"), "Error: offline"],
  ])("区分终止与普通异常，并始终解锁：%s", async (error, expectedStatus) => {
    const { host, statuses } = hostRecorder();
    const progress: UnitTestProgressPort = {
      startStreaming: async () => { throw error; },
      cancel: async () => undefined,
    };
    const transport: UnitTestRunTransport = {
      runStream: async () => runResult(),
      cancelRun: async () => undefined,
    };
    const controller = useUnitTestRunController({ host, progress, transport });

    await expect(controller.execute({ suiteIds: ["code"], logLabel: "Code" })).resolves.toBeNull();
    expect(statuses.at(-1)).toBe(expectedStatus);
    expect(controller.running.value).toBe(false);
  });

  it("拒绝重叠运行，并把重复终止收敛为一次", async () => {
    const { host, logs } = hostRecorder();
    let resolveRun: ((result: UnitTestRunResult) => void) | undefined;
    let progressCancelCount = 0;
    let startCount = 0;
    const progress: UnitTestProgressPort = {
      startStreaming: async () => {
        startCount += 1;
        return new Promise<UnitTestRunResult>((resolve) => { resolveRun = resolve; });
      },
      cancel: async () => { progressCancelCount += 1; },
    };
    const transport: UnitTestRunTransport = {
      runStream: async () => runResult(),
      cancelRun: async () => undefined,
    };
    const controller = useUnitTestRunController({ host, progress, transport });

    const first = controller.execute({ suiteIds: ["code"], logLabel: "first" });
    expect(controller.running.value).toBe(true);
    await expect(controller.execute({ suiteIds: ["caa"], logLabel: "second" })).resolves.toBeNull();
    controller.cancel();
    controller.cancel();
    expect(progressCancelCount).toBe(1);
    expect(controller.cancelling.value).toBe(true);
    expect(logs.filter((message) => message.includes("请求终止"))).toHaveLength(1);

    resolveRun?.(runResult());
    await first;
    expect(startCount).toBe(1);
    expect(controller.running.value).toBe(false);
    expect(controller.cancelling.value).toBe(false);
  });
});
