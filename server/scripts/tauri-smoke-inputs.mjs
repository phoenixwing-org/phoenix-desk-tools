import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const LIMITS = Object.freeze({ manifest: 1024 * 1024, files: 4096, entries: 8192, file: 256 * 1024 * 1024, total: 1024 * 1024 * 1024 });
const snapshots = new WeakMap();
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const fail = message => { throw new Error(`Installed input verification: ${message}`); };
const assert = (condition, message) => { if (!condition) fail(message); };
const order = (left, right) => left < right ? -1 : left > right ? 1 : 0;

function absolute(value, label) {
  assert(typeof value === "string" && value.length > 0 && !/[\u0000-\u001f]/u.test(value) && path.isAbsolute(value), `${label} must be an absolute path`);
  return path.resolve(value);
}

function relativeName(value, label) {
  assert(typeof value === "string" && value.length > 0 && value.length <= 1024, `${label} must be a bounded relative path`);
  assert(!/[\\:\u0000-\u001f]/u.test(value) && !value.startsWith("/") && !value.endsWith("/"), `${label} contains an unsafe path`);
  const segments = value.split("/");
  assert(segments.length <= 64 && segments.every(segment => segment && segment !== "." && segment !== ".."), `${label} contains path escape, excessive depth or empty components`);
  assert(segments.every(segment => !/[. ]$/u.test(segment) && !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(segment)), `${label} contains a nonportable filename`);
  return value;
}

function fingerprint(stat) {
  return `${stat.dev}:${stat.ino}:${stat.mode}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`;
}

function directory(filename, identities) {
  const stat = fs.lstatSync(filename, { bigint: true });
  assert(stat.isDirectory() && !stat.isSymbolicLink(), `directory is not a real directory: ${filename}`);
  identities.set(filename, fingerprint(stat));
}

function contained(root, candidate, label) {
  const relative = path.relative(root, candidate);
  assert(relative && !path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`), `${label} is outside installRoot`);
  return relative;
}

function ancestors(root, filename, identities) {
  const segments = contained(root, filename, "input").split(path.sep);
  let current = root;
  for (const segment of segments.slice(0, -1)) { current = path.join(current, segment); directory(current, identities); }
}

// No executable is run. Stream bounded regular files through a verified FD;
// this is observational integrity, not a lock against hostile external writers.
function readRegular(filename, budget, identities, capture = false, maximum = LIMITS.file) {
  const before = fs.lstatSync(filename, { bigint: true });
  assert(before.isFile() && !before.isSymbolicLink(), `input is not a regular non-symlink file: ${filename}`);
  assert(before.size <= BigInt(maximum), `file exceeds byte budget: ${filename}`);
  budget.bytes += Number(before.size);
  assert(budget.bytes <= LIMITS.total, "inputs exceed total byte budget");
  const fd = fs.openSync(filename, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0) | (fs.constants.O_NONBLOCK || 0));
  let result, original;
  try {
    const opened = fs.fstatSync(fd, { bigint: true });
    assert(opened.isFile() && fingerprint(before) === fingerprint(opened), `input changed while opening: ${filename}`);
    const digest = createHash("sha256"), buffer = Buffer.alloc(64 * 1024), chunks = [];
    let bytes = 0;
    for (;;) {
      const length = fs.readSync(fd, buffer, 0, buffer.length, null);
      if (!length) break;
      bytes += length;
      assert(bytes <= Number(opened.size) && bytes <= maximum, `input grew while reading: ${filename}`);
      digest.update(buffer.subarray(0, length));
      if (capture) chunks.push(Buffer.from(buffer.subarray(0, length)));
    }
    const after = fs.fstatSync(fd, { bigint: true }), named = fs.lstatSync(filename, { bigint: true });
    assert(bytes === Number(opened.size) && fingerprint(opened) === fingerprint(after) && fingerprint(after) === fingerprint(named), `input changed while reading: ${filename}`);
    identities.set(filename, fingerprint(after));
    result = { bytes, sha256: digest.digest("hex"), ...(capture ? { content: Buffer.concat(chunks) } : {}) };
  } catch (error) { original = error; }
  try { fs.closeSync(fd); } catch (closeError) {
    if (original) throw new AggregateError([original, closeError], "Input read and FD close failed");
    throw closeError;
  }
  if (original) throw original;
  return result;
}

function record(value, keys, label) {
  assert(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object`);
  assert(Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key)), `${label} has missing or extra fields`);
}

