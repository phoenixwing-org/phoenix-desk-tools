import childProcess from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { captureBuildInputs, runControlledCargoBuild, recordBuildProof, verifyBuildProof } from "../server/scripts/tauri-smoke-build-proof.mjs";
import { freezeInstalledInputs, verifyInstalledInputs } from "../server/scripts/tauri-smoke-inputs.mjs";

// No installer, existing-build probe or global application is invoked here.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
if (args.some(arg => arg !== "--build-only") || args.length > 1) throw new Error("Usage: node scripts/build-tauri-smoke.mjs [--build-only]; existing builds cannot mint proof");
if (process.platform !== "darwin" || !["arm64", "x64"].includes(process.arch)) throw new Error("unsupported-profile: controlled Tauri smoke build currently supports macOS only");
const inputs = captureBuildInputs(repoRoot);
const configured = process.env.PHOENIX_TAURI_BUILD_OUTPUT;
let output;
if (configured !== undefined) {
  if (!configured || !path.isAbsolute(configured) || /[\u0000-\u001f]/u.test(configured)) throw new Error("PHOENIX_TAURI_BUILD_OUTPUT must be an absolute new directory");
  const requested = path.resolve(configured), parent = path.dirname(requested);
  if (fs.realpathSync(parent) !== parent || !fs.lstatSync(parent).isDirectory()) throw new Error("Build output parent must be a canonical existing directory");
  for (const [left, right] of [[repoRoot, requested], [requested, repoRoot]]) {
    const relative = path.relative(left, right);
    if (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`)) throw new Error("Build output must be outside and not contain repository");
  }
  fs.mkdirSync(requested, { mode: 0o700 }); output = requested;
} else output = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "desk-tauri-controlled-build-")));
const build = runControlledCargoBuild(inputs, output);
const { installRoot, executable, appVersion } = build;
const snapshot = freezeInstalledInputs({ installRoot, executable, expectedVersion: inputs.version, appVersion, platform: "darwin", arch: process.arch });
const proofPath = path.join(output, "controlled-build-proof.json");
const evidence = recordBuildProof({ repoRoot, proofPath, snapshot, inputs, build });
verifyInstalledInputs(snapshot); verifyBuildProof({ repoRoot, proofPath, snapshot });
const receiptPath = process.env.PHOENIX_TAURI_RECEIPT_PATH || path.join(output, "installed-host-receipt.v3.json");
const env = {};
for (const [key, value] of Object.entries(process.env)) if (["PATH", "HOME", "USERPROFILE", "LANG", "TZ", "TMPDIR", "TMP", "TEMP", "SYSTEMROOT", "WINDIR", "COMSPEC", "PATHEXT"].includes(key) || /^LC_[A-Z_]+$/u.test(key)) env[key] = value;
Object.assign(env, { PHOENIX_TAURI_BUILD_PROOF_PATH: proofPath, PHOENIX_TAURI_INSTALL_ROOT: installRoot, PHOENIX_TAURI_EXECUTABLE: executable, PHOENIX_TAURI_RECEIPT_PATH: receiptPath });
if (args.includes("--build-only")) {
  console.log(JSON.stringify({ status: "prepared", proofPath, installRoot, executable, receiptPath, evidence, launch: { command: process.execPath, args: [path.join(repoRoot, "server/scripts/smoke-tauri-release-app.mjs")], environment: { PHOENIX_TAURI_BUILD_PROOF_PATH: proofPath, PHOENIX_TAURI_INSTALL_ROOT: installRoot, PHOENIX_TAURI_EXECUTABLE: executable, PHOENIX_TAURI_RECEIPT_PATH: receiptPath } } }, null, 2));
} else {
  const smoke = childProcess.spawnSync(process.execPath, [path.join(repoRoot, "server/scripts/smoke-tauri-release-app.mjs")], { cwd: repoRoot, env, stdio: "inherit" });
  if (smoke.error) throw smoke.error;
  if (smoke.status !== 0 || smoke.signal) throw new Error("Prepared controlled-build smoke did not exit 0");
}
