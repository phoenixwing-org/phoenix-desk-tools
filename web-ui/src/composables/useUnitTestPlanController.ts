import { ref } from "vue";
import {
  fetchUnitTestPlan,
  type UnitTestPlan,
  type UnitTestRunOptions,
} from "../api";

export interface UnitTestPlanRequest {
  readonly suiteIds: readonly string[];
  readonly excludeCaseIds?: readonly string[];
  readonly includeCaseDetails: boolean;
}

export type UnitTestPlanFetchOptions = Pick<UnitTestRunOptions, "exclude_cases"> & {
  readonly include_case_details: boolean;
};

export interface UnitTestPlanTransport {
  readonly fetchPlan: (
    suites: string[],
    options: UnitTestPlanFetchOptions,
  ) => Promise<UnitTestPlan>;
}

export interface UseUnitTestPlanControllerOptions {
  readonly transport?: UnitTestPlanTransport;
  readonly onAccepted?: (plan: UnitTestPlan, request: UnitTestPlanRequest) => void;
}

const defaultTransport: UnitTestPlanTransport = {
  fetchPlan: fetchUnitTestPlan,
};

/** 单元测试计划 Controller；仅最新请求可以提交状态和触发 Page hook。 */
export function useUnitTestPlanController(options: UseUnitTestPlanControllerOptions = {}) {
  const transport = options.transport ?? defaultTransport;
  const plan = ref<UnitTestPlan | null>(null);
  const loading = ref(false);
  const error = ref("");
  let requestEpoch = 0;

  async function load(request: UnitTestPlanRequest): Promise<UnitTestPlan | null> {
    const epoch = ++requestEpoch;
    const snapshot: UnitTestPlanRequest = {
      suiteIds: [...request.suiteIds],
      excludeCaseIds: request.excludeCaseIds ? [...request.excludeCaseIds] : undefined,
      includeCaseDetails: request.includeCaseDetails,
    };
    const fetchOptions: UnitTestPlanFetchOptions = {
      include_case_details: snapshot.includeCaseDetails,
      ...(snapshot.excludeCaseIds?.length
        ? { exclude_cases: [...snapshot.excludeCaseIds] }
        : {}),
    };
    loading.value = true;
    error.value = "";

    try {
      const loaded = await transport.fetchPlan([...snapshot.suiteIds], fetchOptions);
      if (epoch !== requestEpoch) return null;
      plan.value = loaded;
      options.onAccepted?.(loaded, snapshot);
      return loaded;
    } catch (cause) {
      if (epoch !== requestEpoch) return null;
      error.value = String(cause);
      plan.value = null;
      return null;
    } finally {
      if (epoch === requestEpoch) loading.value = false;
    }
  }

  function clear(): void {
    requestEpoch += 1;
    plan.value = null;
    loading.value = false;
    error.value = "";
  }

  return {
    plan,
    loading,
    error,
    load,
    clear,
  };
}
