import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { strFromU8, unzipSync } from "fflate";

import { loadBomPreview, renameBomFcstdFile } from "../server/src/lib/bomAttributeService.js";
import { patchFcstdXlinkAttributes } from "../server/src/lib/fcstdReferenceLabelService.js";
import {
  patchBomLinkLabels,
  searchIncomingRefs,
  searchOutgoingRefs,
} from "../server/src/lib/pnwBomXrefService.js";
import { runFcstdMapScan } from "../server/src/lib/pnwFcstdMapService.js";
import {
  analyzeRenameReferences,
  applyRenameCorrections,
  exportRenameReport,
} from "../server/src/lib/pnwRenameService.js";
import { analyzeXlinkFix, runXlinkFix } from "../server/src/lib/pnwXlinkFixService.js";

const workspace = path.resolve(".tmp/tauri-acceptance-workspace");
const rootRel = "Cad/asm/100001.001-A-Root.ASSY.FCStd";
const subRel = "Cad/asm/100002.001-A-Sub.ASSY.FCStd";
const boltRel = "Cad/parts/100003.001-H-Bolt.FCStd";
const renamedBoltRel = "Cad/parts/100003.001-H-Bolt-Renamed.FCStd";
const fixtures = [rootRel, subRel, boltRel];
const dbKey = (rel: string) => `./${rel.replace(/^\.\//, "")}`;
const backups = fixtures.map((rel) => ({
  rel,
  source: path.join(workspace, rel),
  backup: path.join(workspace, `${rel}.cad-chain-original`),
}));

function documentXml(rel: string): string {
  const archive = unzipSync(new Uint8Array(fs.readFileSync(path.join(workspace, rel))));
  return strFromU8(archive["Document.xml"]);
}

function guiXml(rel: string): string {
  const archive = unzipSync(new Uint8Array(fs.readFileSync(path.join(workspace, rel))));
  return strFromU8(archive["GuiDocument.xml"]);
}

