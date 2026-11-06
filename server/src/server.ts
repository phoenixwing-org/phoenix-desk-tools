import { createAdaptorServer, type ServerType } from "@hono/node-server";
import { refreshRuntimeCatalog } from "./routes/unit-tests.js";
import { setShellShutdownHandler } from "./routes/shell.js";
import { createPhoenixServerApp } from "./serverApp.js";
import { beginBatchTaskShutdown, closeBatchTaskServices } from "./features/batch-tasks/service.js";
import { closeFreecadHostServices } from "./features/freecad-mcp/worker-host.js";
import { migrateLegacyRuntimeUserData } from "./lib/appRuntimePaths.js";
import path from "node:path";
import { configureDrawingExecutionBarrier } from "./features/drawing-research/executionGate.js";
import {
  acquireDeskToolsInstanceLease,
  deskToolsRegistrationDirectory,
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

// The auxiliary test catalog must not make CAD/workspace APIs unavailable.
try {
  refreshRuntimeCatalog();
} catch (error) {
  console.error(`[runtime] 测试目录同步失败，主服务继续启动；可在单元测试页重试：${error instanceof Error ? error.message : String(error)}`);
}

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
// Stable host scope, not instanceId/port/workspace: a server restart must see
// any previous unclosed Native reservation. Ordinary read APIs stay available.
try {
  configureDrawingExecutionBarrier(path.join(deskToolsRegistrationDirectory(), "native-freecad-v1"));
} catch {
  console.error("[native] 持久执行门禁不可用，FreeCAD 原生任务保持禁用；普通读取服务继续启动");
}
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
let stopping = false;
function shutdown(exit: boolean) {
  if (stopping) return;
  stopping = true;
  beginBatchTaskShutdown();
  void closeFreecadHostServices(closeBatchTaskServices).then(() => {
    disposeRegistration();
    server.close(() => { if (exit) process.exit(0); });
  }).catch(() => console.error('[native] 自有执行资源尚未确认关闭；保留服务等待，不退出、不清理或切换持久门禁'));
}
process.once("SIGINT", () => shutdown(true));
process.once("SIGTERM", () => shutdown(true));
setShellShutdownHandler(() => shutdown(false));
