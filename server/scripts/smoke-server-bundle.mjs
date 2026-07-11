import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(scriptDir, "..");
const repoRoot = path.resolve(serverRoot, "..");
const entry = path.join(serverRoot, "dist-sidecar", "server.mjs");
const port = 5198;
const userData = fs.mkdtempSync(path.join(os.tmpdir(), "phoenix-sidecar-smoke-"));

if (!fs.existsSync(entry)) throw new Error(`Missing ${entry}; run build:bundle first`);

const child = spawn(process.execPath, [entry], {
  cwd: repoRoot,
  env: {
    ...process.env,
    CAA_SERVER_PORT: String(port),
    PHOENIX_REPO_ROOT: repoRoot,
    PHOENIX_USER_DATA_DIR: userData,
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
    if (child.exitCode != null) throw new Error(`Bundled server exited early (${child.exitCode})\n${output}`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (response.ok && (await response.json()).status === "ok") return;
    } catch {
      // Server compilation and SQLite initialization can take a moment on first launch.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Bundled server did not become healthy\n${output}`);
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
    const timer = setTimeout(() => reject(new Error("Bundled server did not stop")), 5_000);
    child.once("exit", (code) => {
      clearTimeout(timer);
      code === 0 ? resolve() : reject(new Error(`Bundled server exited ${code}\n${output}`));
    });
  });
  process.stdout.write("[sidecar] bundle health/shutdown smoke passed\n");
} finally {
  if (child.exitCode == null) child.kill();
  fs.rmSync(userData, { recursive: true, force: true });
}
