export type AsyncViewTarget = {
  readonly id: string;
  readonly pageId: string;
};

export type AsyncViewSwitchState<T extends AsyncViewTarget> = {
  readonly displayed: T | undefined;
  readonly pending: T | undefined;
  readonly error: string;
};

type AsyncViewSwitchOptions<T extends AsyncViewTarget> = {
  readonly load: (pageId: string) => Promise<unknown>;
  readonly onState: (state: AsyncViewSwitchState<T>) => void;
  readonly onError?: (target: T, message: string) => void;
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
/**
 * 复用同一个模块加载 Promise；失败后清空缓存，允许下一次导航重试。
 */
export function createRetryableSharedLoader<T>(loader: () => Promise<T>, timeoutMs = 30_000): () => Promise<T> {
  let shared: Promise<T> | undefined;
  return () => {
    if (!shared) {
      // Preload runs before defineAsyncComponent mounts, so its timeout cannot protect this wait.
      const loading = new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("页面模块加载超时，请重试；尚未开始文件处理")), timeoutMs);
        Promise.resolve().then(loader).then(resolve, reject).finally(() => clearTimeout(timer));
      });
      shared = loading.catch((error: unknown) => {
        shared = undefined;
        throw error;
      });
    }
    return shared;
  };
}

/**
 * 将“当前导航目标”与“已经 ready、可以显示的 View”分离。
 * 新 View 加载期间保留旧 View；递增序号保证快速导航时只有最后请求可以提交。
 */
export function createAsyncViewSwitchController<T extends AsyncViewTarget>(
  options: AsyncViewSwitchOptions<T>,
) {
  let requestSequence = 0;
  let state: AsyncViewSwitchState<T> = {
    displayed: undefined,
    pending: undefined,
    error: "",
  };

  function publish(next: AsyncViewSwitchState<T>): void {
    state = next;
    options.onState(state);
  }

  async function select(target: T | undefined): Promise<boolean> {
    const request = ++requestSequence;
    if (!target) {
      publish({ displayed: undefined, pending: undefined, error: "" });
      return true;
    }
    if (state.displayed?.id === target.id) {
      publish({ displayed: target, pending: undefined, error: "" });
      return true;
    }

    publish({ displayed: state.displayed, pending: target, error: "" });
    try {
      await options.load(target.pageId);
    } catch (error: unknown) {
      if (request !== requestSequence) return false;
      const message = errorMessage(error);
      publish({ displayed: state.displayed, pending: undefined, error: message });
      options.onError?.(target, message);
      return false;
    }

    if (request !== requestSequence) return false;
    publish({ displayed: target, pending: undefined, error: "" });
    return true;
  }

  function cancel(): void {
    requestSequence += 1;
  }

  function snapshot(): AsyncViewSwitchState<T> {
    return state;
  }

  return { select, cancel, snapshot };
}
