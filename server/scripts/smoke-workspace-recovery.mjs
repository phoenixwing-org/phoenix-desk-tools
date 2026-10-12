import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRecoveryFixture, runRecoveryJourney } from "./workspace-recovery-journey.mjs";

// A real HTTP/child-process journey, not a mock router or an installed-app claim.
const mode = process.argv[2] || "bundle";
assert(process.argv.length <= 3, "unexpected recovery-smoke arguments");
assert(["bundle", "runtime"].includes(mode), "usage: node server/scripts/smoke-workspace-recovery.mjs [bundle|runtime]");
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const runtime = path.join(repo, "src-tauri/resources/runtime");
const version = JSON.parse(fs.readFileSync(path.join(repo, "package.json"), "utf8")).version;
assert(typeof version === "string" && version.length > 0, "package version is required");
const entry = mode === "runtime" ? path.join(runtime, "server/server.mjs") : path.join(repo, "server/dist-sidecar/server.mjs");
const node = mode === "runtime" ? path.join(runtime, "node", process.platform === "win32" ? "node.exe" : "node") : process.execPath;
assert(fs.statSync(entry).isFile() && fs.statSync(node).isFile(), "build the selected runtime before verification");
const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "desk-recovery-http-smoke-")));
const userData = path.join(root, "runtime-data");
const registration = path.join(userData, "registration/service.v1.json");
fs.mkdirSync(userData, { mode: 0o700 });
let child, childFailure, registeredInstance = "", output = "", shuttingDown = false;
// Source-mode startup discovers the full development test catalog before listen.
// Give that bounded, cold-start work its own grace; do not change API/test timeouts.
const readinessLimitMs = mode === "runtime" ? 15000 : 30000;
const startupElapsedMs = [];
let port = 0, origin = "";

try {
  const fixture = createRecoveryFixture(root);
  port = await freePort(); origin = `http://127.0.0.1:${port}`;
  await start();
  const checks = await runRecoveryJourney({ fixture, request, setWorkspace, restart: async () => { await stop(); await start(); } });
  await stop(); fixture.unchanged(); checks.push("owned-child-shutdown-and-registration-release");
  process.stdout.write(`${JSON.stringify({ kind: "phoenix.desk.workspace-recovery-http-smoke", schemaVersion: 1, target: mode, platform: `${process.platform}-${process.arch}`, serverSha256: hash(fs.readFileSync(entry)), nodeSha256: hash(fs.readFileSync(node)), readinessLimitMs, startupElapsedMs, checks, inputFilesUnchanged: true }, null, 2)}\n`);
} finally {
  if (child && child.exitCode == null && child.signalCode == null) {
    child.kill("SIGTERM");
    await exited(child, 5000).catch(() => {
      if (child.exitCode == null && child.signalCode == null) child.kill("SIGKILL");
    });
  }
  // Keep the exact owned evidence on success and failure. No recursive cleanup
  // or endpoint-based kill: only the ChildProcess created by this runner is stopped.
  process.stdout.write(`[recovery] owned evidence retained: ${root}\n`);
}

