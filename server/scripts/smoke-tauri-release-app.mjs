import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { zipSync } from "fflate";
import { freezeInstalledInputs, verifyInstalledInputs } from "./tauri-smoke-inputs.mjs";
import { verifyBuildProof } from "./tauri-smoke-build-proof.mjs";
import { createIsolatedLaunch, readOwnedHandoff, writeOwnedQuit, prepareOwnedRestart, verifyIsolatedLaunch } from "./tauri-smoke-host.mjs";
import { createRecoveryFixture, runRecoveryJourney } from "./workspace-recovery-journey.mjs";

// Non-Unix file identity/ACL isolation remains unproven. Do not trial-launch
// unknown installations to discover whether they support the safe profile.
assert.equal(process.platform, "darwin", "isolated installed-host verification supports macOS only; Windows remains pending");
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const expectedVersion = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8")).version;
const installRoot = path.resolve(String(process.env.PHOENIX_TAURI_INSTALL_ROOT || path.join(repoRoot, "src-tauri/target/release/bundle/macos/Phoenix Desktop Tools.app")));
const executable = path.resolve(String(process.env.PHOENIX_TAURI_EXECUTABLE || path.join(installRoot, "Contents/MacOS/phoenix-desktop")));
const infoPlist = path.join(installRoot, "Contents/Info.plist");
const versionResult = spawnSync("/usr/bin/plutil", ["-extract", "CFBundleShortVersionString", "raw", "-o", "-", infoPlist], { encoding: "utf8", timeout: 5000, shell: false });
assert.equal(versionResult.status, 0, "cannot read the selected installation's actual version");
const appVersion = String(versionResult.stdout).trim();
const snapshot = freezeInstalledInputs({ installRoot, executable, expectedVersion, appVersion, platform: process.platform, arch: process.arch });
const proofPath = String(process.env.PHOENIX_TAURI_BUILD_PROOF_PATH || "").trim();
assert(proofPath && path.isAbsolute(proofPath), "an explicit trusted local native build proof is required before launching any app");
const buildProof = verifyBuildProof({ repoRoot, proofPath, snapshot });
// Freeze and verify everything before the first native child is spawned.
verifyInstalledInputs(snapshot);
const tempRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "desk-installed-recovery-")));
fs.chmodSync(tempRoot, 0o700);
const launch = createIsolatedLaunch(tempRoot, randomUUID());
const fixtureRoot = path.join(tempRoot, "recovery");
fs.mkdirSync(fixtureRoot, { mode: 0o700 });
const fixture = createRecoveryFixture(fixtureRoot);
const modelName = "IndependentBlock.FCStd";
// Independent XML archive: a packaged reader check, not real CAD geometry.
fs.writeFileSync(path.join(fixture.workspace, modelName), zipSync({
  "Document.xml": new TextEncoder().encode('<?xml version="1.0"?><Document SchemaVersion="4" FileVersion="1"><Objects Count="1"><Object type="PartDesign::Body" name="Body" id="1"/></Objects><ObjectData Count="1"><Object name="Body"><Properties Count="1"><Property name="Label" type="App::PropertyString"><String value="Independent block"/></Property></Properties></Object></ObjectData></Document>'),
  "GuiDocument.xml": new TextEncoder().encode('<?xml version="1.0"?><GuiDocument/>'),
}, { level: 6 }), { flag: "wx", mode: 0o600 });
let child, handoff, latestHealth;
let output = "";
const ownedChildren = [];

