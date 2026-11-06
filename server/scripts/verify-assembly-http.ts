/** Manual integration proof: real application routes + real Native + copy publication.
 * pnpm -C server exec tsx scripts/verify-assembly-http.ts --allow-native
 * Only self-created synthetic CAD is accepted. No server socket/browser, user
 * workspace, executable override, script input or replacement write is used.
 */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { createPhoenixServerApp } from "../src/serverApp.js";
import { createSyntheticAssemblyRefreshFixture } from "./verify-assembly-refresh.js";
import type { AssemblyMaintenanceInspection, AssemblyUpdateJob, AssemblyUpdateReconciliation } from "../../shared/assembly-maintenance.js";

const FILES = ["Host.FCStd", "Middle.FCStd", "Leaf.FCStd"];
const SELECTED = ["RigidInstance", "FlexibleInstance"];
const ORIGIN = "http://localhost:49373";
const SOURCE_FILES = [
  "server/scripts/verify-assembly-http.ts", "server/scripts/verify-assembly-refresh.ts",
  "server/src/serverApp.ts", "server/src/routes/cad.ts", "shared/assembly-maintenance.ts",
  ...["routes", "runtime", "service", "updates", "baseline", "publication", "process-occupancy", "native-runner", "native-preview", "native-preservation", "native-archive"].map(name => `server/src/features/assembly-maintenance/${name}.ts`),
  "server/src/features/drawing-research/executionGate.ts", "server/src/features/cad-native-measurement/host-barrier.ts",
];
const digest = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
function requireCheck(condition: unknown, code: string): asserts condition {
  if (!condition) throw Object.assign(new Error("Synthetic HTTP integration not verified"), { code });
}
function stableBytes(filename: string, maximum = 64 * 1024 * 1024) {
  const fd = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    const before = fs.fstatSync(fd);
    requireCheck(before.isFile() && before.nlink === 1 && before.size <= maximum, "unsafe_proof_file");
    const bytes = Buffer.alloc(before.size + 1); let length = 0;
    while (length < bytes.length) { const count = fs.readSync(fd, bytes, length, bytes.length - length, length); if (!count) break; length += count; }
    const same = (other: fs.Stats) => before.dev === other.dev && before.ino === other.ino && before.size === other.size
      && before.mtimeMs === other.mtimeMs && before.ctimeMs === other.ctimeMs && before.nlink === other.nlink;
    requireCheck(length === before.size && same(fs.fstatSync(fd)) && same(fs.lstatSync(filename)), "proof_file_changed");
    return bytes.subarray(0, length);
  } finally { fs.closeSync(fd); }
}
function sourceDigests() {
  const repository = fileURLToPath(new URL("../../", import.meta.url));
  return Object.fromEntries(SOURCE_FILES.map(rel => [rel, digest(stableBytes(path.join(repository, rel), 1024 * 1024))]));
}
function cadDigests(root: string) { return Object.fromEntries(FILES.map(rel => [rel, digest(stableBytes(path.join(root, rel)))])); }
function durableReceipt(directory: string, value: unknown) {
  const filename = path.join(directory, "http-complete-receipt.json"), fd = fs.openSync(filename,
    fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
  try { fs.writeFileSync(fd, JSON.stringify(value, null, 2)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  const parent = fs.openSync(directory, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try { fs.fsyncSync(parent); } finally { fs.closeSync(parent); }
}

export async function verifyAssemblyHttp() {
  const sources = sourceDigests(), app = createPhoenixServerApp();
  const seeded = await createSyntheticAssemblyRefreshFixture(), root = seeded.directory;
  requireCheck(seeded.receipt.state === "seeded" && seeded.proof.actual_close_observed && seeded.proof.exit_code === 0 && seeded.proof.signal === null,
    "fixture_not_verified");
  const before = cadDigests(root), checks: Record<string, boolean> = {};
  let active: AssemblyUpdateJob | null = null;
  async function request(action: string, body: unknown, origin = ORIGIN) {
    const response = await app.request(`/api/cad/assembly-maintenance/${action}`, {
      method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    const text = await response.text();
    requireCheck(Buffer.byteLength(text) <= 1024 * 1024, "http_response_unbounded");
    const envelope = JSON.parse(text) as { success?: boolean; data?: unknown; code?: string };
    return { response, envelope, text };
  }
  async function success<T>(action: string, body: unknown, expected = 200): Promise<T> {
    const { response, envelope } = await request(action, body);
    requireCheck(response.status === expected && envelope.success === true && !!envelope.data, "http_success_envelope_missing");
    requireCheck(response.headers.get("access-control-allow-origin") === ORIGIN, "http_origin_contract_failed");
    return envelope.data as T;
  }
  try {
    const context = { workspacePath: root, filePath: "./Host.FCStd" };
    const denied = await request("update/start", { ...context, selectedObjects: SELECTED }, "https://unrelated.invalid");
    checks.unrelated_origin_cannot_start = denied.response.status === 403;
    const injected = await request("update/start", { ...context, selectedObjects: SELECTED, script: "untrusted", nativeProof: {} });
    checks.http_cannot_supply_native_authority = injected.response.status === 400;
    const inspection = await success<AssemblyMaintenanceInspection>("inspect", context);
    checks.saved_inspection_only = inspection.scope === "current_saved_file" && inspection.synchronization === "not_checked"
      && inspection.update.available === false && SELECTED.every(name => inspection.links.some(link => link.object_name === name));
    checks.inspection_did_not_create_private_job_storage = !fs.existsSync(path.join(root, ".phoenix"));
    active = await success<AssemblyUpdateJob>("update/start", { ...context, selectedObjects: SELECTED }, 202);
    checks.start_returns_owned_background_job = active.status === "preparing" && !active.can_publish && active.file_path === "Host.FCStd"
      && /^[a-f0-9-]{36}$/.test(active.id);
    const deadline = Date.now() + 420_000, phases = new Set([active.phase]);
    while (active.status === "preparing") {
      requireCheck(Date.now() < deadline, "http_preview_observation_timeout");
      await delay(250);
      active = await success<AssemblyUpdateJob>("update/status", { workspacePath: root, id: active.id }); phases.add(active.phase);
    }
    checks.default_runtime_native_preview_verified = active.status === "ready" && active.can_publish && active.preview?.added.length === 2
      && active.preview.removed.length === 2 && active.preview.preserved_joint_count === 5 && active.preview.independently_reopened
      && active.preview.rigid_unchanged && active.preview.placements_unchanged && active.preview.joint_frames_unchanged;
    requireCheck(checks.default_runtime_native_preview_verified, "default_http_preview_not_ready");
    checks.preview_kept_all_source_bytes = JSON.stringify(before) === JSON.stringify(cadDigests(root));
    const id = active.id;
    const changedMode = await request("update/publish", { workspacePath: root, id, mode: "replace_source", confirmedClosed: false, confirmedNotReopened: false });
    checks.http_replacement_requires_both_confirmations = changedMode.response.status === 400;
    const altered = await request("update/publish", { workspacePath: root, id, mode: "verified_copy", confirmedClosed: false, confirmedNotReopened: false, targetRel: "Untrusted.FCStd" });
    checks.http_target_override_rejected = altered.response.status === 400;
    active = await success<AssemblyUpdateJob>("update/publish", { workspacePath: root, id, mode: "verified_copy", confirmedClosed: false, confirmedNotReopened: false });
    requireCheck(active.status === "published" && !!active.output_rel, "http_copy_not_published");
    checks.copy_publication_does_not_mutate_originals = active.output_rel !== "Host.FCStd" && JSON.stringify(before) === JSON.stringify(cadDigests(root));
    checks.actual_default_refresh_reports_index_pending = active.warnings.some(message => message.includes("当前索引未包含该文件"))
      && !fs.existsSync(path.join(root, ".phoenix", "phoenix-workspace.sqlite"));
    const firstHash = digest(stableBytes(path.join(root, active.output_rel)));
    const replayed = await success<AssemblyUpdateJob>("update/publish", { workspacePath: root, id, mode: "verified_copy", confirmedClosed: false, confirmedNotReopened: false });
    checks.published_http_request_is_not_replayed = replayed.id === id && replayed.status === "published" && replayed.output_rel === active.output_rel
      && firstHash === digest(stableBytes(path.join(root, active.output_rel)));
    const reconciliation = await success<AssemblyUpdateReconciliation>("update/reconcile", { workspacePath: root, id });
    checks.http_reconciliation_observes_only = reconciliation.observed_publication === "published_observed"
      && reconciliation.read_only && reconciliation.can_publish === false && reconciliation.backup_state === "verified";
    const history = await success<{ records: AssemblyUpdateReconciliation[] }>("update/history", { workspacePath: root, limit: 30 });
    checks.http_history_never_restores_authority = history.records.some(record => record.id === id) && history.records.every(record => record.read_only && !record.can_publish);
    const cancelled = await success<AssemblyUpdateJob>("update/cancel", { workspacePath: root, id });
    checks.cancel_does_not_relabel_a_publication = cancelled.status === "published" && cancelled.output_rel === active.output_rel;
    checks.production_sources_unchanged = JSON.stringify(sources) === JSON.stringify(sourceDigests());
    const result = { state: Object.values(checks).every(Boolean) ? "passed" : "blocked", sources, checks, before, after: cadDigests(root),
      observed_phases: [...phases], seed_proof: seeded.proof, inspection, job: active, reconciliation };
    durableReceipt(root, result);
    requireCheck(result.state === "passed", "http_integration_check_failed");
    return { state: result.state, checks, artifact: path.basename(root) };
  } catch (error) {
    if (active && ["preparing", "ready"].includes(active.status)) {
      try { await request("update/cancel", { workspacePath: root, id: active.id }); } catch { /* Keep owned Native lifecycle/receipts authoritative. */ }
    }
    throw Object.assign(error instanceof Error ? error : new Error("HTTP proof not verified"), { artifact: path.basename(root) });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.slice(2).join(" ") !== "--allow-native") {
    console.error("Explicit --allow-native is required; no existing CAD or server URL input is accepted."); process.exitCode = 2;
  } else verifyAssemblyHttp().then(result => console.log(JSON.stringify(result))).catch(error => {
    const code = typeof error?.code === "string" && /^[a-z][a-z0-9_]{0,79}$/.test(error.code) ? error.code : "http_proof_unverified";
    const artifact = typeof error?.artifact === "string" && /^desk-assembly-proof-[A-Za-z0-9-]+$/.test(error.artifact) ? error.artifact : null;
    console.error(JSON.stringify({ state: "blocked", code, artifact })); process.exitCode = 1;
  });
}
