import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { buildBrowserHostEnvironment, createDeskWebService, parseDeskWebServiceArgs, validateBrowserHostManifest } from "./desk-web-service.mjs";

const RUNTIME = "sha256:" + "a".repeat(64), INSTANCE = "adf84061-9854-4645-87a1-853d25acf851";
const NODE_DIGEST = "b".repeat(64);
const validation = extra => ({ nodeVersion: "v22.23.1", nodeDigest: NODE_DIGEST, ...extra });
function candidate(context) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "desk-web-candidate-")));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const repo = path.join(root, "repo"), stateDir = path.join(root, "state"); fs.mkdirSync(repo);
  const entries = { "server/dist-browser/server.mjs": "// Independent inert entry\n", "web-ui/dist/index.html": "<!doctype html><html>Independent sample</html>" };
  const files = Object.entries(entries).map(([rel, data]) => {
    const filename = path.join(repo, rel); fs.mkdirSync(path.dirname(filename), { recursive: true }); fs.writeFileSync(filename, data);
    return { path: rel, bytes: Buffer.byteLength(data), sha256: createHash("sha256").update(data).digest("hex") };
  });
  const manifest = { kind: "phoenix.desk.browser-host", schema_version: 1, status: "not-published", app_version: "0.5.0",
    service_protocol_version: 1, browser_host_protocol: 1, profile: "browser-service-v1",
    entry: "server/dist-browser/server.mjs", web_root: "web-ui/dist", node: { version: "v22.23.1", bundled: false, sha256: NODE_DIGEST },
    platform: process.platform, arch: process.arch, source: { commit: "c".repeat(40), dirty: true }, files, assets: [] };
  const manifestPath = path.join(repo, "server/dist-browser/browser-host-manifest.json");
  const writeManifest = ({ recomputeId = true } = {}) => {
    if (recomputeId) {
      const { runtime_id: _runtimeId, generated_at: _generatedAt, ...payload } = manifest;
      manifest.runtime_id = "sha256:" + createHash("sha256").update(JSON.stringify(payload)).digest("hex");
    }
    manifest.generated_at = "2026-01-01T00:00:00.000Z";
    fs.writeFileSync(manifestPath, JSON.stringify(manifest));
  }; writeManifest();
  return { root, repo, stateDir, manifest, writeManifest };
}
function ready(pid = 7001) {
  return { state: "ready", code: "verified", reason: "synthetic verified host", api_origin: "http://127.0.0.1:48381", web_url: "http://127.0.0.1:48381/", instance_id: INSTANCE, reused: true, lock_present: true, pid };
}
function setup(context, extra = {}) {
  const f = candidate(context); let now = 0, launches = 0, kills = 0, unrefs = 0;
  const calls = [], child = Object.assign(new EventEmitter(), { pid: 7001, unref() { unrefs++; }, kill() { kills++; } });
  const service = createDeskWebService({ repoRoot: f.repo, nodeVersion: "v22.23.1", nodeDigest: NODE_DIGEST, inFlight: new Map(),
    env: { PATH: "/synthetic/bin", HOME: "/independent-user", NODE_OPTIONS: "--require private.js", NODE_PATH: "/private/modules", PYTHONPATH: "/private/python", OPENAI_API_KEY: "synthetic-test-secret", PHOENIX_WING_ROOT: "/private/source", PHOENIX_USER_DATA_DIR: "/private/data" },
    spawnImpl: (...args) => { launches++; calls.push(args); return child; },
    discoverImpl: async () => ({ state: "absent", code: "no_registration", reason: "missing", reused: false }),
    readRegistrationImpl: () => ({ instance_id: INSTANCE, pid: extra.registrationPid ?? 7001, web_url: "http://127.0.0.1:48381/", runtime_id: f.manifest.runtime_id }),
    clock: { now: () => now, sleep: async ms => { now += ms; } }, ...extra,
  });
  return { ...f, service, calls, child, get launches() { return launches; }, get kills() { return kills; }, get unrefs() { return unrefs; } };
}

test("CLI accepts only an explicit absolute state directory, command and bounded port", () => {
  assert.deepEqual(parseDeskWebServiceArgs(["ensure", "--state-dir", "/private/tmp/independent", "--port", "0"]), { command: "ensure", stateDir: "/private/tmp/independent", port: 0 });
  for (const args of [["stop", "--state-dir", "/x"], ["ensure"], ["status", "--state-dir", "relative"], ["ensure", "--state-dir", "/x", "--port", "65536"], ["ensure", "--state-dir", "/x", "--port", "-1"], ["ensure", "--state-dir", "/x", "--state-dir", "/y"], ["ensure", "--state-dir", "/x", "--open"]]) assert.throws(() => parseDeskWebServiceArgs(args));
});

