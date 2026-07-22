import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { runtimeHomeDirectory } from "./appRuntimePaths.js";

export const DESK_TOOLS_SERVICE_SCHEMA_VERSION = 1;
export const DESK_TOOLS_SERVICE_PROTOCOL_VERSION = 1;
export const DESK_TOOLS_APP_VERSION = "0.3.0";
export const DESK_TOOLS_PREFERRED_PORT = 48_375;
export const DESK_TOOLS_PORT_ATTEMPTS = 32;

export type DeskToolsServiceRegistration = {
  readonly schema_version: 1;
  readonly service: "phoenix-desk-tools";
  readonly protocol_version: 1;
  readonly app_version: string;
  readonly host: "127.0.0.1";
  readonly port: number;
  readonly pid: number;
  readonly instance_id: string;
  readonly started_at: string;
  readonly health_path: "/api/caa/health";
  readonly caa_open_path: "/api/caa/dialog/open";
};

export type DeskToolsRegistrationHandle = {
  readonly directory: string;
  readonly servicePath: string;
  readonly service: DeskToolsServiceRegistration;
  dispose(): void;
};

export type DeskToolsInstanceLease = {
  readonly instanceId: string;
  readonly lockPath: string;
  dispose(): void;
};

type RegistrationPlatform = NodeJS.Platform;

function platformConfigRoot(
  platform: RegistrationPlatform,
  env: NodeJS.ProcessEnv,
  homeDirectory: string,
): string {
  if (platform === "darwin") return path.join(homeDirectory, "Library", "Application Support");
  if (platform === "win32") {
    const local = String(env.LOCALAPPDATA || "").trim();
    return local || path.join(homeDirectory, "AppData", "Local");
  }
  const xdg = String(env.XDG_CONFIG_HOME || "").trim();
  return xdg ? path.resolve(xdg) : path.join(homeDirectory, ".config");
}

export function deskToolsRegistrationDirectory(
  env: NodeJS.ProcessEnv = process.env,
  platform: RegistrationPlatform = process.platform,
  homeDirectory = runtimeHomeDirectory(),
): string {
  const override = String(env.PHOENIX_DESK_TOOLS_REGISTRY_DIR || "").trim();
  if (override) return path.resolve(override);
  return path.join(platformConfigRoot(platform, env, homeDirectory), "phoenix-wing", "phoenix", "services", "desk-tools");
}

export function deskToolsPortCandidates(
  env: NodeJS.ProcessEnv = process.env,
): { readonly ports: readonly number[]; readonly strict: boolean } {
  const explicit = String(env.CAA_SERVER_PORT || "").trim();
  if (explicit) {
    const port = Number(explicit);
    if (!Number.isInteger(port) || port < 1 || port > 65_535) {
      throw new Error(`CAA_SERVER_PORT 必须是 1..65535 的整数，当前为 ${JSON.stringify(explicit)}`);
    }
    return { ports: [port], strict: true };
  }
  return {
    ports: Array.from({ length: DESK_TOOLS_PORT_ATTEMPTS }, (_, index) => DESK_TOOLS_PREFERRED_PORT + index),
    strict: false,
  };
}

function atomicWriteJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(temporaryPath, "wx", 0o600);
    fs.writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8" });
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    fs.renameSync(temporaryPath, filePath);
  } finally {
    if (descriptor !== undefined) {
      try { fs.closeSync(descriptor); } catch { /* already closed during an exceptional path */ }
    }
    try { fs.unlinkSync(temporaryPath); } catch { /* rename or cleanup already completed */ }
  }
}

function removeOwnedServiceRegistration(filePath: string, instanceId: string): void {
  try {
    const current = JSON.parse(fs.readFileSync(filePath, "utf8")) as { instance_id?: unknown };
    if (current.instance_id === instanceId) fs.unlinkSync(filePath);
  } catch {
    // A missing, stale, or concurrently replaced registration belongs to nobody here.
  }
}

function processIsAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return Boolean(error && typeof error === "object" && "code" in error && error.code === "EPERM");
  }
}

function removeOwnedFile(filePath: string, instanceId: string): void {
  try {
    const current = JSON.parse(fs.readFileSync(filePath, "utf8")) as { instance_id?: unknown };
    if (current.instance_id === instanceId) fs.unlinkSync(filePath);
  } catch {
    // Missing or replaced ownership records are not ours to remove.
  }
}

/**
 * Serialises Desk API startup across Web and Tauri hosts. The service registration
 * remains the discovery source; this lock only closes the simultaneous-start race.
 */
export function acquireDeskToolsInstanceLease(
  env: NodeJS.ProcessEnv = process.env,
  now = new Date(),
  isPidAlive: (pid: number) => boolean = processIsAlive,
): DeskToolsInstanceLease {
  const directory = deskToolsRegistrationDirectory(env);
  const lockPath = path.join(directory, "instance.v1.lock");
  const instanceId = randomUUID();
  const owner = {
    schema_version: 1,
    service: "phoenix-desk-tools",
    instance_id: instanceId,
    pid: process.pid,
    host_kind: String(env.PHOENIX_DESK_HOST || "direct"),
    started_at: now.toISOString(),
  };
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });

  for (let attempt = 0; attempt < 3; attempt += 1) {
    let descriptor: number | undefined;
    try {
      descriptor = fs.openSync(lockPath, "wx", 0o600);
      fs.writeFileSync(descriptor, `${JSON.stringify(owner, null, 2)}\n`, { encoding: "utf8" });
      fs.fsyncSync(descriptor);
      fs.closeSync(descriptor);
      descriptor = undefined;
      let disposed = false;
      return {
        instanceId,
        lockPath,
        dispose(): void {
          if (disposed) return;
          disposed = true;
          removeOwnedFile(lockPath, instanceId);
        },
      };
    } catch (error) {
      if (descriptor !== undefined) {
        try { fs.closeSync(descriptor); } catch { /* already closed */ }
      }
      const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
      if (code !== "EEXIST") throw error;
      let existing: { instance_id?: unknown; pid?: unknown; host_kind?: unknown } = {};
      try { existing = JSON.parse(fs.readFileSync(lockPath, "utf8")); } catch { /* stale partial lock */ }
      const pid = Number(existing.pid);
      if (isPidAlive(pid)) {
        throw new Error(
          `Desk API 已由 ${String(existing.host_kind || "另一宿主")} 启动（PID ${pid}）。请复用 service.v1.json 中登记的 API，不要启动第二份。`,
        );
      }
      removeOwnedFile(lockPath, String(existing.instance_id || ""));
    }
  }
  throw new Error("无法取得 Desk API 单实例锁；请稍后重试");
}

export function registerDeskToolsRuntime(
  port: number,
  env: NodeJS.ProcessEnv = process.env,
  now = new Date(),
  instanceId: string = randomUUID(),
): DeskToolsRegistrationHandle {
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error(`无效 Desk Tools 端口：${port}`);
  const directory = deskToolsRegistrationDirectory(env);
  const servicePath = path.join(directory, "service.v1.json");
  const service: DeskToolsServiceRegistration = {
    schema_version: DESK_TOOLS_SERVICE_SCHEMA_VERSION,
    service: "phoenix-desk-tools",
    protocol_version: DESK_TOOLS_SERVICE_PROTOCOL_VERSION,
    app_version: DESK_TOOLS_APP_VERSION,
    host: "127.0.0.1",
    port,
    pid: process.pid,
    instance_id: instanceId,
    started_at: now.toISOString(),
    health_path: "/api/caa/health",
    caa_open_path: "/api/caa/dialog/open",
  };
  atomicWriteJson(servicePath, service);

  let disposed = false;
  return {
    directory,
    servicePath,
    service,
    dispose(): void {
      if (disposed) return;
      disposed = true;
      removeOwnedServiceRegistration(servicePath, service.instance_id);
    },
  };
}
