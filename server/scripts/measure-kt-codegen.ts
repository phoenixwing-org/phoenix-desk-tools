import path from "node:path";
import {
  discoverKtCodegenDocuments,
  loadKtCodegenDocument,
  preflightKtCodegen,
} from "../src/lib/ktCodegenService.js";

function elapsed(start: number, end: number): number {
  return Math.round((end - start) * 100) / 100;
}

// Accept both `pnpm measure:kt-codegen <workspace>` and the common
// `pnpm measure:kt-codegen -- <workspace>` forwarding form.
const workspaceArg = process.argv.slice(2).find((argument) => argument !== "--");
if (!workspaceArg) {
  throw new Error("Usage: pnpm measure:kt-codegen <workspace>");
}

const root = path.resolve(workspaceArg);
const startedDiscovery = performance.now();
const coldDiscovery = discoverKtCodegenDocuments(root);
const finishedColdDiscovery = performance.now();
const warmDiscovery = discoverKtCodegenDocuments(root);
const finishedWarmDiscovery = performance.now();
const selected = coldDiscovery.documents[0];
if (!selected) throw new Error("No Wing-compatible KT Codegen document found");

const document = loadKtCodegenDocument(root, selected.path);
const startedPreflight = performance.now();
const coldPreflight = preflightKtCodegen(root, {
  param: document.param,
  table: document.table,
  block_keys: ["PARAM DECLARATION"],
});
const finishedColdPreflight = performance.now();
const warmPreflight = preflightKtCodegen(root, {
  param: document.param,
  table: document.table,
  block_keys: ["PARAM DECLARATION"],
});
const finishedWarmPreflight = performance.now();

console.log(JSON.stringify({
  kind: "kt.codegen.read-only-benchmark",
  schema_version: 1,
  workspace: root,
  documents: coldDiscovery.documents,
  selected: selected.path,
  discovery: {
    cold_ms: elapsed(startedDiscovery, finishedColdDiscovery),
    warm_ms: elapsed(finishedColdDiscovery, finishedWarmDiscovery),
    scanned: coldDiscovery.scanned_file_count,
    found: coldDiscovery.documents.length,
    warm_cache_hits: warmDiscovery.cache_hit_count,
    warm_files_read: warmDiscovery.files_read,
    cold_snapshot_bytes: coldDiscovery.config_snapshot_bytes,
    cold_snapshot_byte_limit_reached: coldDiscovery.config_scan_byte_limit_reached,
  },
  preflight: {
    cold_ms: elapsed(startedPreflight, finishedColdPreflight),
    warm_ms: elapsed(finishedColdPreflight, finishedWarmPreflight),
    indexed: coldPreflight.indexed_file_count,
    candidates: coldPreflight.candidate_file_count,
    candidate_summaries: coldPreflight.source_candidates.length,
    candidate_summaries_truncated: coldPreflight.source_candidates_truncated,
    snapshot_bytes: coldPreflight.source_snapshot_bytes,
    snapshot_byte_limit_reached: coldPreflight.source_scan_byte_limit_reached,
    regions: coldPreflight.plan.markerRegions.length,
    artifacts: coldPreflight.plan.artifacts.length,
    safe_to_apply: coldPreflight.safe_to_apply,
    warm_source_cache_hits: warmPreflight.source_cache_hits,
    warm_source_files_read: warmPreflight.source_files_read,
    reused: warmPreflight.reused,
  },
}, null, 2));
