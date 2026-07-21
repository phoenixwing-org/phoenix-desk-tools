import { describe, expect, it, vi } from "vitest";
import {
  createAsyncViewSwitchController,
  createRetryableSharedLoader,
  type AsyncViewSwitchState,
  type AsyncViewTarget,
} from "./asyncViewSwitch";

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function target(id: string): AsyncViewTarget {
  return { id, pageId: `page-${id}` };
}

describe("async View switch", () => {
  it("reuses an in-flight loader and retries after a rejection", async () => {
    const first = deferred<string>();
    const loader = vi.fn()
      .mockImplementationOnce(() => first.promise)
      .mockResolvedValueOnce("recovered");
    const shared = createRetryableSharedLoader(loader);

    const pending = shared();
    expect(shared()).toBe(pending);
    first.reject(new Error("chunk failed"));
    await expect(pending).rejects.toThrow("chunk failed");
    await expect(shared()).resolves.toBe("recovered");
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it("keeps the ready View visible until the target loader resolves", async () => {
    const loads = new Map<string, Deferred<void>>();
    const states: AsyncViewSwitchState<AsyncViewTarget>[] = [];
    const controller = createAsyncViewSwitchController<AsyncViewTarget>({
      load: (pageId) => {
        const load = deferred<void>();
        loads.set(pageId, load);
        return load.promise;
      },
      onState: (state) => states.push(state),
    });

    const first = target("first");
    const firstSelection = controller.select(first);
    loads.get(first.pageId)!.resolve();
    await expect(firstSelection).resolves.toBe(true);

    const second = target("second");
    const secondSelection = controller.select(second);
    expect(controller.snapshot()).toEqual({ displayed: first, pending: second, error: "" });
    loads.get(second.pageId)!.resolve();
    await expect(secondSelection).resolves.toBe(true);
    expect(controller.snapshot()).toEqual({ displayed: second, pending: undefined, error: "" });
    expect(states).not.toContainEqual({ displayed: undefined, pending: second, error: "" });
  });

  it("lets the latest navigation win when loaders finish out of order", async () => {
    const loads = new Map<string, Deferred<void>>();
    const controller = createAsyncViewSwitchController<AsyncViewTarget>({
      load: (pageId) => {
        const load = deferred<void>();
        loads.set(pageId, load);
        return load.promise;
      },
      onState: () => undefined,
    });

    const slow = target("slow");
    const latest = target("latest");
    const slowSelection = controller.select(slow);
    const latestSelection = controller.select(latest);
    loads.get(latest.pageId)!.resolve();
    await expect(latestSelection).resolves.toBe(true);
    loads.get(slow.pageId)!.resolve();
    await expect(slowSelection).resolves.toBe(false);
    expect(controller.snapshot().displayed).toEqual(latest);
  });

  it("preserves the last ready View when loading fails", async () => {
    const failures: string[] = [];
    const controller = createAsyncViewSwitchController<AsyncViewTarget>({
      load: async (pageId) => {
        if (pageId.endsWith("broken")) throw new Error("unable to import chunk");
      },
      onState: () => undefined,
      onError: (_target, message) => failures.push(message),
    });
    const ready = target("ready");
    await controller.select(ready);

    await expect(controller.select(target("broken"))).resolves.toBe(false);
    expect(controller.snapshot()).toEqual({
      displayed: ready,
      pending: undefined,
      error: "unable to import chunk",
    });
    expect(failures).toEqual(["unable to import chunk"]);
  });
});