test("invalid CLI input emits exactly one JSON stdout record and a nonzero status without entering startup", () => {
  const child = spawnSync(process.execPath, [fileURLToPath(new URL("./desk-web-service.mjs", import.meta.url)), "stop"], { encoding: "utf8" });
  assert.equal(child.status, 2);
  const lines = child.stdout.trim().split(/\r?\n/);
  assert.equal(lines.length, 1); assert.equal(JSON.parse(lines[0]).code, "invalid_arguments");
  assert.match(child.stderr, /\[desk-web\]/);
});

test("candidate validation requires exact Node/platform and verifies listed members without crawling extras", context => {
  const f = candidate(context);
  fs.writeFileSync(path.join(f.repo, "unlisted-private-note.txt"), "not part of the candidate");
  assert.equal(validateBrowserHostManifest(f.repo, validation()).manifest.runtime_id, f.manifest.runtime_id);
  assert.throws(() => validateBrowserHostManifest(f.repo, validation({ nodeVersion: "v22.23.0" })), /Node/);
  assert.throws(() => validateBrowserHostManifest(f.repo, validation({ platform: "independent-other-platform" })));
  fs.writeFileSync(path.join(f.repo, f.manifest.files[0].path), "tampered");
  assert.throws(() => validateBrowserHostManifest(f.repo, validation()));
});

test("candidate runtime identity binds the complete payload, including refreshed member fingerprints", context => {
  const f = candidate(context), originalId = f.manifest.runtime_id;
  const entry = f.manifest.files[0], changed = "// Independently changed inert entry\n";
  fs.writeFileSync(path.join(f.repo, entry.path), changed);
  entry.bytes = Buffer.byteLength(changed); entry.sha256 = createHash("sha256").update(changed).digest("hex");
  f.writeManifest({ recomputeId: false });
  assert.equal(f.manifest.runtime_id, originalId);
  assert.throws(() => validateBrowserHostManifest(f.repo, validation()), error => error.code === "candidate_identity_mismatch");
  f.writeManifest();
  assert.notEqual(f.manifest.runtime_id, originalId);
  assert.equal(validateBrowserHostManifest(f.repo, validation()).manifest.runtime_id, f.manifest.runtime_id);
  assert.throws(() => validateBrowserHostManifest(f.repo, validation({ nodeDigest: "d".repeat(64) })), error => error.code === "node_digest_mismatch");
});

test("candidate profile, protocols, source identity, empty assets and Node digest are mandatory", context => {
  const f = candidate(context), original = structuredClone(f.manifest);
  for (const override of [
    { service_protocol_version: 2 }, { browser_host_protocol: 2 }, { profile: "different-profile" },
    { source: { commit: "not-a-commit", dirty: true } }, { source: { commit: "c".repeat(40), dirty: "true" } },
    { assets: [{ path: "independent-extra" }] }, { node: { version: "v22.23.1", bundled: false, sha256: "invalid" } },
  ]) {
    Object.assign(f.manifest, original, override); f.writeManifest();
    assert.throws(() => validateBrowserHostManifest(f.repo, validation()), error => error.code === "incompatible_candidate");
  }
});

test("candidate paths reject traversal, duplicates, self-hashing and symlink members", context => {
  const f = candidate(context), original = structuredClone(f.manifest.files);
  for (const rel of ["../outside", "/absolute", "web-ui//dist/index.html", "server\\entry.mjs", "server/dist-browser/browser-host-manifest.json"]) {
    f.manifest.files = [{ ...original[0], path: rel }, original[1]]; f.writeManifest();
    assert.throws(() => validateBrowserHostManifest(f.repo, validation()));
  }
  f.manifest.files = [original[0], original[0], original[1]]; f.writeManifest();
  assert.throws(() => validateBrowserHostManifest(f.repo, validation()));
  f.manifest.files = original; f.writeManifest();
  const entry = path.join(f.repo, original[0].path), originalFile = path.join(f.root, "independent-entry.mjs");
  fs.renameSync(entry, originalFile); fs.symlinkSync(originalFile, entry);
  assert.throws(() => validateBrowserHostManifest(f.repo, validation()), /符号链接/);
});

test("child environment is constructed from a small OS whitelist and dedicated explicit state", () => {
  const env = buildBrowserHostEnvironment("/synthetic/repo", "/synthetic/state", { runtime_id: RUNTIME }, 0, {
    HOME: "/independent-user", PATH: "/safe/bin", NODE_OPTIONS: "secret", NODE_PATH: "secret", PYTHONHOME: "secret", GITHUB_TOKEN: "secret", PHOENIX_USER_DATA_DIR: "/old-user-data", PHOENIX_WING_MODE: "local",
  });
  assert.equal(env.HOME, "/independent-user"); assert.equal(env.PATH, "/safe/bin");
  for (const key of ["NODE_OPTIONS", "NODE_PATH", "PYTHONHOME", "GITHUB_TOKEN", "PHOENIX_WING_MODE"]) assert.equal(env[key], undefined);
  assert.equal(env.PHOENIX_DESK_BROWSER_PORT, "0"); assert.equal(env.PHOENIX_DESK_BROWSER_RUNTIME_ID, RUNTIME);
  assert.equal(env.PHOENIX_USER_DATA_DIR, "/synthetic/state/data"); assert.equal(env.PHOENIX_LEGACY_USER_DATA_DIR, env.PHOENIX_USER_DATA_DIR);
  assert.equal(env.PHOENIX_DESK_TOOLS_REGISTRY_DIR, "/synthetic/state/services"); assert.equal(env.TMPDIR, "/synthetic/state/temp");
});

