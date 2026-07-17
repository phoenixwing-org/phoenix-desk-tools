import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { zipSync } from "fflate";
import {
  PNW_CAD_NATIVE_PROTOCOL,
  PNW_CAD_NATIVE_SUPPORTED_PROTOCOL_MAJORS,
  PNW_CAD_NATIVE_V1_CAPABILITIES,
  PNW_CAD_QUERY_V1_READ_COMMANDS,
  pnwIsCadNativeProtocolInfo,
  pnwIsCadNativeV1Compatible,
  pnwIsCadNativeV1ReadSuccess,
  pnwIsCadNativeV1XlinkScanSuccess,
  pnwIsCadQueryContractV1,
} from "@phoenix-wing/cad-contracts";
import {
  PNW_WORKSPACE_SCHEMA_ID,
  PNW_WORKSPACE_SCHEMA_V13_SHA256,
  PNW_WORKSPACE_SCHEMA_VERSION,
} from "@phoenix-wing/workspace-schema";

const WING_SOURCE_PACKAGE = "@phoenix-wing/cad-rust-source";
const WING_SOURCE_MANIFEST = `${WING_SOURCE_PACKAGE}/source-manifest.json`;
const CAD_CONTRACTS_PACKAGE = "@phoenix-wing/cad-contracts";
const SUPPORTED_PROTOCOL_MAJOR = PNW_CAD_NATIVE_SUPPORTED_PROTOCOL_MAJORS[0];
const TOOLS = [
  { name: "fcstd-read", capability: PNW_CAD_NATIVE_V1_CAPABILITIES["fcstd-read"][0] },
  { name: "fcstd-xlink", capability: PNW_CAD_NATIVE_V1_CAPABILITIES["fcstd-xlink"][0] },
];
const QUERY_TOOL = "fcstd-query";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const defaultServerRoot = path.resolve(scriptDir, "..");

export function resolveWingRustSource(serverRoot = defaultServerRoot) {
  const requireFromServer = createRequire(path.join(serverRoot, "package.json"));
  let sourceManifestPath;
  try {
    sourceManifestPath = requireFromServer.resolve(WING_SOURCE_MANIFEST);
  } catch (error) {
    throw new Error(
      `Cannot resolve ${WING_SOURCE_MANIFEST}; install the Wing CAD Rust source package before building`,
      { cause: error },
    );
  }
  const sourceManifest = JSON.parse(fs.readFileSync(sourceManifestPath, "utf8"));
  validateSourceManifest(sourceManifest);
  const packageRoot = path.dirname(sourceManifestPath);
  const cargoManifestPath = resolveInsidePackage(
    packageRoot,
    sourceManifest.cargo_manifest,
    "cargo_manifest",
  );
  const cargoLockPath = resolveInsidePackage(
    packageRoot,
    sourceManifest.cargo_lock,
    "cargo_lock",
  );
  assertFile(cargoManifestPath, "Wing Cargo manifest");
  assertFile(cargoLockPath, "Wing Cargo lockfile");
  return { packageRoot, sourceManifest, sourceManifestPath, cargoManifestPath };
}

