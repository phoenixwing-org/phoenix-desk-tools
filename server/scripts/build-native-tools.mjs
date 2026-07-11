import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(scriptDir, "..");
const outputDir = path.join(serverRoot, "bin");
const suffix = process.platform === "win32" ? ".exe" : "";

const tools = [
  { name: "fcstd-read", crateDir: "cli" },
  { name: "fcstd-xlink", crateDir: "fcstd-xlink" },
];

fs.mkdirSync(outputDir, { recursive: true });

for (const tool of tools) {
  const crateRoot = path.join(serverRoot, tool.crateDir);
  const manifest = path.join(crateRoot, "Cargo.toml");
  const result = spawnSync(
    "cargo",
    ["build", "--locked", "--release", "--manifest-path", manifest],
    { cwd: serverRoot, env: process.env, stdio: "inherit", windowsHide: true },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);

  const targetRoot = process.env.CARGO_TARGET_DIR
    ? path.resolve(serverRoot, process.env.CARGO_TARGET_DIR)
    : path.join(crateRoot, "target");
  const source = path.join(targetRoot, "release", `${tool.name}${suffix}`);
  if (!fs.existsSync(source)) {
    throw new Error(`Cargo succeeded but ${source} was not produced`);
  }
  const target = path.join(outputDir, `${tool.name}${suffix}`);
  fs.copyFileSync(source, target);
  if (process.platform !== "win32") fs.chmodSync(target, 0o755);
  process.stdout.write(`[native] ${tool.name} -> ${target}\n`);
}
