import { spawn } from "node:child_process";
import net from "node:net";
import { resolveDevUiPort } from "./dev-ui-port.mjs";
import { discoverDeskApi } from "./desk-api-discovery.mjs";

const preferredPort = 48_375;
const attempts = 32;

function canListen(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    const done = (available) => {
      server.removeAllListeners();
      try { server.close(); } catch { /* it never listened */ }
      resolve(available);
    };
    server.once("error", () => done(false));
    server.listen(port, "127.0.0.1", () => done(true));
  });
}

async function selectPort() {
  const explicit = String(process.env.CAA_SERVER_PORT || "").trim();
  if (explicit) return Number(explicit);
  for (let offset = 0; offset < attempts; offset += 1) {
    const port = preferredPort + offset;
    if (await canListen(port)) return port;
  }
  throw new Error(`Desk Tools dev API has no free port in ${preferredPort}..${preferredPort + attempts - 1}`);
}

const uiPort = await resolveDevUiPort();
const existingApi = await discoverDeskApi();
const port = existingApi?.port ?? await selectPort();
const apiMode = existingApi ? "reused" : "managed";
process.stdout.write(
  existingApi
    ? `[dev] Desk Tools UI port ${uiPort}; reuse API ${existingApi.origin} (v${existingApi.appVersion})\n`
    : `[dev] Desk Tools UI port ${uiPort}; start API http://127.0.0.1:${port}\n`,
);
const pnpmCli = process.env.npm_execpath;
if (!pnpmCli) throw new Error("npm_execpath is unavailable; run this script through pnpm dev");
const child = spawn(process.execPath, [
  pnpmCli,
  ...(existingApi
    ? ["run", "dev:ui"]
    : [
      "exec",
      "concurrently",
      "--kill-others-on-fail",
      "-n",
      "server,ui",
      "-c",
      "green,blue",
      "pnpm dev:server",
      "pnpm dev:ui",
    ]),
], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    CAA_SERVER_PORT: String(port),
    WEB_UI_PORT: String(uiPort),
    PHOENIX_DESK_HOST: "web",
    VITE_DESK_API_SOURCE: apiMode,
  },
  stdio: "inherit",
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => child.kill(signal));
}
child.once("error", (error) => { throw error; });
child.once("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exitCode = code ?? 1;
});