export function buildNativeTools({
  serverRoot = defaultServerRoot,
  platform = process.platform,
  arch = process.arch,
  cargoCommand = process.env.CARGO || "cargo",
  runCommand = runCommandSync,
} = {}) {
  const source = resolveWingRustSource(serverRoot);
  const targetKey = `${platform}-${arch}`;
  if (!/^[a-z0-9_-]+-[a-z0-9_-]+$/u.test(targetKey)) {
    throw new Error(`Invalid native target: ${targetKey}`);
  }
  const cargoTargetDir = path.join(serverRoot, ".native-target", targetKey);
  const args = [
    "build",
    "--locked",
    "--release",
    "--manifest-path",
    source.cargoManifestPath,
  ];
  runCommand(cargoCommand, args, {
    cwd: source.packageRoot,
    env: { ...process.env, CARGO_TARGET_DIR: cargoTargetDir },
  });

  const outputDir = path.join(serverRoot, "bin");
  fs.mkdirSync(outputDir, { recursive: true });
  const binaries = {};
  for (const tool of TOOLS) {
    const filename = `${tool.name}${platform === "win32" ? ".exe" : ""}`;
    const compiled = path.join(cargoTargetDir, "release", filename);
    assertFile(compiled, `Cargo output for ${tool.name}`);
    const target = path.join(outputDir, filename);
    fs.copyFileSync(compiled, target);
    if (platform !== "win32") fs.chmodSync(target, 0o755);
    const protocolInfo = queryProtocolInfo(target, tool);
    binaries[tool.name] = {
      file: filename,
      sha256: sha256File(target),
      tool_version: protocolInfo.tool_version,
      capabilities: protocolInfo.capabilities,
    };
    process.stdout.write(`[native] ${tool.name} from Wing ${source.sourceManifest.package_version} -> ${target}\n`);
  }
  const queryFilename = `${QUERY_TOOL}${platform === "win32" ? ".exe" : ""}`;
  const queryCompiled = path.join(cargoTargetDir, "release", queryFilename);
  assertFile(queryCompiled, `Cargo output for ${QUERY_TOOL}`);
  const queryTarget = path.join(outputDir, queryFilename);
  fs.copyFileSync(queryCompiled, queryTarget);
  if (platform !== "win32") fs.chmodSync(queryTarget, 0o755);
  const queryContract = queryDatabaseContract(queryTarget);
  binaries[QUERY_TOOL] = {
    file: queryFilename,
    sha256: sha256File(queryTarget),
    capabilities: queryContract.commands,
  };
  process.stdout.write(`[native] ${QUERY_TOOL} from Wing ${source.sourceManifest.package_version} -> ${queryTarget}\n`);

  const parity = verifyNativeParity({ serverRoot, source, outputDir, platform, queryContract });

  const buildManifest = {
    schema_version: 1,
    source_package: WING_SOURCE_PACKAGE,
    source_package_version: source.sourceManifest.package_version,
    source_manifest_schema: source.sourceManifest.schema_version,
    native_protocol: source.sourceManifest.native_protocol,
    database_query_protocol: queryContract,
    target: { platform, arch, profile: "release" },
    cargo_locked: true,
    parity,
    binaries,
  };
  fs.writeFileSync(
    path.join(outputDir, "native-build-manifest.json"),
    `${JSON.stringify(buildManifest, null, 2)}\n`,
    "utf8",
  );
  return { buildManifest, cargoTargetDir, outputDir, source };
}

