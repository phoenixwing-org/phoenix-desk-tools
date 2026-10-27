import fs from "node:fs";
import { analyzeRenameReferences, applyRenameCorrections, inspectIncomingRenameLabels } from "../../lib/pnwRenameService.js";
import { fcstdFingerprint, safeFcstdPath } from "../../lib/fcstdBatchFiles.js";
import { verifyIncomingLabelSources, verifyIncomingObjectLabels, type IncomingObjectLabelPlan } from "../../lib/renameObjectLabelPlan.js";

export type RenameOptions = { fixXref: boolean; syncLabels: boolean; fixBasename: boolean };
export function renameOptions(raw?: Partial<RenameOptions>): RenameOptions {
  const result: RenameOptions = { fixXref: true, syncLabels: true, fixBasename: true };
  for (const key of Object.keys(result) as (keyof RenameOptions)[]) {
    if (raw?.[key] !== undefined) {
      if (typeof raw[key] !== "boolean") throw new Error("引用修正选项必须为布尔值");
      result[key] = raw[key]!;
    }
  }
  return result;
}
const normalized = (rel: string) => rel.replace(/^\.\//, "").replace(/\\/g, "/");

/** The same path/basename + incoming-label operations as the single-file dialog.
 * Only preflighted, backed-up direct hosts may be mutated; never host_all. */
export function correctRenamedReferences(root: string, logId: number, targetRel: string, options: RenameOptions, expectedHosts: string[], fingerprints: Map<string, string>) {
  const failed: Array<{ host_repo_rel_path: string; error: string }> = [];
  const scan = analyzeRenameReferences(root, { rename_log_id: logId, transitive: true });
  const direct = scan.hosts.filter(host => host.hits.length).map(host => normalized(host.host_repo_rel_path));
  const expected = new Set(expectedHosts.map(normalized));
  if (direct.some(host => !expected.has(host)) || expectedHosts.some(host => !direct.includes(normalized(host)))) {
    throw new Error("改名后的宿主集合与确认计划不一致，已停止自动修正，请重新分析");
  }
  let xlinkPatches = 0; let labelPatches = 0;
  const expectedLabels = new Map<string, IncomingObjectLabelPlan>();
  let labelsPending = false;
  const notes: string[] = [];
  const labelHosts: string[] = [];
  // Repair all direct paths of THIS renamed file before projecting labels.
  // A host's sibling numbering can traverse another selected host's links.
  for (const host of direct) {
    try {
      const filename = safeFcstdPath(root, host);
      if (fcstdFingerprint(fs.readFileSync(filename)) !== fingerprints.get(host)) throw new Error("宿主在分析后已变化，未自动覆盖");
      const args = { rename_log_id: logId, host_repo_rel_paths: [host], transitive: false };
      if ((options.fixXref || options.fixBasename) && scan.hosts.find(item => normalized(item.host_repo_rel_path) === host)?.hits.some(hit => hit.status === "pending")) {
        const result = applyRenameCorrections(root, args);
        xlinkPatches += result.xlink_patches;
        failed.push(...result.failed);
        // Preserve the baseline of a completed path write even if label repair fails next.
        fingerprints.set(host, fcstdFingerprint(fs.readFileSync(filename)));
        if (result.failed.length) continue;
      }
      labelHosts.push(host);
    } catch (error) { failed.push({ host_repo_rel_path: host, error: error instanceof Error ? error.message : String(error) }); }
  }
  // Labels remain JIT and host-scoped, not a transaction across sources. A
  // failed path host is excluded; other safely preflighted hosts can continue.
  for (const host of labelHosts) {
    try {
      const filename = safeFcstdPath(root, host);
      if (fcstdFingerprint(fs.readFileSync(filename)) !== fingerprints.get(host)) throw new Error("宿主在引用路径修正后已变化，未自动覆盖");
      const args = { rename_log_id: logId, host_repo_rel_paths: [host], transitive: false };
      if (options.syncLabels) {
        const labels = inspectIncomingRenameLabels(root, logId, host, targetRel);
        expectedLabels.set(host, labels);
        verifyIncomingLabelSources(root, labels);
        const result = applyRenameCorrections(root, { ...args, labels_only: true, label_scope: "incoming" });
        labelPatches += result.label_patches;
        failed.push(...result.failed);
        if ("skipped" in result) notes.push(...result.skipped.map(item => `${item.host_repo_rel_path}：${item.reason}`));
      } else {
        // A disabled write is not a failed write. Inspect only to distinguish
        // already-correct labels from changes that still need confirmation.
        try {
          const labels = inspectIncomingRenameLabels(root, logId, host, targetRel);
          if (labels.patches.length) labelsPending = true;
          notes.push(...labels.skipped.map(item => `${item.host_repo_rel_path}：${item.reason}`));
        } catch (error) {
          labelsPending = true;
          notes.push(`${host}：未请求同步标签，标签仍待确认：${error instanceof Error ? error.message : String(error)}`);
        }
      }
      // Account for this batch's own writes when a host references several renamed files.
      fingerprints.set(host, fcstdFingerprint(fs.readFileSync(filename)));
    } catch (error) { failed.push({ host_repo_rel_path: host, error: error instanceof Error ? error.message : String(error) }); }
  }
  const remaining = analyzeRenameReferences(root, { rename_log_id: logId, transitive: true });
  // The index aggregates file edges. It cannot certify labels of named
  // subobjects or .001/.002 siblings; verify the confirmed live identities.
  // Source bytes were guarded during each host's own write. Later legitimate
  // host writes may change those sources; this is not a batch-wide source lock.
  if (options.syncLabels) for (const [host, plan] of expectedLabels) {
    try { verifyIncomingObjectLabels(root, host, plan.expectations); }
    catch (error) { failed.push({ host_repo_rel_path: host, error: error instanceof Error ? error.message : String(error) }); }
  }
  return { xlink_patches: xlinkPatches, label_patches: labelPatches, failed_hosts: failed,
    notes,
    pending: failed.length > 0 || (remaining.pending_hit_count ?? 0) > 0 || labelsPending,
    host_count: direct.length };
}
