import childProcess from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import vm from "node:vm";
import ts from "typescript";
import { afterEach, describe, expect, it, vi } from "vitest";
import { captureBuildInputs, CONTROLLED_CARGO_ARGS, CONTROLLED_TAURI_CONFIG, recordBuildProof, runControlledCargoBuild, verifyBuildInputs, verifyBuildProof, type BuildInputs, type ControlledBuild } from "./tauri-smoke-build-proof.mjs";
import { freezeInstalledInputs, type InstalledInputsSnapshot } from "./tauri-smoke-inputs.mjs";

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
// Only five public, audited native/hook/smoke implementations are copied, to exercise
// the real production profile allowlist. All data/config/artifacts below are
// independently constructed; no CAD/project fixture or real app is executed.
const auditedPaths = ["src-tauri/src/lib.rs", "src-tauri/src/isolated_smoke.rs", "server/scripts/smoke-workspace-recovery.mjs", "server/scripts/workspace-recovery-journey.mjs", "scripts/build-tauri-isolated-runtime.mjs"];
const auditedSource = new Map(auditedPaths.map(name => [name, fs.readFileSync(path.join(repository, name))]));
const owned: string[] = [], originalPlatform = Object.getOwnPropertyDescriptor(process, "platform")!;
const digest = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");
const write = (filename: string, bytes: Buffer | string) => { fs.mkdirSync(path.dirname(filename), { recursive: true }); fs.writeFileSync(filename, bytes); };
function fixture() {
  const parent = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "controlled-build-contract-"))); owned.push(parent);
  const repo = path.join(parent, "source"), output = path.join(parent, "owned-output"), template = path.join(parent, "independent-template"); fs.mkdirSync(output, { mode: 0o700 });
  const install = path.join(output, "cargo-target/release/bundle/macos/Independent Shell.app");
  write(path.join(repo, "package.json"), JSON.stringify({ name: "independent-build-contract", version: "1.2.3" }));
  write(path.join(repo, "src-tauri/Cargo.toml"), '[package]\nname = "independent-shell"\nversion = "1.2.3"\n\n[lib]\nname = "independent_shell"\n');
  write(path.join(repo, "src-tauri/Cargo.lock"), "# independent lock\nversion = 4\n");
  write(path.join(repo, "src-tauri/build.rs"), "fn main() {}\n"); write(path.join(repo, "src-tauri/src/main.rs"), "fn main() {}\n");
  write(path.join(repo, "src-tauri/tauri.conf.json"), JSON.stringify({ productName: "Independent Shell", version: "1.2.3", build: { beforeBuildCommand: "pnpm build && pnpm build:tauri-runtime", frontendDist: "../web-ui/dist" } }));
  for (const [name, bytes] of auditedSource) write(path.join(repo, name), bytes);
  const templateRuntime = path.join(template, "Contents/Resources/runtime"), runtime = path.join(install, "Contents/Resources/runtime"), executable = path.join(install, "Contents/MacOS/phoenix-desktop");
  write(path.join(template, "Contents/MacOS/phoenix-desktop"), "independent executable bytes; never executed"); write(path.join(template, "Contents/Info.plist"), "independent plist; version read by caller");
  const entries = [["node/node", "independent node bytes"], ["server/server.mjs", "independent server bytes"], ["scripts/adapter.py", "# independent adapter"]].map(([name, bytes]) => {
    write(path.join(templateRuntime, name), bytes); return { path: name, bytes: Buffer.byteLength(bytes), sha256: digest(bytes) };
  });
  const manifest = { schema_version: 1, generated_at: "2026-01-01T00:00:00.000Z", platform: "darwin", arch: process.arch,
    node: { version: "v22.0.0", filename: "node", sha256: entries[0].sha256 }, server: { filename: "server.mjs", sha256: entries[1].sha256 },
    workspace_schema: { schema_id: "phoenix-workspace", schema_version: 13, ddl_sha256: "a".repeat(64), database_filename: "phoenix-workspace.sqlite" }, files: entries };
  write(path.join(templateRuntime, "runtime-manifest.json"), `${JSON.stringify(manifest)}\n`);
  const staged = path.join(repo, "src-tauri/resources/runtime"); fs.cpSync(templateRuntime, staged, { recursive: true }); write(path.join(repo, "web-ui/dist/index.html"), "<main>Independent test</main>");
  const options = { installRoot: install, executable, expectedVersion: "1.2.3", appVersion: "1.2.3", platform: "darwin" as const, arch: process.arch as "arm64" | "x64" };
  const proofPath = path.join(parent, "proof.json");
  const source = () => captureBuildInputs(repo), snapshot = () => freezeInstalledInputs(fs.existsSync(install) ? options : { ...options, installRoot: template, executable: path.join(template, "Contents/MacOS/phoenix-desktop") });
  const cargo = () => vi.spyOn(childProcess, "spawnSync").mockImplementation(command => {
    if (command === "cargo") fs.cpSync(template, install, { recursive: true });
    return { pid: 10, output: [], stdout: command === "/usr/bin/plutil" ? "1.2.3\n" : Buffer.alloc(0), stderr: Buffer.alloc(0), status: 0, signal: null };
  });
  const prepare = () => { cargo(); const inputs = source(), build = runControlledCargoBuild(inputs, output), frozen = snapshot(); recordBuildProof({ repoRoot: repo, proofPath, snapshot: frozen, inputs, build }); return { inputs, build, snapshot: frozen }; };
  const mutateProof = (fn: (value: Record<string, unknown>) => void) => { const value = JSON.parse(fs.readFileSync(proofPath, "utf8")) as Record<string, unknown>; fn(value); write(proofPath, `${JSON.stringify(value)}\n`); };
  return { parent, repo, output, template, install, runtime, staged, executable, options, proofPath, source, snapshot, cargo, prepare, mutateProof };
}
afterEach(() => { vi.restoreAllMocks(); Object.defineProperty(process, "platform", originalPlatform); for (const directory of owned.splice(0)) fs.rmSync(directory, { recursive: true, force: true }); });