export function validateSourceManifest(manifest) {
  assertRecord(manifest, "source manifest");
  assertEqual(manifest.schema_version, 4, "source manifest schema_version");
  assertNonEmptyString(manifest.package_version, "source manifest package_version");
  assertNonEmptyString(manifest.cargo_manifest, "source manifest cargo_manifest");
  assertNonEmptyString(manifest.cargo_lock, "source manifest cargo_lock");
  assertRecord(manifest.legacy_protocol, "source manifest legacy_protocol");
  assertEqual(manifest.legacy_protocol.kind, "desk-tools-v0", "legacy protocol kind");
  assertRecord(manifest.native_protocol, "source manifest native_protocol");
  assertEqual(manifest.native_protocol.kind, PNW_CAD_NATIVE_PROTOCOL, "native protocol kind");
  assertEqual(manifest.native_protocol.version_query, true, "native version query");
  assertEqual(
    JSON.stringify(manifest.native_protocol.version_query_args),
    JSON.stringify(["--protocol-version"]),
    "native version query args",
  );
  if (!manifest.native_protocol.supported_protocol_majors?.includes(SUPPORTED_PROTOCOL_MAJOR)) {
    throw new Error(`Wing source does not support native protocol v${SUPPORTED_PROTOCOL_MAJOR}`);
  }
  assertRecord(manifest.database_query_protocol, "source manifest database_query_protocol");
  assertEqual(
    manifest.database_query_protocol.kind,
    "phoenix-cad-query",
    "database query protocol kind",
  );
  assertEqual(
    manifest.database_query_protocol.version?.major,
    1,
    "database query protocol major",
  );
  assertEqual(
    JSON.stringify(manifest.database_query_protocol.contract_query_args),
    JSON.stringify(["--contract"]),
    "database query contract args",
  );
  const querySchema = manifest.database_query_protocol.workspace_schema;
  assertRecord(querySchema, "database query workspace_schema");
  assertEqual(querySchema.id, PNW_WORKSPACE_SCHEMA_ID, "database query workspace schema id");
  assertEqual(
    querySchema.version,
    PNW_WORKSPACE_SCHEMA_VERSION,
    "database query workspace schema version",
  );
  assertEqual(
    querySchema.ddl_sha256,
    PNW_WORKSPACE_SCHEMA_V13_SHA256,
    "database query workspace schema hash",
  );
  assertRecord(manifest.binaries, "source manifest binaries");
  for (const tool of TOOLS) {
    const binary = manifest.binaries[tool.name];
    assertRecord(binary, `source manifest binaries.${tool.name}`);
    if (!binary.protocol_v1_capabilities?.includes(tool.capability)) {
      throw new Error(`${tool.name} source manifest is missing ${tool.capability} capability`);
    }
  }
  assertRecord(manifest.database_tools, "source manifest database_tools");
  const queryTool = manifest.database_tools[QUERY_TOOL];
  assertRecord(queryTool, `source manifest database_tools.${QUERY_TOOL}`);
  assertEqual(queryTool.package, QUERY_TOOL, "database query Cargo package");
  assertEqual(
    JSON.stringify(queryTool.contract_query_args),
    JSON.stringify(["--contract"]),
    "database query tool contract args",
  );
  if (!PNW_CAD_QUERY_V1_READ_COMMANDS.every((command) => queryTool.capabilities?.includes(command))) {
    throw new Error(`${QUERY_TOOL} source manifest is missing read capabilities`);
  }
  assertRecord(manifest.parity_fixtures, "source manifest parity_fixtures");
  const read = manifest.parity_fixtures.read;
  assertRecord(read, "source manifest parity_fixtures.read");
  assertNonEmptyString(read.document_xml, "read parity document_xml");
  assertNonEmptyString(read.selected_object, "read parity selected_object");
  assertNonEmptyString(read.expected_contract_fixture, "read parity expected_contract_fixture");
  const xlinkScan = manifest.parity_fixtures.xlink_scan;
  assertRecord(xlinkScan, "source manifest parity_fixtures.xlink_scan");
  assertNonEmptyString(xlinkScan.document_xml, "xlink parity document_xml");
  assertNonEmptyString(xlinkScan.target_basename, "xlink parity target_basename");
  assertNonEmptyString(xlinkScan.expected_contract_fixture, "xlink parity expected_contract_fixture");
  const databaseQuery = manifest.parity_fixtures.database_query;
  assertRecord(databaseQuery, "source manifest parity_fixtures.database_query");
  assertEqual(databaseQuery.schema_version, PNW_WORKSPACE_SCHEMA_VERSION, "query parity schema version");
  assertNonEmptyString(databaseQuery.sql_fixture, "query parity SQL fixture");
  assertNonEmptyString(databaseQuery.expected_contract_fixture, "query parity contract fixture");
}

export function validateProtocolInfo(info, tool) {
  if (!pnwIsCadNativeProtocolInfo(info)) {
    throw new Error(`${tool.name} protocol info does not satisfy @phoenix-wing/cad-contracts`);
  }
  if (!pnwIsCadNativeV1Compatible(info)) {
    throw new Error(`${tool.name} does not support native protocol v${SUPPORTED_PROTOCOL_MAJOR}`);
  }
  assertEqual(info.protocol, PNW_CAD_NATIVE_PROTOCOL, `${tool.name} protocol`);
  assertEqual(info.tool, tool.name, `${tool.name} tool`);
  assertNonEmptyString(info.tool_version, `${tool.name} tool_version`);
  if (!info.supported_protocol_majors?.includes(SUPPORTED_PROTOCOL_MAJOR)) {
    throw new Error(`${tool.name} does not support native protocol v${SUPPORTED_PROTOCOL_MAJOR}`);
  }
  if (!Array.isArray(info.capabilities) || !info.capabilities.includes(tool.capability)) {
    throw new Error(`${tool.name} is missing ${tool.capability} capability`);
  }
  assertEqual(info.legacy_compatible, true, `${tool.name} legacy_compatible`);
  return info;
}

