import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const DESK_API_PROTOCOL_VERSION = 1;

export function deskApiRegistrationDirectory(env = process.env, platform = process.platform, home = os.homedir()) {
  const override = String(env.PHOENIX_DESK_TOOLS_REGISTRY_DIR || "").trim();
  if (override) return path.resolve(override);
  let root;
  if (platform === "darwin") root = path.join(home, "Library", "Application Support");
  else if (platform === "win32") root = String(env.LOCALAPPDATA || "").trim() || path.join(home, "AppData", "Local");
  else root = String(env.XDG_CONFIG_HOME || "").trim() || path.join(home, ".config");
  return path.join(root, "phoenix-wing", "phoenix", "services", "desk-tools");
}

export function readDeskApiRegistration(env = process.env) {
  const servicePath = path.join(deskApiRegistrationDirectory(env), "service.v1.json");
  try {
    const service = JSON.parse(fs.readFileSync(servicePath, "utf8"));
    const port = Number(service?.port);
    if (
      service?.schema_version !== 1
      || service?.service !== "phoenix-desk-tools"
      || service?.host !== "127.0.0.1"
      || !Number.isInteger(port)
      || port < 1
      || port > 65_535
    ) return null;
    return { ...service, port, servicePath };
  } catch {
    return null;
  }
}

export async function probeDeskApi(registration, fetchImpl = globalThis.fetch) {
  if (!registration) return null;
  try {
    const response = await fetchImpl(`http://127.0.0.1:${registration.port}/api/health`, {
      signal: AbortSignal.timeout(800),
    });
    if (!response.ok) return null;
    const health = await response.json();
    if (health?.service !== "phoenix-node") return null;
    if (
      registration.protocol_version !== DESK_API_PROTOCOL_VERSION
      || health?.protocol_version !== DESK_API_PROTOCOL_VERSION
    ) {
      throw new Error(
        `已运行的 Desk API 协议版本为登记 ${String(registration.protocol_version ?? "未知")} / 健康 ${String(health?.protocol_version ?? "未知")}，当前界面要求 ${DESK_API_PROTOCOL_VERSION}`,
      );
    }
    return {
      origin: `http://127.0.0.1:${registration.port}`,
      port: registration.port,
      protocolVersion: health.protocol_version,
      appVersion: String(health.app_version || registration.app_version || "未知"),
      servicePath: registration.servicePath,
    };
  } catch (error) {
    if (error instanceof Error && error.message.includes("协议版本")) throw error;
    return null;
  }
}

export async function discoverDeskApi(env = process.env, fetchImpl = globalThis.fetch) {
  const api = await probeDeskApi(readDeskApiRegistration(env), fetchImpl);
  // A live process may still contain the previous checkout's modules, even when
  // it was originally started in local mode. Never mix it with freshly built UI.
  if (api && env.PHOENIX_WING_MODE === "local") {
    throw new Error(
      `pnpm wing 需要重新启动本地 Wing Server；检测到已运行的 Desk API ${api.origin}。请先停止该服务，再执行 pnpm wing；不会复用无法确认最新真源的后台，也不会自动关闭现有服务。`,
    );
  }
  return api;
}