const hookPath = path.join(repository, "scripts/build-tauri-isolated-runtime.mjs");
const hookText = fs.readFileSync(hookPath, "utf8");
const hookTree = ts.createSourceFile("isolated-hook.mjs", hookText, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
function astNodes<T extends ts.Node>(root: ts.Node, guard: (node: ts.Node) => node is T): T[] {
  const found: T[] = []; const visit = (node: ts.Node) => { if (guard(node)) found.push(node); ts.forEachChild(node, visit); }; visit(root); return found;
}
// Execute the actual hook's compiled statements with only spawnSync mocked.
// No build, CLI, HTTP transport or application is executed by these tests.
const executableHook = ts.transpileModule(hookText, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  transformers: { before: [context => source => {
    const visit: ts.Visitor = node => ts.isPropertyAccessExpression(node) && ts.isMetaProperty(node.expression) && node.name.text === "url"
      ? context.factory.createStringLiteral(pathToFileURL(hookPath).href) : ts.visitEachChild(node, visit, context);
    return ts.visitNode(source, visit) as ts.SourceFile;
  }] },
}).outputText;
function runHook(options: { failAt?: number; signal?: boolean; spawnError?: boolean; platform?: string; extraArg?: boolean } = {}) {
  const calls: { command: string; args: string[]; options: childProcess.SpawnSyncOptions }[] = [];
  const environment = { HOME: process.env.HOME, PATH: process.env.PATH, LANG: "C", LC_TEST: "independent-locale", NODE_OPTIONS: "forbidden-loader", PHOENIX_WING_ROOT: "forbidden-local", PHOENIX_LEGACY_USER_DATA_DIR: "forbidden-data", PRIVATE_TOKEN: "forbidden-secret", CARGO_TARGET_DIR: "forbidden-target", APPDATA: "forbidden-profile" };
  let error: unknown;
  try {
    vm.runInNewContext(executableHook, { exports: {}, process: { platform: options.platform || "darwin", argv: [process.execPath, hookPath, ...(options.extraArg ? ["unexpected"] : [])], execPath: process.execPath, env: environment }, require: (name: string) => {
      if (name === "node:path") return path; if (name === "node:url") return { fileURLToPath };
      if (name !== "node:child_process") throw new Error(`unapproved hook import: ${name}`);
      return { spawnSync: (command: string, args: string[], childOptions: childProcess.SpawnSyncOptions) => {
        calls.push({ command, args: [...args], options: childOptions });
        return { status: options.failAt === calls.length ? (options.signal ? null : 1) : 0, signal: options.failAt === calls.length && options.signal ? "SIGTERM" : null, ...(options.failAt === calls.length && options.spawnError ? { error: new Error("independent spawn error") } : {}) };
      } };
    } }, { timeout: 1000 });
  } catch (caught) { error = caught; }
  return { calls, error, environment };
}