function queryProtocolInfo(binaryPath, tool) {
  const result = spawnSync(binaryPath, ["--protocol-version"], {
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
    timeout: 15_000,
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${tool.name} protocol query failed: ${String(result.stderr).trim()}`);
  }
  if (String(result.stderr).trim()) {
    throw new Error(`${tool.name} protocol query wrote stderr: ${String(result.stderr).trim()}`);
  }
  let info;
  try {
    info = JSON.parse(String(result.stdout).trim());
  } catch (error) {
    throw new Error(`${tool.name} protocol query returned invalid JSON`, { cause: error });
  }
  return validateProtocolInfo(info, tool);
}

function queryDatabaseContract(binaryPath) {
  const result = spawnSync(binaryPath, ["--contract"], {
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
    timeout: 15_000,
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${QUERY_TOOL} contract query failed: ${String(result.stderr).trim()}`);
  }
  if (String(result.stderr).trim()) {
    throw new Error(`${QUERY_TOOL} contract query wrote stderr: ${String(result.stderr).trim()}`);
  }
  let contract;
  try {
    contract = JSON.parse(String(result.stdout).trim());
  } catch (error) {
    throw new Error(`${QUERY_TOOL} contract query returned invalid JSON`, { cause: error });
  }
  if (!pnwIsCadQueryContractV1(contract)) {
    throw new Error(`${QUERY_TOOL} contract does not satisfy @phoenix-wing/cad-contracts`);
  }
  if (contract.schema.id !== PNW_WORKSPACE_SCHEMA_ID
      || contract.schema.version !== PNW_WORKSPACE_SCHEMA_VERSION
      || contract.schema.ddl_sha256 !== PNW_WORKSPACE_SCHEMA_V13_SHA256) {
    throw new Error(`${QUERY_TOOL} workspace schema identity differs from Desk Tools`);
  }
  return contract;
}

function verifyNativeParity({ serverRoot, source, outputDir, platform, queryContract }) {
  const read = verifyReadParity({ serverRoot, source, outputDir, platform });
  const parity = source.sourceManifest.parity_fixtures.xlink_scan;
  const documentXmlPath = resolveInsidePackage(
    source.packageRoot,
    parity.document_xml,
    "parity_fixtures.xlink_scan.document_xml",
  );
  assertFile(documentXmlPath, "Wing XLink parity Document.xml");
  const requireFromServer = createRequire(path.join(serverRoot, "package.json"));
  const expectedPath = requireFromServer.resolve(
    `${CAD_CONTRACTS_PACKAGE}/fixtures/${parity.expected_contract_fixture}`,
  );
  const expected = JSON.parse(fs.readFileSync(expectedPath, "utf8"));
  if (!pnwIsCadNativeV1XlinkScanSuccess(expected)) {
    throw new Error("Wing XLink parity golden JSON does not satisfy cad-contracts v1 guard");
  }

  const binaryPath = path.join(
    outputDir,
    `fcstd-xlink${platform === "win32" ? ".exe" : ""}`,
  );
  const result = spawnSync(
    binaryPath,
    ["--protocol", String(SUPPORTED_PROTOCOL_MAJOR), "scan", documentXmlPath, parity.target_basename],
    { encoding: "utf8", maxBuffer: 4 * 1024 * 1024, timeout: 15_000, windowsHide: true },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`fcstd-xlink parity scan failed: ${String(result.stderr).trim()}`);
  }
  if (String(result.stderr).trim()) {
    throw new Error(`fcstd-xlink parity scan wrote stderr: ${String(result.stderr).trim()}`);
  }
  const actual = JSON.parse(String(result.stdout).trim());
  if (!pnwIsCadNativeV1XlinkScanSuccess(actual)) {
    throw new Error("fcstd-xlink parity output does not satisfy cad-contracts v1 guard");
  }
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error("fcstd-xlink parity output differs from Wing golden JSON");
  }
  process.stdout.write(`[native] fcstd-xlink parity -> ${parity.expected_contract_fixture}\n`);
  return {
    read,
    xlink_scan: {
      verified: true,
      expected_contract_fixture: parity.expected_contract_fixture,
      document_xml_sha256: sha256File(documentXmlPath),
    },
    database_query: verifyQueryParity({ serverRoot, source, queryContract }),
  };
}

function verifyQueryParity({ serverRoot, source, queryContract }) {
  const parity = source.sourceManifest.parity_fixtures.database_query;
  const sourceExpectedPath = resolveInsidePackage(
    source.packageRoot,
    parity.expected_contract_fixture,
    "parity_fixtures.database_query.expected_contract_fixture",
  );
  assertFile(sourceExpectedPath, "Wing query contract fixture");
  const requireFromServer = createRequire(path.join(serverRoot, "package.json"));
  const contractsExpectedPath = requireFromServer.resolve(
    `${CAD_CONTRACTS_PACKAGE}/fixtures/${path.basename(parity.expected_contract_fixture)}`,
  );
  const sourceExpected = JSON.parse(fs.readFileSync(sourceExpectedPath, "utf8"));
  const contractsExpected = JSON.parse(fs.readFileSync(contractsExpectedPath, "utf8"));
  if (stableJson(sourceExpected) !== stableJson(contractsExpected)
      || stableJson(queryContract) !== stableJson(contractsExpected)) {
    throw new Error(`${QUERY_TOOL} contract differs from Wing golden JSON`);
  }
  process.stdout.write(`[native] ${QUERY_TOOL} parity -> ${path.basename(parity.expected_contract_fixture)}\n`);
  return {
    verified: true,
    expected_contract_fixture: path.basename(parity.expected_contract_fixture),
    schema_version: queryContract.schema.version,
  };
}

