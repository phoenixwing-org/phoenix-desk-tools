import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { runtimeHomeDirectory } from "./appRuntimePaths.js";

export const DESK_TOOLS_SERVICE_SCHEMA_VERSION = 1;
export const DESK_TOOLS_SERVICE_PROTOCOL_VERSION = 1;
export const DESK_TOOLS_PREFERRED_PORT = 48_375;
export const DESK_TOOLS_PORT_ATTEMPTS = 32;

export type DeskToolsServiceRegistration = {
  readonly schema_version: 1;
  readonly service: "phoenix-desk-tools";
  readonly protocol_version: 1;
  readonly host: "127.0.0.1";
  readonly port: number;
  readonly pid: number;
  readonly instance_id: string;
  readonly started_at: string;
  readonly health_path: "/api/caa/health";
  readonly caa_open_path: "/api/caa/dialog/open";
};

export type DeskToolsInstallationRegistration = {
  readonly schema_version: 1;
  readonly product: "phoenix-desk-tools";
  readonly product_version: string;
  readonly native_provider_manifest: string;
  readonly updated_at: string;
};

export type DeskToolsRegistrationHandle = {
  readonly directory: string;
  readonly servicePath: string;
  readonly installationPath?: string;
  readonly service: DeskToolsServiceRegistration;
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

function nativeProviderManifest(env: NodeJS.ProcessEnv): string {
  const explicit = String(env.PHOENIX_NATIVE_PROVIDER_MANIFEST || "").trim();
  const resources = String(env.PHOENIX_RESOURCES_DIR || "").trim();
  const repo = String(env.PHOENIX_REPO_ROOT || "").trim();
  const candidates = [
    explicit,
    resources ? path.join(resources, "native-provider.json") : "",
    resources ? path.join(resources, "runtime", "native-provider.json") : "",
    repo ? path.join(repo, "src-tauri", "resources", "runtime", "native-provider.json") : "",
  ].filter(Boolean);
  return candidates.find((candidate) => {
    try { return fs.statSync(candidate).isFile(); } catch { return false; }
  }) ?? "";
}

function removeOwnedServiceRegistration(filePath: string, instanceId: string): void {
  try {
    const current = JSON.parse(fs.readFileSync(filePath, "utf8")) as { instance_id?: unknown };
    if (current.instance_id === instanceId) fs.unlinkSync(filePath);
  } catch {
    // A missing, stale, or concurrently replaced registration belongs to nobody here.
  }
}

export function registerDeskToolsRuntime(
  port: number,
  env: NodeJS.ProcessEnv = process.env,
  now = new Date(),
): DeskToolsRegistrationHandle {
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error(`无效 Desk Tools 端口：${port}`);
  const directory = deskToolsRegistrationDirectory(env);
  const servicePath = path.join(directory, "service.v1.json");
  const service: DeskToolsServiceRegistration = {
    schema_version: DESK_TOOLS_SERVICE_SCHEMA_VERSION,
    service: "phoenix-desk-tools",
    protocol_version: DESK_TOOLS_SERVICE_PROTOCOL_VERSION,
    host: "127.0.0.1",
    port,
    pid: process.pid,
    instance_id: randomUUID(),
    started_at: now.toISOString(),
    health_path: "/api/caa/health",
    caa_open_path: "/api/caa/dialog/open",
  };
  atomicWriteJson(servicePath, service);

  const providerManifest = nativeProviderManifest(env);
  const installationPath = providerManifest ? path.join(directory, "installation.v1.json") : undefined;
  if (installationPath) {
    const installation: DeskToolsInstallationRegistration = {
      schema_version: DESK_TOOLS_SERVICE_SCHEMA_VERSION,
      product: "phoenix-desk-tools",
      product_version: String(env.PHOENIX_DESK_TOOLS_VERSION || "0.2.0"),
      native_provider_manifest: providerManifest,
      updated_at: now.toISOString(),
    };
    atomicWriteJson(installationPath, installation);
  }

  let disposed = false;
  return {
    directory,
    servicePath,
    installationPath,
    service,
    dispose(): void {
      if (disposed) return;
      disposed = true;
      removeOwnedServiceRegistration(servicePath, service.instance_id);
    },
  };
}