describe("isolated native beforeBuild hook wiring (mock spawn only)", () => {
  it("parses five fixed steps and the sole spawn as explicit shellfalse with controlled environment", () => {
    const plan = astNodes(hookTree, ts.isVariableDeclaration).find(node => ts.isIdentifier(node.name) && node.name.text === "steps")?.initializer;
    expect(plan && ts.isArrayLiteralExpression(plan) && plan.elements.length).toBe(5);
    const spawn = astNodes(hookTree, ts.isCallExpression).filter(call => call.expression.getText(hookTree) === "childProcess.spawnSync"); expect(spawn).toHaveLength(1);
    const options = spawn[0].arguments[2]; expect(ts.isObjectLiteralExpression(options)).toBe(true);
    if (!ts.isObjectLiteralExpression(options)) throw new Error("literal spawn options required");
    const properties = new Map(options.properties.filter(ts.isPropertyAssignment).map(property => [property.name.getText(hookTree), property.initializer.getText(hookTree)]));
    expect(properties.get("shell")).toBe("false"); expect(properties.get("env")).toBe("environment"); expect(properties.get("cwd")).toBe("root");
    const imports = hookTree.statements.filter(ts.isImportDeclaration).map(node => (node.moduleSpecifier as ts.StringLiteral).text);
    expect(imports).toEqual(["node:child_process", "node:path", "node:url"]);
  });
  it("runs only the five safe steps in order, never the ordinary legacy smoke chain", () => {
    const { calls, error } = runHook(); expect(error).toBeUndefined(); expect(calls.map(call => [call.command, call.args])).toEqual([
      ["pnpm", ["build"]], ["pnpm", ["-C", "server", "build:bundle"]], [process.execPath, ["server/scripts/smoke-workspace-recovery.mjs", "bundle"]],
      ["pnpm", ["-C", "server", "prepare:tauri-runtime"]], [process.execPath, ["server/scripts/smoke-workspace-recovery.mjs", "runtime"]],
    ]);
    for (const call of calls) { expect(call.options.cwd).toBe(repository); expect(call.options.shell).toBe(false); expect(call.options.timeout).toBe(30 * 60 * 1000); expect(call.options.stdio).toBe("inherit"); }
  });
  it("projects only clean OS environment and Registry mode separately for every child", () => {
    const { calls, error, environment } = runHook(); expect(error).toBeUndefined(); expect(calls).toHaveLength(5);
    for (const call of calls) expect(call.options.env).toEqual({ HOME: environment.HOME, PATH: environment.PATH, LANG: "C", LC_TEST: "independent-locale", PHOENIX_WING_MODE: "registry" });
  });
  it.each([1, 2, 3, 4, 5])("stops immediately at failing step %s without running later steps", failAt => {
    const result = runHook({ failAt }); expect(String(result.error)).toContain("isolated runtime step failed"); expect(result.calls).toHaveLength(failAt);
  });
  it.each(["signal", "spawnError"] as const)("stops on non-successful child %s without a later command", kind => {
    const result = runHook({ failAt: 2, [kind]: true }); expect(result.error).toBeDefined(); expect(result.calls).toHaveLength(2);
  });
  it.each(["unsupported-platform", "unexpected-argument"])("refuses %s before any child command", kind => {
    const result = runHook(kind === "unsupported-platform" ? { platform: "win32" } : { extraArg: true }); expect(result.error).toBeDefined(); expect(result.calls).toHaveLength(0);
  });
});

