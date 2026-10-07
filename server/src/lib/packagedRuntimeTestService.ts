import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { parseCatDlg, patchCatNls } from "@desk-tools/catdlg-core";
import {
  runtimeAppConfigPath,
  runtimeResourcesDir,
  runtimeScriptCandidates,
  runtimeUserDataDir,
} from "./appRuntimePaths.js";
import {
  patchReferenceLabelsInDocumentXml,
  patchXlinkAttributesInDocumentXml,
} from "./fcstdReferenceLabelService.js";
import { decodeSourceBuffer, encodeSourceText } from "./sourceTextCodec.js";

export type PackagedRuntimeSuiteId = "code" | "cad" | "platform" | "caa";

export type PackagedRuntimeCheck = {
  id: string;
  module: string;
  suiteId: PackagedRuntimeSuiteId;
  className: string;
  method: string;
  run: () => string | void | Promise<string | void>;
};

export type PackagedRuntimeCheckResult = {
  status: "passed" | "failed" | "error";
  durationMs: number;
  message: string;
  traceback: string;
};

class RuntimeCheckFailure extends Error {}

function expectRuntime(condition: unknown, message: string): asserts condition {
  if (!condition) throw new RuntimeCheckFailure(message);
}

function check(
  module: string,
  suiteId: PackagedRuntimeSuiteId,
  className: string,
  method: string,
  run: PackagedRuntimeCheck["run"],
): PackagedRuntimeCheck {
  return {
    id: `${module} > ${className} > ${method}`,
    module,
    suiteId,
    className,
    method,
    run,
  };
}

function sha256(filename: string): string {
  return createHash("sha256").update(fs.readFileSync(filename)).digest("hex");
}

function verifyRuntimeManifest(): string {
  const resources = runtimeResourcesDir();
  expectRuntime(resources, "PHOENIX_RESOURCES_DIR is not set");
  const manifestPath = path.join(resources, "runtime-manifest.json");
  expectRuntime(fs.existsSync(manifestPath), `Runtime manifest is missing: ${manifestPath}`);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  expectRuntime(manifest?.schema_version === 1, "Unsupported runtime manifest schema");
  expectRuntime(!("native_tools" in manifest), "Runtime manifest must not declare CAD native tools");
  expectRuntime(!("native_provider" in manifest), "Runtime manifest must not declare a CAD native provider");
  expectRuntime(!fs.existsSync(path.join(resources, "bin")), "Packaged runtime must not contain a CAD native bin directory");
  expectRuntime(!fs.existsSync(path.join(resources, "native-provider.json")), "Packaged runtime must not contain native-provider.json");
  expectRuntime(manifest?.platform === process.platform, `Runtime platform mismatch: ${manifest?.platform || "missing"} != ${process.platform}`);
  expectRuntime(manifest?.arch === process.arch, `Runtime architecture mismatch: ${manifest?.arch || "missing"} != ${process.arch}`);
  expectRuntime(manifest?.node?.version === process.version, `Bundled Node version mismatch: ${manifest?.node?.version || "missing"} != ${process.version}`);

  const files = [
    { record: manifest.node, base: "node" },
    { record: manifest.server, base: "server" },
  ];
  expectRuntime(files.length === 2, "Runtime manifest must list the bundled Node and server sidecar");
  for (const item of files) {
    const filename = path.join(resources, item.base, String(item.record?.filename || ""));
    expectRuntime(item.record?.filename && fs.existsSync(filename), `Runtime file is missing: ${filename}`);
    expectRuntime(item.record?.sha256 === sha256(filename), `Runtime file hash mismatch: ${filename}`);
  }
  return `${files.length} packaged files match the runtime manifest`;
}

function verifyGbkCodec(): string {
  const source = "class Phoenix {}; // GBK self-test: 中文\r\n";
  const encoded = encodeSourceText({ text: source, encoding: "gbk", hadBom: false }, source);
  const decoded = decodeSourceBuffer(encoded);
  expectRuntime(decoded?.encoding === "gbk", "GBK input was not detected as GBK");
  expectRuntime(decoded.text === source, "GBK source did not round-trip without data loss");
  return "GBK source round-trip passed";
}

function verifyReferenceLabels(): string {
  const xml = '<Document><ObjectData><Object name="Part"><Property name="Label" type="App::PropertyString"><String value="Old"/></Property><XLink file="old.FCStd"/></Object></ObjectData></Document>';
  const result = patchReferenceLabelsInDocumentXml(xml, { "old.FCStd": "New & Label" });
  expectRuntime(result.changes.length === 1, "FCStd reference label patch did not report one change");
  expectRuntime(result.xml.includes('value="New &amp; Label"'), "FCStd reference label was not XML-escaped and replaced");
  return "FCStd reference label patch passed";
}

function verifyXlinkAttributes(): string {
  const xml = '<Document><Other file="old.FCStd"/><XLink file="old.FCStd"/></Document>';
  const result = patchXlinkAttributesInDocumentXml(xml, { "old.FCStd": "new.FCStd" });
  expectRuntime(result.count === 1, "FCStd XLink patch did not report one change");
  expectRuntime(result.xml.includes('<XLink file="new.FCStd"/>'), "FCStd XLink file attribute was not replaced");
  expectRuntime(result.xml.includes('<Other file="old.FCStd"/>'), "FCStd XLink patch changed an unrelated file attribute");
  return "FCStd XLink attribute patch passed";
}

