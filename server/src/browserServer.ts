// Opt-in API + static Web process. No Tauri, legacy data import or CAD startup.
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import { createAdaptorServer } from "@hono/node-server";
import { createPhoenixServerApp } from "./serverApp.js";
import { acquireDeskToolsInstanceLease, registerDeskToolsRuntime } from "./lib/deskToolsRegistration.js";
import { setShellShutdownHandler } from "./routes/shell.js";
import { closeBatchTaskServices } from "./features/batch-tasks/service.js";

const state = process.env.PHOENIX_DESK_BROWSER_STATE_DIR || "";
const webRoot = process.env.PHOENIX_WEB_ROOT || "";
const runtimeId = process.env.PHOENIX_DESK_BROWSER_RUNTIME_ID || "";
if (!path.isAbsolute(state) || fs.realpathSync(state) !== state || !fs.lstatSync(state).isDirectory()
  || !path.isAbsolute(webRoot) || !/^[A-Za-z0-9._:-]{1,256}$/.test(runtimeId)
  || process.env.PHOENIX_USER_DATA_DIR !== path.join(state, "data")
  || process.env.PHOENIX_LEGACY_USER_DATA_DIR !== process.env.PHOENIX_USER_DATA_DIR
  || process.env.PHOENIX_DESK_TOOLS_REGISTRY_DIR !== path.join(state, "services")) {
  throw new Error("Desk browser host requires an explicit isolated state directory; use desk-web-service.mjs");
}
const requestedPort = Number(process.env.PHOENIX_DESK_BROWSER_PORT || "0");
if (!Number.isInteger(requestedPort) || requestedPort < 0 || requestedPort > 65535) throw new Error("Invalid browser host port");
let origin = "";
const startedAt = new Date().toISOString();
const manifest = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "browser-host-manifest.json"), "utf8"));
if (manifest.runtime_id !== runtimeId || !Array.isArray(manifest.files)) throw new Error("Browser build manifest does not match the launcher");
const assetDigests: Record<string, string> = {};
for (const member of manifest.files) {
  if (typeof member.path === "string" && member.path.startsWith("web-ui/dist/")) assetDigests[member.path.slice("web-ui/dist/".length)] = member.sha256;
}
if (!assetDigests["index.html"]) throw new Error("Browser manifest is missing the Web entry");
const lease = acquireDeskToolsInstanceLease();
let registration: ReturnType<typeof registerDeskToolsRuntime> | undefined;
let stopping = false;
const dispose = () => { registration?.dispose(); lease.dispose(); };
process.once("exit", dispose);
const app = createPhoenixServerApp({ browserHost: { origin: () => origin, instanceId: lease.instanceId, startedAt, runtimeId, webRoot, assetDigests } });
const server = createAdaptorServer({ fetch: app.fetch, hostname: "127.0.0.1" });
try {
  // Do not initialize a per-state Native barrier: that would bypass another
  // Desk host's machine-wide Native ownership domain. Gated Native jobs stay
  // fail-closed until a shared host-scope contract is separately validated.
  const port = await new Promise<number>((resolve, reject) => {
    server.once("error", reject);
    server.listen(requestedPort, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") reject(new Error("Missing listener address"));
      else resolve(address.port);
    });
  });
  origin = `http://127.0.0.1:${port}`;
  registration = registerDeskToolsRuntime(port, process.env, new Date(startedAt), lease.instanceId, { webUrl: origin + "/", runtimeId });
  process.stdout.write(JSON.stringify({ event: "ready", web_url: origin + "/", api_origin: origin, instance_id: lease.instanceId, pid: process.pid, runtime_id: runtimeId }) + "\n");
} catch (error) {
  dispose(); server.close(); throw error;
}
function shutdown() {
  if (stopping) return;
  stopping = true;
  void closeBatchTaskServices().catch(() => undefined).finally(() => server.close(() => { dispose(); process.exitCode = 0; }));
}
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
setShellShutdownHandler(shutdown);
