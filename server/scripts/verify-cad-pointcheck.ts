import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { pnwCreateDb } from "@phoenix-wing/db-node";
import {
  loadBomPreview,
  renameBomFcstdFile,
  writeBomToFcstd,
} from "../src/lib/bomAttributeService.js";
import { readFcstdEmbeddedBomFields } from "../src/lib/fcstdDocumentXmlService.js";
import {
  loadAssemblyTreeFromXrefs,
  queryXrefCountsForRel,
  refreshBomXrefsForHosts,
  searchIncomingRefs,
  searchOutgoingRefs,
} from "../src/lib/pnwBomXrefService.js";
import {
  analyzeRenameReferences,
  applyRenameCorrections,
  executeDiskFileRename,
  listRenameLogs,
} from "../src/lib/pnwRenameService.js";
import {
  assertSafeFreecadCommand,
  buildFreecadChildEnvironment,
  redactSensitiveJson,
  redactSensitiveText,
  truncateExternalProcessText,
} from "../src/lib/freecadProcessSecurity.js";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const deskRoot = path.resolve(scriptDir, "../..");
const fixtureSubdir = "01-零件装配";
const sourceNames = [
  "8002.001-H-PX-滑动装置.ASSY.FCStd",
  "8003.001-H-PX-滑轨.FCStd",
  "8003.001-H-PX-滑轨.Drawing.FCStd",
  "8004.001-H-PX-滑块.FCStd",
  "8005.001-H-PX-螺栓.FCStd",
] as const;
const originalPartName = sourceNames[1];
const renamedPartName = "8103.002-H-PX-滑轨点检.FCStd";
const assemblyName = sourceNames[0];
const drawingName = sourceNames[2];

type CliOptions = {
  sourceRoot: string;
  autoCadRoot: string;
  freecadCmd: string;
  receipt: string;
  keep: boolean;
};

type FreeCadItem = {
  rel: string;
  ok: boolean;
  object_count?: number;
  labels?: string[];
  bom_objects?: Array<Record<string, string>>;
  error?: string;
};

