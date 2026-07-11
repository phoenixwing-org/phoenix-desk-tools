type TauriCore = {
  invoke<T>(command: string, args?: Record<string, unknown>): Promise<T>;
};

type PhoenixRuntimeGlobal = typeof globalThis & {
  __TAURI__?: { core?: TauriCore };
  __PHOENIX_API_ORIGIN__?: string;
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
  return isTauriRuntime() ? "http://127.0.0.1:5180" : "";
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
