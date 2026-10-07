import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { zipSync } from "fflate";

if (!["darwin", "win32"].includes(process.platform)) {
  throw new Error("The Tauri release app smoke currently supports macOS and Windows only");
}

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(serverRoot, "..");
const packageVersion = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8")).version;
const macApp = path.join(
  repoRoot,
  "src-tauri",
  "target",
  "release",
  "bundle",
  "macos",
  "Phoenix Desktop Tools.app",
);
const configuredExecutable = String(process.env.PHOENIX_TAURI_EXECUTABLE || "").trim();
const executable = configuredExecutable || (process.platform === "darwin"
  ? path.join(macApp, "Contents", "MacOS", "phoenix-desktop")
  : "");
const installRoot = path.resolve(String(process.env.PHOENIX_TAURI_INSTALL_ROOT || (
  process.platform === "darwin" ? macApp : path.dirname(executable)
)));
const infoPlist = process.platform === "darwin" ? path.join(macApp, "Contents", "Info.plist") : "";
const fixtureXml = path.join(
  repoRoot,
  "tests",
  "fixtures",
  "workspaces",
  "minimal",
  "document-xml",
  "图纸-通过link来创建-Document.xml",
);
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "phoenix-tauri-app-smoke-"));
const home = path.join(tempRoot, "home");
const workspace = path.join(tempRoot, "workspace");
const registrationDirectory = path.join(home, "desk-tools-registration");
const serviceRegistrationPath = path.join(registrationDirectory, "service.v1.json");
const output = [];
let child;
let port = 0;
let origin = "";

