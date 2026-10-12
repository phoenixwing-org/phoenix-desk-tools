import childProcess from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Only the controlled macOS build profile uses this hook. Ordinary development
// and release commands remain unchanged. No fixed-port or inherited-state smoke
// runner is called here; the recovery CLI owns its child, registration and data.
if (process.platform !== "darwin") throw new Error("unsupported-profile: isolated runtime build requires macOS");
if (process.argv.length !== 2) throw new Error("usage: node scripts/build-tauri-isolated-runtime.mjs");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const environment = {};
const systemKeys = new Set(["PATH", "HOME", "USERPROFILE", "LANG", "TZ", "TMPDIR", "TMP", "TEMP", "SYSTEMROOT", "WINDIR", "COMSPEC", "PATHEXT"]);
for (const [key, value] of Object.entries(process.env)) {
  if (systemKeys.has(key) || /^LC_[A-Z_]+$/u.test(key)) environment[key] = value;
}
environment.PHOENIX_WING_MODE = "registry";
const steps = [
  ["pnpm", ["build"]],
  ["pnpm", ["-C", "server", "build:bundle"]],
  [process.execPath, ["server/scripts/smoke-workspace-recovery.mjs", "bundle"]],
  ["pnpm", ["-C", "server", "prepare:tauri-runtime"]],
  [process.execPath, ["server/scripts/smoke-workspace-recovery.mjs", "runtime"]],
];
for (const [command, args] of steps) {
  const result = childProcess.spawnSync(command, args, {
    cwd: root, env: environment, shell: false, stdio: "inherit", timeout: 30 * 60 * 1000,
  });
  if (result.error) throw result.error;
  if (result.status !== 0 || result.signal) throw new Error(`isolated runtime step failed: ${command} ${args.join(" ")}`);
}