try {
  await start();
  const launcher = await successful("/api/config/launcher");
  assertUnder(launch.userData, path.resolve(String(launcher.launcher_config_path || "")), "launcher configuration");
  await setWorkspace(fixture.workspace);
  const retiredCodeRoutes = await verifyRetiredCodeRoutes();
  const bom = await successful("/api/cad/bom/file?rel=" + encodeURIComponent(modelName));
  assert(bom.is_fcstd === true && bom.file_size_bytes > 0, "packaged CAD route did not read the independent FCStd archive");
  assert(String(bom.source_note || "").includes("TypeScript FCStd reader"), "CAD route did not use the packaged TypeScript reader");
  const recoveryChecks = await runRecoveryJourney({ fixture, request, setWorkspace, restart: async () => { await stop(); await start(); } });
  fixture.unchanged();
  assert.equal((await successful("/api/workspace")).path, fixture.workspace);
  verifyInstalledInputs(snapshot);
  assert.equal(verifyBuildProof({ repoRoot, proofPath, snapshot }).proofSha256, buildProof.proofSha256, "native build proof bytes changed after freeze");
  await stop();
  fixture.unchanged();
  verifyInstalledInputs(snapshot);
  assert.equal(verifyBuildProof({ repoRoot, proofPath, snapshot }).proofSha256, buildProof.proofSha256, "native build proof bytes changed after freeze");
  recoveryChecks.push("owned-native-host-and-sidecar-shutdown");
  const receipt = {
    kind: "phoenix.desk.tauri-release-app-smoke", schemaVersion: 3,
    platform: process.platform + "-" + process.arch, appVersion,
    binarySha256: snapshot.executableSha256, runtimeManifestSha256: snapshot.manifestSha256,
    payloadInventorySha256: snapshot.payloadInventorySha256, payloadFiles: snapshot.payload.length,
    payloadBytes: snapshot.payloadBytes, nativeBuildProof: buildProof,
    health: latestHealth, userDataIsolated: true, inputFilesUnchanged: true, cadRuntime: "typescript",
    retiredCodeRoutes, recoveryChecks,
    isolation: { profileVersion: 1, isolatedLaunchVersion: 1, managedHandoffValidated: true, ownedQuit: true },
    flows: { launch: true, workspaceActivation: true, runtimeResources: true, retiredCodeRoutes404: true,
      realFcstdRead: true, workspaceRecovery: true, restartInvalidatesInspections: true, gracefulExit: true, sidecarReleased: true },
  };
  const serialized = JSON.stringify(receipt, null, 2) + "\n";
  const receiptPath = String(process.env.PHOENIX_TAURI_RECEIPT_PATH || "").trim();
  if (receiptPath) {
    assert(path.isAbsolute(receiptPath), "receipt path must be absolute");
    const receiptParent = path.dirname(receiptPath);
    assert.equal(fs.realpathSync(receiptParent), receiptParent, "receipt parent must be canonical; symlink aliases are forbidden");
    assert(!isUnder(repoRoot, receiptPath), "private installed-host evidence must stay outside the repository");
    const descriptor = fs.openSync(receiptPath, "wx", 0o600);
    try { fs.writeFileSync(descriptor, serialized); fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
  }
  process.stdout.write(serialized);
  process.stdout.write("[M4] macOS Tauri " + appVersion + " isolated installed-host journey passed\n");
} finally {
  await cleanup();
}

async function start() {
  verifyInstalledInputs(snapshot);
  assert.equal(verifyBuildProof({ repoRoot, proofPath, snapshot }).proofSha256, buildProof.proofSha256, "native build proof bytes changed after freeze");
  output = "";
  child = spawn(executable, [], { cwd: fixture.workspace, env: launch.environment, stdio: ["ignore", "pipe", "pipe"], shell: false });
  ownedChildren.push(child);
  child.stdout?.on("data", appendOutput); child.stderr?.on("data", appendOutput);
  let spawnError;
  child.once("error", error => { spawnError = error; });
  const deadline = Date.now() + 30000;
  handoff = undefined;
  while (Date.now() < deadline) {
    if (spawnError) throw spawnError;
    assert(child.exitCode == null && child.signalCode == null, "owned native host exited before handoff\n" + output);
    try { handoff = readOwnedHandoff(launch, child, expectedVersion); break; }
    catch (error) { if (error?.code !== "ENOENT") throw error; }
    await delay(100);
  }
  assert(handoff, "owned native host did not publish its handoff\n" + output);
  latestHealth = await successful("/api/health");
  assert.equal(latestHealth.status, "ok"); assert.equal(latestHealth.service, "phoenix-node");
  assert.equal(latestHealth.protocol_version, 1); assert.equal(latestHealth.app_version, expectedVersion);
}

async function request(route, body, headers, method = body === undefined ? "GET" : "POST") {
  // A stale port/registration cannot authorize an HTTP call or mutation.
  const identity = readOwnedHandoff(launch, child, expectedVersion);
  const response = await fetch(identity.api_origin + route, { method, redirect: "error", signal: AbortSignal.timeout(10000),
    headers: { ...(body === undefined ? {} : { "content-type": "application/json" }), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body) });
  const parts = [];
  let size = 0;
  for await (const chunk of response.body || []) {
    size += chunk.byteLength;
    assert(size <= 2 * 1024 * 1024, "owned endpoint response exceeded its smoke budget");
    parts.push(chunk);
  }
  const raw = Buffer.concat(parts).toString("utf8");
  let result;
  try { result = raw ? JSON.parse(raw) : {}; } catch { throw new Error(route + " returned non-JSON, HTTP " + response.status); }
  return { status: response.status, body: result };
}
async function successful(route, body) {
  const result = await request(route, body);
  assert(result.status >= 200 && result.status < 300, route + " returned HTTP " + result.status + ": " + String(result.body?.code || "unexpected response"));
  return result.body;
}
async function setWorkspace(workspace) {
  assert([fixture.workspace, fixture.other].includes(workspace), "smoke workspace must belong to this independent fixture");
  assert.equal((await successful("/api/workspace", { path: workspace })).path, workspace);
}

async function stop() {
  const stopped = child, ownedHandoff = writeOwnedQuit(launch, stopped, expectedVersion);
  await waitForExit(stopped, 10000);
  assert.equal(stopped.exitCode, 0, "owned native host did not exit normally\n" + output);
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (!fs.existsSync(path.join(launch.registrationDirectory, "service.v1.json"))
      && !fs.existsSync(path.join(launch.registrationDirectory, "instance.v1.lock"))
      && !(await canConnect(new URL(ownedHandoff.api_origin).port))) break;
    await delay(100);
  }
  assert(!(await canConnect(new URL(ownedHandoff.api_origin).port)), "owned sidecar port did not release");
  prepareOwnedRestart(launch, stopped, ownedHandoff);
}

