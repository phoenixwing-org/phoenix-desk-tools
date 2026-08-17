import { spawn } from "node:child_process";
import process from "node:process";
import {
  createTauriDevConfigOverride,
  DEV_UI_PREFERRED_PORT,
  resolveDevUiPort,
} from "./dev-ui-port.mjs";

const port = await resolveDevUiPort();
const configOverride = JSON.stringify(createTauriDevConfigOverride(port));
const shiftMessage = port === DEV_UI_PREFERRED_PORT ? "" : `（${DEV_UI_PREFERRED_PORT} 已占用，自动跃迁）`;
process.stdout.write(`[tauri-dev] Vite UI port ${port} ${shiftMessage}\n`);

const child = spawn("cargo", [
  "tauri",
  "dev",
  "--config",
  configOverride,
  ...process.argv.slice(2),
], {
  cwd: process.cwd(),
  env: { ...process.env, WEB_UI_PORT: String(port) },
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
