import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  LOCAL_WING_PACKAGE_NAMES,
  resolvePhoenixWingContext,
} from "./phoenix-wing-mode.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const deskRoot = path.resolve(scriptDir, "..");
const args = process.argv.slice(2);
const mode = args.shift();
const separator = args.indexOf("--");
const wrapperArgs = separator < 0 ? args : args.slice(0, separator);
const checkOnly = wrapperArgs.includes("--check");

if ((mode !== "local" && mode !== "registry") || (!checkOnly && separator < 0)) {
  console.error("用法：node scripts/run-with-phoenix-wing.mjs <local|registry> [--check] -- <command> [...args]");
  process.exit(2);
}

let context;
try {
  context = resolvePhoenixWingContext(deskRoot, {
    ...process.env,
    PHOENIX_WING_MODE: mode,
  });
} catch (error) {
  console.error(`[Wing][LOCAL][停止] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

const pnpmCommand = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

function run(command, commandArgs, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, {
      cwd: options.cwd ?? deskRoot,
      env: options.env ?? process.env,
      stdio: "inherit",
      shell: false,
    });
    const relaySignal = (signal) => child.kill(signal);
    process.once("SIGINT", relaySignal);
    process.once("SIGTERM", relaySignal);
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      process.removeListener("SIGINT", relaySignal);
      process.removeListener("SIGTERM", relaySignal);
      if (signal) reject(new Error(`${command} 被 ${signal} 终止`));
      else if (code === 0) resolve();
      else reject(new Error(`${command} 退出码 ${code}`));
    });
  });
}

async function prepareLocalWing(wingRoot) {
  console.log(`[Wing][LOCAL][准备] 构建 ${LOCAL_WING_PACKAGE_NAMES.length} 个 Desk 消费包`);
  const filters = LOCAL_WING_PACKAGE_NAMES.flatMap((name) => ["--filter", name]);
  await run(pnpmCommand, ["--dir", wingRoot, ...filters, "run", "build"], { cwd: wingRoot });
  await run(pnpmCommand, ["--dir", wingRoot, "run", "build"], { cwd: wingRoot });
}

if (context.mode === "local") {
  console.log(`[Wing][LOCAL] ${context.root}（${context.configuredBy}）`);
  if (checkOnly) {
    console.log("[Wing][LOCAL][检查通过] 并列仓库及 6 个消费包完整；未改 package.json、pnpm-lock.yaml 或 node_modules");
    process.exit(0);
  }
  try {
    await prepareLocalWing(context.root);
  } catch (error) {
    console.error(`[Wing][LOCAL][停止] ${error instanceof Error ? error.message : String(error)}`);
    console.error(`请先在 ${context.root} 执行 pnpm install；若要测试 npm 正式包，请运行 pnpm dev:registry`);
    process.exit(1);
  }
} else {
  console.log("[Wing][REGISTRY] 使用 package.json + pnpm-lock.yaml 锁定的 npm 正式包");
  if (checkOnly) process.exit(0);
}

const childEnv = { ...process.env, PHOENIX_WING_MODE: context.mode };
if (context.mode === "local") {
  childEnv.PHOENIX_WING_ROOT = context.root;
  delete childEnv.PHOENIX_WING_SRC;
  const registerUrl = pathToFileURL(path.join(scriptDir, "register-local-wing.mjs")).href;
  const importOption = `--import=${registerUrl}`;
  childEnv.NODE_OPTIONS = [process.env.NODE_OPTIONS, importOption].filter(Boolean).join(" ");
} else {
  delete childEnv.PHOENIX_WING_ROOT;
  delete childEnv.PHOENIX_WING_SRC;
}

const commandArgs = args.slice(separator + 1);
const command = commandArgs.shift();
const normalizedCommand = command === "pnpm" ? pnpmCommand : command;
try {
  await run(normalizedCommand, commandArgs, { env: childEnv });
} catch (error) {
  console.error(`[Wing][${context.mode === "local" ? "LOCAL" : "REGISTRY"}][命令失败] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
