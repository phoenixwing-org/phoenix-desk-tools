import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { strToU8, zipSync } from "fflate";
import { replaceFileAtomically } from "./fcstdDocumentXmlService.js";
import { reconcileFcstdPropertyCounts, type FcstdPropertyCountIssue } from "./fcstdPropertyCounts.js";

import { fcstdFingerprint as hash, fcstdWorkspace as workspace, safeFcstdPath as safePath, readFcstdBatchArchive, visitFcstdBatch } from "./fcstdBatchFiles.js";

type FileIssue = { rel: string; issues: FcstdPropertyCountIssue[] };
type Plan = { root: string; expires: number; files: Map<string, string> };
const plans = new Map<string, Plan>();
function archive(filename: string, all = false) {
  const result = readFcstdBatchArchive(filename, all);
  return { ...result, ...reconcileFcstdPropertyCounts(result.xml) };
}

/** Read-only disk inspection; never creates/refreshes the CAD index or preferences. */
export async function analyzeFcstdProperties(workspaceRoot: string, opts: { batch_dir?: string } = {}) {
  const root = workspace(workspaceRoot);
  const files: FileIssue[] = [];
  const hashes = new Map<string, string>();
  const scan = await visitFcstdBatch(root, String(opts.batch_dir || "."), (rel, filename) => {
    const result = archive(filename);
    if (result.issues.length) {
      files.push({ rel, issues: result.issues });
      hashes.set(rel, hash(result.bytes));
    }
  });
  // Short-lived, workspace-bound plans: clients cannot submit an arbitrary file
  // list/hash as permission to write, and API restarts invalidate all plans.
  for (const [id, plan] of plans) if (plan.expires <= Date.now()) plans.delete(id);
  while (plans.size >= 20) plans.delete(plans.keys().next().value!);
  const planId = randomUUID();
  plans.set(planId, { root, expires: Date.now() + 10 * 60_000, files: hashes });
  return { plan_id: planId, ...scan, files };
}

export function applyFcstdPropertyRepairs(workspaceRoot: string, opts: { plan_id?: string; files?: string[] } = {}) {
  const root = workspace(workspaceRoot);
  const plan = plans.get(opts.plan_id || "");
  if (!plan || plan.root !== root || plan.expires <= Date.now()) throw new Error("分析已失效，请重新分析");
  if (!Array.isArray(opts.files) || !opts.files.length || opts.files.length > 1000
    || opts.files.some((rel) => typeof rel !== "string" || !plan.files.has(rel))) {
    throw new Error("只能修正本次分析中勾选的异常文件");
  }
  plans.delete(opts.plan_id!);
  const results: Array<{ rel: string; status: "fixed" | "failed"; message: string }> = [];
  for (const rel of new Set(opts.files)) {
    try {
      const filename = safePath(root, rel);
      const result = archive(filename, true);
      if (hash(result.bytes) !== plan.files.get(rel)) throw new Error("分析后文件已变化，请重新分析");
      result.files["Document.xml"] = strToU8(result.xml);
      const bytes = zipSync(result.files, { level: 6 });
      // Recheck just before synchronous replacement, including directory swaps.
      safePath(root, rel);
      if (hash(fs.readFileSync(filename)) !== plan.files.get(rel)) throw new Error("文件已变化，未写入");
      replaceFileAtomically(filename, bytes);
      results.push({ rel, status: "fixed", message: `已修正 ${result.issues.length} 处属性计数` });
    } catch (error) {
      results.push({ rel, status: "failed", message: error instanceof Error ? error.message : String(error) });
    }
  }
  return { results };
}