function hash(bytes) { return createHash("sha256").update(bytes).digest("hex"); }
async function setWorkspace(workspace) {
  const result = await request("/api/workspace", { path: workspace });
  assert.equal(result.status, 200, `${result.status}: ${String(result.body?.code || "workspace activation failed")}`);
  assert.equal(result.body.path, workspace);
}
async function request(route, body, headers = {}) {
  readOwn();
  const response = await fetch(`${origin}${route}`, { method: body ? "POST" : "GET", headers: { ...headers, ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(10000), redirect: "error" });
  return { status: response.status, body: await response.json() };
}
async function start() {
  shuttingDown = false; childFailure = undefined; registeredInstance = "";
  child = spawn(node, [entry], { cwd: mode === "runtime" ? runtime : repo,
    env: childEnvironment(process.env, { root, userData, registration, selectedRoot: mode === "runtime" ? runtime : repo, packaged: mode === "runtime", port }),
    stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  child.once("error", error => { childFailure = error; });
  child.stdout.on("data", bytes => { output = (output + bytes.toString()).slice(-18000); });
  child.stderr.on("data", bytes => { output = (output + bytes.toString()).slice(-18000); });
  const startedAt = Date.now(), deadline = startedAt + readinessLimitMs;
  while (Date.now() < deadline) {
    try {
      readOwn(); // No health request may authorize a merely occupied port.
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      await new Promise(resolve => setTimeout(resolve, 100));
      continue; // An absent record is the only registration state worth waiting for.
    }
    const health = await request("/api/health");
    assert.equal(health.status, 200); assert.equal(health.body.status, "ok");
    assert.equal(health.body.service, "phoenix-node"); assert.equal(health.body.protocol_version, 1);
    assert.equal(health.body.app_version, version);
    startupElapsedMs.push(Date.now() - startedAt);
    return;
  }
  throw new Error(`owned runtime did not start within ${readinessLimitMs}ms; ${output}`);
}
async function stop() {
  shuttingDown = true;
  const wait = exited(child, 5000), result = await request("/api/shutdown", {});
  assert.equal(result.status, 200); await wait; assert.equal(child.exitCode, 0);
  assert(!fs.existsSync(registration), "owned service registration was not released");
  assert(!fs.existsSync(path.join(path.dirname(registration), "instance.v1.lock")), "owned instance lease was not released");
}
function exited(processToWait, timeout) {
  if (processToWait.exitCode != null || processToWait.signalCode != null) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const done = () => { clearTimeout(timer); resolve(); };
    const timer = setTimeout(() => { processToWait.off("exit", done); reject(new Error(shuttingDown ? "owned shutdown timed out" : "owned child timed out")); }, timeout);
    processToWait.once("exit", done);
  });
}

// Pure validation seam exercised with synthetic records, not an HTTP mock claim.
function validateOwnedRegistration(proof, liveChild, expectedVersion, expectedPort, expectedInstance = "") {
  assert(Number.isSafeInteger(liveChild?.pid) && liveChild.pid > 0 && liveChild.exitCode == null &&
    liveChild.signalCode == null && !liveChild.killed, "only our live spawned child can authorize this API");
  assert(proof && typeof proof === "object" && !Array.isArray(proof), "invalid owned registration");
  assert.equal(proof.schema_version, 1); assert.equal(proof.service, "phoenix-desk-tools");
  assert.equal(proof.protocol_version, 1); assert.equal(proof.app_version, expectedVersion);
  assert.equal(proof.pid, liveChild.pid); assert.equal(proof.host, "127.0.0.1");
  assert(Number.isInteger(expectedPort) && expectedPort > 0 && expectedPort <= 65535, "invalid selected port");
  assert.equal(proof.port, expectedPort);
  assert(typeof proof.instance_id === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(proof.instance_id), "invalid owned instance UUID v4");
  if (expectedInstance) assert.equal(proof.instance_id, expectedInstance, "owned instance changed");
  return proof.instance_id;
}

function readOwn() {
  if (childFailure) throw childFailure;
  assert(Number.isSafeInteger(child?.pid) && child.pid > 0 && child.exitCode == null && child.signalCode == null && !child.killed,
    `owned runtime is not live; ${output}`);
  process.kill(child.pid, 0); // Observe our exact spawned PID; never signal an endpoint-discovered process.
  const descriptor = fs.openSync(registration, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0) | (fs.constants.O_NONBLOCK || 0));
  try {
    const stat = fs.fstatSync(descriptor);
    assert(stat.isFile() && stat.size <= 65536, "registration must be a bounded regular file");
    const bytes = Buffer.alloc(65537); let count = 0;
    while (count < bytes.length) {
      const read = fs.readSync(descriptor, bytes, count, bytes.length - count, null);
      if (!read) break; count += read;
    }
    assert(count <= 65536, "registration exceeds the byte budget");
    const leaf = fs.lstatSync(registration);
    assert(leaf.isFile() && !leaf.isSymbolicLink() && leaf.dev === stat.dev && leaf.ino === stat.ino, "owned registration identity changed");
    const proof = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, count)));
    registeredInstance = validateOwnedRegistration(proof, child, version, port, registeredInstance);
    return proof;
  } finally { fs.closeSync(descriptor); }
}

function childEnvironment(parentEnvironment, { root, userData, registration, selectedRoot, packaged, port }) {
  const systemKeys = new Set(["PATH", "HOME", "USERPROFILE", "CFFIXED_USER_HOME", "SYSTEMROOT", "SystemRoot", "WINDIR", "COMSPEC", "PATHEXT", "LANG", "TZ"]);
  const environment = {};
  for (const [key, value] of Object.entries(parentEnvironment)) {
    if ((systemKeys.has(key) || /^LC_[A-Z_]+$/u.test(key)) && typeof value === "string") environment[key] = value;
  }
  Object.assign(environment, {
    CAA_SERVER_PORT: String(port), PHOENIX_REPO_ROOT: selectedRoot,
    PHOENIX_USER_DATA_DIR: userData, PHOENIX_LEGACY_USER_DATA_DIR: userData,
    PHOENIX_DESK_TOOLS_REGISTRY_DIR: path.dirname(registration),
    PHOENIX_RUNTIME_CATALOG_PATH: path.join(userData, "runtime-catalog.sqlite"),
    PHOENIX_APP_CONFIG_PATH: path.join(selectedRoot, "phoenix/config/app_config.json"),
    PHOENIX_TEST_FIXTURE_CATALOG_PATH: path.join(selectedRoot, "phoenix/config/test_fixture_catalog.json"),
    APPDATA: path.join(root, "system-config", "Roaming"), LOCALAPPDATA: path.join(root, "system-config", "Local"),
    XDG_CONFIG_HOME: path.join(root, "system-config"), XDG_CACHE_HOME: path.join(root, "cache"),
    TMPDIR: root, TEMP: root, TMP: root,
    ...(packaged ? { PHOENIX_PACKAGED: "1", PHOENIX_RESOURCES_DIR: selectedRoot } : {}),
  });
  return environment;
}
async function freePort() {
  const probe = net.createServer();
  await new Promise((resolve, reject) => { probe.once("error", reject); probe.listen(0, "127.0.0.1", resolve); });
  const selected = probe.address().port;
  await new Promise((resolve, reject) => probe.close(error => error ? reject(error) : resolve()));
  return selected;
}