test("a ready compatible service is reused without spawn or side-effect directories", async context => {
  const f = setup(context, { discoverImpl: async () => ready() });
  const output = await f.service.ensure({ stateDir: f.stateDir });
  assert.equal(output.state, "ready"); assert.equal(output.reused, true); assert.equal(output.created, false); assert.equal(output.pid, 7001);
  assert.equal(f.launches, 0); assert.equal(f.kills, 0); assert.equal(fs.existsSync(path.join(f.stateDir, "data")), false);
});

test("concurrent ensure requests share one launch, then publish self-created only for the same PID", async context => {
  let probes = 0;
  const f = setup(context, { discoverImpl: async () => ++probes === 1 ? { state: "absent" } : ready() });
  const first = f.service.ensure({ stateDir: f.stateDir, port: 0 }), second = f.service.ensure({ stateDir: f.stateDir + path.sep, port: 0 });
  assert.equal(first, second);
  const output = await first;
  assert.equal(output.created, true); assert.equal(output.reused, false); assert.equal(f.launches, 1); assert.equal(f.unrefs, 1); assert.equal(f.kills, 0);
  const [command, args, opts] = f.calls[0]; assert.equal(command, process.execPath);
  assert.deepEqual(args, [path.join(f.repo, "server/dist-browser/server.mjs")]);
  assert.equal(opts.detached, true); assert.equal(opts.shell, false); assert.equal(opts.stdio[0], "ignore"); assert.equal(opts.stdio[1], opts.stdio[2]);
  assert.equal(opts.env.NODE_OPTIONS, undefined); assert.equal(opts.env.PYTHONPATH, undefined); assert.equal(opts.env.OPENAI_API_KEY, undefined);
  assert.equal(opts.env.PHOENIX_DESK_HOST, "browser"); assert.equal(fs.statSync(path.join(f.stateDir, "browser-host.log")).mode & 0o077, 0);
});

test("a concurrent other compatible owner is reused, never claimed or killed", async context => {
  let probes = 0;
  const f = setup(context, { registrationPid: 8002, discoverImpl: async () => ++probes === 1 ? { state: "absent" } : ready(8002) });
  const output = await f.service.ensure({ stateDir: f.stateDir });
  assert.equal(output.reused, true); assert.equal(output.created, false); assert.equal(output.pid, 8002); assert.equal(f.kills, 0);
});

test("incompatible, unavailable and owner-lock states never spawn or remove owner records", async context => {
  for (const state of ["incompatible", "unavailable"]) {
    const f = setup(context, { discoverImpl: async () => ({ state, code: "owner_lock_present", lock_present: true }) });
    fs.mkdirSync(f.stateDir, { mode: 0o700 }); fs.mkdirSync(path.join(f.stateDir, "services"), { mode: 0o700 });
    const lock = path.join(f.stateDir, "services/instance.v1.lock"); fs.writeFileSync(lock, "existing independent owner");
    assert.equal((await f.service.ensure({ stateDir: f.stateDir })).state, state);
    assert.equal(f.launches, 0); assert.equal(f.kills, 0); assert.equal(fs.readFileSync(lock, "utf8"), "existing independent owner");
  }
});

test("startup timeout is finite, does not repeat spawn and grants no kill authority", async context => {
  const f = setup(context);
  const output = await f.service.ensure({ stateDir: f.stateDir });
  assert.equal(output.code, "startup_timeout"); assert.equal(output.created, false); assert.equal(output.pid, null);
  assert.equal(f.launches, 1); assert.equal(f.kills, 0); assert.equal("stop" in output, false);
});

test("status is read-only for absent state, and state safety rejects root, user root, symlinks and public directories", async context => {
  const f = setup(context);
  assert.equal((await f.service.status({ stateDir: f.stateDir })).state, "absent"); assert.equal(fs.existsSync(f.stateDir), false); assert.equal(f.launches, 0);
  for (const stateDir of [path.parse(f.root).root, os.homedir(), f.repo, path.dirname(f.repo)]) assert.equal((await f.service.ensure({ stateDir })).code, "invalid_state_dir");
  const linked = path.join(f.root, "linked"); fs.symlinkSync(f.root, linked, "dir");
  assert.equal((await f.service.ensure({ stateDir: path.join(linked, "child") })).code, "invalid_state_dir");
  const publicDir = path.join(f.root, "public"); fs.mkdirSync(publicDir, { mode: 0o755 }); fs.chmodSync(publicDir, 0o755);
  assert.equal((await f.service.ensure({ stateDir: publicDir })).code, "invalid_state_dir"); assert.equal(f.launches, 0);
});
