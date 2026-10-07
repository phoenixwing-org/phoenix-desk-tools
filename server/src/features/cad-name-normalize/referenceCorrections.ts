import fs from "node:fs";
import path from "node:path";
import { pnwCreateDb } from "@phoenix-wing/db-node";
import { analyzeRenameReferences, applyRenameCorrections } from "../../lib/pnwRenameService.js";
import { fcstdFingerprint, readFcstdBatchArchive, safeFcstdPath } from "../../lib/fcstdBatchFiles.js";
import { drawingLinkLabelAttributes } from "../../lib/fcstdDrawing.js";

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
  const labelAttrs = new Map<string, Set<string> | null>();
  const notes: string[] = [];
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
      }
      if (options.syncLabels) {
        const result = applyRenameCorrections(root, { ...args, labels_only: true, label_scope: "incoming" });
        labelPatches += result.label_patches;
        failed.push(...result.failed);
        if ("skipped" in result) notes.push(...result.skipped.map(item => `${item.host_repo_rel_path}：${item.reason}`));
      }
      labelAttrs.set(host, drawingLinkLabelAttributes(host, readFcstdBatchArchive(filename).xml));
      // Account for this batch's own writes when a host references several renamed files.
      fingerprints.set(host, fcstdFingerprint(fs.readFileSync(filename)));
    } catch (error) { failed.push({ host_repo_rel_path: host, error: error instanceof Error ? error.message : String(error) }); }
  }
  const remaining = analyzeRenameReferences(root, { rename_log_id: logId, transitive: true });
  // Re-read the index refreshed by the shared patcher; a skipped/missing Label is not success.
  let labelsPending = false;
  if (direct.length) {
    const db = pnwCreateDb(path.join(root, ".phoenix/phoenix-workspace.sqlite"));
    try {
      const edges = db.all<{ host_repo_rel_path: string; target_repo_rel_path: string; target_basename: string; xlink_file_attr: string; link_label: string; rule_label: string }>("SELECT host_repo_rel_path, target_repo_rel_path, target_basename, xlink_file_attr, link_label, rule_label FROM phoenix_cad_bom_xref");
      for (const edge of edges) {
        if (!direct.includes(normalized(edge.host_repo_rel_path))) continue;
        if (normalized(edge.target_repo_rel_path || "") !== targetRel && edge.target_basename !== path.posix.basename(targetRel)) continue;
        const attrs = labelAttrs.get(normalized(edge.host_repo_rel_path));
        if (attrs && !attrs.has(edge.xlink_file_attr)) continue;
        if (!options.syncLabels) labelsPending = true;
        else if (!edge.rule_label || edge.link_label !== edge.rule_label) failed.push({ host_repo_rel_path: normalized(edge.host_repo_rel_path), error: "引用标签尚未与规则名一致，请打开引用分析确认" });
      }
    } finally { db.close(); }
  }
  return { xlink_patches: xlinkPatches, label_patches: labelPatches, failed_hosts: failed,
    notes,
    pending: failed.length > 0 || (remaining.pending_hit_count ?? 0) > 0 || labelsPending,
    host_count: direct.length };
}
