import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import vm from "node:vm";
import ts from "typescript";
import { afterEach, describe, expect, it } from "vitest";
import {
  PNW_WORKSPACE_DATABASE_FILENAME,
  PNW_WORKSPACE_SCHEMA_ID,
  PNW_WORKSPACE_SCHEMA_V13_SHA256,
  PNW_WORKSPACE_SCHEMA_VERSION,
} from "@phoenix-wing/workspace-schema";

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
const prepareSource = fs.readFileSync(new URL("prepare-tauri-runtime.mjs", import.meta.url), "utf8");
const preferencesPath = "phoenix/freecad/thumbnail_preferences.py";
const temporaryRoots: string[] = [];
const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const order = (left: string, right: string) => left < right ? -1 : left > right ? 1 : 0;

function regularFiles(root: string): string[] {
  const result: string[] = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const filename = path.join(root, entry.name);
    if (entry.isDirectory()) result.push(...regularFiles(filename));
    else if (entry.isFile()) result.push(filename);
    else throw new Error(`Unexpected non-regular fixture entry: ${entry.name}`);
  }
  return result.sort(order);
}

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "desk-runtime-closure-"));
  temporaryRoots.push(root);
  function write(relativePath: string, bytes: string | Buffer) {
    const target = path.join(root, relativePath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, bytes);
  }
  const publicPaths = [
    "phoenix/__init__.py", "phoenix/freecad/__init__.py", preferencesPath, "phoenix/freecad/freecad_exec.py",
    "scripts/freecad_batch_step_runner.py", "scripts/freecad_batch_step_fc.py",
    ...["phoenix/batch_step", "phoenix/freecad/batch_step"].flatMap(base =>
      ["__init__.py", "job.py", "report.py", "step_naming.py", "step_paths.py"].map(name => `${base}/${name}`)),
  ];
  for (const filename of publicPaths) write(filename, fs.readFileSync(path.join(repoRoot, filename)));
  write("phoenix/config/app_config.json", '{"navigation":[]}\n');
  write("phoenix/config/test_fixture_catalog.json", '{"fixtures":[]}\n');
  write("phoenix/freecad/unrelated.py", "# independent unselected module\n");
  write("phoenix/freecad/tests/synthetic.test.py", "# independent test, not a runtime dependency\n");
  write("server/scripts/sw-step-export.ps1", "# independent closure placeholder\n");
  write("server/dist-sidecar/server.mjs", "export const fixture = 'independent closure';\n");
  write("server/node_modules/node-sqlite3-wasm/dist/node-sqlite3-wasm.wasm", Buffer.from([0, 97, 115, 109]));
  write("server/node_modules/node-sqlite3-wasm/dist/node-sqlite3-wasm.js", "module.exports = {};\n");
  write("isolated-bin/node", "independent executable bytes; never launched\n");
  return { root, publicPaths, write, runtime: path.join(root, "src-tauri/resources/runtime") };
}