function verifyAppConfig(): string {
  const filename = runtimeAppConfigPath();
  expectRuntime(fs.existsSync(filename), `Application config is missing: ${filename}`);
  const config = JSON.parse(fs.readFileSync(filename, "utf8"));
  expectRuntime(Array.isArray(config?.navigation) && config.navigation.length > 0, "Application config has no navigation entries");
  const pageIds = config.navigation.map((entry: any) => String(entry?.page || "")).filter(Boolean);
  expectRuntime(new Set(pageIds).size === pageIds.length, "Application config contains duplicate navigation page ids");
  return `${pageIds.length} navigation entries loaded from app_config.json`;
}

function verifyUserDataWrite(): string {
  const directory = runtimeUserDataDir();
  fs.mkdirSync(directory, { recursive: true });
  const probe = path.join(directory, `.runtime-write-probe-${process.pid}-${Date.now()}`);
  try {
    fs.writeFileSync(probe, "ok", "utf8");
    expectRuntime(fs.readFileSync(probe, "utf8") === "ok", "User data write probe could not be read back");
  } finally {
    fs.rmSync(probe, { force: true });
  }
  return `User data directory is writable: ${directory}`;
}

function verifyGit(): string {
  const probe = spawnSync("git", ["--version"], {
    encoding: "utf8",
    timeout: 5_000,
    windowsHide: true,
  });
  expectRuntime(!probe.error, `Git could not start: ${probe.error?.message || "unknown error"}`);
  expectRuntime(probe.status === 0, `Git version probe exited with ${probe.status}`);
  const version = String(probe.stdout || probe.stderr || "").trim();
  expectRuntime(/^git version\s+/i.test(version), "Git returned an unexpected version response");
  return version;
}

function verifyScript(filename: string): string {
  const resolved = runtimeScriptCandidates(filename).find((candidate) => fs.existsSync(candidate));
  expectRuntime(resolved, `Packaged adapter script is missing: ${filename}`);
  return `${filename} is available at ${resolved}`;
}

function verifyCatDlgParser(): string {
  const nodes = parseCatDlg("CATDlgDialog RuntimeSelfTest\n{\n  STYLE = CATDlgWndBtn;\n}\n");
  expectRuntime(nodes.length === 1 && nodes[0]?.id === "RuntimeSelfTest", "CAA CATDlg parser did not preserve declaration order");
  return "CAA CATDlg parser passed";
}

function verifyCatNlsPatch(): string {
  const source = "// DO NOT EDIT :: THE CAA2 WIZARD WILL REPLACE ALL THE CODE HERE\nTitle = \"Old\";\n// END WIZARD REPLACEMENT ZONE\n";
  const patched = patchCatNls(source, [{ key: "Title", value: "Runtime Self Test" }]);
  expectRuntime(patched.includes('Title = "Runtime Self Test";'), "CAA CATNls patch did not update the wizard zone");
  return "CAA CATNls patch passed";
}

export function packagedRuntimeChecks(): PackagedRuntimeCheck[] {
  return [
    check("runtime/code/source-codec", "code", "Packaged source services", "round-trips GBK source", verifyGbkCodec),
    check("runtime/cad/fcstd-xml", "cad", "Packaged FCStd services", "patches reference labels", verifyReferenceLabels),
    check("runtime/cad/fcstd-xml", "cad", "Packaged FCStd services", "patches XLink attributes", verifyXlinkAttributes),
    check("runtime/cad/external-adapters", "cad", "Packaged external adapters", "bundles FreeCAD STEP adapter", () => verifyScript("freecad_batch_step_runner.py")),
    check("runtime/cad/external-adapters", "cad", "Packaged external adapters", "bundles SolidWorks STEP adapter", () => verifyScript("sw-step-export.ps1")),
    check("runtime/platform/package", "platform", "Packaged application", "validates runtime manifest", verifyRuntimeManifest),
    check("runtime/platform/package", "platform", "Packaged application", "loads application config", verifyAppConfig),
    check("runtime/platform/user-data", "platform", "Packaged application", "writes user data", verifyUserDataWrite),
    check("runtime/platform/git", "platform", "Packaged application", "starts system Git", verifyGit),
    check("runtime/caa/dialog", "caa", "Packaged CAA services", "parses CATDlg", verifyCatDlgParser),
    check("runtime/caa/dialog", "caa", "Packaged CAA services", "patches CATNls", verifyCatNlsPatch),
  ];
}

export async function runPackagedRuntimeCheck(checkToRun: PackagedRuntimeCheck): Promise<PackagedRuntimeCheckResult> {
  const started = Date.now();
  try {
    const detail = await checkToRun.run();
    return {
      status: "passed",
      durationMs: Date.now() - started,
      message: String(detail || "Runtime check passed"),
      traceback: "",
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      status: error instanceof RuntimeCheckFailure ? "failed" : "error",
      durationMs: Date.now() - started,
      message,
      traceback: error instanceof Error ? error.stack || message : message,
    };
  }
}
