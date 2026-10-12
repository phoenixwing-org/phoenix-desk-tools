import childProcess from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { freezeInstalledInputs, verifyInstalledInputs } from "./tauri-smoke-inputs.mjs";

// This is evidence from a trusted local workflow, not a signature. Native
// profile changes require explicit re-audit; self-consistent arbitrary sources
// are not sufficient to grant an isolated-launch capability.
const AUDITED = Object.freeze({
  "src-tauri/src/lib.rs": "3093f5a48dbee9578858c1cb0d10237b634d6e6f0e368b8e5b15a3badd768159",
  "src-tauri/src/isolated_smoke.rs": "daa7314b3fbbcf1cdb5fc1627689cc42b68fcee709ef613720b9b198ae5c129b",
  "server/scripts/smoke-workspace-recovery.mjs": "795f7831fbf7fe59fb83773a89cbdd4798efaa29cd3901e2e3dbe2a83afcc0f0",
  "server/scripts/workspace-recovery-journey.mjs": "0a56112e4811b7d278563bd3954a58569de87713ff4555e4252fe13fd107097e",
  "scripts/build-tauri-isolated-runtime.mjs": "7083d89a2804aa8d881f94567cd642df4fe9926c73f7a4e87752fcd38da8b667",
});
const SOURCE_PATHS = Object.freeze(["package.json", "src-tauri/Cargo.lock", "src-tauri/Cargo.toml", "src-tauri/build.rs", "src-tauri/tauri.conf.json", "src-tauri/src/main.rs", ...Object.keys(AUDITED)]);
// The ordinary config must remain known. This profile retains a fixed audited
// build hook rather than an ambient command chain; record that override as argv.
export const CONTROLLED_TAURI_CONFIG = JSON.stringify({ build: { beforeBuildCommand: "node scripts/build-tauri-isolated-runtime.mjs" } });
export const CONTROLLED_CARGO_ARGS = Object.freeze(["tauri", "build", "--bundles", "app", "--ci", "--no-sign", "--config", CONTROLLED_TAURI_CONFIG, "--", "--locked", "--offline"]);
const LIMITS = Object.freeze({ json: 1024 * 1024, file: 256 * 1024 * 1024, total: 1024 * 1024 * 1024, files: 4096, entries: 8192, source: 8 * 1024 * 1024 });
const sources = new WeakMap(), builds = new WeakMap();
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const encode = value => `${JSON.stringify(value)}\n`;
const fail = message => { throw new Error(`Controlled build proof: ${message}`); };
const assert = (condition, message) => { if (!condition) fail(message); };
const order = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const statKey = stat => `${stat.dev}:${stat.ino}:${stat.mode}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`;
const outputIdentity = stat => `${stat.dev}:${stat.ino}:${stat.mode}:${stat.uid}`;
function freeze(value) { if (value && typeof value === "object") { for (const child of Object.values(value)) freeze(child); Object.freeze(value); } return value; }
function record(value, keys, label) { assert(value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key)), `${label} has missing or extra fields`); }
function sha(value) { assert(typeof value === "string" && /^[a-f0-9]{64}$/u.test(value), "invalid SHA-256"); }
function relative(value) {
  assert(typeof value === "string" && value.length > 0 && value.length <= 1024 && !/[\\:\u0000-\u001f]/u.test(value), "unsafe relative path");
  const pieces = value.split("/");
  assert(pieces.length <= 64 && pieces.every(piece => piece && piece !== "." && piece !== ".." && !/[. ]$/u.test(piece) && !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(piece)), "relative path escape/nonportable name"); return value;
}
function absolute(value) { assert(typeof value === "string" && path.isAbsolute(value) && !/[\u0000-\u001f]/u.test(value), "absolute path required"); return path.resolve(value); }
function realDirectory(filename) {
  const stat = fs.lstatSync(filename, { bigint: true }); assert(stat.isDirectory() && !stat.isSymbolicLink(), "non-symlink directory required"); return stat;
}
function rootDirectory(filename) { const selected = absolute(filename); realDirectory(selected); return fs.realpathSync(selected); }
function outside(left, right) { const relativePath = path.relative(left, right); return path.isAbsolute(relativePath) || relativePath === ".." || relativePath.startsWith(`..${path.sep}`); }
function ancestors(root, filename) {
  const name = path.relative(root, filename); assert(name && !path.isAbsolute(name) && name !== ".." && !name.startsWith(`..${path.sep}`), "input escapes root");
  let current = root; for (const part of name.split(path.sep).slice(0, -1)) { current = path.join(current, part); realDirectory(current); }
}
function regular(filename, maximum = LIMITS.file, capture = false, budget = { bytes: 0 }) {
  const before = fs.lstatSync(filename, { bigint: true }); assert(before.isFile() && !before.isSymbolicLink(), "regular no-link input required");
  assert(before.size <= BigInt(maximum), "file exceeds byte budget"); budget.bytes += Number(before.size); assert(budget.bytes <= LIMITS.total, "total byte budget exceeded");
  const fd = fs.openSync(filename, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0) | (fs.constants.O_NONBLOCK || 0));
  let result, error;
  try {
    const opened = fs.fstatSync(fd, { bigint: true }); assert(opened.isFile() && statKey(opened) === statKey(before), "input changed at open");
    const hash = createHash("sha256"), buffer = Buffer.alloc(64 * 1024), chunks = []; let bytes = 0;
    for (;;) { const count = fs.readSync(fd, buffer, 0, buffer.length, null); if (!count) break; bytes += count; assert(bytes <= Number(opened.size) && bytes <= maximum, "input grew during read"); hash.update(buffer.subarray(0, count)); if (capture) chunks.push(Buffer.from(buffer.subarray(0, count))); }
    assert(bytes === Number(opened.size) && statKey(opened) === statKey(fs.fstatSync(fd, { bigint: true })) && statKey(opened) === statKey(fs.lstatSync(filename, { bigint: true })), "input changed during read");
    result = { bytes, sha256: hash.digest("hex"), ...(capture ? { content: Buffer.concat(chunks) } : {}) };
  } catch (caught) { error = caught; }
  try { fs.closeSync(fd); } catch (caught) { if (error) throw new AggregateError([error, caught], "Proof input read and close failed"); throw caught; }
  if (error) throw error; return result;
}
function json(bytes) {
  let text; try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { fail("JSON is not UTF-8"); }
  // Detect duplicate decoded keys before JSON.parse, with bounded nesting and
  // token counts. This is a lexical guard, not a substitute JSON parser.
  const stack = []; let tokens = 0;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (char === '"') {
      let end = index + 1; for (; end < text.length; end++) { if (text[end] === "\\") end++; else if (text[end] === '"') break; }
      assert(end < text.length && end - index <= 4096, "JSON string budget exceeded");
      let next = end + 1; while (/\s/u.test(text[next] || "!")) next++;
      if (text[next] === ":") { const current = stack.at(-1); assert(current?.keys, "invalid JSON key layout"); let key; try { key = JSON.parse(text.slice(index, end + 1)); } catch { fail("invalid JSON key"); } assert(!current.keys.has(key), "duplicate JSON key"); current.keys.add(key); }
      index = end;
    } else if (char === "{" || char === "[") { stack.push(char === "{" ? { keys: new Set() } : {}); assert(stack.length <= 16, "JSON depth budget exceeded"); }
    else if (char === "}" || char === "]") stack.pop();
    if (!/\s/u.test(char)) assert(++tokens <= 65536, "JSON token budget exceeded");
  }
  try { return JSON.parse(text); } catch { fail("invalid JSON"); }
}
function sourceFingerprint(repoRoot) {
  const root = rootDirectory(repoRoot), files = [];
  for (const name of SOURCE_PATHS) { const filename = path.join(root, name); ancestors(root, filename); const entry = regular(filename, LIMITS.source); files.push({ path: name, bytes: entry.bytes, sha256: entry.sha256 }); }
  for (const [name, expected] of Object.entries(AUDITED)) assert(files.find(entry => entry.path === name)?.sha256 === expected, `unsupported-profile: ${name} requires re-audit`);
  const packageJson = json(regular(path.join(root, "package.json"), LIMITS.json, true).content);
  const config = json(regular(path.join(root, "src-tauri/tauri.conf.json"), LIMITS.json, true).content);
  const cargo = new TextDecoder("utf-8", { fatal: true }).decode(regular(path.join(root, "src-tauri/Cargo.toml"), LIMITS.source, true).content);
  const packageSection = cargo.match(/^\[package\]\s*\n([\s\S]*?)(?=^\[|$(?![\s\S]))/mu)?.[1];
  const versions = [...(packageSection || "").matchAll(/^version\s*=\s*"([^"]+)"\s*$/gmu)];
  const version = packageJson.version;
  assert(typeof version === "string" && /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(version) && config.version === version && versions.length === 1 && versions[0][1] === version, "package/tauri/Cargo version mismatch");
  assert(config.build?.beforeBuildCommand === "pnpm build && pnpm build:tauri-runtime" && config.build?.frontendDist === "../web-ui/dist", "unsupported native build layout");
  assert(typeof config.productName === "string" && /^[A-Za-z0-9 ._-]{1,100}$/u.test(config.productName) && !config.productName.endsWith(".") && config.productName !== ".", "unsupported app bundle name");
  return freeze({ root, version, productName: config.productName, files, digestSha256: digest(encode(files)), sourceDirtyAllowed: true });
}
/** Capture audited native input bytes. Dirty working trees are allowed explicitly. */
export function captureBuildInputs(repoRoot) {
  const snapshot = sourceFingerprint(repoRoot); sources.set(snapshot, snapshot.root); return snapshot;
}
export function verifyBuildInputs(inputs) {
  assert(sources.has(inputs), "build inputs must be workflow-owned");
  assert(encode(sourceFingerprint(inputs.root)) === encode(inputs), "source inputs changed after capture");
}
function cleanBuildEnvironment(output) {
  const kept = {};
  for (const [key, value] of Object.entries(process.env)) if (["PATH", "HOME", "USERPROFILE", "LANG", "TZ", "TMPDIR", "TMP", "TEMP", "SYSTEMROOT", "WINDIR", "COMSPEC", "PATHEXT"].includes(key) || /^LC_[A-Z_]+$/u.test(key)) kept[key] = value;
  return { ...kept, CARGO_TARGET_DIR: path.join(output, "cargo-target"), CARGO_NET_OFFLINE: "true", PHOENIX_WING_MODE: "registry" };
}
/** Execute the fixed offline native build; never execute an existing application. */
export function runControlledCargoBuild(inputs, ownedOutputDirectory) {
  assert(process.platform === "darwin" && ["arm64", "x64"].includes(process.arch), "unsupported-profile: controlled build currently supports macOS only");
  verifyBuildInputs(inputs);
  const output = rootDirectory(ownedOutputDirectory), relativeOutput = path.relative(inputs.root, output), stat = realDirectory(output);
  assert(relativeOutput && outside(inputs.root, output) && outside(output, inputs.root), "Cargo output must be outside and not contain repository");
  assert((stat.mode & 0o077n) === 0n && (typeof process.getuid !== "function" || stat.uid === BigInt(process.getuid())), "Cargo output must be private and owned");
  const listing = fs.opendirSync(output); let first, listingError;
  try { first = listing.readSync(); } catch (caught) { listingError = caught; }
  try { listing.closeSync(); } catch (caught) { if (listingError) throw new AggregateError([listingError, caught], "Output enumeration and close failed"); throw caught; }
  if (listingError) throw listingError; assert(first === null, "Cargo output must be newly empty");
  const result = childProcess.spawnSync("cargo", [...CONTROLLED_CARGO_ARGS], { cwd: inputs.root, env: cleanBuildEnvironment(output), shell: false, stdio: "inherit", timeout: 45 * 60 * 1000 });
  if (result.error) throw result.error;
  assert(result.status === 0 && !result.signal, "controlled cargo build did not exit 0"); verifyBuildInputs(inputs);
  const installRoot = path.join(output, "cargo-target/release/bundle/macos", `${inputs.productName}.app`), executable = path.join(installRoot, "Contents/MacOS/phoenix-desktop"), plist = path.join(installRoot, "Contents/Info.plist");
  const outputProof = outputIdentity(stat); assert(outputIdentity(realDirectory(output)) === outputProof, "controlled output directory identity/permissions changed");
  ancestors(output, plist); assert(rootDirectory(installRoot) === installRoot, "build app root must be canonical"); const plistBefore = regular(plist, LIMITS.json);
  const version = childProcess.spawnSync("/usr/bin/plutil", ["-extract", "CFBundleShortVersionString", "raw", "-o", "-", plist], { encoding: "utf8", env: cleanBuildEnvironment(output) });
  if (version.error) throw version.error; assert(version.status === 0 && !version.signal, "cannot read actual controlled build plist version");
  const appVersion = String(version.stdout).trim();
  const snapshot = freezeInstalledInputs({ installRoot, executable, expectedVersion: inputs.version, appVersion, platform: "darwin", arch: process.arch });
  assert(snapshot.plist?.sha256 === plistBefore.sha256, "actual plist changed while reading version");
  verifyBuildInputs(inputs); assert(outputIdentity(realDirectory(output)) === outputProof, "controlled output directory identity/permissions changed");
  const token = freeze({ command: "cargo", args: [...CONTROLLED_CARGO_ARGS], exitCode: 0, outputDirectory: output, installRoot, executable, appVersion });
  builds.set(token, { inputs, snapshot, outputProof }); return token;
}
function treeFingerprint(root) {
  realDirectory(root); const files = [], budget = { bytes: 0 }; let visited = 0;
  function visit(directory, prefix) {
    realDirectory(directory); const dir = fs.opendirSync(directory); let error;
    try { for (;;) { const entry = dir.readSync(); if (!entry) break; assert(++visited <= LIMITS.entries, "generated entries budget exceeded"); const name = relative(prefix ? `${prefix}/${entry.name}` : entry.name), filename = path.join(root, name), stat = fs.lstatSync(filename); if (stat.isDirectory() && !stat.isSymbolicLink()) visit(filename, name); else { assert(files.length < LIMITS.files, "generated file count budget exceeded"); const value = regular(filename, LIMITS.file, false, budget); files.push({ path: name, bytes: value.bytes, sha256: value.sha256 }); } } } catch (caught) { error = caught; }
    try { dir.closeSync(); } catch (caught) { if (error) throw new AggregateError([error, caught], "Generated inventory and close failed"); throw caught; } if (error) throw error;
  }
  visit(root, ""); assert(files.length > 0, "generated inventory is empty"); files.sort((a, b) => order(a.path, b.path)); return freeze({ files, digestSha256: digest(encode(files)) });
}
function generatedFingerprint(root) {
  const frontend = path.join(root, "web-ui/dist"), runtime = path.join(root, "src-tauri/resources/runtime");
  ancestors(root, path.join(frontend, ".boundary")); ancestors(root, path.join(runtime, ".boundary"));
  return freeze({ frontend: treeFingerprint(frontend), runtime: treeFingerprint(runtime) });
}
function artifact(snapshot) {
  assert(snapshot.platform === "darwin" && snapshot.plist && snapshot.expectedVersion === snapshot.appVersion, "unsupported or mismatched installed artifact");
  return { executableSha256: snapshot.executableSha256, manifestSha256: snapshot.manifestSha256, payloadInventorySha256: snapshot.payloadInventorySha256, payloadBytes: snapshot.payloadBytes, node: snapshot.node, server: snapshot.server, plistSha256: snapshot.plist.sha256 };
}
function matchingRuntime(generated, snapshot) {
  const expected = [...snapshot.payload, { path: "runtime-manifest.json", bytes: fs.lstatSync(snapshot.manifestPath).size, sha256: snapshot.manifestSha256 }].sort((a, b) => order(a.path, b.path));
  assert(encode(generated.runtime.files) === encode(expected), "staged runtime differs from installed payload");
}
/** Mint only following a workflow-owned successful controlled Cargo build. */
export function recordBuildProof({ repoRoot, proofPath, snapshot, inputs, build }) {
  const ownedBuild = builds.get(build);
  assert(ownedBuild?.inputs === inputs && sources.has(inputs) && rootDirectory(repoRoot) === inputs.root, "successful controlled build token required");
  assert(outputIdentity(realDirectory(build.outputDirectory)) === ownedBuild.outputProof, "controlled output directory identity/permissions changed");
  verifyInstalledInputs(ownedBuild.snapshot);
  assert(snapshot.root === build.installRoot && snapshot.executable === build.executable && encode(artifact(snapshot)) === encode(artifact(ownedBuild.snapshot)), "mint requires this controlled build's actual app artifacts");
  verifyBuildInputs(inputs); verifyInstalledInputs(snapshot);
  assert(snapshot.platform === process.platform && snapshot.arch === process.arch && snapshot.appVersion === inputs.version, "build artifact version/platform/architecture mismatch");
  const generated = generatedFingerprint(inputs.root); matchingRuntime(generated, snapshot);
  const proof = { kind: "phoenix.desk.tauri-controlled-build", schemaVersion: 1, profileVersion: 1, isolatedLaunchVersion: 1, appVersion: inputs.version, platform: snapshot.platform, arch: snapshot.arch,
    source: { files: inputs.files, digestSha256: inputs.digestSha256, sourceDirtyAllowed: true }, generated,
    build: { command: build.command, args: build.args, exitCode: 0, externalTargetDirectory: true }, artifact: artifact(snapshot) };
  const bytes = Buffer.from(encode(proof)); assert(bytes.length <= LIMITS.json, "proof exceeds JSON budget");
  const target = absolute(proofPath), parent = rootDirectory(path.dirname(target)); assert(path.dirname(target) === parent, "proof parent must be canonical");
  verifyBuildInputs(inputs); verifyInstalledInputs(snapshot); assert(encode(generatedFingerprint(inputs.root)) === encode(generated), "generated inputs changed before proof");
  assert(outputIdentity(realDirectory(build.outputDirectory)) === ownedBuild.outputProof, "controlled output directory identity/permissions changed");
  const fd = fs.openSync(target, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW || 0), 0o600); let error;
  try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } catch (caught) { error = caught; }
  try { fs.closeSync(fd); } catch (caught) { if (error) throw new AggregateError([error, caught], "Proof write and close failed"); throw caught; } if (error) throw error;
  return verifyBuildProof({ repoRoot, proofPath: target, snapshot });
}
function inventory(value, label) {
  record(value, ["files", "digestSha256"], label); sha(value.digestSha256); assert(Array.isArray(value.files) && value.files.length > 0 && value.files.length <= LIMITS.files, "invalid inventory count");
  let prior = "", total = 0; const seen = new Set();
  for (const file of value.files) { record(file, ["path", "bytes", "sha256"], "inventory file"); relative(file.path); sha(file.sha256); assert(Number.isSafeInteger(file.bytes) && file.bytes >= 0 && file.bytes <= LIMITS.file, "invalid file byte count"); total += file.bytes; assert(total <= LIMITS.total, "inventory byte budget exceeded"); const key = file.path.normalize("NFC").toLowerCase(); assert(!seen.has(key), "duplicate inventory path"); seen.add(key); if (prior) assert(order(prior, file.path) < 0, "inventory is not sorted"); prior = file.path; }
  assert(digest(encode(value.files)) === value.digestSha256, "inventory digest mismatch");
}
/** Verify transport hashes against the currently selected real installation and source. */
export function verifyBuildProof({ repoRoot, proofPath, snapshot }) {
  verifyInstalledInputs(snapshot); const current = sourceFingerprint(repoRoot);
  const target = absolute(proofPath), parent = rootDirectory(path.dirname(target)); assert(parent === path.dirname(target), "proof parent must be canonical");
  const bytes = regular(target, LIMITS.json, true), proof = json(bytes.content);
  record(proof, ["kind", "schemaVersion", "profileVersion", "isolatedLaunchVersion", "appVersion", "platform", "arch", "source", "generated", "build", "artifact"], "proof");
  assert(proof.kind === "phoenix.desk.tauri-controlled-build" && proof.schemaVersion === 1 && proof.profileVersion === 1 && proof.isolatedLaunchVersion === 1, "unsupported build proof profile");
  assert(proof.platform === "darwin" && proof.platform === process.platform && proof.platform === snapshot.platform && proof.arch === process.arch && proof.arch === snapshot.arch && proof.appVersion === current.version && proof.appVersion === snapshot.appVersion, "proof version/platform/architecture mismatch");
  record(proof.source, ["files", "digestSha256", "sourceDirtyAllowed"], "source"); assert(proof.source.sourceDirtyAllowed === true && encode(proof.source.files) === encode(current.files) && proof.source.digestSha256 === current.digestSha256, "source proof mismatch");
  record(proof.generated, ["frontend", "runtime"], "generated"); inventory(proof.generated.frontend, "frontend"); inventory(proof.generated.runtime, "runtime");
  assert(encode(proof.generated) === encode(generatedFingerprint(current.root)), "generated proof mismatch"); matchingRuntime(proof.generated, snapshot);
  record(proof.build, ["command", "args", "exitCode", "externalTargetDirectory"], "build"); assert(proof.build.command === "cargo" && encode(proof.build.args) === encode(CONTROLLED_CARGO_ARGS) && proof.build.exitCode === 0 && proof.build.externalTargetDirectory === true, "unsupported controlled build command");
  record(proof.artifact, ["executableSha256", "manifestSha256", "payloadInventorySha256", "payloadBytes", "node", "server", "plistSha256"], "artifact"); assert(encode(proof.artifact) === encode(artifact(snapshot)), "artifact proof mismatch");
  verifyInstalledInputs(snapshot); assert(encode(sourceFingerprint(current.root)) === encode(current), "source changed during proof verification");
  return freeze({ proofSha256: bytes.sha256, profileVersion: 1, isolatedLaunchVersion: 1, appVersion: proof.appVersion, platform: proof.platform, arch: proof.arch, sourceDigestSha256: current.digestSha256 });
}
