import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { DESK_WEB_APP_VERSION, discoverDeskWeb, readDeskWebRegistration } from "./desk-web-discovery.mjs";

const REPO_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const ENTRY = "server/dist-browser/server.mjs";
const WEB_ROOT = "web-ui/dist";
const MANIFEST = "server/dist-browser/browser-host-manifest.json";
const SHA256 = /^[a-f0-9]{64}$/;
const MAX_MANIFEST_BYTES = 2 * 1024 * 1024;
const STARTUP_TIMEOUT_MS = 10_000;
const activeEnsures = new Map();
const plain = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const positivePid = (value) => Number.isSafeInteger(value) && value > 0;

function fail(code, reason) { const error = new Error(reason); error.code = code; throw error; }
function stateResult(state, code, reason, runtimeId = null) {
  return { state, code, reason, api_origin: null, web_url: null, instance_id: null, reused: false,
    created: false, release_status: "not-published", app_version: DESK_WEB_APP_VERSION, runtime_id: runtimeId, pid: null };
}
function safeRelative(value) {
  if (typeof value !== "string" || !value || value !== value.trim() || /[\\:\p{Cc}\p{Cf}\p{Cs}]/u.test(value)
    || path.isAbsolute(value) || value.split("/").some(part => !part || part === "." || part === "..")) fail("invalid_manifest", "发布候选清单包含不安全的相对文件路径");
  return value;
}
function noSymlinkPath(filename) {
  const root = path.parse(filename).root;
  let current = root;
  for (const part of filename.slice(root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink()) fail("unsafe_path", "明确路径不能经过符号链接");
  }
}
function readPinnedFile(filename, { limit = Number.MAX_SAFE_INTEGER, hash = false } = {}) {
  noSymlinkPath(filename);
  let fd;
  try {
    fd = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
    const before = fs.fstatSync(fd, { bigint: true });
    if (!before.isFile() || before.size > BigInt(limit)) fail("invalid_manifest", "发布候选成员不是允许大小的普通文件");
    const digest = hash ? createHash("sha256") : undefined;
    const chunks = [], buffer = Buffer.alloc(64 * 1024);
    let offset = 0;
    while (true) {
      const count = fs.readSync(fd, buffer, 0, buffer.length, offset);
      if (!count) break;
      offset += count;
      if (offset > limit || BigInt(offset) > before.size) fail("source_changed", "发布候选成员在校验期间变化");
      if (digest) digest.update(buffer.subarray(0, count)); else chunks.push(Buffer.from(buffer.subarray(0, count)));
    }
    const after = fs.fstatSync(fd, { bigint: true }), leaf = fs.lstatSync(filename, { bigint: true });
    const stamp = stat => [stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].join(":");
    if (BigInt(offset) !== before.size || stamp(before) !== stamp(after) || stamp(before) !== stamp(leaf) || !leaf.isFile()) fail("source_changed", "发布候选成员在校验期间变化");
    return { bytes: offset, ...(digest ? { sha256: digest.digest("hex") } : { data: Buffer.concat(chunks, offset) }) };
  } finally { if (fd !== undefined) fs.closeSync(fd); }
}

