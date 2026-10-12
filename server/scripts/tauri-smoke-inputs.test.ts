import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { freezeInstalledInputs, verifyInstalledInputs, type InstalledInputsOptions } from "./tauri-smoke-inputs.mjs";

const owned: string[] = [];
const digest = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");
interface Entry { path: string; bytes: number; sha256: string }
interface Manifest {
  schema_version: number; generated_at: string; platform: string; arch: string;
  node: { version: string; filename: string; sha256: string };
  server: { filename: string; sha256: string };
  workspace_schema: { schema_id: string; schema_version: number; ddl_sha256: string; database_filename: string };
  files: Entry[];
}
function write(filename: string, bytes: string | Buffer) { fs.mkdirSync(path.dirname(filename), { recursive: true }); fs.writeFileSync(filename, bytes); }
function fixture(platform: "darwin" | "win32" = "darwin") {
  const parent = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "tauri-input-contract-"))); owned.push(parent);
  const root = path.join(parent, "installation");
  const runtime = path.join(root, platform === "darwin" ? "Contents/Resources/runtime" : "runtime");
  const executable = path.join(root, platform === "darwin" ? "Contents/MacOS/example-shell" : "example-shell.exe");
  write(executable, "independent synthetic shell; never executed");
  if (platform === "darwin") write(path.join(root, "Contents/Info.plist"), "independent metadata; version supplied by caller");
  const nodeName = platform === "darwin" ? "node" : "node.exe";
  const files = new Map([[`node/${nodeName}`, "synthetic node; never executed"], ["server/server.mjs", "synthetic server; never executed"], ["scripts/adapter.py", "# independent adapter"], ["data/empty", ""]]);
  const entries = [...files].map(([name, content]) => { write(path.join(runtime, name), content); return { path: name, bytes: Buffer.byteLength(content), sha256: digest(content) }; });
  const manifest: Manifest = { schema_version: 1, generated_at: "2026-01-01T00:00:00.000Z", platform, arch: "x64",
    node: { version: "v22.0.0", filename: nodeName, sha256: entries[0].sha256 },
    server: { filename: "server.mjs", sha256: entries[1].sha256 },
    workspace_schema: { schema_id: "phoenix-workspace", schema_version: 13, ddl_sha256: "a".repeat(64), database_filename: "phoenix-workspace.sqlite" }, files: entries };
  const manifestPath = path.join(runtime, "runtime-manifest.json");
  const rewrite = () => write(manifestPath, `${JSON.stringify(manifest)}\n`); rewrite();
  const options: InstalledInputsOptions = { installRoot: root, executable, expectedVersion: "1.2.3", appVersion: "1.2.3", platform, arch: "x64" };
  return { parent, root, runtime, executable, manifest, manifestPath, rewrite, options };
}
afterEach(() => { vi.restoreAllMocks(); for (const root of owned.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

describe("actual installed Tauri input freezing", () => {
  it.each(["darwin", "win32"] as const)("freezes and revalidates independent real files for %s without executing them", platform => {
    const file = fixture(platform), before = fs.readFileSync(file.manifestPath);
    const snapshot = freezeInstalledInputs(file.options);
    expect(snapshot.root).toBe(file.root); expect(snapshot.payload).toHaveLength(4);
    expect(snapshot.manifestSha256).toBe(digest(before)); expect(snapshot.executableSha256).toBe(digest(fs.readFileSync(file.executable)));
    expect(snapshot.payloadInventorySha256).toBe(digest(`${JSON.stringify(snapshot.payload)}\n`));
    expect(snapshot.node.filename).toBe(platform === "darwin" ? "node" : "node.exe");
    expect(snapshot.plist?.path ?? null).toBe(platform === "darwin" ? path.join(file.root, "Contents/Info.plist") : null);
    expect(Object.isFrozen(snapshot)).toBe(true); expect(Object.isFrozen(snapshot.payload)).toBe(true);
    for (const row of snapshot.payload) expect(Object.isFrozen(row)).toBe(true);
    expect(Object.isFrozen(snapshot.node)).toBe(true); expect(Object.isFrozen(snapshot.server)).toBe(true);
    verifyInstalledInputs(snapshot); expect(fs.readFileSync(file.manifestPath)).toEqual(before);
  });
  it("reads the actual selected macOS plist, not another installation's metadata", () => {
    const actual = fixture(), other = fixture();
    write(path.join(other.root, "Contents/Info.plist"), "different unrelated metadata");
    const snapshot = freezeInstalledInputs(actual.options);
    expect(snapshot.plist?.sha256).toBe(digest(fs.readFileSync(path.join(actual.root, "Contents/Info.plist"))));
    expect(snapshot.plist?.sha256).not.toBe(digest(fs.readFileSync(path.join(other.root, "Contents/Info.plist"))));
    fs.unlinkSync(path.join(actual.root, "Contents/Info.plist"));
    expect(() => freezeInstalledInputs(actual.options)).toThrow();
  });
  it("refuses a caller's package-versus-installed version mismatch before file access", () => {
    const file = fixture(); const open = vi.spyOn(fs, "openSync");
    expect(() => freezeInstalledInputs({ ...file.options, appVersion: "1.2.4" })).toThrow("version"); expect(open).not.toHaveBeenCalled();
  });
  it("refuses snapshot forgery or an otherwise identical clone", () => {
    const snapshot = freezeInstalledInputs(fixture().options);
    expect(() => verifyInstalledInputs({ ...snapshot })).toThrow("server-owned");
  });
  it.each(["data/empty", "scripts/adapter.py", "server/server.mjs", "node/node"])("rejects a changed payload before receipt: %s", name => {
    const file = fixture(), snapshot = freezeInstalledInputs(file.options); write(path.join(file.runtime, name), "changed independent bytes");
    expect(() => verifyInstalledInputs(snapshot)).toThrow();
  });
  it.each(["executable", "plist", "manifest"])("rejects changed non-payload frozen metadata: %s", kind => {
    const file = fixture(), snapshot = freezeInstalledInputs(file.options);
    const target = kind === "executable" ? file.executable : kind === "plist" ? path.join(file.root, "Contents/Info.plist") : file.manifestPath;
    write(target, "changed metadata"); expect(() => verifyInstalledInputs(snapshot)).toThrow();
  });
  it("rejects even a different self-consistent complete installation after initial freeze", () => {
    const file = fixture(), snapshot = freezeInstalledInputs(file.options), changed = "synthetic replacement node";
    write(path.join(file.runtime, "node/node"), changed); file.manifest.files[0] = { path: "node/node", bytes: Buffer.byteLength(changed), sha256: digest(changed) };
    file.manifest.node.sha256 = digest(changed); file.rewrite();
    expect(() => freezeInstalledInputs(file.options)).not.toThrow(); expect(() => verifyInstalledInputs(snapshot)).toThrow();
  });
  it("re-hashes bytes even when every target stat observation remains equal", () => {
    const file = fixture(), target = path.join(file.runtime, "scripts/adapter.py"), snapshot = freezeInstalledInputs(file.options);
    const originalStat = fs.lstatSync(target, { bigint: true }), lstat = fs.lstatSync, fstat = fs.fstatSync, open = fs.openSync, close = fs.closeSync;
    write(target, "!".repeat(Number(originalStat.size))); const targetFDs = new Set<number>();
    vi.spyOn(fs, "lstatSync").mockImplementation(((...args: Parameters<typeof fs.lstatSync>) => path.resolve(String(args[0])) === target ? originalStat : Reflect.apply(lstat, fs, args)) as typeof fs.lstatSync);
    vi.spyOn(fs, "openSync").mockImplementation((filename, flags, mode) => { const fd = open(filename, flags, mode); if (String(filename) === target) targetFDs.add(fd); return fd; });
    vi.spyOn(fs, "fstatSync").mockImplementation(((...args: Parameters<typeof fs.fstatSync>) => targetFDs.has(args[0]) ? originalStat : Reflect.apply(fstat, fs, args)) as typeof fs.fstatSync);
    vi.spyOn(fs, "closeSync").mockImplementation(fd => { targetFDs.delete(fd); close(fd); });
    expect(() => verifyInstalledInputs(snapshot)).toThrow("runtime size/hash mismatch");
  });
  it.each(["hidden-file", "empty-directory", "missing"])("rejects an inexact runtime inventory: %s", kind => {
    const file = fixture();
    if (kind === "hidden-file") write(path.join(file.runtime, ".unexpected"), "extra");
    else if (kind === "empty-directory") fs.mkdirSync(path.join(file.runtime, "unexpected"));
    else fs.unlinkSync(path.join(file.runtime, "scripts/adapter.py"));
    expect(() => freezeInstalledInputs(file.options)).toThrow(/extra|missing/u);
  });
  it.each(["missing-files", "empty-files"])("fails closed for old schema-1 proof: %s", kind => {
    const file = fixture(), input = { ...file.manifest } as Partial<Manifest>;
    if (kind === "missing-files") delete input.files; else input.files = [];
    write(file.manifestPath, JSON.stringify(input)); expect(() => freezeInstalledInputs(file.options)).toThrow("legacy manifest");
  });
  it.each([
    ["parent", "../external"], ["absolute", "/external"], ["drive", "C:/external"], ["backslash", "scripts\\external"],
    ["interior-dot", "scripts/./external"], ["empty-component", "scripts//external"], ["self", "runtime-manifest.json"], ["control", "scripts/\u0000external"],
    ["device", "scripts/CON.py"], ["tail-dot", "scripts/adapter."], ["tail-space", "scripts/adapter "],
  ])("rejects manifest path grammar: %s", (_name, unsafe) => {
    const file = fixture(); file.manifest.files[2].path = unsafe; file.rewrite(); expect(() => freezeInstalledInputs(file.options)).toThrow();
  });
  it.each(["duplicate", "case-collision"])("rejects duplicate filesystem targets: %s", kind => {
    const file = fixture(); file.manifest.files.push({ ...file.manifest.files[2], path: kind === "duplicate" ? "scripts/adapter.py" : "Scripts/ADAPTER.py" });
    file.rewrite(); expect(() => freezeInstalledInputs(file.options)).toThrow("duplicate/colliding");
  });
  it.each(["root", "escaped-nested"])("rejects duplicate decoded JSON keys: %s", kind => {
    const file = fixture(), raw = JSON.stringify(file.manifest);
    write(file.manifestPath, kind === "root" ? raw.replace('"schema_version":1', '"schema_version":1,"schema_version":1') : raw.replace('"filename":"node"', '"filename":"node","file\\u006eame":"node"'));
    expect(() => freezeInstalledInputs(file.options)).toThrow("duplicate JSON");
  });
  it.each(["platform", "architecture", "node-sha", "server-sha", "node-name", "schema", "extra-field", "size", "hash"])("rejects contradictory metadata: %s", kind => {
    const file = fixture();
    if (kind === "platform") file.manifest.platform = "win32";
    else if (kind === "architecture") file.manifest.arch = "arm64";
    else if (kind === "node-sha") file.manifest.node.sha256 = "b".repeat(64);
    else if (kind === "server-sha") file.manifest.server.sha256 = "b".repeat(64);
    else if (kind === "node-name") file.manifest.node.filename = "../external";
    else if (kind === "schema") file.manifest.schema_version = 2;
    else if (kind === "extra-field") Object.assign(file.manifest, { native_provider: "legacy" });
    else if (kind === "size") file.manifest.files[2].bytes++;
    else file.manifest.files[2].sha256 = "b".repeat(64);
    file.rewrite(); expect(() => freezeInstalledInputs(file.options)).toThrow();
  });
  it("rejects an executable outside the selected installRoot", () => {
    const actual = fixture(), other = fixture(); expect(() => freezeInstalledInputs({ ...actual.options, executable: other.executable })).toThrow("outside installRoot");
  });
  it.each(["root", "ancestor", "payload", "executable", "plist"])("rejects a symlink at the selected boundary: %s", kind => {
    const file = fixture(), outside = path.join(file.parent, "outside");
    if (kind === "root") { fs.renameSync(file.root, outside); fs.symlinkSync(outside, file.root, "dir"); }
    else if (kind === "ancestor") { const contents = path.join(file.root, "Contents"); fs.renameSync(contents, outside); fs.symlinkSync(outside, contents, "dir"); }
    else {
      const target = kind === "payload" ? path.join(file.runtime, "scripts/adapter.py") : kind === "executable" ? file.executable : path.join(file.root, "Contents/Info.plist");
      fs.renameSync(target, outside); fs.symlinkSync(outside, target, "file");
    }
    expect(() => freezeInstalledInputs(file.options)).toThrow(/symlink|real directory/u);
  });
  it("detects equal bytes but replacement inode of the actual install directory", () => {
    const file = fixture(), snapshot = freezeInstalledInputs(file.options), moved = path.join(file.parent, "prior-installation");
    fs.renameSync(file.root, moved); fs.cpSync(moved, file.root, { recursive: true }); expect(() => verifyInstalledInputs(snapshot)).toThrow("identity");
  });
  it("rejects a large manifest before parsing it", () => {
    const file = fixture(); write(file.manifestPath, Buffer.alloc(1024 * 1024 + 1, 32)); const parse = vi.spyOn(JSON, "parse");
    expect(() => freezeInstalledInputs(file.options)).toThrow("byte budget"); expect(parse).not.toHaveBeenCalled();
  });
  it("rejects a sparse oversized executable before opening it", () => {
    const file = fixture(); fs.truncateSync(file.executable, 256 * 1024 * 1024 + 1); const open = vi.spyOn(fs, "openSync");
    expect(() => freezeInstalledInputs(file.options)).toThrow("byte budget"); expect(open).not.toHaveBeenCalled();
  });
  it("rejects a nonregular executable before opening it", () => {
    const file = fixture(); fs.unlinkSync(file.executable); fs.mkdirSync(file.executable); const open = vi.spyOn(fs, "openSync");
    expect(() => freezeInstalledInputs(file.options)).toThrow("regular"); expect(open).not.toHaveBeenCalled();
  });
  it("enforces directory enumeration limits before unbounded allocation", () => {
    const file = fixture(); let reads = 0, closed = 0;
    vi.spyOn(fs, "opendirSync").mockImplementation(() => ({ readSync: () => { reads++; return { name: "runtime-manifest.json" }; }, closeSync: () => { closed++; } }) as unknown as fs.Dir);
    expect(() => freezeInstalledInputs(file.options)).toThrow("entries exceed budget"); expect(reads).toBe(8193); expect(closed).toBe(1);
  });
  it("retains both read and close failures without leaking the real descriptor", () => {
    const file = fixture(), realClose = fs.closeSync; let closed = 0;
    vi.spyOn(fs, "readSync").mockImplementation(() => { throw new Error("independent read failure"); });
    vi.spyOn(fs, "closeSync").mockImplementation(fd => { realClose(fd); closed++; throw new Error("independent close failure"); });
    let error: unknown; try { freezeInstalledInputs(file.options); } catch (caught) { error = caught; }
    expect(error).toBeInstanceOf(AggregateError); expect((error as AggregateError).errors.map((entry: Error) => entry.message)).toEqual(["independent read failure", "independent close failure"]); expect(closed).toBe(1);
  });
});
