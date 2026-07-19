import { describe, expect, it } from "vitest";
import type { UnitTestPlan } from "../api";
import {
  useUnitTestPlanController,
  type UnitTestPlanFetchOptions,
  type UnitTestPlanTransport,
} from "./useUnitTestPlanController";

function unitTestPlan(label: string, modules = [`tests.${label.toLowerCase()}`]): UnitTestPlan {
  return {
    suite_id: label.toLowerCase(),
    suite_label: label,
    total_modules: modules.length,
    total_cases: modules.length,
    ignored_cases: 0,
    load_errors: [],
    modules: modules.map((module) => ({
      module,
      suite_id: label.toLowerCase(),
      case_count: 1,
    })),
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<T>((accept, fail) => {
    resolve = accept;
    reject = fail;
  });
  return { promise, resolve, reject };
}

describe("useUnitTestPlanController", () => {
  it("只为计划请求发送套件、关注排除和 case detail，不携带旧模块过滤", async () => {
    const calls: Array<{ suites: string[]; options: UnitTestPlanFetchOptions }> = [];
    const transport: UnitTestPlanTransport = {
      fetchPlan: async (suites, options) => {
        calls.push({ suites, options });
        return unitTestPlan("Code");
      },
    };
    const controller = useUnitTestPlanController({ transport });
    const suiteIds = ["code"];
    const excludeCaseIds = ["case.old"];

    await controller.load({ suiteIds, excludeCaseIds, includeCaseDetails: true });
    suiteIds.push("caa");
    excludeCaseIds.push("case.late");

    expect(calls).toEqual([{
      suites: ["code"],
      options: {
        exclude_cases: ["case.old"],
        include_case_details: true,
      },
    }]);
    expect(calls[0]?.options).not.toHaveProperty("include_modules");
    expect(calls[0]?.options).not.toHaveProperty("include_cases");
  });

  it("旧成功响应不能覆盖新请求，旧 finally 也不能提前结束新 loading", async () => {
    const first = deferred<UnitTestPlan>();
    const second = deferred<UnitTestPlan>();
    const accepted: string[] = [];
    let call = 0;
    const transport: UnitTestPlanTransport = {
      fetchPlan: async () => (call++ === 0 ? first.promise : second.promise),
    };
    const controller = useUnitTestPlanController({
      transport,
      onAccepted: (plan) => { accepted.push(plan.suite_id); },
    });

    const oldLoad = controller.load({
      suiteIds: ["old"],
      includeCaseDetails: false,
    });
    const newLoad = controller.load({
      suiteIds: ["new"],
      includeCaseDetails: true,
    });
    first.resolve(unitTestPlan("Old"));

    await expect(oldLoad).resolves.toBeNull();
    expect(controller.plan.value).toBeNull();
    expect(controller.loading.value).toBe(true);
    expect(accepted).toEqual([]);

    second.resolve(unitTestPlan("New"));
    await expect(newLoad).resolves.toEqual(unitTestPlan("New"));
    expect(controller.plan.value?.suite_id).toBe("new");
    expect(controller.loading.value).toBe(false);
    expect(accepted).toEqual(["new"]);
  });

  it("新成功先提交后，迟到的旧失败不会清空计划或写入过时错误", async () => {
    const first = deferred<UnitTestPlan>();
    const second = deferred<UnitTestPlan>();
    let call = 0;
    const controller = useUnitTestPlanController({
      transport: {
        fetchPlan: async () => (call++ === 0 ? first.promise : second.promise),
      },
    });

    const oldLoad = controller.load({ suiteIds: ["old"], includeCaseDetails: false });
    const newLoad = controller.load({ suiteIds: ["new"], includeCaseDetails: false });
    second.resolve(unitTestPlan("New"));
    await newLoad;
    expect(controller.plan.value?.suite_id).toBe("new");
    expect(controller.loading.value).toBe(false);

    first.reject(new Error("old request failed"));
    await expect(oldLoad).resolves.toBeNull();
    expect(controller.plan.value?.suite_id).toBe("new");
    expect(controller.error.value).toBe("");
    expect(controller.loading.value).toBe(false);
  });

  it("当前请求失败时清空计划、保留错误并结束 loading", async () => {
    let accepted = 0;
    const controller = useUnitTestPlanController({
      transport: {
        fetchPlan: async () => { throw new Error("offline"); },
      },
      onAccepted: () => { accepted += 1; },
    });

    await expect(controller.load({
      suiteIds: ["code"],
      includeCaseDetails: false,
    })).resolves.toBeNull();
    expect(controller.plan.value).toBeNull();
    expect(controller.error.value).toBe("Error: offline");
    expect(controller.loading.value).toBe(false);
    expect(accepted).toBe(0);
  });

  it("clear 会使在途响应失效并立即清空计划状态", async () => {
    const pending = deferred<UnitTestPlan>();
    const controller = useUnitTestPlanController({
      transport: { fetchPlan: async () => pending.promise },
    });
    const loading = controller.load({ suiteIds: ["code"], includeCaseDetails: false });

    controller.clear();
    expect(controller.plan.value).toBeNull();
    expect(controller.loading.value).toBe(false);
    expect(controller.error.value).toBe("");

    pending.resolve(unitTestPlan("Code"));
    await expect(loading).resolves.toBeNull();
    expect(controller.plan.value).toBeNull();
  });
});