// Execute only the real copy/manifest program in a small independent filesystem.
// Imports and import.meta.url are bound by AST; no Node/FreeCAD app is launched.
function prepare(file: ReturnType<typeof fixture>, text = prepareSource, beforeManifest = () => {}) {
  const tree = ts.createSourceFile("prepare.mjs", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const result = ts.transform(tree, [(context) => {
    const visit: ts.Visitor = (node) => {
      if (ts.isImportDeclaration(node)) return undefined;
      if (ts.isPropertyAccessExpression(node) && ts.isMetaProperty(node.expression) && node.name.text === "url") {
        return context.factory.createStringLiteral(pathToFileURL(path.join(file.root, "server/scripts/prepare-tauri-runtime.mjs")).href);
      }
      return ts.visitEachChild(node, visit, context);
    };
    return root => ts.visitNode(root, visit) as ts.SourceFile;
  }]);
  try {
    vm.runInNewContext(ts.createPrinter().printFile(result.transformed[0]!), {
      createHash, fs, path, fileURLToPath, beforeManifest,
      PNW_WORKSPACE_DATABASE_FILENAME, PNW_WORKSPACE_SCHEMA_ID,
      PNW_WORKSPACE_SCHEMA_V13_SHA256, PNW_WORKSPACE_SCHEMA_VERSION,
      process: { platform: process.platform, arch: process.arch, version: process.version,
        execPath: path.join(file.root, "isolated-bin/node"), stdout: { write: () => {} } },
    }, { timeout: 2_000 });
  } finally { result.dispose(); }
}

function verifyPythonClosure(runtime: string) {
  for (const filename of regularFiles(runtime).filter(name => name.endsWith(".py"))) {
    const text = fs.readFileSync(filename, "utf8");
    for (const match of text.matchAll(/^\s*(?:from\s+(phoenix(?:\.\w+)+)\s+import|import\s+(phoenix(?:\.\w+)+))/gmu)) {
      const modulePath = (match[1] || match[2]!).replaceAll(".", "/");
      if (![`${modulePath}.py`, `${modulePath}/__init__.py`].some(candidate => fs.existsSync(path.join(runtime, candidate)))) {
        throw new Error(`Unpackaged local Python import: ${modulePath}`);
      }
    }
  }
}

function verifyManifest(runtime: string) {
  const manifest = JSON.parse(fs.readFileSync(path.join(runtime, "runtime-manifest.json"), "utf8"));
  const expected = regularFiles(runtime).filter(filename => path.relative(runtime, filename) !== "runtime-manifest.json").map(filename => {
    const bytes = fs.readFileSync(filename);
    return { path: path.relative(runtime, filename).split(path.sep).join("/"), bytes: bytes.length, sha256: hash(bytes) };
  }).sort((left, right) => order(left.path, right.path));
  expect(manifest.files).toEqual(expected);
  return manifest;
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("Tauri runtime Python copy and manifest closure", () => {
  it("copies the real thumbnail preference module bytes without selecting its entire parent", () => {
    const file = fixture(); prepare(file);
    expect(fs.readFileSync(path.join(file.runtime, preferencesPath))).toEqual(fs.readFileSync(path.join(repoRoot, preferencesPath)));
    expect(fs.existsSync(path.join(file.runtime, "phoenix/freecad/unrelated.py"))).toBe(false);
    expect(fs.existsSync(path.join(file.runtime, "phoenix/freecad/tests"))).toBe(false);
  });
  it("resolves all packaged static phoenix Python imports without executing FreeCAD", () => {
    const file = fixture(); prepare(file); verifyPythonClosure(file.runtime);
    for (const filename of file.publicPaths) expect(fs.readFileSync(path.join(file.runtime, filename))).toEqual(fs.readFileSync(path.join(repoRoot, filename)));
  });
  it("lists every actual payload's raw bytes and SHA while retaining the schema-one consumers", () => {
    const file = fixture(); prepare(file); const manifest = verifyManifest(file.runtime);
    expect(manifest.schema_version).toBe(1);
    expect(manifest.node.sha256).toBe(hash(fs.readFileSync(path.join(file.runtime, "node/node"))));
    expect(manifest.server.sha256).toBe(hash(fs.readFileSync(path.join(file.runtime, "server/server.mjs"))));
    expect(manifest.workspace_schema.ddl_sha256).toBe(PNW_WORKSPACE_SCHEMA_V13_SHA256);
    expect(manifest.files.some((entry: { path: string }) => entry.path === preferencesPath)).toBe(true);
    expect(manifest.files.some((entry: { path: string }) => entry.path === "runtime-manifest.json")).toBe(false);
  });
  it("detects the original missing-copy regression with a source mutation", () => {
    const file = fixture();
    const mutated = prepareSource.replace(/^copyFile\(thumbnailPreferences,.*\n/mu, "");
    expect(mutated).not.toBe(prepareSource); prepare(file, mutated);
    expect(() => verifyPythonClosure(file.runtime)).toThrow("Unpackaged local Python import: phoenix/freecad/thumbnail_preferences");
  });
  it("rejects a missing preference source before replacing an existing runtime", () => {
    const file = fixture(); file.write("src-tauri/resources/runtime/existing", "keep");
    fs.unlinkSync(path.join(file.root, preferencesPath));
    expect(() => prepare(file)).toThrow("thumbnail_preferences.py is missing");
    expect(fs.readFileSync(path.join(file.runtime, "existing"), "utf8")).toBe("keep");
  });
  it("rejects a symlink preference source before replacing an existing runtime", () => {
    const file = fixture(); file.write("src-tauri/resources/runtime/existing", "keep");
    fs.unlinkSync(path.join(file.root, preferencesPath));
    file.write("unselected.py", "# independent symlink source\n");
    fs.symlinkSync(path.join(file.root, "unselected.py"), path.join(file.root, preferencesPath));
    expect(() => prepare(file)).toThrow("thumbnail_preferences.py is missing");
    expect(fs.readFileSync(path.join(file.runtime, "existing"), "utf8")).toBe("keep");
  });
  it("rejects a symlink payload rather than following or omitting it from the manifest", () => {
    const file = fixture();
    const mutated = prepareSource.replace("const manifest = {", "beforeManifest();\nconst manifest = {");
    expect(() => prepare(file, mutated, () => fs.symlinkSync(path.join(file.root, preferencesPath), path.join(file.runtime, "opaque-link")))).toThrow("Runtime payload must not be a symlink: opaque-link");
    expect(fs.existsSync(path.join(file.runtime, "runtime-manifest.json"))).toBe(false);
  });
  it("detects payload byte changes against the emitted manifest", () => {
    const file = fixture(); prepare(file);
    fs.appendFileSync(path.join(file.runtime, preferencesPath), "# independent mutation\n");
    expect(() => verifyManifest(file.runtime)).toThrow();
  });
});