/** Verifies only explicitly listed candidate files. It neither builds nor discovers extra assets. */
export function validateBrowserHostManifest(repoRoot, options = {}) {
  const root = path.resolve(repoRoot);
  noSymlinkPath(root);
  if (fs.realpathSync(root) !== root || !fs.statSync(root).isDirectory()) fail("unsafe_path", "发布候选仓库目录必须是真实目录");
  const bytes = readPinnedFile(path.join(root, MANIFEST), { limit: MAX_MANIFEST_BYTES }).data;
  let manifest;
  try { manifest = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch { fail("invalid_manifest", "发布候选清单无法解析"); }
  const nodeVersion = options.nodeVersion ?? process.version;
  if (!plain(manifest) || manifest.kind !== "phoenix.desk.browser-host" || manifest.schema_version !== 1
    || manifest.status !== "not-published" || manifest.app_version !== DESK_WEB_APP_VERSION
    || manifest.service_protocol_version !== 1 || manifest.browser_host_protocol !== 1 || manifest.profile !== "browser-service-v1"
    || typeof manifest.runtime_id !== "string" || !/^sha256:[a-f0-9]{64}$/.test(manifest.runtime_id)
    || typeof manifest.generated_at !== "string" || !Number.isFinite(Date.parse(manifest.generated_at))
    || manifest.entry !== ENTRY || manifest.web_root !== WEB_ROOT
    || !plain(manifest.node) || manifest.node.version !== "v22.23.1" || manifest.node.bundled !== false
    || typeof manifest.node.sha256 !== "string" || !SHA256.test(manifest.node.sha256)
    || nodeVersion !== manifest.node.version || manifest.platform !== (options.platform ?? process.platform)
    || manifest.arch !== (options.arch ?? process.arch) || !plain(manifest.source)
    || typeof manifest.source.commit !== "string" || !/^[a-f0-9]{40}$/.test(manifest.source.commit) || typeof manifest.source.dirty !== "boolean"
    || !Array.isArray(manifest.assets) || manifest.assets.length !== 0 || !Array.isArray(manifest.files)
    || manifest.files.length < 2 || manifest.files.length > 10_000) {
    fail("incompatible_candidate", "发布候选清单、Node 版本或平台不兼容；需要精确 Node v22.23.1，未自动下载或构建");
  }
  // Preserve the generator's full insertion-ordered payload, rather than
  // repairing/projecting known fields before checking its identity.
  const { runtime_id: runtimeId, generated_at: _generatedAt, ...payload } = manifest;
  const payloadDigest = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
  if (runtimeId !== `sha256:${payloadDigest}`) fail("candidate_identity_mismatch", "发布候选 payload 与 runtime_id 不匹配；未启动后台");
  const nodeDigest = options.nodeDigest ?? readPinnedFile(process.execPath, { hash: true }).sha256;
  if (typeof nodeDigest !== "string" || !SHA256.test(nodeDigest) || nodeDigest !== manifest.node.sha256) {
    fail("node_digest_mismatch", "当前 Node 二进制 SHA256 与候选清单不匹配；未启动后台");
  }
  const seen = new Set();
  for (const member of manifest.files) {
    if (!plain(member)) fail("invalid_manifest", "发布候选清单成员无效");
    const rel = safeRelative(member.path);
    if (rel === MANIFEST || seen.has(rel) || !Number.isSafeInteger(member.bytes) || member.bytes < 0
      || typeof member.sha256 !== "string" || !SHA256.test(member.sha256)) fail("invalid_manifest", "发布候选清单含重复、自引用或无效指纹");
    seen.add(rel);
    const actual = readPinnedFile(path.join(root, rel), { limit: member.bytes, hash: true });
    if (actual.bytes !== member.bytes || actual.sha256 !== member.sha256) fail("candidate_hash_mismatch", "发布候选成员大小或 SHA256 不匹配；未启动后台");
  }
  if (!seen.has(ENTRY) || !seen.has(WEB_ROOT + "/index.html")) fail("invalid_manifest", "发布候选必须明确列出后台入口与 Web 首页");
  return { manifest, repoRoot: root, entry: path.join(root, ENTRY), webRoot: path.join(root, WEB_ROOT) };
}

function safeStateDirectory(value, { create = false, userHome = os.homedir(), repoRoot = REPO_ROOT } = {}) {
  if (typeof value !== "string" || !value || !path.isAbsolute(value) || /[\p{Cc}\p{Cf}\p{Cs}]/u.test(value)) fail("invalid_state_dir", "--state-dir 必须是明确的绝对目录路径");
  const filename = path.resolve(value), root = path.parse(filename).root;
  if (filename === root || filename === path.resolve(userHome) || filename === path.resolve(repoRoot)
    || path.resolve(repoRoot).startsWith(filename + path.sep)) fail("invalid_state_dir", "state-dir 不能是根目录、用户主目录或仓库根/父目录");
  let current = root, missing = false;
  for (const part of filename.slice(root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    let stat;
    try { stat = fs.lstatSync(current); }
    catch (error) {
      if (error?.code !== "ENOENT") throw error;
      missing = true;
      if (!create) continue;
      try { fs.mkdirSync(current, { mode: 0o700 }); }
      catch (creationError) { if (creationError?.code !== "EEXIST") throw creationError; }
      stat = fs.lstatSync(current);
    }
    if (stat.isSymbolicLink() || !stat.isDirectory()) fail("invalid_state_dir", "state-dir 必须是真实目录，不能经过符号链接");
  }
  if (missing && !create) return { path: filename, exists: false };
  const stat = fs.lstatSync(filename);
  if (fs.realpathSync(filename) !== filename || (process.platform !== "win32" && (stat.mode & 0o077) !== 0)
    || (typeof process.getuid === "function" && stat.uid !== process.getuid())) fail("invalid_state_dir", "state-dir 必须属于当前用户且仅当前用户可访问");
  return { path: filename, exists: true };
}

const OS_ENV_KEYS = ["PATH", "SystemRoot", "SYSTEMROOT", "WINDIR", "HOME", "USERPROFILE", "LOCALAPPDATA", "APPDATA", "LANG", "LC_ALL", "LC_CTYPE", "TZ"];
/** Explicit host environment only. Existing HOME is preserved, never repurposed for isolation. */
export function buildBrowserHostEnvironment(repoRoot, stateDir, manifest, port, sourceEnv = process.env) {
  const env = {};
  for (const key of OS_ENV_KEYS) if (typeof sourceEnv[key] === "string") env[key] = sourceEnv[key];
  return { ...env,
    PHOENIX_REPO_ROOT: repoRoot, PHOENIX_PACKAGED: "1", PHOENIX_RESOURCES_DIR: repoRoot,
    PHOENIX_DESK_BROWSER_STATE_DIR: stateDir, PHOENIX_WEB_ROOT: path.join(repoRoot, WEB_ROOT),
    PHOENIX_DESK_BROWSER_RUNTIME_ID: manifest.runtime_id, PHOENIX_DESK_BROWSER_PORT: String(port),
    PHOENIX_USER_DATA_DIR: path.join(stateDir, "data"), PHOENIX_LEGACY_USER_DATA_DIR: path.join(stateDir, "data"),
    PHOENIX_DESK_TOOLS_REGISTRY_DIR: path.join(stateDir, "services"),
    PHOENIX_APP_CONFIG_PATH: path.join(repoRoot, "phoenix/config/app_config.json"),
    PHOENIX_TEST_FIXTURE_CATALOG_PATH: path.join(repoRoot, "phoenix/config/test_fixture_catalog.json"),
    PHOENIX_RUNTIME_CATALOG_PATH: path.join(stateDir, "data/runtime-catalog.sqlite"), PHOENIX_DESK_HOST: "browser",
    TMPDIR: path.join(stateDir, "temp"), TMP: path.join(stateDir, "temp"), TEMP: path.join(stateDir, "temp"),
  };
}

function privateSubdirectory(filename) {
  try { fs.mkdirSync(filename, { mode: 0o700 }); }
  catch (error) { if (error?.code !== "EEXIST") throw error; }
  noSymlinkPath(filename);
  const stat = fs.lstatSync(filename);
  if (!stat.isDirectory() || (process.platform !== "win32" && (stat.mode & 0o077) !== 0)
    || (typeof process.getuid === "function" && stat.uid !== process.getuid())) fail("unsafe_state_member", "后台状态子目录不是自有私有目录");
}
function portValue(value = 0) {
  const port = typeof value === "string" && /^(?:0|[1-9][0-9]*)$/.test(value) ? Number(value) : value;
  if (!Number.isInteger(port) || port < 0 || port > 65_535) fail("invalid_arguments", "--port 必须是 0..65535 的整数");
  return port;
}

export function createDeskWebService(ports = {}) {
  const repoRoot = ports.repoRoot ?? REPO_ROOT, sourceEnv = ports.env ?? process.env;
  const discover = ports.discoverImpl ?? discoverDeskWeb, readRegistration = ports.readRegistrationImpl ?? readDeskWebRegistration;
  const spawnImpl = ports.spawnImpl ?? spawn, fetchImpl = ports.fetchImpl ?? globalThis.fetch;
  const clock = ports.clock ?? { now: () => Date.now(), sleep: ms => new Promise(resolve => setTimeout(resolve, ms)) };
  const map = ports.inFlight ?? activeEnsures;
  function candidate() { return validateBrowserHostManifest(repoRoot, { nodeVersion: ports.nodeVersion, nodeDigest: ports.nodeDigest, platform: ports.platform, arch: ports.arch }); }
  function finalize(output, env, verified, ownPid) {
    const base = { ...output, created: false, release_status: "not-published", app_version: verified.manifest.app_version, runtime_id: verified.manifest.runtime_id, pid: null };
    if (output.state !== "ready") return base;
    const registration = readRegistration(env);
    if (!registration || registration.instance_id !== output.instance_id || registration.web_url !== output.web_url
      || registration.runtime_id !== verified.manifest.runtime_id || !positivePid(registration.pid)) return stateResult("unavailable", "registration_changed", "服务登记在确认期间变化；未接管现有服务", verified.manifest.runtime_id);
    const created = ownPid !== undefined && ownPid === registration.pid;
    return { ...base, reused: !created, created, pid: registration.pid };
  }
  async function discoverWithin(env, verified, deadline) {
    const remaining = Math.floor(deadline - clock.now());
    if (remaining <= 0) return stateResult("unavailable", "startup_timeout", "等待 Desk 浏览器宿主就绪超时；未终止或接管任何进程", verified.manifest.runtime_id);
    let timer;
    const deadlineFetch = (url, options = {}) => fetchImpl(url, { ...options,
      signal: AbortSignal.any([...(options.signal ? [options.signal] : []), AbortSignal.timeout(Math.max(1, Math.floor(deadline - clock.now())))]) });
    try {
      return await Promise.race([
        discover(env, deadlineFetch, { expectedVersion: verified.manifest.app_version, expectedRuntimeId: verified.manifest.runtime_id }),
        new Promise(resolve => { timer = setTimeout(() => resolve(stateResult("unavailable", "startup_timeout", "等待 Desk 浏览器宿主就绪超时；未终止或接管任何进程", verified.manifest.runtime_id)), remaining); }),
      ]);
    } finally { if (timer) clearTimeout(timer); }
  }
  async function status({ stateDir, port = 0 } = {}) {
    let runtimeId = null;
    try {
      portValue(port);
      const verified = candidate(); runtimeId = verified.manifest.runtime_id;
      const state = safeStateDirectory(stateDir, { userHome: ports.userHome, repoRoot });
      if (!state.exists) return stateResult("absent", "no_state_dir", "独立状态目录尚不存在", runtimeId);
      const env = buildBrowserHostEnvironment(verified.repoRoot, state.path, verified.manifest, portValue(port), sourceEnv);
      return finalize(await discoverWithin(env, verified, clock.now() + 2000), env, verified);
    } catch (error) { return stateResult("incompatible", error?.code || "candidate_unavailable", "无法验证本地发布候选或安全状态目录；未启动任何进程", runtimeId); }
  }
  async function runEnsure(options) {
    let runtimeId = null;
    try {
      const port = portValue(options.port), verified = candidate(); runtimeId = verified.manifest.runtime_id;
      const state = safeStateDirectory(options.stateDir, { create: true, userHome: ports.userHome, repoRoot });
      const env = buildBrowserHostEnvironment(verified.repoRoot, state.path, verified.manifest, port, sourceEnv);
      const existing = await discoverWithin(env, verified, clock.now() + 2000);
      if (existing.state !== "absent") return finalize(existing, env, verified);
      for (const name of ["data", "services", "temp"]) privateSubdirectory(path.join(state.path, name));
      const log = path.join(state.path, "browser-host.log");
      let fd, child, launchError = false;
      try {
        fd = fs.openSync(log, fs.constants.O_WRONLY | fs.constants.O_APPEND | fs.constants.O_CREAT | fs.constants.O_NOFOLLOW, 0o600);
        const stat = fs.fstatSync(fd);
        if (!stat.isFile() || stat.nlink !== 1 || (process.platform !== "win32" && (stat.mode & 0o077) !== 0)
          || (typeof process.getuid === "function" && stat.uid !== process.getuid())) fail("unsafe_log", "后台日志不是自有私有文件");
        child = spawnImpl(ports.executable ?? process.execPath, [verified.entry], {
          cwd: verified.repoRoot, env, detached: true, windowsHide: true, shell: false, stdio: ["ignore", fd, fd],
        });
        child.once("error", () => { launchError = true; });
        child.unref();
      } finally { if (fd !== undefined) fs.closeSync(fd); }
      const ownPid = positivePid(child?.pid) ? child.pid : undefined;
      if (!ownPid) return stateResult("unavailable", "spawn_unconfirmed", "后台进程启动身份尚未确认；没有发送终止指令", runtimeId);
      const deadline = clock.now() + STARTUP_TIMEOUT_MS;
      for (let attempt = 0; attempt < 60 && clock.now() < deadline; attempt++) {
        const output = await discoverWithin(env, verified, deadline);
        if (output.state === "ready") return finalize(output, env, verified, ownPid);
        if (output.state === "incompatible") return finalize(output, env, verified);
        if (launchError) return stateResult("unavailable", "spawn_failed", "自有后台启动失败；未关闭其他服务，请检查状态目录日志", runtimeId);
        if (output.code === "startup_timeout") return finalize(output, env, verified);
        const remaining = deadline - clock.now();
        if (remaining > 0) await clock.sleep(Math.min(200, remaining));
      }
      return stateResult("unavailable", "startup_timeout", "等待 Desk 浏览器宿主就绪超时；未终止或接管任何进程", runtimeId);
    } catch (error) { return stateResult("incompatible", error?.code || "candidate_unavailable", "无法启动已验证的本地发布候选；没有关闭或接管已有服务", runtimeId); }
  }
  function ensure(options = {}) {
    const key = `${path.resolve(repoRoot)}\0${path.resolve(String(options.stateDir ?? ""))}`;
    if (map.has(key)) return map.get(key);
    const pending = runEnsure(options).finally(() => { if (map.get(key) === pending) map.delete(key); });
    map.set(key, pending); return pending;
  }
  return { ensure, status };
}

export function parseDeskWebServiceArgs(args) {
  const [command, ...rest] = args;
  if (command !== "ensure" && command !== "status") fail("invalid_arguments", "命令仅支持 ensure 或 status");
  let stateDir, port = 0; const seen = new Set();
  for (let index = 0; index < rest.length; index += 2) {
    const flag = rest[index], value = rest[index + 1];
    if (!["--state-dir", "--port"].includes(flag) || seen.has(flag) || value === undefined) fail("invalid_arguments", "参数仅支持唯一的 --state-dir 与可选 --port");
    seen.add(flag);
    if (flag === "--state-dir") stateDir = value; else port = portValue(value);
  }
  if (!stateDir || !path.isAbsolute(stateDir)) fail("invalid_arguments", "必须指定 --state-dir /absolute/path");
  return { command, stateDir, port };
}

const service = createDeskWebService();
export const ensureDeskWebService = options => service.ensure(options);
export const statusDeskWebService = options => service.status(options);

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let output;
  try {
    const args = parseDeskWebServiceArgs(process.argv.slice(2));
    output = await service[args.command](args);
  } catch (error) { output = stateResult("incompatible", error?.code || "invalid_arguments", error instanceof Error ? error.message : "参数无效"); }
  if (output.state !== "ready") process.stderr.write(`[desk-web] ${output.reason}\n`);
  process.stdout.write(JSON.stringify(output) + "\n");
  if (output.state !== "ready") process.exitCode = output.code === "invalid_arguments" ? 2 : 1;
}