try {
  for (const required of [executable, fixtureXml, ...(infoPlist ? [infoPlist] : [])]) assertFile(required);
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(workspace, { recursive: true });
  writeFcstdFixture();

  child = spawn(executable, [], {
    cwd: workspace,
    env: {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
      CFFIXED_USER_HOME: home,
      PHOENIX_TAURI_USER_DATA_DIR: path.join(home, "user-data"),
      PHOENIX_DESK_TOOLS_REGISTRY_DIR: registrationDirectory,
      APPDATA: path.join(home, "AppData", "Roaming"),
      LOCALAPPDATA: path.join(home, "AppData", "Local"),
      TMPDIR: tempRoot,
      TEMP: tempRoot,
      TMP: tempRoot,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.on("data", (chunk) => output.push(chunk.toString()));
  child.stderr?.on("data", (chunk) => output.push(chunk.toString()));

  await waitForServiceRegistration();
  const health = await waitForHealth();
  const launcher = await api("/api/config/launcher");
  const launcherConfigPath = path.resolve(String(launcher.launcher_config_path || ""));
  assertUnder(tempRoot, launcherConfigPath, "Tauri user data");

  const activeWorkspace = await api("/api/workspace", {
    method: "POST",
    body: { path: workspace },
  });
  assert(activeWorkspace.path === workspace, "release app did not activate the isolated workspace");

  const runtimeManifest = [
    path.join(installRoot, "Contents", "Resources", "runtime", "runtime-manifest.json"),
    path.join(installRoot, "runtime", "runtime-manifest.json"),
  ].find((candidate) => fs.existsSync(candidate));
  assert(runtimeManifest, "packaged TypeScript runtime manifest is missing");
  assertUnder(installRoot, runtimeManifest, "runtime manifest");
  assertFile(runtimeManifest);
  const runtimeDirectory = path.dirname(runtimeManifest);
  assert(!fs.existsSync(path.join(runtimeDirectory, "bin")), "release runtime still contains a CAD native bin directory");
  assert(!fs.existsSync(path.join(runtimeDirectory, "native-provider.json")), "release runtime still contains native-provider.json");

  const retiredCodeRoutes = await verifyRetiredCodeRoutes();

  const bom = await api(`/api/cad/bom/file?rel=${encodeURIComponent("730201.001-H-DEMO-TestBlock.FCStd")}`);
  assert(bom.is_fcstd === true && bom.file_size_bytes > 0, "release CAD route did not read the real FCStd archive");
  assert(
    String(bom.source_note || "").includes("TypeScript FCStd reader"),
    "release CAD route did not use the packaged TypeScript FCStd reader",
  );

  const version = process.platform === "darwin"
    ? plistValue("CFBundleShortVersionString")
    : String(process.env.PHOENIX_TAURI_EXPECTED_VERSION || "").trim();
  assert(version === packageVersion, `unexpected app version: ${version || "missing"}; expected ${packageVersion}`);
  const binarySha256 = sha256(fs.readFileSync(executable));
  const manifestSha256 = sha256(fs.readFileSync(runtimeManifest));

  gracefulQuit();
  await waitForExit(child, 10_000);
  await waitForPortRelease();

  const receipt = {
    kind: "phoenix.desk.tauri-release-app-smoke",
    schemaVersion: 2,
    platform: `${process.platform}-${process.arch}`,
    appVersion: version,
    executable: displayPath(executable),
    binarySha256,
    runtimeManifestSha256: manifestSha256,
    health,
    userDataIsolated: true,
    cadRuntime: "typescript",
    retiredCodeRoutes,
    flows: {
      launch: true,
      workspaceActivation: true,
      runtimeResources: true,
      retiredCodeRoutes404: true,
      realFcstdRead: true,
      gracefulExit: true,
      sidecarReleased: true,
    },
  };
  const serialized = `${JSON.stringify(receipt, null, 2)}\n`;
  const receiptPath = String(process.env.PHOENIX_TAURI_RECEIPT_PATH || "").trim();
  if (receiptPath) {
    fs.mkdirSync(path.dirname(path.resolve(receiptPath)), { recursive: true });
    fs.writeFileSync(receiptPath, serialized, "utf8");
  }
  process.stdout.write(serialized);
  process.stdout.write(`[q2] ${process.platform} Tauri ${version} release app smoke passed\n`);
} finally {
  await cleanup();
}

async function verifyRetiredCodeRoutes() {
  // Check the original methods as well as paths: a GET-only check can miss a
  // still-active write endpoint. A redirect or SPA fallback must not pass.
  const routes = [
    ["GET", "/api/code/index"],
    ["GET", "/api/code/index/catdlg"],
    ["POST", "/api/code/index/scan"],
    ["GET", "/api/code/index/entries"],
    ["GET", "/api/code/index/extension-discovery"],
    ["GET", "/api/code/index/extra-extensions"],
    ["PUT", "/api/code/index/extra-extensions"],
    ["POST", "/api/code/index/purge-missing"],
    ["POST", "/api/code/index/export-json"],
    ["GET", "/api/code/codegen/documents"],
    ["POST", "/api/code/codegen/open"],
    ["POST", "/api/code/codegen/document-state"],
    ["PUT", "/api/code/codegen/document"],
    ["POST", "/api/code/codegen/preflight"],
    ["POST", "/api/code/codegen/apply"],
    ["POST", "/api/code/codegen/source-preview"],
    ["POST", "/api/code/codegen/source-states"],
    ["GET", "/api/code/rename/prefs"],
    ["PUT", "/api/code/rename/prefs"],
    ["POST", "/api/code/rename/preview"],
    ["POST", "/api/code/rename/apply"],
    ["POST", "/api/code/uuid/scan"],
    ["POST", "/api/code/uuid/apply"],
    ["GET", "/api/code/reorder-members/prefs"],
    ["PUT", "/api/code/reorder-members/prefs"],
    ["POST", "/api/code/reorder-members/resolve"],
    ["POST", "/api/code/reorder-members/run"],
    ["POST", "/api/code/reorder-members/self-test"],
    ["GET", "/api/code/reorder-members/top-level"],
    ["GET", "/api/code/reorder-members/top-dirs"],
  ];
  const checks = [];
  for (const [method, route] of routes) {
    const response = await fetch(`${origin}${route}`, {
      method,
      redirect: "error",
      headers: method === "GET" ? undefined : { "content-type": "application/json" },
      body: method === "GET" ? undefined : "{}",
    });
    const text = await response.text();
    assert(response.status === 404, `retired ${method} ${route} returned HTTP ${response.status}, expected 404: ${text}`);
    checks.push({ method, path: route, status: response.status });
  }
  return checks;
}

function writeFcstdFixture() {
  fs.writeFileSync(path.join(workspace, "730201.001-H-DEMO-TestBlock.FCStd"), zipSync({
    "Document.xml": fs.readFileSync(fixtureXml),
    "GuiDocument.xml": new TextEncoder().encode("<?xml version=\"1.0\"?><GuiDocument/>"),
  }, { level: 6 }));
}

async function api(route, options = {}) {
  const response = await fetch(`${origin}${route}`, {
    method: options.method || "GET",
    headers: options.body ? { "content-type": "application/json" } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`${route} returned invalid JSON: ${text}`);
  }
  if (!response.ok) throw new Error(`${route} returned HTTP ${response.status}: ${text}`);
  return body;
}

async function waitForHealth() {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode != null) {
      throw new Error(`Tauri release app exited early (${child.exitCode})\n${output.join("")}`);
    }
    try {
      const body = await api("/api/health");
      if (body.status === "ok" && body.service === "phoenix-node" && body.protocol_version === 1) return body;
    } catch {
      // The release app starts its packaged Node service before the endpoint is ready.
    }
    await delay(100);
  }
  throw new Error(`Tauri release app did not become healthy\n${output.join("")}`);
}

function gracefulQuit() {
  const command = process.platform === "darwin" ? "osascript" : "powershell.exe";
  const args = process.platform === "darwin"
    ? ["-e", 'tell application id "com.phoenix.desktools" to quit']
    : [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        `$process = Get-Process -Id ${child.pid} -ErrorAction Stop; if (-not $process.CloseMainWindow()) { exit 2 }`,
      ];
  const result = spawnSync(command, args, { encoding: "utf8", timeout: 10_000 });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`cannot quit the Tauri release app: ${String(result.stderr).trim()}`);
  }
}

