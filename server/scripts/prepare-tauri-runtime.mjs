import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  PNW_WORKSPACE_DATABASE_FILENAME,
  PNW_WORKSPACE_SCHEMA_ID,
  PNW_WORKSPACE_SCHEMA_V13_SHA256,
  PNW_WORKSPACE_SCHEMA_VERSION,
} from "@phoenix-wing/workspace-schema";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(scriptDir, "..");
const repoRoot = path.resolve(serverRoot, "..");
const runtimeRoot = path.join(repoRoot, "src-tauri", "resources", "runtime");
const bundleFile = path.join(serverRoot, "dist-sidecar", "server.mjs");

function requireFile(filename, hint) {
  if (!fs.existsSync(filename) || !fs.statSync(filename).isFile()) {
    throw new Error(`${filename} is missing${hint ? `; ${hint}` : ""}`);
  }
  return filename;
}

function copyFile(source, relativeTarget) {
  const target = path.join(runtimeRoot, relativeTarget);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
  if (process.platform !== "win32" && fs.statSync(source).mode & 0o111) fs.chmodSync(target, 0o755);
  return target;
}

function copyTree(source, relativeTarget) {
  const target = path.join(runtimeRoot, relativeTarget);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.cpSync(source, target, {
    recursive: true,
    force: true,
    dereference: true,
    filter: (entry) => path.basename(entry) !== "__pycache__" && !entry.endsWith(".pyc"),
  });
}

function sha256(filename) {
  return createHash("sha256").update(fs.readFileSync(filename)).digest("hex");
}

requireFile(bundleFile, "run pnpm -C server build:bundle");
const sqliteRoot = path.join(serverRoot, "node_modules", "node-sqlite3-wasm");
requireFile(path.join(sqliteRoot, "dist", "node-sqlite3-wasm.wasm"), "run pnpm install");

fs.rmSync(runtimeRoot, { recursive: true, force: true });
fs.mkdirSync(runtimeRoot, { recursive: true });

const nodeTarget = copyFile(process.execPath, path.join("node", path.basename(process.execPath)));
for (const licenseName of ["LICENSE", "LICENSE.txt"]) {
  const candidate = path.join(path.dirname(process.execPath), licenseName);
  if (fs.existsSync(candidate)) copyFile(candidate, path.join("node", licenseName));
}
const serverTarget = copyFile(bundleFile, path.join("server", "server.mjs"));
copyTree(sqliteRoot, path.join("server", "node_modules", "node-sqlite3-wasm"));
copyFile(path.join(repoRoot, "phoenix", "config", "app_config.json"), path.join("phoenix", "config", "app_config.json"));
copyFile(path.join(repoRoot, "phoenix", "config", "test_fixture_catalog.json"), path.join("phoenix", "config", "test_fixture_catalog.json"));
copyFile(path.join(repoRoot, "scripts", "freecad_batch_step_runner.py"), path.join("scripts", "freecad_batch_step_runner.py"));
copyFile(path.join(repoRoot, "scripts", "freecad_batch_step_fc.py"), path.join("scripts", "freecad_batch_step_fc.py"));
copyFile(path.join(serverRoot, "scripts", "sw-step-export.ps1"), path.join("scripts", "sw-step-export.ps1"));
copyFile(path.join(repoRoot, "phoenix", "__init__.py"), path.join("phoenix", "__init__.py"));
copyTree(path.join(repoRoot, "phoenix", "batch_step"), path.join("phoenix", "batch_step"));
copyFile(path.join(repoRoot, "phoenix", "freecad", "__init__.py"), path.join("phoenix", "freecad", "__init__.py"));
copyTree(path.join(repoRoot, "phoenix", "freecad", "batch_step"), path.join("phoenix", "freecad", "batch_step"));

const manifest = {
  schema_version: 1,
  generated_at: new Date().toISOString(),
  platform: process.platform,
  arch: process.arch,
  node: { version: process.version, filename: path.basename(nodeTarget), sha256: sha256(nodeTarget) },
  server: { filename: path.basename(serverTarget), sha256: sha256(serverTarget) },
  workspace_schema: {
    schema_id: PNW_WORKSPACE_SCHEMA_ID,
    schema_version: PNW_WORKSPACE_SCHEMA_VERSION,
    ddl_sha256: PNW_WORKSPACE_SCHEMA_V13_SHA256,
    database_filename: PNW_WORKSPACE_DATABASE_FILENAME,
  },
};
fs.writeFileSync(path.join(runtimeRoot, "runtime-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
process.stdout.write(`[tauri] runtime resources -> ${runtimeRoot}\n`);