function sha(value, label) { assert(typeof value === "string" && /^[a-f0-9]{64}$/u.test(value), `${label} must be a lowercase SHA-256`); }

function parseManifest(bytes) {
  let text;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { fail("manifest is not valid UTF-8"); }
  // Bounded lexical preflight. JSON.parse remains the syntax parser. Detect
  // duplicate decoded keys, not merely identical escape spellings.
  const stack = []; let tokens = 0;
  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    if (character === '"') {
      let end = index + 1;
      for (; end < text.length; end++) { if (text[end] === "\\") end++; else if (text[end] === '"') break; }
      assert(end < text.length, "manifest contains an unterminated string");
      let value; try { value = JSON.parse(text.slice(index, end + 1)); } catch { fail("manifest contains an invalid string"); }
      assert(value.length <= 2048, "manifest string exceeds budget");
      let next = end + 1; while (/\s/u.test(text[next] || "") && next < text.length) next++;
      if (text[next] === ":") {
        const object = stack.at(-1);
        assert(object?.kind === "{", "manifest has an invalid object key");
        assert(!object.keys.has(value), "manifest contains duplicate JSON keys"); object.keys.add(value);
      }
      index = end; tokens++;
    } else if (character === "{" || character === "[") {
      stack.push({ kind: character, keys: new Set() }); tokens++;
      assert(stack.length <= 16, "manifest nesting exceeds budget");
    } else if (character === "}" || character === "]") {
      assert(stack.pop()?.kind === (character === "}" ? "{" : "["), "manifest has mismatched delimiters");
    } else if (character === "," || character === ":") tokens++;
    assert(tokens <= 65536, "manifest tokens exceed budget");
  }
  assert(stack.length === 0, "manifest is incomplete");
  let manifest; try { manifest = JSON.parse(text); } catch { fail("manifest is not valid JSON"); }
  // Old schema-1 packages without files are unsupported, not repaired from the
  // same untrusted installation being checked.
  assert(Array.isArray(manifest?.files) && manifest.files.length > 0, "legacy manifest lacks a complete nonempty files inventory");
  record(manifest, ["schema_version", "generated_at", "platform", "arch", "node", "server", "workspace_schema", "files"], "manifest");
  assert(manifest.schema_version === 1, "unsupported runtime manifest schema");
  assert(typeof manifest.generated_at === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(manifest.generated_at) && Number.isFinite(Date.parse(manifest.generated_at)), "manifest generated_at is invalid");
  assert(manifest.files.length <= LIMITS.files, "manifest file count exceeds budget");
  record(manifest.node, ["version", "filename", "sha256"], "manifest.node");
  record(manifest.server, ["filename", "sha256"], "manifest.server");
  assert(typeof manifest.node.version === "string" && /^v\d+\.\d+\.\d+$/u.test(manifest.node.version), "manifest Node version is invalid");
  sha(manifest.node.sha256, "manifest.node.sha256"); sha(manifest.server.sha256, "manifest.server.sha256");
  record(manifest.workspace_schema, ["schema_id", "schema_version", "ddl_sha256", "database_filename"], "workspace schema");
  assert(manifest.workspace_schema.schema_id === "phoenix-workspace" && manifest.workspace_schema.schema_version === 13 && manifest.workspace_schema.database_filename === "phoenix-workspace.sqlite", "unsupported workspace schema metadata");
  sha(manifest.workspace_schema.ddl_sha256, "workspace schema DDL SHA");
  const seen = new Set(), expected = new Map();
  for (const entry of manifest.files) {
    record(entry, ["path", "bytes", "sha256"], "payload entry"); const name = relativeName(entry.path, "payload path");
    assert(name !== "runtime-manifest.json", "manifest cannot list itself as payload");
    const collision = name.normalize("NFC").toLowerCase();
    assert(!seen.has(collision), "manifest contains duplicate/colliding payload paths"); seen.add(collision);
    assert(Number.isSafeInteger(entry.bytes) && entry.bytes >= 0 && entry.bytes <= LIMITS.file, "payload size exceeds budget or is invalid"); sha(entry.sha256, "payload SHA");
    expected.set(name, entry);
  }
  return { manifest, expected };
}