async function main(): Promise<void> {
for (const item of backups) fs.copyFileSync(item.source, item.backup);

const evidence: Record<string, unknown> = {};
try {
  const scanned = runFcstdMapScan(workspace);
  evidence.initial_scan = scanned.xref_stats;
  assert.equal(scanned.scan_stats.present, 3);
  assert.equal(scanned.xref_stats.edge_count, 2);

  const rootBefore = searchOutgoingRefs(workspace, rootRel);
  const subBefore = searchOutgoingRefs(workspace, subRel);
  assert.equal(rootBefore.label_mismatch_count, 1);
  assert.equal(subBefore.label_mismatch_count, 1);

  const labels = patchBomLinkLabels(workspace, [
    {
      host_repo_rel: rootRel,
      xlink_file_attr: "100002.001-A-Sub.ASSY.FCStd",
      link_label: "Sub Assembly",
    },
    {
      host_repo_rel: subRel,
      xlink_file_attr: "../parts/100003.001-H-Bolt.FCStd",
      link_label: "Bolt",
    },
  ]);
  evidence.label_write = labels;
  assert.equal(labels.label_patches, 2);
  assert.deepEqual(labels.failed, []);
  assert.equal(searchOutgoingRefs(workspace, rootRel).label_mismatch_count, 0);
  assert.equal(searchOutgoingRefs(workspace, subRel).label_mismatch_count, 0);

  const broken = patchFcstdXlinkAttributes(
    path.join(workspace, rootRel),
    { "100002.001-A-Sub.ASSY.FCStd": "../broken/100002.001-A-Sub.ASSY.FCStd" },
  );
  assert.equal(broken.count, 1);
  runFcstdMapScan(workspace);
  const xlinkDryRun = analyzeXlinkFix(workspace, {
    all_in_dir: true,
    batch_dir: "Cad",
  });
  evidence.xlink_dry_run = {
    stats: xlinkDryRun.stats,
    issues: xlinkDryRun.issue_rows,
  };
  assert.equal(xlinkDryRun.stats.fixable_count, 1);
  assert.equal(xlinkDryRun.issue_rows[0].host_repo_rel, dbKey(rootRel));
  assert.equal(xlinkDryRun.issue_rows[0].new_path, "100002.001-A-Sub.ASSY.FCStd");

  const xlinkWrite = runXlinkFix(workspace, {
    all_in_dir: true,
    batch_dir: "Cad",
    dry_run: false,
  });
  evidence.xlink_write = {
    total_changes: xlinkWrite.total_changes,
    log: xlinkWrite.log,
  };
  assert.equal(xlinkWrite.total_changes, 1);
  assert.match(documentXml(rootRel), /XLink file="100002\.001-A-Sub\.ASSY\.FCStd"/);
  assert.equal(searchOutgoingRefs(workspace, rootRel).refs[0].resolve_status, "resolved");

  const boltPreview = loadBomPreview(workspace, boltRel);
  const renamed = await renameBomFcstdFile(workspace, boltRel, {
    ...boltPreview.fields,
    baseline: boltPreview.fields,
    filename: path.posix.basename(renamedBoltRel),
  });
  evidence.disk_rename = renamed;
  assert.equal(renamed.rel_path, renamedBoltRel);
  assert.equal(renamed.map_updated, true);
  assert.equal(fs.existsSync(path.join(workspace, boltRel)), false);
  assert.equal(fs.existsSync(path.join(workspace, renamedBoltRel)), true);

  const renameScan = analyzeRenameReferences(workspace, {
    rename_log_id: renamed.rename_log_id,
    transitive: true,
  });
  evidence.rename_analysis = renameScan;
  assert.equal(renameScan.direct_host_count, 1);
  assert.equal(renameScan.host_count, 2);
  assert.equal(renameScan.pending_hit_count, 1);
  assert.equal(renameScan.hosts.find((host) => host.depth === 0)?.host_repo_rel_path, subRel);
  assert.equal(renameScan.hosts.find((host) => host.depth === 1)?.host_repo_rel_path, rootRel);

  const corrected = applyRenameCorrections(workspace, {
    rename_log_id: renamed.rename_log_id,
    transitive: true,
    host_repo_rel_paths: [rootRel],
  });
  evidence.rename_apply = corrected;
  assert.equal(corrected.xlink_patches, 1);
  assert.deepEqual(corrected.failed, []);
  assert.match(documentXml(subRel), /XLink file="\.\.\/parts\/100003\.001-H-Bolt-Renamed\.FCStd"/);

  runFcstdMapScan(workspace);
  const incoming = searchIncomingRefs(workspace, { rel: renamedBoltRel, transitive: true });
  evidence.renamed_incoming = incoming.hosts;
  assert.equal(incoming.direct_count, 1);
  assert.equal(incoming.count, 2);
  assert.equal(incoming.hosts.find((host: any) => host.depth === 0)?.host_repo_rel_path, dbKey(subRel));
  assert.equal(incoming.hosts.find((host: any) => host.depth === 1)?.host_repo_rel_path, dbKey(rootRel));
  assert.equal(searchOutgoingRefs(workspace, subRel).refs[0].resolve_status, "resolved");

  const report = exportRenameReport(workspace, { rename_log_id: renamed.rename_log_id });
  evidence.rename_report = report;
  assert.equal(fs.existsSync(path.resolve(workspace, report.path || report.report_path)), true);

  assert.equal(guiXml(rootRel), `keep ${rootRel.replace(/^Cad\//, "")}`);
  assert.equal(guiXml(subRel), `keep ${subRel.replace(/^Cad\//, "")}`);
  assert.equal(guiXml(renamedBoltRel), `keep ${boltRel.replace(/^Cad\//, "")}`);

  console.log(JSON.stringify(evidence, null, 2));
} finally {
  for (const item of backups) {
    if (fs.existsSync(item.backup)) {
      fs.copyFileSync(item.backup, item.source);
      fs.rmSync(item.backup, { force: true });
    }
  }
  fs.rmSync(path.join(workspace, renamedBoltRel), { force: true });
  runFcstdMapScan(workspace);
}
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