function verifyReadParity({ serverRoot, source, outputDir, platform }) {
  const parity = source.sourceManifest.parity_fixtures.read;
  const documentXmlPath = resolveInsidePackage(
    source.packageRoot,
    parity.document_xml,
    "parity_fixtures.read.document_xml",
  );
  assertFile(documentXmlPath, "Wing read parity Document.xml");
  const requireFromServer = createRequire(path.join(serverRoot, "package.json"));
  const expectedPath = requireFromServer.resolve(
    `${CAD_CONTRACTS_PACKAGE}/fixtures/${parity.expected_contract_fixture}`,
  );
  const expected = JSON.parse(fs.readFileSync(expectedPath, "utf8"));
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "phoenix-read-parity-"));
  const fcstdPath = path.join(tempRoot, "real-document.FCStd");
  try {
    const documentXml = fs.readFileSync(documentXmlPath);
    fs.writeFileSync(fcstdPath, zipSync({ "Document.xml": new Uint8Array(documentXml) }));
    const binaryPath = path.join(
      outputDir,
      `fcstd-read${platform === "win32" ? ".exe" : ""}`,
    );
    const result = spawnSync(
      binaryPath,
      ["--protocol", String(SUPPORTED_PROTOCOL_MAJOR), "read", fcstdPath],
      { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: 30_000, windowsHide: true },
    );
    if (result.error) throw result.error;
    if (result.status !== 0) {
      throw new Error(`fcstd-read parity failed: ${String(result.stderr).trim()}`);
    }
    if (String(result.stderr).trim()) {
      throw new Error(`fcstd-read parity wrote stderr: ${String(result.stderr).trim()}`);
    }
    const response = JSON.parse(String(result.stdout).trim());
    if (!pnwIsCadNativeV1ReadSuccess(response)) {
      throw new Error("fcstd-read parity output does not satisfy cad-contracts v1 guard");
    }
    const selected = response.result.objects.find((object) => object.name === parity.selected_object);
    if (!selected) throw new Error(`fcstd-read parity object is missing: ${parity.selected_object}`);
    const actual = {
      protocol: response.protocol,
      protocol_version: response.protocol_version,
      tool: response.tool,
      operation: response.operation,
      ok: response.ok,
      source_fixture: parity.document_xml,
      summary: {
        objects: response.result.objects.length,
        bom_items: response.result.objects.filter((object) => object.is_valid_bom_item).length,
        xlinks: response.result.xlinks.length,
        root_names: response.result.root_names,
        selected: {
          name: selected.name,
          label: selected.label,
          type_id: selected.type_id,
          properties: selected.properties,
          level: selected.level,
        },
      },
    };
    if (stableJson(actual) !== stableJson(expected)) {
      throw new Error("fcstd-read parity summary differs from Wing golden JSON");
    }
    process.stdout.write(`[native] fcstd-read parity -> ${parity.expected_contract_fixture}\n`);
    return {
      verified: true,
      expected_contract_fixture: parity.expected_contract_fixture,
      document_xml_sha256: sha256File(documentXmlPath),
    };
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => (
      `${JSON.stringify(key)}:${stableJson(value[key])}`
    )).join(",")}}`;
  }
  return JSON.stringify(value);
}

function runCommandSync(command, args, options) {
  const result = spawnSync(command, args, { ...options, stdio: "inherit", windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}

function resolveInsidePackage(packageRoot, relativePath, label) {
  assertNonEmptyString(relativePath, label);
  const resolved = path.resolve(packageRoot, relativePath);
  const relative = path.relative(packageRoot, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`${label} must stay inside ${WING_SOURCE_PACKAGE}`);
  }
  return resolved;
}

function assertFile(filePath, label) {
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    throw new Error(`${label} does not exist: ${filePath}`);
  }
}

function sha256File(filePath) {
  return createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function assertRecord(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
}

function assertNonEmptyString(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be non-empty`);
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) throw new Error(`${label} must equal ${JSON.stringify(expected)}`);
}

const isMain = process.argv[1]
  && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMain) buildNativeTools();