function runtimeInventory(root, expected, budget, identities) {
  const rows = [], requiredDirectories = new Set([""]); let visited = 0;
  for (const name of expected.keys()) { const pieces = name.split("/"); for (let n = 1; n < pieces.length; n++) requiredDirectories.add(pieces.slice(0, n).join("/")); }
  function visit(relative) {
    const filename = path.join(root, relative); directory(filename, identities);
    const dir = fs.opendirSync(filename); let original;
    try {
      for (;;) {
        const entry = dir.readSync(); if (!entry) break;
        assert(++visited <= LIMITS.entries, "runtime directory entries exceed budget");
        const name = relative ? `${relative}/${entry.name}` : entry.name;
        relativeName(name, "actual payload path");
        const candidate = path.join(root, name), stat = fs.lstatSync(candidate, { bigint: true });
        assert(!stat.isSymbolicLink(), `runtime symlink is forbidden: ${name}`);
        if (stat.isDirectory()) { assert(requiredDirectories.has(name), `extra runtime directory: ${name}`); visit(name); }
        else if (stat.isFile()) {
          if (name === "runtime-manifest.json") continue;
          assert(expected.has(name), `extra runtime file: ${name}`);
          const actual = readRegular(candidate, budget, identities), wanted = expected.get(name);
          assert(actual.bytes === wanted.bytes && actual.sha256 === wanted.sha256, `runtime size/hash mismatch: ${name}`);
          rows.push({ path: name, bytes: actual.bytes, sha256: actual.sha256 });
        } else fail(`runtime input is not a regular file/directory: ${name}`);
      }
    } catch (error) { original = error; }
    try { dir.closeSync(); } catch (closeError) {
      if (original) throw new AggregateError([original, closeError], "Runtime inventory and directory close failed");
      throw closeError;
    }
    if (original) throw original;
  }
  visit(""); assert(rows.length === expected.size, "runtime payload file is missing");
  return rows.sort((left, right) => order(left.path, right.path));
}

function assertIdentities(identities) {
  for (const [filename, expected] of identities) {
    const actual = fs.lstatSync(filename, { bigint: true });
    assert(!actual.isSymbolicLink() && fingerprint(actual) === expected, `input identity/stat changed: ${filename}`);
  }
}