function optionValue(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function parseOptions(args: string[]): CliOptions {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const configuredFreecadCmd = path.resolve(
    optionValue(args, "--freecadcmd")
      || process.env.FREECADCMD
      || "/Applications/FreeCAD.app/Contents/Resources/bin/freecadcmd",
  );
  return {
    sourceRoot: path.resolve(optionValue(args, "--source-root") || process.env.PHOENIX_FREECAD_STUDY_ROOT || path.join(deskRoot, "../phoenix-freecad-study")),
    autoCadRoot: path.resolve(optionValue(args, "--auto-cad-root") || process.env.KT_AUTO_CAD_ROOT || path.join(deskRoot, "../kt-auto-cad")),
    freecadCmd: assertSafeFreecadCommand(configuredFreecadCmd),
    receipt: path.resolve(optionValue(args, "--receipt") || path.join(os.tmpdir(), `phoenix-cad-pointcheck-${stamp}.json`)),
    keep: args.includes("--keep"),
  };
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function sha256(filename: string): string {
  return createHash("sha256").update(fs.readFileSync(filename)).digest("hex");
}

function rel(name: string): string {
  return `${fixtureSubdir}/${name}`;
}

function gitInfo(root: string): Record<string, unknown> {
  const run = (args: string[]) => spawnSync("git", ["-C", root, ...args], { encoding: "utf8" });
  const branch = run(["branch", "--show-current"]);
  const commit = run(["rev-parse", "HEAD"]);
  const status = run(["status", "--short"]);
  return {
    root,
    branch: branch.status === 0 ? branch.stdout.trim() : null,
    commit: commit.status === 0 ? commit.stdout.trim() : null,
    dirty_paths: status.status === 0
      ? status.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
      : [],
  };
}

function ensureInputs(options: CliOptions): void {
  assert(fs.statSync(options.sourceRoot).isDirectory(), `FreeCAD study root is not a directory: ${options.sourceRoot}`);
  assert(fs.statSync(options.autoCadRoot).isDirectory(), `KT Auto CAD root is not a directory: ${options.autoCadRoot}`);
  assert(fs.statSync(options.freecadCmd).isFile(), `FreeCADCmd is not a file: ${options.freecadCmd}`);
  for (const name of sourceNames) {
    const filename = path.join(options.sourceRoot, fixtureSubdir, name);
    assert(fs.statSync(filename).isFile(), `Required source fixture is missing: ${filename}`);
  }
}

function copyFixtures(options: CliOptions, workspace: string): Record<string, string> {
  const destinationDir = path.join(workspace, fixtureSubdir);
  fs.mkdirSync(destinationDir, { recursive: true });
  const hashes: Record<string, string> = {};
  for (const name of sourceNames) {
    const source = path.join(options.sourceRoot, fixtureSubdir, name);
    const destination = path.join(destinationDir, name);
    fs.copyFileSync(source, destination, fs.constants.COPYFILE_EXCL);
    const sourceHash = sha256(source);
    assert(sha256(destination) === sourceHash, `Fixture copy hash mismatch: ${name}`);
    hashes[rel(name)] = sourceHash;
  }
  return hashes;
}

function sourceHashes(options: CliOptions): Record<string, string> {
  return Object.fromEntries(sourceNames.map((name) => [rel(name), sha256(path.join(options.sourceRoot, fixtureSubdir, name))]));
}

function freeCadVersion(freecadCmd: string): string {
  const result = spawnSync(freecadCmd, ["--version"], {
    encoding: "utf8",
    env: buildFreecadChildEnvironment(process.env),
    maxBuffer: 1024 * 1024,
    timeout: 30_000,
  });
  const output = redactSensitiveText(`${result.stdout || ""}\n${result.stderr || ""}`);
  assert(result.status === 0, `FreeCADCmd version probe failed (${result.status}): ${truncateExternalProcessText(output, 16_384)}`);
  const lines = output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  return lines.find((line) => /freecad|version|revision/i.test(line)) || lines[0] || "unknown";
}

function runFreeCad(
  freecadCmd: string,
  workspace: string,
  relativePaths: string[],
  save: boolean,
): { items: FreeCadItem[]; warnings: string[] } {
  const python = `
import FreeCAD
import json
import os
import traceback

root = os.environ["PHOENIX_CAD_POINTCHECK_ROOT"]
paths = json.loads(os.environ["PHOENIX_CAD_POINTCHECK_PATHS"])
save_docs = os.environ.get("PHOENIX_CAD_POINTCHECK_SAVE") == "1"
keys = ["PartNumber", "PartVersion", "TypeCode", "ModelSeries", "PartName", "Label"]
items = []
for rel_path in paths:
    item = {"rel": rel_path, "ok": False}
    try:
        filename = os.path.join(root, *rel_path.split("/"))
        document = FreeCAD.openDocument(filename)
        document.recompute()
        if save_docs:
            document.save()
        document_name = document.Name
        FreeCAD.closeDocument(document_name)
        reopened = FreeCAD.openDocument(filename)
        reopened.recompute()
        bom_objects = []
        labels = []
        for obj in reopened.Objects:
            label = str(getattr(obj, "Label", ""))
            if label:
                labels.append(label)
            values = {}
            for key in keys:
                if hasattr(obj, key):
                    values[key] = str(getattr(obj, key, ""))
            if any(values.get(key, "") for key in ["PartNumber", "PartVersion", "TypeCode", "ModelSeries", "PartName"]):
                values["ObjectName"] = str(getattr(obj, "Name", ""))
                bom_objects.append(values)
        item.update({"ok": True, "object_count": len(reopened.Objects), "labels": labels[:20], "bom_objects": bom_objects})
        FreeCAD.closeDocument(reopened.Name)
    except Exception as exc:
        item["error"] = str(exc)
        traceback.print_exc()
    items.append(item)

print("PHOENIX_CAD_POINTCHECK_RESULT=" + json.dumps({"items": items}, ensure_ascii=False))
exit()
`;
  const result = spawnSync(freecadCmd, ["-c"], {
    encoding: "utf8",
    env: buildFreecadChildEnvironment(process.env, {
      PHOENIX_CAD_POINTCHECK_ROOT: workspace,
      PHOENIX_CAD_POINTCHECK_PATHS: JSON.stringify(relativePaths),
      PHOENIX_CAD_POINTCHECK_SAVE: save ? "1" : "0",
    }),
    input: python,
    maxBuffer: 64 * 1024 * 1024,
    timeout: 180_000,
  });
  const combined = `${result.stdout || ""}\n${result.stderr || ""}`;
  const safeCombined = redactSensitiveText(combined);
  assert(result.status === 0, `FreeCADCmd failed (${result.status}): ${truncateExternalProcessText(safeCombined, 16_384)}`);
  const markerPrefix = "PHOENIX_CAD_POINTCHECK_RESULT=";
  const marker = combined.split(/\r?\n/).find((line) => line.includes(markerPrefix));
  assert(marker, `FreeCADCmd result marker is missing: ${truncateExternalProcessText(safeCombined, 16_384)}`);
  const payload = redactSensitiveJson(
    JSON.parse(marker.slice(marker.indexOf(markerPrefix) + markerPrefix.length)),
  ) as { items: FreeCadItem[] };
  assert(payload.items.every((item) => item.ok), `FreeCADCmd could not reopen every fixture: ${JSON.stringify(payload.items)}`);
  const warnings = safeCombined.split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("PHOENIX_CAD_POINTCHECK_RESULT=") && (
      /warning|error|traceback|not found|nameerror|invalid/i.test(line)
    ))
    .slice(-30);
  return { items: payload.items, warnings };
}

function buildAutoCadIndex(
  autoCadRoot: string,
  workspace: string,
  relativePaths: string[],
): {
  result: Record<string, unknown>;
  plan: { assets: number; references: number; bom_lines: number; parse_failures: number };
} {
  const runnerRoot = fs.mkdtempSync(path.join(os.tmpdir(), "phoenix-auto-cad-index-runner-"));
  const entry = path.join(runnerRoot, "index-entry.ts");
  const bundle = path.join(runnerRoot, "index-entry.mjs");
  const input = path.join(runnerRoot, "input.json");
  const output = path.join(runnerRoot, "output.json");
  const readerImport = JSON.stringify(path.join(autoCadRoot, "src/fcstdTsReader.ts"));
  const indexImport = JSON.stringify(path.join(autoCadRoot, "src/workspaceIndex.ts"));
  fs.writeFileSync(entry, `
import fs from "node:fs";
import path from "node:path";
import { analyzeFcstdBytes } from ${readerImport};
import { buildCadWorkspaceIndex, writeCadWorkspaceIndex } from ${indexImport};

const [inputFile, outputFile] = process.argv.slice(2);
const payload = JSON.parse(fs.readFileSync(inputFile, "utf8"));
const kind = (filename) => {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".drawing.fcstd")) return "drawing";
  if (lower.endsWith(".assy.fcstd")) return "assembly";
  return "part";
};
const records = payload.relativePaths.map((relativePath) => {
  const filename = path.join(payload.workspace, ...relativePath.split("/"));
  const stat = fs.statSync(filename);
  const analysis = analyzeFcstdBytes(new Uint8Array(fs.readFileSync(filename)));
  return {
    relativePath,
    filename: path.posix.basename(relativePath),
    documentKind: kind(relativePath),
    sizeBytes: stat.size,
    modifiedAtMs: stat.mtimeMs,
    objectCount: analysis.objectCount,
    xlinks: analysis.xlinks,
  };
});
const plan = buildCadWorkspaceIndex(records);
fs.mkdirSync(path.join(payload.workspace, ".phoenix"), { recursive: true });
const result = await writeCadWorkspaceIndex(
  path.join(payload.workspace, ".phoenix", "phoenix-workspace.sqlite"),
  payload.workspace,
  plan,
);
fs.writeFileSync(outputFile, JSON.stringify({
  result,
  plan: {
    assets: plan.assets.length,
    references: plan.references.length,
    bom_lines: plan.bomLines.length,
    parse_failures: plan.parseFailures,
  },
}));
`, "utf8");
  fs.writeFileSync(input, JSON.stringify({ workspace, relativePaths }), "utf8");
  try {
    const esbuild = path.join(autoCadRoot, "node_modules", ".bin", "esbuild");
    assert(fs.existsSync(esbuild), `KT Auto CAD esbuild is missing: ${esbuild}`);
    const built = spawnSync(esbuild, [
      entry,
      "--bundle",
      "--platform=node",
      "--format=esm",
      "--target=node22",
      `--outfile=${bundle}`,
    ], { encoding: "utf8", timeout: 120_000, maxBuffer: 32 * 1024 * 1024 });
    const buildOutput = redactSensitiveText(built.stderr || built.stdout || "");
    assert(built.status === 0, `KT Auto CAD index runner bundle failed: ${truncateExternalProcessText(buildOutput, 16_384)}`);
    const executed = spawnSync(process.execPath, [bundle, input, output], {
      encoding: "utf8",
      timeout: 120_000,
      maxBuffer: 32 * 1024 * 1024,
    });
    const executionOutput = redactSensitiveText(executed.stderr || executed.stdout || "");
    assert(executed.status === 0, `KT Auto CAD index runner failed: ${truncateExternalProcessText(executionOutput, 16_384)}`);
    return JSON.parse(fs.readFileSync(output, "utf8"));
  } finally {
    fs.rmSync(runnerRoot, { recursive: true, force: true });
  }
}

function readAssetRow(workspace: string, relativePath: string): Record<string, unknown> | undefined {
  const db = pnwCreateDb(path.join(workspace, ".phoenix", "phoenix-workspace.sqlite"));
  try {
    return db.get<Record<string, unknown>>(
      `SELECT id, repo_rel_path, filename, asset_kind, part_number, part_version,
              type_code, model_series, part_name, label, file_status, bom_json
       FROM phoenix_cad_file_asset
       WHERE repo_rel_path IN (?, ?)
       LIMIT 1`,
      [relativePath, `./${relativePath}`],
    );
  } finally {
    db.close();
  }
}

function findAtomicLeftovers(root: string): string[] {
  const found: string[] = [];
  const visit = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else if (/\.phoenix-.*\.(tmp|backup)$/.test(entry.name)) found.push(path.relative(root, absolute).replace(/\\/g, "/"));
    }
  };
  visit(root);
  return found.sort();
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "phoenix-cad-pointcheck-workspace-"));
  const receipt: Record<string, any> = {
    protocol: "phoenix-cad-pointcheck",
    version: 1,
    started_at: new Date().toISOString(),
    status: "running",
    scope: { os: "macOS", windows: "excluded", ui_lock_safe: true },
    inputs: {
      desk: gitInfo(deskRoot),
      auto_cad: gitInfo(options.autoCadRoot),
      freecad_study: gitInfo(options.sourceRoot),
      source_root: options.sourceRoot,
      fixture_subdir: fixtureSubdir,
      fixture_files: [...sourceNames],
      freecadcmd: options.freecadCmd,
    },
    workspace: { path: workspace, retained: options.keep },
    checks: {},
  };
  try {
    ensureInputs(options);
    receipt.inputs.freecad_version = freeCadVersion(options.freecadCmd);
    const originalHashes = copyFixtures(options, workspace);
    receipt.checks.source_copy = { passed: true, sha256: originalHashes };

    const baselineRels = sourceNames.map(rel);
    receipt.checks.freecad_baseline = {
      passed: true,
      save: false,
      ...runFreeCad(options.freecadCmd, workspace, baselineRels, false),
    };

    const autoIndex = buildAutoCadIndex(options.autoCadRoot, workspace, baselineRels);
    const baselineAssemblyRefs = searchOutgoingRefs(workspace, rel(assemblyName));
    const baselineDrawingRefs = searchOutgoingRefs(workspace, rel(drawingName));
    assert(baselineAssemblyRefs.count >= 3, `Expected at least 3 assembly XLinks, got ${baselineAssemblyRefs.count}`);
    assert(baselineDrawingRefs.count >= 1, `Expected at least 1 drawing XLink, got ${baselineDrawingRefs.count}`);
    receipt.checks.auto_cad_index = {
      passed: true,
      result: autoIndex.result,
      plan: autoIndex.plan,
      assembly_refs: baselineAssemblyRefs.count,
      drawing_refs: baselineDrawingRefs.count,
    };

    const targetRel = rel(originalPartName);
    const targetFields = {
      PartNumber: "8103",
      PartVersion: "002",
      TypeCode: "h",
      ModelSeries: "px",
      PartName: "滑轨点检 & A+B",
      label: "8103.002-滑轨点检 & A+B",
    };
    const targetWrite = await writeBomToFcstd(workspace, targetRel, targetFields);
    const targetEmbedded = readFcstdEmbeddedBomFields(path.join(workspace, targetRel));
    const targetIndex = readAssetRow(workspace, targetRel);
    assert(targetWrite.index_updated === true, "Target BOM write did not update the existing Auto CAD index row");
    assert(targetEmbedded?.PartNumber === "8103" && targetEmbedded?.PartVersion === "002", "Target embedded BOM fields were not written");
    assert(targetEmbedded?.TypeCode === "H" && targetEmbedded?.ModelSeries === "PX", "Target embedded fields were not normalized");
    assert(targetEmbedded?.PartName === targetFields.PartName && targetEmbedded?.label === targetFields.label, "Target embedded special characters did not round-trip");
    assert(targetIndex?.part_number === "8103" && targetIndex?.part_version === "002", "Target index identity is stale after BOM write");
    assert(targetIndex?.part_name === targetFields.PartName && targetIndex?.label === targetFields.label, "Target index display fields are stale after BOM write");

    const assemblyRel = rel(assemblyName);
    const assemblyFields = {
      PartNumber: "8202",
      PartVersion: "003",
      TypeCode: "H",
      ModelSeries: "PX",
      PartName: "滑动装置点检",
      label: "8202.003-滑动装置点检",
    };
    const assemblyWrite = await writeBomToFcstd(workspace, assemblyRel, assemblyFields);
    const assemblyPreview = loadBomPreview(workspace, assemblyRel);
    assert(assemblyWrite.index_updated === true, "Assembly BOM write did not update the existing Auto CAD index row");
    assert(assemblyPreview.fields.PartNumber === assemblyFields.PartNumber, "Desk BOM preview did not reread assembly fields");
    receipt.checks.bom_properties = {
      passed: true,
      target: { write: targetWrite, embedded: targetEmbedded, index: targetIndex },
      assembly: { write: assemblyWrite, reread: assemblyPreview.fields, index: readAssetRow(workspace, assemblyRel) },
    };

    const conflictSourceRel = rel(sourceNames[3]);
    const conflictTargetRel = rel(sourceNames[4]);
    const conflictBefore = {
      source: sha256(path.join(workspace, conflictSourceRel)),
      target: sha256(path.join(workspace, conflictTargetRel)),
      logs: listRenameLogs(workspace).entries.length,
    };
    let conflictError = "";
    try {
      executeDiskFileRename(workspace, conflictSourceRel, { filename: sourceNames[4] });
    } catch (error: any) {
      conflictError = error.message || String(error);
    }
    const conflictAfter = {
      source: sha256(path.join(workspace, conflictSourceRel)),
      target: sha256(path.join(workspace, conflictTargetRel)),
      logs: listRenameLogs(workspace).entries.length,
    };
    assert(/already exists/i.test(conflictError), `Rename conflict did not fail closed: ${conflictError}`);
    assert(JSON.stringify(conflictBefore) === JSON.stringify(conflictAfter), "Rename conflict changed files or audit logs");
    receipt.checks.rename_conflict = { passed: true, error: conflictError, before: conflictBefore, after: conflictAfter };

    const renamed = await renameBomFcstdFile(workspace, targetRel, {
      ...targetFields,
      filename: renamedPartName,
      baseline: targetFields,
    });
    const newTargetRel = rel(renamedPartName);
    assert(renamed.map_updated === true, "Disk rename did not update the existing Auto CAD index path");
    assert(!fs.existsSync(path.join(workspace, targetRel)) && fs.existsSync(path.join(workspace, newTargetRel)), "Disk rename state is inconsistent");
    assert(readAssetRow(workspace, newTargetRel)?.filename === renamedPartName, "Renamed index path is inconsistent");
    const analysis = analyzeRenameReferences(workspace, { rename_log_id: renamed.rename_log_id, transitive: true });
    const directHosts = analysis.hosts.filter((host) => host.hit_count > 0).map((host) => host.host_repo_rel_path);
    const directHostKeys = directHosts.map((host) => host.replace(/^\.\//, ""));
    assert(directHosts.length === 2, `Expected assembly and drawing rename hosts, got ${JSON.stringify(directHosts)}`);
    assert(directHostKeys.includes(assemblyRel) && directHostKeys.includes(rel(drawingName)), `Unexpected rename hosts: ${JSON.stringify(directHosts)}`);
    const xlinkResult = applyRenameCorrections(workspace, {
      rename_log_id: renamed.rename_log_id,
      host_repo_rel_paths: directHosts,
      transitive: true,
    });
    assert(xlinkResult.failed.length === 0 && xlinkResult.xlink_patches === 2, `XLink correction failed: ${JSON.stringify(xlinkResult)}`);
    const labelResult = applyRenameCorrections(workspace, {
      rename_log_id: renamed.rename_log_id,
      host_repo_rel_paths: directHosts,
      labels_only: true,
      transitive: true,
    });
    assert(labelResult.failed.length === 0 && labelResult.label_patches === 2, `Label correction failed: ${JSON.stringify(labelResult)}`);
    assert(labelResult.label_changes.every((change: any) => change.new_label === targetFields.label), `Unexpected corrected Label: ${JSON.stringify(labelResult.label_changes)}`);
    receipt.checks.rename_and_references = {
      passed: true,
      rename: renamed,
      analysis: {
        direct_hosts: directHosts,
        hit_count: analysis.hit_count,
        pending_hit_count: analysis.pending_hit_count,
      },
      xlink: xlinkResult,
      label: labelResult,
    };

    refreshBomXrefsForHosts(workspace, [assemblyRel, rel(drawingName)]);
    const assemblyOutgoing = searchOutgoingRefs(workspace, assemblyRel);
    const drawingOutgoing = searchOutgoingRefs(workspace, rel(drawingName));
    const incoming = searchIncomingRefs(workspace, { rel: newTargetRel, transitive: true });
    const oldCounts = queryXrefCountsForRel(workspace, targetRel);
    const newCounts = queryXrefCountsForRel(workspace, newTargetRel);
    const tree = loadAssemblyTreeFromXrefs(workspace, assemblyRel, { full: true });
    const outgoing = [...assemblyOutgoing.refs, ...drawingOutgoing.refs].filter((edge: any) => edge.target_repo_rel_path === `./${newTargetRel}`);
    assert(outgoing.length === 2, `Expected two corrected outgoing references, got ${outgoing.length}`);
    assert(outgoing.every((edge: any) => edge.xlink_file_attr === renamedPartName), `Corrected XLink attributes are inconsistent: ${JSON.stringify(outgoing)}`);
    assert(outgoing.every((edge: any) => edge.link_label === targetFields.label && edge.rule_label === targetFields.label), `Corrected XLink labels are inconsistent: ${JSON.stringify(outgoing)}`);
    assert(oldCounts.incoming === 0 && newCounts.incoming === 2, `Incoming XRef counts are inconsistent: ${JSON.stringify({ oldCounts, newCounts })}`);
    assert(incoming.direct_count === 2, `Expected two direct incoming hosts, got ${incoming.direct_count}`);
    assert(JSON.stringify(tree).includes(newTargetRel) && !JSON.stringify(tree).includes(targetRel), "Assembly tree still contains the old target path");
    receipt.checks.bom_xref_index = {
      passed: true,
      old_counts: oldCounts,
      new_counts: newCounts,
      incoming: { count: incoming.count, direct_count: incoming.direct_count, hosts: incoming.hosts },
      outgoing,
      tree: { node_count: tree.node_count, mode: tree.mode },
    };

    const finalRels = sourceNames.map((name) => name === originalPartName ? newTargetRel : rel(name));
    const finalFreeCad = runFreeCad(options.freecadCmd, workspace, finalRels, true);
    const finalTarget = finalFreeCad.items.find((item) => item.rel === newTargetRel);
    assert(finalTarget, "FreeCAD final target result is missing");
    const freeCadBom = finalTarget.bom_objects?.find((item) => item.PartNumber === targetFields.PartNumber);
    assert(freeCadBom?.PartVersion === targetFields.PartVersion, `FreeCAD did not persist target BOM fields: ${JSON.stringify(finalTarget.bom_objects)}`);
    assert(freeCadBom?.PartName === targetFields.PartName && freeCadBom?.Label === targetFields.label, `FreeCAD BOM fields changed during save/reopen: ${JSON.stringify(freeCadBom)}`);

    const afterFreeCadEmbedded = readFcstdEmbeddedBomFields(path.join(workspace, newTargetRel));
    assert(afterFreeCadEmbedded?.PartNumber === targetFields.PartNumber, "Desk reread lost PartNumber after FreeCAD save/reopen");
    assert(afterFreeCadEmbedded?.PartName === targetFields.PartName && afterFreeCadEmbedded?.label === targetFields.label, "Desk reread changed BOM fields after FreeCAD save/reopen");
    refreshBomXrefsForHosts(workspace, [assemblyRel, rel(drawingName)]);
    const secondIncoming = searchIncomingRefs(workspace, { rel: newTargetRel, transitive: true });
    assert(secondIncoming.direct_count === 2, "Desk XRef reread changed after FreeCAD save/reopen");
    receipt.checks.freecad_roundtrip = {
      passed: true,
      save: true,
      ...finalFreeCad,
      desk_second_reread: afterFreeCadEmbedded,
      xref_direct_incoming: secondIncoming.direct_count,
    };

    const leftovers = findAtomicLeftovers(workspace);
    const finalSourceHashes = sourceHashes(options);
    assert(JSON.stringify(finalSourceHashes) === JSON.stringify(originalHashes), "Source fixtures changed during point-check");
    assert(leftovers.length === 0, `Atomic temp files remain: ${JSON.stringify(leftovers)}`);
    receipt.checks.safety = {
      passed: true,
      source_unchanged: true,
      source_sha256_after: finalSourceHashes,
      atomic_leftovers: leftovers,
      rename_log_count: listRenameLogs(workspace).entries.length,
    };
    receipt.status = "passed";
  } catch (error: any) {
    receipt.status = "failed";
    receipt.error = redactSensitiveText(error?.stack || error?.message || String(error));
    throw error;
  } finally {
    receipt.finished_at = new Date().toISOString();
    fs.mkdirSync(path.dirname(options.receipt), { recursive: true });
    fs.writeFileSync(options.receipt, `${JSON.stringify(redactSensitiveJson(receipt), null, 2)}\n`, "utf8");
    if (!options.keep) fs.rmSync(workspace, { recursive: true, force: true });
    console.log(`CAD_POINTCHECK_STATUS=${receipt.status}`);
    console.log(`CAD_POINTCHECK_RECEIPT=${options.receipt}`);
    console.log(`CAD_POINTCHECK_WORKSPACE=${options.keep ? workspace : "cleaned"}`);
  }
}

main().catch((error) => {
  console.error(redactSensitiveText(error?.stack || error));
  process.exitCode = 1;
});
