import fs from "node:fs";
import path from "node:path";
import { runtimeRepoRoot } from "./appRuntimePaths.js";

const DEFAULT_SERVER_ROOT = path.join(runtimeRepoRoot(), "server");

export type NativeToolName = "fcstd-read" | "fcstd-xlink";

export type NativeToolResolveOptions = {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  serverRoot?: string;
  resourcesDir?: string;
};

const TOOL_CONFIG: Record<NativeToolName, { envKey: string; crateDir: string; manifest: string }> = {
  "fcstd-read": {
    envKey: "PHOENIX_FCSTD_READ",
    crateDir: "cli",
    manifest: "server/cli/Cargo.toml",
  },
  "fcstd-xlink": {
    envKey: "PHOENIX_FCSTD_XLINK",
    crateDir: "fcstd-xlink",
    manifest: "server/fcstd-xlink/Cargo.toml",
  },
};

function executableName(name: NativeToolName, platform: NodeJS.Platform): string {
  return platform === "win32" ? `${name}.exe` : name;
}

function existingFile(candidate: unknown): string | null {
  const raw = String(candidate || "").trim();
  if (!raw) return null;
  try {
    return fs.statSync(raw).isFile() ? path.resolve(raw) : null;
  } catch {
    return null;
  }
}

export function nativeToolCandidates(
  name: NativeToolName,
  options: NativeToolResolveOptions = {},
): string[] {
  const env = options.env || process.env;
  const platform = options.platform || process.platform;
  const serverRoot = path.resolve(options.serverRoot || DEFAULT_SERVER_ROOT);
  const resourcesDir = String(options.resourcesDir || env.PHOENIX_RESOURCES_DIR || "").trim();
  const filename = executableName(name, platform);
  const config = TOOL_CONFIG[name];
  const candidates = [
    env[config.envKey],
    env.PHOENIX_NATIVE_BIN_DIR ? path.join(env.PHOENIX_NATIVE_BIN_DIR, filename) : "",
    resourcesDir ? path.join(resourcesDir, "bin", filename) : "",
    resourcesDir ? path.join(resourcesDir, filename) : "",
    path.join(serverRoot, "bin", filename),
    path.join(serverRoot, config.crateDir, "target", "release", filename),
    path.join(serverRoot, config.crateDir, "target", "debug", filename),
  ];
  return [...new Set(candidates.map((candidate) => String(candidate || "").trim()).filter(Boolean))];
}

export function resolveNativeTool(
  name: NativeToolName,
  options: NativeToolResolveOptions = {},
): string | null {
  for (const candidate of nativeToolCandidates(name, options)) {
    const found = existingFile(candidate);
    if (found) return found;
  }
  return null;
}

export function requireNativeTool(
  name: NativeToolName,
  options: NativeToolResolveOptions = {},
): string {
  const found = resolveNativeTool(name, options);
  if (found) return found;
  const config = TOOL_CONFIG[name];
  throw new Error(
    `${name} is unavailable; run pnpm build:native or set ${config.envKey} to the executable path`,
  );
}

export function nativeToolStatus(options: NativeToolResolveOptions = {}) {
  const tools = (Object.keys(TOOL_CONFIG) as NativeToolName[]).map((name) => {
    const config = TOOL_CONFIG[name];
    const resolved = resolveNativeTool(name, options);
    return {
      name,
      available: Boolean(resolved),
      path: resolved || "",
      env_key: config.envKey,
      manifest: config.manifest,
      candidates: nativeToolCandidates(name, options),
    };
  });
  return {
    ok: tools.every((tool) => tool.available),
    platform: options.platform || process.platform,
    tools,
  };
}