function capture(options) {
  assert(options && typeof options === "object", "input options are missing");
  const { expectedVersion, appVersion, platform, arch } = options;
  assert(typeof expectedVersion === "string" && /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(expectedVersion), "expected version is invalid");
  assert(appVersion === expectedVersion, "installed app version does not match source package version");
  assert(platform === "darwin" || platform === "win32", "unsupported installation platform");
  assert(typeof arch === "string" && ["arm64", "x64", "ia32"].includes(arch), "unsupported installation architecture");
  const requestedRoot = absolute(options.installRoot, "installRoot"), identities = new Map(), budget = { bytes: 0 };
  directory(requestedRoot, new Map());
  const root = fs.realpathSync(requestedRoot); directory(root, identities);
  const requestedExecutable = absolute(options.executable, "executable");
  let executableRelative;
  try { executableRelative = contained(requestedRoot, requestedExecutable, "executable"); }
  catch { executableRelative = contained(root, requestedExecutable, "executable"); }
  const executable = path.join(root, executableRelative); ancestors(root, executable, identities);
  const executableRecord = readRegular(executable, budget, identities);
  const runtimeDirectory = path.join(root, platform === "darwin" ? "Contents/Resources/runtime" : "runtime");
  const manifestPath = path.join(runtimeDirectory, "runtime-manifest.json"); ancestors(root, manifestPath, identities);
  let plist = null;
  if (platform === "darwin") {
    const plistPath = path.join(root, "Contents/Info.plist"); ancestors(root, plistPath, identities);
    const actual = readRegular(plistPath, budget, identities, false, LIMITS.manifest);
    plist = Object.freeze({ path: plistPath, sha256: actual.sha256 });
    assert(path.relative(root, executable).split(path.sep).slice(0, -1).join("/") === "Contents/MacOS", "macOS executable must be in actual installRoot/Contents/MacOS");
  }
  const manifestRecord = readRegular(manifestPath, budget, identities, true, LIMITS.manifest);
  const { manifest, expected } = parseManifest(manifestRecord.content);
  assert(manifest.platform === platform && manifest.arch === arch, "runtime platform/architecture does not match current target");
  assert(manifest.node.filename === (platform === "win32" ? "node.exe" : "node") && manifest.server.filename === "server.mjs", "runtime Node/server filenames are invalid");
  for (const [name, declared] of [[`node/${manifest.node.filename}`, manifest.node], [`server/${manifest.server.filename}`, manifest.server]]) {
    assert(expected.has(name) && expected.get(name).sha256 === declared.sha256, `Node/server record disagrees with complete payload: ${name}`);
  }
  const payload = runtimeInventory(runtimeDirectory, expected, budget, identities);
  assertIdentities(identities);
  const snapshot = Object.freeze({ root, executable, runtimeDirectory, manifestPath, expectedVersion, appVersion, platform, arch,
    executableSha256: executableRecord.sha256, manifestSha256: manifestRecord.sha256,
    payloadInventorySha256: hash(`${JSON.stringify(payload)}\n`), payload: Object.freeze(payload.map(entry => Object.freeze(entry))),
    node: Object.freeze({ ...manifest.node }), server: Object.freeze({ ...manifest.server }), plist,
    payloadBytes: payload.reduce((bytes, entry) => bytes + entry.bytes, 0),
  });
  return { snapshot, identities };
}

/**
 * Freeze actual installed inputs without spawning, executing or modifying them.
 * appVersion must be read by the caller from this installation's metadata.
 * Caller must first reconcile package/tauri/Cargo versions. The manifest is a
 * self-consistency proof, not a build-origin signature. Runtime extras are
 * refused; unrelated platform signature/icon files outside runtime are not
 * claimed to be described by its payload inventory.
 * @param {import("./tauri-smoke-inputs.mjs").InstalledInputsOptions} options
 * @returns {import("./tauri-smoke-inputs.mjs").InstalledInputsSnapshot}
 */
export function freezeInstalledInputs(options) {
  const captured = capture(options);
  snapshots.set(captured.snapshot, captured.identities);
  return captured.snapshot;
}

/** Re-hash immediately before launch and receipt. No filesystem-wide lock is claimed.
 * @param {import("./tauri-smoke-inputs.mjs").InstalledInputsSnapshot} snapshot
 * @returns {void}
 */
export function verifyInstalledInputs(snapshot) {
  const identities = snapshots.get(snapshot);
  assert(identities, "snapshot is not a server-owned frozen input");
  assertIdentities(identities);
  const current = capture({ installRoot: snapshot.root, executable: snapshot.executable, expectedVersion: snapshot.expectedVersion,
    appVersion: snapshot.appVersion, platform: snapshot.platform, arch: snapshot.arch });
  assert(JSON.stringify(current.snapshot) === JSON.stringify(snapshot), "installed inputs changed since freeze");
  assert(current.identities.size === identities.size, "installed input inventory changed since freeze");
  for (const [filename, expected] of identities) assert(current.identities.get(filename) === expected, `installed identity changed since freeze: ${filename}`);
}