async function waitForExit(processToWait, timeoutMs) {
  if (processToWait.exitCode != null) return;
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Tauri release app did not exit gracefully")), timeoutMs);
    processToWait.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

async function waitForServiceRegistration() {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode != null) throw new Error(`Tauri release app exited before service registration\n${output.join("")}`);
    try {
      const registration = JSON.parse(fs.readFileSync(serviceRegistrationPath, "utf8"));
      if (registration.service === "phoenix-desk-tools"
          && registration.protocol_version === 1
          && registration.host === "127.0.0.1"
          && Number.isInteger(registration.port)) {
        port = registration.port;
        origin = `http://127.0.0.1:${port}`;
        return;
      }
    } catch {
      // The managed service has not published its atomic registration yet.
    }
    await delay(100);
  }
  throw new Error(`Tauri release app did not publish ${serviceRegistrationPath}\n${output.join("")}`);
}

async function waitForPortRelease() {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (!(await canConnect())) return;
    await delay(100);
  }
  throw new Error(`the packaged Node service still owns port ${port} after the app exited`);
}

function canConnect() {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    const done = (connected) => {
      socket.destroy();
      resolve(connected);
    };
    socket.setTimeout(250, () => done(false));
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
  });
}

function plistValue(key) {
  const result = spawnSync("plutil", ["-extract", key, "raw", "-o", "-", infoPlist], {
    encoding: "utf8",
    timeout: 5_000,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`cannot read ${key} from Info.plist`);
  return String(result.stdout).trim();
}

function displayPath(filename) {
  const relative = path.relative(repoRoot, filename);
  return relative && !relative.startsWith("..") && !path.isAbsolute(relative)
    ? relative.replaceAll(path.sep, "/")
    : path.basename(filename);
}

async function cleanup() {
  if (await canConnect()) {
    try {
      await fetch(`${origin}/api/shutdown`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
    } catch { /* best effort */ }
  }
  if (child?.exitCode == null) child.kill();
  if (process.env.PHOENIX_KEEP_TAURI_APP_SMOKE === "1") {
    process.stdout.write(`[q2] kept ${tempRoot}\n`);
  } else {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

function assertUnder(root, candidate, label) {
  const relative = path.relative(path.resolve(root), candidate);
  assert(relative && !relative.startsWith("..") && !path.isAbsolute(relative), `${label} escaped ${root}: ${candidate}`);
}

function assertFile(file) {
  assert(fs.existsSync(file) && fs.statSync(file).isFile(), `required file is missing: ${file}`);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
