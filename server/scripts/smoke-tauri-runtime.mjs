import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(scriptDir, "..");
const repoRoot = path.resolve(serverRoot, "..");
const runtimeRoot = path.join(repoRoot, "src-tauri", "resources", "runtime");
const executableSuffix = process.platform === "win32" ? ".exe" : "";
const node = path.join(runtimeRoot, "node", `node${executableSuffix}`);
const entry = path.join(runtimeRoot, "server", "server.mjs");
const port = 5198;
const userData = fs.mkdtempSync(path.join(os.tmpdir(), "phoenix-runtime-smoke-"));
const registrationDirectory = path.join(userData, "service-registration");
const serviceRegistrationPath = path.join(registrationDirectory, "service.v1.json");

for (const file of [node, entry]) {
  if (!fs.existsSync(file)) throw new Error(`Missing packaged runtime file: ${file}`);
}

const child = spawn(node, [entry], {
  cwd: runtimeRoot,
  env: {
    ...process.env,
    CAA_SERVER_PORT: String(port),
    PHOENIX_PACKAGED: "1",
    PHOENIX_REPO_ROOT: runtimeRoot,
    PHOENIX_RESOURCES_DIR: runtimeRoot,
    PHOENIX_USER_DATA_DIR: userData,
    PHOENIX_DESK_TOOLS_REGISTRY_DIR: registrationDirectory,
  },
  stdio: ["ignore", "pipe", "pipe"],
  windowsHide: true,
});

let output = "";
child.stdout.on("data", (chunk) => { output += chunk.toString(); });
child.stderr.on("data", (chunk) => { output += chunk.toString(); });

async function waitForHealth() {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (child.exitCode != null) {
      throw new Error(`Packaged runtime exited early (${child.exitCode})\n${output}`);
    }
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`);
      const body = response.ok ? await response.json() : null;
      if (body?.status === "ok" && body?.service === "phoenix-node") return;
    } catch {
      // SQLite and the CAA catalog are initialized before the health endpoint is ready.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Packaged runtime did not become healthy\n${output}`);
}

try {
  await waitForHealth();
  const response = await fetch(`http://127.0.0.1:${port}/api/shutdown`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  if (!response.ok) throw new Error(`Shutdown returned HTTP ${response.status}`);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Packaged runtime did not stop")), 5_000);
    child.once("exit", (code) => {
      clearTimeout(timer);
      code === 0 ? resolve() : reject(new Error(`Packaged runtime exited ${code}\n${output}`));
    });
  });
  if (fs.existsSync(serviceRegistrationPath)) {
    throw new Error("Packaged runtime left a stale service registration after shutdown");
  }
  process.stdout.write("[tauri] packaged runtime health/shutdown smoke passed\n");
} finally {
  if (child.exitCode == null) child.kill();
  fs.rmSync(userData, { recursive: true, force: true });
}
