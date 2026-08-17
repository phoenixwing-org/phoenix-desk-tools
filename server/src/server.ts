import { createAdaptorServer, type ServerType } from "@hono/node-server";
import { refreshRuntimeCatalog } from "./routes/unit-tests.js";
import { setShellShutdownHandler } from "./routes/shell.js";
import { createPhoenixServerApp } from "./serverApp.js";
import { migrateLegacyRuntimeUserData } from "./lib/appRuntimePaths.js";
import {
  acquireDeskToolsInstanceLease,
  deskToolsPortCandidates,
  registerDeskToolsRuntime,
} from "./lib/deskToolsRegistration.js";

const wingMode = process.env.PHOENIX_WING_MODE === "local" ? "LOCAL" : "REGISTRY";
const wingSource = wingMode === "LOCAL"
  ? process.env.PHOENIX_WING_ROOT
  : "package.json + pnpm-lock.yaml";

console.log(`[Wing][${wingMode}][server] ${wingSource}`);

const userDataMigration = migrateLegacyRuntimeUserData();
if (userDataMigration.imported.length) {
  console.log(`[runtime] imported legacy user data: ${userDataMigration.imported.join(", ")}`);
}
if (userDataMigration.errors.length) {
  console.error(`[runtime] legacy user data import incomplete: ${userDataMigration.errors.join("; ")}`);
}

const app = createPhoenixServerApp();

// 启动检查
refreshRuntimeCatalog();

async function listen(server: ServerType, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error): void => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = (): void => {
      server.off("error", onError);
      const address = server.address();
      if (!address || typeof address === "string") reject(new Error("Phoenix server 未返回 TCP 监听地址"));
      else resolve(address.port);
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, "127.0.0.1");
  });
}

async function startServer(): Promise<{ readonly server: ServerType; readonly port: number }> {
  const candidates = deskToolsPortCandidates();
  let lastError: unknown;
  for (const port of candidates.ports) {
    const server = createAdaptorServer({ fetch: app.fetch, hostname: "127.0.0.1" });
    try {
      return { server, port: await listen(server, port) };
    } catch (error) {
      lastError = error;
      const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
      try { server.close(); } catch { /* it never reached the listening state */ }
      if (code !== "EADDRINUSE" || candidates.strict) throw error;
    }
  }
  throw new Error(`Desk Tools 本地 API 在候选端口范围内均无法启动：${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

const instanceLease = acquireDeskToolsInstanceLease();
let started: Awaited<ReturnType<typeof startServer>>;
try {
  started = await startServer();
} catch (error) {
  instanceLease.dispose();
  throw error;
}
const { server, port } = started;
let registration: ReturnType<typeof registerDeskToolsRuntime>;
try {
  registration = registerDeskToolsRuntime(port, process.env, new Date(), instanceLease.instanceId);
} catch (error) {
  instanceLease.dispose();
  server.close();
  throw error;
}
console.log(`Phoenix server http://127.0.0.1:${port}`);
console.log(`  /api/caa/*  CAA 对话`);
console.log(`  /api/cad/*  CAD 工具 (TypeScript/SQLite)`);
console.log(`  service registration ${registration.servicePath}`);

const disposeRegistration = (): void => {
  registration.dispose();
  instanceLease.dispose();
};
process.once("exit", disposeRegistration);
process.once("SIGINT", () => {
  disposeRegistration();
  server.close(() => process.exit(0));
});
process.once("SIGTERM", () => {
  disposeRegistration();
  server.close(() => process.exit(0));
});

setShellShutdownHandler(() => {
  disposeRegistration();
  server.close();
});
