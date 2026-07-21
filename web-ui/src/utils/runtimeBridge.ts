type TauriCore = {
  invoke<T>(command: string, args?: Record<string, unknown>): Promise<T>;
};

type PhoenixRuntimeGlobal = typeof globalThis & {
  __TAURI__?: { core?: TauriCore };
  __PHOENIX_API_ORIGIN__?: string;
};

type PhoenixRuntimeInfo = {
  api_origin?: unknown;
};

function runtimeGlobal(): PhoenixRuntimeGlobal {
  return globalThis as PhoenixRuntimeGlobal;
}

function trimOrigin(value: unknown): string {
  return String(value || "").trim().replace(/\/+$/, "");
}

export function isTauriRuntime(): boolean {
  return typeof runtimeGlobal().__TAURI__?.core?.invoke === "function";
}

export function apiOrigin(): string {
  const configured = trimOrigin(
    runtimeGlobal().__PHOENIX_API_ORIGIN__ || import.meta.env.VITE_API_ORIGIN,
  );
  if (configured) return configured;
  return isTauriRuntime() ? "http://127.0.0.1:48375" : "";
}

export function apiUrl(url: string): string {
  if (/^[a-z][a-z\d+.-]*:/i.test(url) || url.startsWith("//")) return url;
  const origin = apiOrigin();
  if (!origin) return url;
  return `${origin}${url.startsWith("/") ? "" : "/"}${url}`;
}

export async function invokeTauri<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const invoke = runtimeGlobal().__TAURI__?.core?.invoke;
  if (!invoke) throw new Error("Tauri runtime is unavailable");
  return invoke<T>(command, args);
}

/** Resolve the managed API port before Vue mounts and any store starts fetching. */
export async function initializeRuntimeBridge(): Promise<void> {
  if (!isTauriRuntime() || trimOrigin(runtimeGlobal().__PHOENIX_API_ORIGIN__)) return;
  const info = await invokeTauri<PhoenixRuntimeInfo>("get_runtime_info");
  const origin = trimOrigin(info.api_origin);
  const parsed = new URL(origin);
  if (parsed.protocol !== "http:" || parsed.hostname !== "127.0.0.1" || !parsed.port) {
    throw new Error("Tauri returned an invalid Phoenix API origin");
  }
  runtimeGlobal().__PHOENIX_API_ORIGIN__ = parsed.origin;
}
