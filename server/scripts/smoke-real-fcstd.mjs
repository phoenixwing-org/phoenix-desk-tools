import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { unzipSync, zipSync } from "fflate";

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(serverRoot, "..");
const fixtureXml = path.join(
  repoRoot,
  "tests",
  "fixtures",
  "workspaces",
  "minimal",
  "document-xml",
  "图纸-通过link来创建-Document.xml",
);
const executable = (name) => path.join(serverRoot, "bin", `${name}${process.platform === "win32" ? ".exe" : ""}`);
const readTool = executable("fcstd-read");
const xlinkTool = executable("fcstd-xlink");
const buildManifest = path.join(serverRoot, "bin", "native-build-manifest.json");
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "phoenix-real-fcstd-"));
const archive = path.join(tempRoot, "图纸-真实读改回滚.FCStd");
const oldAttr = "8003.001-H-PHOENIX-滑轨.FCStd";
const newAttr = "renamed/8003.002-H-PHOENIX-滑轨.FCStd";

try {
  for (const required of [fixtureXml, readTool, xlinkTool, buildManifest]) assertFile(required);
  const xml = fs.readFileSync(fixtureXml);
  fs.writeFileSync(archive, zipSync({
    "Document.xml": xml,
    "GuiDocument.xml": new TextEncoder().encode("<?xml version=\"1.0\"?><GuiDocument/>")
  }, { level: 6 }));
  const original = fs.readFileSync(archive);
  const beforeSha256 = sha256(original);

  const beforeRead = runJson(readTool, ["--protocol", "1", "read", archive], "read before patch");
  assertNativeRead(beforeRead, "before patch");

  const scanXml = path.join(tempRoot, "Document.xml");
  fs.writeFileSync(scanXml, xml);
  const scan = runJson(
    xlinkTool,
    ["--protocol", "1", "scan", scanXml, oldAttr],
    "xlink scan",
  );
  if (!scan.ok || scan.result?.hits?.length !== 1) {
    throw new Error(`real XLink fixture must expose one hit: ${JSON.stringify(scan)}`);
  }

  const patched = runJson(xlinkTool, ["patch", archive, `${oldAttr}=${newAttr}`], "xlink patch");
  if (patched.ok !== true || patched.count !== 1) {
    throw new Error(`real XLink patch must change exactly one attribute: ${JSON.stringify(patched)}`);
  }
  const afterPatch = fs.readFileSync(archive);
  if (sha256(afterPatch) === beforeSha256) throw new Error("FCStd archive bytes did not change after patch");
  const patchedXml = decodeDocumentXml(afterPatch);
  if (!patchedXml.includes(newAttr) || patchedXml.includes(`file=\"${oldAttr}\"`)) {
    throw new Error("FCStd Document.xml did not preserve the requested XLink replacement");
  }
  assertNativeRead(runJson(readTool, ["--protocol", "1", "read", archive], "read after patch"), "after patch");

  let rolledBack = false;
  try {
    throw new Error("injected post-patch host failure");
  } catch (error) {
    if (!(error instanceof Error) || error.message !== "injected post-patch host failure") throw error;
    fs.writeFileSync(archive, original);
    rolledBack = true;
  }
  const restored = fs.readFileSync(archive);
  if (!rolledBack || sha256(restored) !== beforeSha256) {
    throw new Error("FCStd rollback did not restore the exact original archive bytes");
  }
  const restoredXml = decodeDocumentXml(restored);
  if (!restoredXml.includes(oldAttr) || restoredXml.includes(newAttr)) {
    throw new Error("FCStd rollback did not restore the original Document.xml semantics");
  }
  assertNativeRead(runJson(readTool, ["--protocol", "1", "read", archive], "read after rollback"), "after rollback");
  const leftovers = fs.readdirSync(tempRoot).filter((name) => name.includes(".phoenix-") || name.endsWith(".tmp"));
  if (leftovers.length > 0) throw new Error(`native transaction left temporary files: ${leftovers.join(", ")}`);

  const manifest = JSON.parse(fs.readFileSync(buildManifest, "utf8"));
  process.stdout.write(`${JSON.stringify({
    kind: "phoenix.desk.real-fcstd-smoke",
    schemaVersion: 1,
    sourcePackage: manifest.source_package,
    sourcePackageVersion: manifest.source_package_version,
    target: manifest.target,
    fixture: path.relative(repoRoot, fixtureXml).replaceAll(path.sep, "/"),
    flows: { read: true, modify: true, rollback: true },
    xlinkHits: scan.result.hits.length,
    changedAttributes: patched.count,
    exactRollbackSha256: beforeSha256,
  }, null, 2)}\n`);
  process.stdout.write("[q2] real FCStd read/modify/exact-rollback smoke passed\n");
} finally {
  if (process.env.PHOENIX_KEEP_REAL_FCSTD_SMOKE === "1") {
    process.stdout.write(`[q2] kept ${tempRoot}\n`);
  } else {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

function runJson(command, args, label) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    timeout: 30_000,
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${label} failed (${String(result.status)}): ${String(result.stderr).trim()}`);
  }
  try {
    return JSON.parse(String(result.stdout).trim());
  } catch (error) {
    throw new Error(`${label} returned invalid JSON: ${String(result.stdout).trim()}`, { cause: error });
  }
}

function assertNativeRead(value, phase) {
  if (value.protocol !== "phoenix-cad-native" || value.protocol_version?.major !== 1 || value.ok !== true) {
    throw new Error(`native read ${phase} failed contract v1: ${JSON.stringify(value)}`);
  }
  if (!Array.isArray(value.result?.objects) || value.result.objects.length === 0) {
    throw new Error(`native read ${phase} returned no FCStd objects`);
  }
}

function decodeDocumentXml(bytes) {
  const entries = unzipSync(bytes);
  const document = entries["Document.xml"];
  if (!document) throw new Error("FCStd archive lost Document.xml");
  return new TextDecoder().decode(document);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function assertFile(file) {
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) throw new Error(`required file is missing: ${file}`);
}