describe("controlled local native build proof", () => {
  it("captures eleven source inputs including audited safe hook and explicit dirty allowance without executing anything", () => {
    const file = fixture(), spawn = file.cargo(), inputs = file.source(); expect(inputs.files).toHaveLength(11); expect(inputs.files.map(entry => entry.path)).toEqual(["package.json", "src-tauri/Cargo.lock", "src-tauri/Cargo.toml", "src-tauri/build.rs", "src-tauri/tauri.conf.json", "src-tauri/src/main.rs", ...auditedPaths]); expect(inputs.sourceDirtyAllowed).toBe(true); expect(inputs.version).toBe("1.2.3");
    expect(inputs.digestSha256).toBe(digest(`${JSON.stringify(inputs.files)}\n`)); expect(Object.isFrozen(inputs)).toBe(true); verifyBuildInputs(inputs); expect(spawn).not.toHaveBeenCalled();
  });
  it("mints only after fixed controlled Cargo mock exit0, and rechecks real independent artifacts", () => {
    const file = fixture(), spawn = file.cargo(), inputs = file.source(), build = runControlledCargoBuild(inputs, file.output), snapshot = file.snapshot();
    expect(spawn).toHaveBeenCalledWith("cargo", [...CONTROLLED_CARGO_ARGS], expect.objectContaining({ cwd: file.repo, stdio: "inherit", env: expect.objectContaining({ CARGO_TARGET_DIR: path.join(file.output, "cargo-target"), CARGO_NET_OFFLINE: "true", PHOENIX_WING_MODE: "registry" }) }));
    const receipt = recordBuildProof({ repoRoot: file.repo, proofPath: file.proofPath, snapshot, inputs, build });
    expect(receipt).toEqual({ proofSha256: digest(fs.readFileSync(file.proofPath)), profileVersion: 1, isolatedLaunchVersion: 1, appVersion: "1.2.3", platform: "darwin", arch: process.arch, sourceDigestSha256: inputs.digestSha256 });
    expect(Object.isFrozen(receipt)).toBe(true); expect(verifyBuildProof({ repoRoot: file.repo, proofPath: file.proofPath, snapshot })).toEqual(receipt);
    expect(fs.readFileSync(file.proofPath, "utf8")).not.toContain(file.parent);
  });
  it("records the exact safe config override in fixed Cargo argv and proof without executing the original hook", () => {
    expect(CONTROLLED_TAURI_CONFIG).toBe('{"build":{"beforeBuildCommand":"node scripts/build-tauri-isolated-runtime.mjs"}}');
    expect(CONTROLLED_CARGO_ARGS).toEqual(["tauri", "build", "--bundles", "app", "--ci", "--no-sign", "--config", CONTROLLED_TAURI_CONFIG, "--", "--locked", "--offline"]);
    const file = fixture(), spawn = file.cargo(), inputs = file.source(), build = runControlledCargoBuild(inputs, file.output), snapshot = file.snapshot();
    expect(spawn.mock.calls[0][2]?.shell).toBe(false); recordBuildProof({ repoRoot: file.repo, proofPath: file.proofPath, snapshot, inputs, build });
    expect(JSON.parse(fs.readFileSync(file.proofPath, "utf8")).build.args).toEqual(CONTROLLED_CARGO_ARGS);
  });
  it.each(["beforeBuildCommand", "frontendDist"])("rejects unknown original config %s rather than treating override as permission", key => {
    const file = fixture(), config = path.join(file.repo, "src-tauri/tauri.conf.json"), value = JSON.parse(fs.readFileSync(config, "utf8")); value.build[key] = "independent-unsupported"; write(config, JSON.stringify(value));
    const spawn = file.cargo(); expect(file.source).toThrow("unsupported native build layout"); expect(spawn).not.toHaveBeenCalled();
  });
  it.each(auditedPaths.slice(2))("rejects unknown audited hook/smoke source %s before Cargo", name => {
    const file = fixture(), spawn = file.cargo(); write(path.join(file.repo, name), "independent unapproved source bytes"); expect(file.source).toThrow("unsupported-profile"); expect(spawn).not.toHaveBeenCalled();
  });
  it.each(auditedPaths.slice(2))("rejects audited hook/smoke mutation at Cargo completion %s", name => {
    const file = fixture(), inputs = file.source(), spawn = file.cargo(), implementation = spawn.getMockImplementation()!;
    spawn.mockImplementation((...args) => { const result = implementation(...args); if (args[0] === "cargo") write(path.join(file.repo, name), "independent changed hook bytes"); return result; });
    expect(() => runControlledCargoBuild(inputs, file.output)).toThrow("unsupported-profile"); expect(fs.existsSync(file.proofPath)).toBe(false);
  });
  it.each(["omitted-config", "old-chain", "unsafe-extra-config"])("rejects proof argv drift %s even when all artifacts match", kind => {
    const file = fixture(), { snapshot } = file.prepare(); file.mutateProof(value => {
      const build = value.build as { args: string[] };
      if (kind === "omitted-config") build.args = CONTROLLED_CARGO_ARGS.filter((_, index) => index !== 6 && index !== 7);
      else if (kind === "old-chain") build.args[7] = JSON.stringify({ build: { beforeBuildCommand: "pnpm build && pnpm build:tauri-runtime" } });
      else build.args.push("--config", "{}");
    }); expect(() => verifyBuildProof({ repoRoot: file.repo, proofPath: file.proofPath, snapshot })).toThrow("unsupported controlled build command");
  });
  it("does not inherit compiler injection, credentials or Wing local overrides, and retains genuine HOME", () => {
    const file = fixture(); vi.stubEnv("RUSTC_WRAPPER", "independent-forbidden"); vi.stubEnv("RUSTFLAGS", "independent-forbidden"); vi.stubEnv("NODE_OPTIONS", "independent-forbidden"); vi.stubEnv("PHOENIX_WING_ROOT", "independent-forbidden"); vi.stubEnv("PRIVATE_TOKEN", "independent-forbidden");
    try { const spawn = file.cargo(); runControlledCargoBuild(file.source(), file.output); const env = spawn.mock.calls[0][2]?.env; expect(env?.HOME).toBe(process.env.HOME); for (const key of ["RUSTC_WRAPPER", "RUSTFLAGS", "NODE_OPTIONS", "PHOENIX_WING_ROOT", "PRIVATE_TOKEN"]) expect(env).not.toHaveProperty(key); } finally { vi.unstubAllEnvs(); }
  });
  it.each(["lib.rs", "isolated_smoke.rs"])("refuses unknown native profile source even if the caller could hash it: %s", name => {
    const file = fixture(), spawn = file.cargo(); write(path.join(file.repo, "src-tauri/src", name), "independent unapproved native bytes"); expect(file.source).toThrow("unsupported-profile"); expect(spawn).not.toHaveBeenCalled();
  });
  it.each(["package", "Cargo", "tauri"])("refuses source version drift: %s", kind => {
    const file = fixture(); if (kind === "package") write(path.join(file.repo, "package.json"), '{"version":"1.2.4"}'); else if (kind === "Cargo") write(path.join(file.repo, "src-tauri/Cargo.toml"), '[package]\nversion = "1.2.4"\n'); else write(path.join(file.repo, "src-tauri/tauri.conf.json"), '{"version":"1.2.4"}'); expect(file.source).toThrow("version mismatch");
  });
  it("rejects clone build inputs and forged successful Cargo result without publishing proof", () => {
    const file = fixture(), inputs = file.source(), snapshot = file.snapshot(); expect(() => verifyBuildInputs({ ...inputs })).toThrow("workflow-owned");
    const build = { command: "cargo", args: [...CONTROLLED_CARGO_ARGS], exitCode: 0, outputDirectory: file.output, installRoot: file.template, executable: file.executable, appVersion: "1.2.3" } as ControlledBuild;
    expect(() => recordBuildProof({ repoRoot: file.repo, proofPath: file.proofPath, inputs, snapshot, build })).toThrow("token required"); expect(fs.existsSync(file.proofPath)).toBe(false);
  });
  it.each([1, null])("refuses controlled Cargo failure without creating a proof (exit %s)", status => {
    const file = fixture(), spawn = file.cargo(); spawn.mockReturnValue({ pid: 10, output: [], stdout: Buffer.alloc(0), stderr: Buffer.alloc(0), status, signal: status === null ? "SIGTERM" : null }); expect(() => runControlledCargoBuild(file.source(), file.output)).toThrow("did not exit 0"); expect(fs.existsSync(file.proofPath)).toBe(false);
  });
  it("refuses Windows before any native build or app probe", () => {
    const file = fixture(), inputs = file.source(), spawn = file.cargo(); Object.defineProperty(process, "platform", { ...originalPlatform, value: "win32" }); expect(() => runControlledCargoBuild(inputs, file.output)).toThrow("unsupported-profile"); expect(spawn).not.toHaveBeenCalled();
  });
  it.each(["inside", "containing", "nonempty", "public", "symlink"])("rejects unsafe Cargo target root: %s", kind => {
    const file = fixture(), inputs = file.source(), spawn = file.cargo(); let output = file.output;
    if (kind === "inside") { output = path.join(file.repo, "output"); fs.mkdirSync(output, { mode: 0o700 }); }
    else if (kind === "containing") output = file.parent;
    else if (kind === "nonempty") write(path.join(output, "keep"), "existing user output");
    else if (kind === "public") fs.chmodSync(output, 0o755);
    else { const old = path.join(file.parent, "real-output"); fs.renameSync(output, old); fs.symlinkSync(old, output, "dir"); }
    expect(() => runControlledCargoBuild(inputs, output)).toThrow(); expect(spawn).not.toHaveBeenCalled();
  });
  it("rejects source change at the actual mock build completion barrier", () => {
    const file = fixture(), inputs = file.source(); file.cargo().mockImplementation(() => { write(path.join(file.repo, "src-tauri/Cargo.lock"), "changed while building"); return { pid: 10, output: [], stdout: Buffer.alloc(0), stderr: Buffer.alloc(0), status: 0, signal: null }; });
    expect(() => runControlledCargoBuild(inputs, file.output)).toThrow("source inputs changed"); expect(fs.existsSync(file.proofPath)).toBe(false);
  });
  it("refuses no-replace proof publication and preserves existing bytes", () => {
    const file = fixture(); file.cargo(); const inputs = file.source(), build = runControlledCargoBuild(inputs, file.output), snapshot = file.snapshot(); write(file.proofPath, "existing owned evidence");
    expect(() => recordBuildProof({ repoRoot: file.repo, proofPath: file.proofPath, inputs, build, snapshot })).toThrow(); expect(fs.readFileSync(file.proofPath, "utf8")).toBe("existing owned evidence");
  });
  it("requires installed runtime to match the freshly generated runtime, not an unrelated old bundle", () => {
    const file = fixture(); file.cargo(); const inputs = file.source(), build = runControlledCargoBuild(inputs, file.output), snapshot = file.snapshot(); write(path.join(file.staged, "scripts/adapter.py"), "# unrelated staged bytes");
    expect(() => recordBuildProof({ repoRoot: file.repo, proofPath: file.proofPath, inputs, build, snapshot })).toThrow("staged runtime differs"); expect(fs.existsSync(file.proofPath)).toBe(false);
  });
  it.each(["source", "frontend", "runtime", "executable", "plist"])("refuses changes before final proof revalidation: %s", kind => {
    const file = fixture(), prepared = file.prepare(); const target = kind === "source" ? path.join(file.repo, "src-tauri/Cargo.lock") : kind === "frontend" ? path.join(file.repo, "web-ui/dist/index.html") : kind === "runtime" ? path.join(file.staged, "scripts/adapter.py") : kind === "executable" ? file.executable : path.join(file.install, "Contents/Info.plist");
    write(target, "changed independent bytes"); expect(() => verifyBuildProof({ repoRoot: file.repo, proofPath: file.proofPath, snapshot: prepared.snapshot })).toThrow();
  });
  it("accepts a byte-identical independently selected installation without binding a private installed-root path", () => {
    const file = fixture(); file.prepare(); const other = path.join(file.parent, "copied-installation"); fs.cpSync(file.install, other, { recursive: true });
    const snapshot = freezeInstalledInputs({ ...file.options, installRoot: other, executable: path.join(other, "Contents/MacOS/phoenix-desktop") }); expect(() => verifyBuildProof({ repoRoot: file.repo, proofPath: file.proofPath, snapshot })).not.toThrow();
  });
  it.each(["missing-profile", "wrong-kind", "wrong-version", "wrong-arch", "wrong-os", "wrong-command", "failed-build", "extra-field", "bad-inventory-sha", "escape", "duplicate", "bytes"])("rejects invalid proof DTO: %s", kind => {
    const file = fixture(), { snapshot } = file.prepare(); file.mutateProof(value => {
      if (kind === "missing-profile") delete value.profileVersion;
      else if (kind === "wrong-kind") value.kind = "unknown";
      else if (kind === "wrong-version") value.appVersion = "1.2.4";
      else if (kind === "wrong-arch") value.arch = "unknown";
      else if (kind === "wrong-os") value.platform = "win32";
      else if (kind === "extra-field") value.extra = true;
      else if (kind === "wrong-command" || kind === "failed-build") { const build = value.build as Record<string, unknown>; if (kind === "wrong-command") build.args = ["tauri", "build"]; else build.exitCode = 1; }
      else { const generated = value.generated as { frontend: { files: { path: string; bytes: number; sha256: string }[]; digestSha256: string } }; if (kind === "bad-inventory-sha") generated.frontend.digestSha256 = "b".repeat(64); else { const list = generated.frontend.files; if (kind === "escape") list[0].path = "../outside"; else if (kind === "duplicate") list.push({ ...list[0] }); else list[0].bytes = -1; generated.frontend.digestSha256 = digest(`${JSON.stringify(list)}\n`); } }
    }); expect(() => verifyBuildProof({ repoRoot: file.repo, proofPath: file.proofPath, snapshot })).toThrow();
  });
  it.each(["raw", "escaped"])("rejects duplicate decoded proof keys: %s", kind => {
    const file = fixture(), { snapshot } = file.prepare(), raw = fs.readFileSync(file.proofPath, "utf8"); write(file.proofPath, raw.replace('"schemaVersion":1', kind === "raw" ? '"schemaVersion":1,"schemaVersion":1' : '"schemaVersion":1,"schema\\u0056ersion":1'));
    expect(() => verifyBuildProof({ repoRoot: file.repo, proofPath: file.proofPath, snapshot })).toThrow("duplicate JSON key");
  });
  it.each(["symlink", "directory", "oversize", "utf8", "missing"])("rejects unsafe proof input before any app execution: %s", kind => {
    const file = fixture(), { snapshot } = file.prepare(); if (kind === "symlink") { fs.renameSync(file.proofPath, `${file.proofPath}.old`); fs.symlinkSync(`${file.proofPath}.old`, file.proofPath); } else if (kind === "directory") { fs.unlinkSync(file.proofPath); fs.mkdirSync(file.proofPath); } else if (kind === "oversize") write(file.proofPath, Buffer.alloc(1024 * 1024 + 1)); else if (kind === "utf8") write(file.proofPath, Buffer.from([255])); else fs.unlinkSync(file.proofPath);
    expect(() => verifyBuildProof({ repoRoot: file.repo, proofPath: file.proofPath, snapshot })).toThrow(); expect(childProcess.spawnSync).toHaveBeenCalledTimes(2);
  });
  it.each(["source", "generated-ancestor", "generated-file"])("rejects symlinked source/generation inputs: %s", kind => {
    const file = fixture(); if (kind === "source") { const target = path.join(file.repo, "src-tauri/Cargo.lock"); fs.renameSync(target, `${target}.old`); fs.symlinkSync(`${target}.old`, target); expect(file.source).toThrow(); }
    else { const { snapshot } = file.prepare(), target = kind === "generated-ancestor" ? path.join(file.repo, "web-ui") : path.join(file.repo, "web-ui/dist/index.html"); fs.renameSync(target, `${target}.old`); fs.symlinkSync(`${target}.old`, target, kind === "generated-ancestor" ? "dir" : "file"); expect(() => verifyBuildProof({ repoRoot: file.repo, proofPath: file.proofPath, snapshot })).toThrow(); }
  });
  it("rejects an oversized source input before opening it", () => {
    const file = fixture(), target = path.join(file.repo, "src-tauri/Cargo.lock"); fs.truncateSync(target, 8 * 1024 * 1024 + 1); expect(file.source).toThrow("byte budget");
  });
  it("requires the real installed snapshot rather than a caller-forged equivalent object", () => {
    const file = fixture(), { snapshot } = file.prepare(); expect(() => verifyBuildProof({ repoRoot: file.repo, proofPath: file.proofPath, snapshot: { ...snapshot } as InstalledInputsSnapshot })).toThrow("server-owned");
  });
  it("cannot mint for an unrelated existing native executable even when runtime bytes match", () => {
    const file = fixture(); file.cargo(); const inputs = file.source(), build = runControlledCargoBuild(inputs, file.output);
    const snapshot = freezeInstalledInputs({ ...file.options, installRoot: file.template, executable: path.join(file.template, "Contents/MacOS/phoenix-desktop") });
    expect(() => recordBuildProof({ repoRoot: file.repo, proofPath: file.proofPath, snapshot, inputs, build })).toThrow("actual app artifacts"); expect(fs.existsSync(file.proofPath)).toBe(false);
  });
  it("cannot change native build output after Cargo success and then freeze it as a new mint input", () => {
    const file = fixture(); file.cargo(); const inputs = file.source(), build = runControlledCargoBuild(inputs, file.output); write(file.executable, "different old unapproved native executable"); const snapshot = file.snapshot();
    expect(() => recordBuildProof({ repoRoot: file.repo, proofPath: file.proofPath, snapshot, inputs, build })).toThrow(); expect(fs.existsSync(file.proofPath)).toBe(false);
  });
  it.each(["replacement", "permissions"])("rejects output-root identity or permission changes during the Cargo completion barrier: %s", kind => {
    const file = fixture(), inputs = file.source(), spawn = file.cargo(), implementation = spawn.getMockImplementation()!;
    spawn.mockImplementation((...args) => {
      const result = implementation(...args);
      if (args[0] === "cargo") {
        if (kind === "replacement") { const prior = `${file.output}.prior`; fs.renameSync(file.output, prior); fs.mkdirSync(file.output, { mode: 0o700 }); fs.cpSync(prior, file.output, { recursive: true }); }
        else fs.chmodSync(file.output, 0o755);
      }
      return result;
    }); expect(() => runControlledCargoBuild(inputs, file.output)).toThrow("output directory identity/permissions"); expect(fs.existsSync(file.proofPath)).toBe(false);
  });
  it("rechecks output-root identity again before mint rather than accepting a byte-identical replacement", () => {
    const file = fixture(); file.cargo(); const inputs = file.source(), build = runControlledCargoBuild(inputs, file.output), prior = `${file.output}.prior`;
    fs.renameSync(file.output, prior); fs.mkdirSync(file.output, { mode: 0o700 }); fs.cpSync(prior, file.output, { recursive: true }); const snapshot = file.snapshot();
    expect(() => recordBuildProof({ repoRoot: file.repo, proofPath: file.proofPath, snapshot, inputs, build })).toThrow("output directory identity/permissions"); expect(fs.existsSync(file.proofPath)).toBe(false);
  });
  it("rejects plist bytes changing at the version-read barrier", () => {
    const file = fixture(), spawn = file.cargo(), implementation = spawn.getMockImplementation()!;
    spawn.mockImplementation((...args) => { const result = implementation(...args); if (args[0] === "/usr/bin/plutil") write(path.join(file.install, "Contents/Info.plist"), "different plist bytes after read"); return result; });
    expect(() => runControlledCargoBuild(file.source(), file.output)).toThrow("plist changed"); expect(fs.existsSync(file.proofPath)).toBe(false);
  });
  it.each(["no-app", "plist-failure", "wrong-installed-version"])("cannot create a successful build token without validated actual output: %s", kind => {
    const file = fixture(), spawn = file.cargo(), implementation = spawn.getMockImplementation()!;
    spawn.mockImplementation((...args) => {
      if (kind === "no-app") return { pid: 10, output: [], stdout: Buffer.alloc(0), stderr: Buffer.alloc(0), status: 0, signal: null };
      if (args[0] === "/usr/bin/plutil") return { pid: 10, output: [], stdout: "9.9.9", stderr: Buffer.alloc(0), status: kind === "plist-failure" ? 1 : 0, signal: null };
      return implementation(...args);
    }); expect(() => runControlledCargoBuild(file.source(), file.output)).toThrow(); expect(fs.existsSync(file.proofPath)).toBe(false);
  });
  it("bounds generated directory enumeration before unbounded allocation", () => {
    const file = fixture(); file.cargo(); const inputs = file.source(), build = runControlledCargoBuild(inputs, file.output), snapshot = file.snapshot(), realOpen = fs.opendirSync;
    let reads = 0, closed = 0; vi.spyOn(fs, "opendirSync").mockImplementation((...args: Parameters<typeof fs.opendirSync>) => String(args[0]) === path.join(file.repo, "web-ui/dist") ? ({ readSync: () => { reads++; return { name: "index.html" }; }, closeSync: () => { closed++; } }) as unknown as fs.Dir : Reflect.apply(realOpen, fs, args));
    expect(() => recordBuildProof({ repoRoot: file.repo, proofPath: file.proofPath, snapshot, inputs, build })).toThrow("file count budget"); expect(reads).toBe(4097); expect(closed).toBe(1); expect(fs.existsSync(file.proofPath)).toBe(false);
  });
});