async function verifyRetiredCodeRoutes() {
  // Carry every original method/path; GET alone could hide active write routes.
  const routes = [
    ["GET", "/api/code/index"], ["GET", "/api/code/index/catdlg"], ["POST", "/api/code/index/scan"],
    ["GET", "/api/code/index/entries"], ["GET", "/api/code/index/extension-discovery"],
    ["GET", "/api/code/index/extra-extensions"], ["PUT", "/api/code/index/extra-extensions"],
    ["POST", "/api/code/index/purge-missing"], ["POST", "/api/code/index/export-json"],
    ["GET", "/api/code/codegen/documents"], ["POST", "/api/code/codegen/open"],
    ["POST", "/api/code/codegen/document-state"], ["PUT", "/api/code/codegen/document"],
    ["POST", "/api/code/codegen/preflight"], ["POST", "/api/code/codegen/apply"],
    ["POST", "/api/code/codegen/source-preview"], ["POST", "/api/code/codegen/source-states"],
    ["GET", "/api/code/rename/prefs"], ["PUT", "/api/code/rename/prefs"],
    ["POST", "/api/code/rename/preview"], ["POST", "/api/code/rename/apply"],
    ["POST", "/api/code/uuid/scan"], ["POST", "/api/code/uuid/apply"],
    ["GET", "/api/code/reorder-members/prefs"], ["PUT", "/api/code/reorder-members/prefs"],
    ["POST", "/api/code/reorder-members/resolve"], ["POST", "/api/code/reorder-members/run"],
    ["POST", "/api/code/reorder-members/self-test"], ["GET", "/api/code/reorder-members/top-level"],
    ["GET", "/api/code/reorder-members/top-dirs"],
  ];
  const checks = [];
  for (const [method, route] of routes) {
    const identity = readOwnedHandoff(launch, child, expectedVersion);
    const response = await fetch(identity.api_origin + route, { method, redirect: "error", signal: AbortSignal.timeout(10000),
      headers: method === "GET" ? undefined : { "content-type": "application/json" }, body: method === "GET" ? undefined : "{}" });
    assert.equal(response.status, 404, "retired " + method + " " + route + " returned HTTP " + response.status);
    await response.body?.cancel();
    checks.push({ method, path: route, status: response.status });
  }
  return checks;
}

function appendOutput(chunk) { output = (output + chunk.toString()).slice(-16384); }
function waitForExit(processToWait, timeout) {
  if (processToWait.exitCode != null || processToWait.signalCode != null) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const done = () => { clearTimeout(timer); resolve(); };
    const timer = setTimeout(() => { processToWait.off("exit", done); reject(new Error("owned native host exit timed out")); }, timeout);
    processToWait.once("exit", done);
  });
}
function canConnect(port) {
  return new Promise(resolve => {
    const socket = net.createConnection({ host: "127.0.0.1", port: Number(port) });
    const done = connected => { socket.destroy(); resolve(connected); };
    socket.setTimeout(250, () => done(false)); socket.once("connect", () => done(true)); socket.once("error", () => done(false));
  });
}
async function cleanup() {
  for (const owned of ownedChildren) {
    if (owned.exitCode != null || owned.signalCode != null) continue;
    try { writeOwnedQuit(launch, owned, expectedVersion); await waitForExit(owned, 10000); }
    catch {
      // No bundle ID/global name/stale API shutdown: only our spawn handle.
      owned.kill();
      try { await waitForExit(owned, 5000); } catch { /* retain unresolved live scope */ }
    }
  }
  // Always keep local evidence. A matched path or copied marker is not an
  // atomic authorization to recursively delete a directory after GUI exit.
  verifyIsolatedLaunch(launch);
  process.stdout.write("[M4] retained local smoke evidence: " + tempRoot + "\n");
}
function isUnder(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === "" || (relative !== ".." && !relative.startsWith(".." + path.sep) && !path.isAbsolute(relative));
}
function assertUnder(root, candidate, label) { assert(isUnder(root, candidate) && candidate !== root, label + " escaped the owned user-data scope"); }
function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
