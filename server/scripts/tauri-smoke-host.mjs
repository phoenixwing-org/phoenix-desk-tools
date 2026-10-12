import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const scopes = new WeakMap();
const systemKeys = new Set(["PATH", "HOME", "USERPROFILE", "CFFIXED_USER_HOME", "SYSTEMROOT", "SystemRoot", "WINDIR", "COMSPEC", "PATHEXT", "LANG", "TZ"]);

function readJson(filename) {
  const descriptor = fs.openSync(filename, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  try {
    const stat = fs.fstatSync(descriptor);
    assert(stat.isFile() && stat.size <= 65536, "smoke ownership record must be a bounded regular file");
    assert(!fs.lstatSync(filename).isSymbolicLink(), "smoke ownership record must not be a symlink");
    return JSON.parse(fs.readFileSync(descriptor, "utf8"));
  } finally { fs.closeSync(descriptor); }
}

function rootIdentity(root) {
  const stat = fs.lstatSync(root);
  assert(stat.isDirectory() && !stat.isSymbolicLink() && fs.realpathSync(root) === root, "smoke root must be a canonical existing directory");
  assert(path.isAbsolute(root) && path.dirname(root) !== root, "smoke root must not be a filesystem root");
  return [stat.dev, stat.ino];
}

function scope(config) {
  const saved = scopes.get(config);
  assert(saved, "unrecognized smoke launch scope");
  assert.deepEqual(rootIdentity(config.root), saved.identity, "smoke root identity changed");
  assert.deepEqual(rootIdentity(config.userData), saved.userDataIdentity, "smoke user-data identity changed");
  assert.deepEqual(rootIdentity(config.registrationDirectory), saved.registrationIdentity, "smoke registration identity changed");
  const markerStat = fs.lstatSync(config.markerFile);
  assert(markerStat.isFile() && !markerStat.isSymbolicLink(), "smoke marker must be a regular file");
  assert.deepEqual([markerStat.dev, markerStat.ino], saved.markerIdentity, "smoke marker identity changed");
  assert.deepEqual(readJson(config.markerFile), saved.marker, "smoke launch marker changed");
  return saved;
}

export function createIsolatedLaunch(root, runId, parentEnvironment = process.env) {
  assert(UUID.test(runId), "smoke run id must be a UUID v4");
  const identity = rootIdentity(root);
  const userData = path.join(root, "user-data"), registrationDirectory = path.join(root, "registration");
  for (const directory of [userData, registrationDirectory]) fs.mkdirSync(directory, { mode: 0o700 });
  const markerFile = path.join(root, "isolated-host-smoke.v1.json");
  const marker = { kind: "phoenix.desk.isolated-host-smoke", schema_version: 1, run_id: runId, root };
  const descriptor = fs.openSync(markerFile, "wx", 0o600);
  try { fs.writeFileSync(descriptor, `${JSON.stringify(marker)}\n`); fs.fsyncSync(descriptor); }
  finally { fs.closeSync(descriptor); }
  // Do not forward user configuration, Node injection, Wing source, or credential
  // variables. Home keys keep their original value; no fake home is needed.
  const environment = {};
  for (const [key, value] of Object.entries(parentEnvironment)) {
    if ((systemKeys.has(key) || /^LC_[A-Z_]+$/u.test(key)) && typeof value === "string") environment[key] = value;
  }
  Object.assign(environment, {
    PHOENIX_TAURI_ISOLATED_SMOKE_ROOT: root,
    PHOENIX_TAURI_ISOLATED_SMOKE_RUN_ID: runId,
    PHOENIX_TAURI_ISOLATED_SMOKE_MARKER: markerFile,
    PHOENIX_TAURI_USER_DATA_DIR: userData,
    PHOENIX_USER_DATA_DIR: userData,
    PHOENIX_LEGACY_USER_DATA_DIR: userData,
    PHOENIX_DESK_TOOLS_REGISTRY_DIR: registrationDirectory,
    PHOENIX_RUNTIME_CATALOG_PATH: path.join(userData, "runtime-catalog.sqlite"),
    APPDATA: path.join(root, "system-config", "Roaming"),
    LOCALAPPDATA: path.join(root, "system-config", "Local"),
    XDG_CONFIG_HOME: path.join(root, "system-config"),
    XDG_CACHE_HOME: path.join(root, "cache"),
    TMPDIR: root, TEMP: root, TMP: root,
  });
  const config = Object.freeze({ root, runId, userData, registrationDirectory, markerFile,
    handoffFile: path.join(root, "host-recovery-smoke.v1.json"),
    quitFile: path.join(root, "host-recovery-smoke.quit.v1.json"), environment: Object.freeze(environment) });
  const markerStat = fs.lstatSync(markerFile);
  scopes.set(config, { identity, marker, markerIdentity: [markerStat.dev, markerStat.ino],
    userDataIdentity: rootIdentity(userData), registrationIdentity: rootIdentity(registrationDirectory) });
  return config;
}

/** Observation-based consistency check, not an external-writer filesystem lock. */
export function verifyIsolatedLaunch(config) { scope(config); }

export function readOwnedHandoff(config, child, expectedVersion) {
  scope(config);
  assert(Number.isSafeInteger(child?.pid) && child.pid > 0 && child.exitCode == null && child.signalCode == null && !child.killed,
    "only a live child spawned by this runner can authorize an installed endpoint");
  const handoff = readJson(config.handoffFile);
  const registration = readJson(path.join(config.registrationDirectory, "service.v1.json"));
  assert.equal(handoff.kind, "phoenix.desk.isolated-host-handoff");
  assert.equal(handoff.schema_version, 1); assert.equal(handoff.profile_version, 1);
  assert.equal(handoff.isolated_launch_version, 1);
  assert.equal(handoff.run_id, config.runId); assert.equal(handoff.host_pid, child.pid);
  assert.equal(handoff.api_source, "managed");
  assert.equal(handoff.runtime_user_data_dir, config.userData);
  assert.equal(handoff.registration_dir, config.registrationDirectory);
  assert.equal(handoff.quit_request_file, "host-recovery-smoke.quit.v1.json");
  assert(Number.isSafeInteger(handoff.sidecar_pid) && handoff.sidecar_pid > 0 && handoff.sidecar_pid !== child.pid, "invalid managed sidecar pid");
  assert.equal(registration.schema_version, 1); assert.equal(registration.service, "phoenix-desk-tools");
  assert.equal(registration.protocol_version, 1); assert.equal(registration.app_version, expectedVersion);
  assert.equal(registration.host, "127.0.0.1"); assert.equal(registration.pid, handoff.sidecar_pid);
  assert(typeof registration.instance_id === "string" && UUID.test(registration.instance_id), "invalid sidecar instance identity");
  assert.equal(registration.instance_id, handoff.instance_id);
  assert(Number.isInteger(registration.port) && registration.port > 0 && registration.port <= 65535, "invalid sidecar port");
  assert.equal(handoff.api_origin, `http://127.0.0.1:${registration.port}`);
  return Object.freeze({ ...handoff });
}

export function writeOwnedQuit(config, child, expectedVersion) {
  const handoff = readOwnedHandoff(config, child, expectedVersion);
  const record = { kind: "phoenix.desk.isolated-host-quit", schema_version: 1, run_id: config.runId, host_pid: handoff.host_pid };
  const descriptor = fs.openSync(config.quitFile, "wx", 0o600);
  try { fs.writeFileSync(descriptor, `${JSON.stringify(record)}\n`); fs.fsyncSync(descriptor); }
  finally { fs.closeSync(descriptor); }
  return handoff;
}

export function prepareOwnedRestart(config, child, lastHandoff) {
  scope(config);
  assert(child?.exitCode != null || child?.signalCode != null, "cannot reset launch records while the owned app is live");
  assert.equal(lastHandoff?.run_id, config.runId); assert.equal(lastHandoff?.host_pid, child.pid);
  for (const [filename, expectedKind] of [[config.quitFile, "phoenix.desk.isolated-host-quit"], [config.handoffFile, "phoenix.desk.isolated-host-handoff"]]) {
    if (!fs.existsSync(filename)) continue;
    const record = readJson(filename);
    assert.equal(record.kind, expectedKind); assert.equal(record.run_id, config.runId); assert.equal(record.host_pid, child.pid);
    if (filename === config.quitFile) assert.deepEqual(Object.keys(record).sort(), ["host_pid", "kind", "run_id", "schema_version"]);
    assert.equal(record.schema_version, 1);
    fs.unlinkSync(filename); // Only the matched record from our completed launch.
  }
  assert(!fs.existsSync(path.join(config.registrationDirectory, "service.v1.json")), "managed service registration was not released");
  assert(!fs.existsSync(path.join(config.registrationDirectory, "instance.v1.lock")), "managed instance lease was not released");
}
