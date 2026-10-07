import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { setImmediate as yieldToHost } from "node:timers/promises";
import { createAssemblyTreeReader, patchBomLinkLabels, refreshBomXrefsForHosts } from "../../lib/pnwBomXrefService.js";
import { fcstdFingerprint, fcstdWorkspace, readFcstdBatchArchive, safeFcstdPath, visitFcstdBatch } from "../../lib/fcstdBatchFiles.js";
import { fcstdLinkInstances } from "../../lib/fcstdLinkIdentity.js";
import type { ObjectLabelPatch } from "../../lib/fcstdReferenceLabelService.js";

type Patch = ObjectLabelPatch & { host_repo_rel: string };
export type LabelRow = { rel: string; total: number; pending: number; issues: number; eligible: boolean; status: "normal" | "needs_fix" | "needs_review"; message: string };
type FilePlan = { row: LabelRow; hash: string; patches: Patch[] };
type Plan = { root: string; expires: number; files: Map<string, FilePlan> };
export type LabelResult = { rel: string; status: "written" | "failed" | "uncertain"; count: number; message: string; backup?: string };
export type LabelJob = { id: string; state: "running" | "done" | "attention" | "failed"; completed: number; total: number; current_rel: string; results: LabelResult[]; message: string; index_state: "pending" | "updated" | "not_needed" | "failed" };
const plans = new Map<string, Plan>();
const jobs = new Map<string, { root: string; data: LabelJob }>();
const clean = (root: string, error: unknown) => (error instanceof Error ? error.message : String(error)).split(root).join("[工作空间]");
const normalize = (rel: string) => rel.replace(/\\/g, "/").replace(/^\.\//, "");

function inspect(root: string, rel: string, reader: ReturnType<typeof createAssemblyTreeReader>): FilePlan {
  const archive = readFcstdBatchArchive(safeFcstdPath(root, rel));
  const row: LabelRow = { rel, total: 0, pending: 0, issues: 0, eligible: false, status: "normal", message: "标签已一致" };
  const tree = reader(rel, { full: false });
  if (tree.index_pending) throw new Error("缺少 CAD 引用索引，请先更新 CAD 索引");
  const patches: Patch[] = [], seen = new Set<string>(), reasons = new Set<string>();
  const visit = (nodes: any[]) => {
    for (const node of nodes) {
      if (normalize(node.host_repo_rel || "") === rel) for (const instance of node.xref_instances || []) {
        const identity = JSON.stringify([instance.host_object_name, instance.target_object_name, instance.xlink_file_attr]);
        if (seen.has(identity)) continue;
        seen.add(identity); row.total++;
        if (!node.label_editable || !instance.host_object_name || !instance.target_object_name || !instance.rule_label || instance.rule_error) {
          row.issues++; reasons.add(instance.rule_error || node.label_edit_reason || "引用对象无法安全定位"); continue;
        }
        if (instance.link_label === instance.rule_label) continue;
        patches.push({ host_repo_rel: rel, host_object_name: instance.host_object_name, target_object_name: instance.target_object_name,
          xlink_file_attr: instance.xlink_file_attr, old_label: instance.link_label, link_label: instance.rule_label, document_hash: instance.document_hash });
      }
      visit(node.children || []);
    }
  };
  visit(tree.nodes || []);
  if (row.total < fcstdLinkInstances(archive.xml).length) { row.issues++; reasons.add("索引或装配结构未覆盖全部引用对象，请先在文件详情确认"); }
  row.pending = patches.length;
  row.eligible = row.pending > 0 && row.issues === 0;
  row.status = row.issues ? "needs_review" : row.pending ? "needs_fix" : "normal";
  row.message = row.issues ? [...reasons].join("；") : row.pending ? `待修正 ${row.pending} 个标签` : row.total ? "标签已一致" : "无外部引用标签，无需修正";
  return { row, patches, hash: fcstdFingerprint(archive.bytes) };
}

export async function previewAssemblyLabels(workspace: string, body: { batch_dir?: string } = {}) {
  const root = fcstdWorkspace(workspace), scope = String(body.batch_dir ?? "").trim().replace(/\\/g, "/");
  if (!scope || scope.split("/").includes("..")) throw new Error("请明确选择搜索目录，根目录使用 .；不允许 ..");
  const reader = createAssemblyTreeReader(root), rows: LabelRow[] = [], files = new Map<string, FilePlan>();
  const scan = await visitFcstdBatch(root, scope, async (rel) => {
    if (!/\.assy\.fcstd$/i.test(rel)) return;
    await yieldToHost();
    try { const file = inspect(root, rel, reader); rows.push(file.row); files.set(rel, file); }
    catch (error) { rows.push({ rel, total: 0, pending: 0, issues: 1, eligible: false, status: "needs_review", message: clean(root, error) }); }
  });
  for (const [id, plan] of plans) if (plan.expires <= Date.now()) plans.delete(id);
  while (plans.size >= 20) plans.delete(plans.keys().next().value!);
  const plan_id = randomUUID(); plans.set(plan_id, { root, files, expires: Date.now() + 10 * 60_000 });
  return { ...scan, errors: scan.errors.map(error => ({ ...error, message: clean(root, error.message) })), plan_id, rows };
}

export function startAssemblyLabelJob(workspace: string, body: { plan_id?: string; rels?: string[]; confirmed?: boolean } = {}) {
  const root = fcstdWorkspace(workspace), plan = plans.get(body.plan_id || "");
  if (!plan || plan.root !== root || plan.expires <= Date.now()) throw new Error("预览已失效或不属于当前工作空间，请重新预览");
  const rels = body.rels;
  if (body.confirmed !== true || !Array.isArray(rels) || !rels.length || rels.length > 1000 || new Set(rels).size !== rels.length
    || rels.some(rel => typeof rel !== "string" || !plan.files.get(rel)?.row.eligible)) throw new Error("只允许明确确认并勾选本次可修正的总成");
  if ([...jobs.values()].some(job => job.root === root && job.data.state === "running")) throw new Error("当前工作空间已有标签修正任务，请等待完成");
  while (jobs.size >= 20) {
    const old = [...jobs].find(([, job]) => job.data.state !== "running");
    if (!old) throw new Error("任务过多，请稍后重试"); jobs.delete(old[0]);
  }
  plans.delete(body.plan_id!);
  const data: LabelJob = { id: randomUUID(), state: "running", completed: 0, total: rels.length, current_rel: "", results: [], message: "正在逐个校验并修正标签", index_state: "pending" };
  jobs.set(data.id, { root, data });
  void (async () => {
    const modified = new Set<string>();
    try {
      for (const rel of rels) {
        data.current_rel = rel; await yieldToHost();
        const file = plan.files.get(rel)!;
        try {
          if (fcstdFingerprint(fs.readFileSync(safeFcstdPath(root, rel))) !== file.hash) throw new Error("预览后总成已变化，本文件未写入，请重新预览");
          for (const backupDir of [".phoenix", ".phoenix/reference-label-backups"]) if (fs.existsSync(path.join(root, backupDir))) safeFcstdPath(root, backupDir);
          // Reuse the single-host projection again: changed targets/identity must
          // not silently turn a confirmed recommendation into a different one.
          const current = inspect(root, rel, createAssemblyTreeReader(root));
          if (!current.row.eligible || JSON.stringify(current.patches) !== JSON.stringify(file.patches)) throw new Error("预览后引用目标或推荐发生变化，本文件未写入，请重新预览");
          const result = patchBomLinkLabels(root, file.patches, { refreshIndex: false });
          for (const host of result.applied_hosts) modified.add(host);
          const backup = result.backups?.find((entry: any) => normalize(entry.host_repo_rel) === rel)?.backup_file;
          const failures = result.failed?.map((entry: any) => clean(root, entry.error)).join("；");
          const complete = !failures && result.label_patches === file.patches.length;
          data.results.push({ rel, status: complete ? "written" : result.label_patches ? "uncertain" : "failed", count: result.label_patches,
            message: complete ? `已修正 ${result.label_patches} 个标签` : failures || "写回数量与预览不一致，请在文件详情核对",
            ...(backup ? { backup: path.relative(root, backup).replace(/\\/g, "/") } : {}) });
        } catch (error) { data.results.push({ rel, status: "failed", count: 0, message: clean(root, error) }); }
        data.completed++; data.message = `已处理 ${data.completed} / ${data.total} 个总成`;
      }
    } catch (error) { data.state = "failed"; data.message = `任务异常：${clean(root, error)}；请核对已完成结果`; }
    finally {
      data.current_rel = "";
      if (modified.size) {
        data.message = "正在集中刷新已修改总成的引用索引"; await yieldToHost();
        try {
          const refreshed = refreshBomXrefsForHosts(root, [...modified]);
          if (refreshed.updated_hosts !== modified.size) throw new Error("部分已修改总成未刷新，请检查索引与磁盘");
          data.index_state = "updated";
        }
        catch (error) { data.index_state = "failed"; data.message = `标签已写回，局部索引更新失败：${clean(root, error)}；请到 CAD 索引重试`; }
      } else data.index_state = "not_needed";
      if (data.state === "running") data.state = data.index_state !== "failed" && data.results.every(row => row.status === "written") ? "done" : "attention";
      if (data.index_state !== "failed" && data.state !== "failed") data.message = `${data.state === "done" ? "标签修正完成" : "部分文件需确认"}；${modified.size ? "已集中更新所改总成的引用索引，未全量扫描" : "没有文件写入，无需更新索引"}`;
    }
  })();
  return structuredClone(data);
}

export function getAssemblyLabelJob(workspace: string, id: string) {
  const job = jobs.get(id);
  if (!job || job.root !== fcstdWorkspace(workspace)) throw new Error("任务不存在或不属于当前工作空间；服务重启后请重新预览核对，勿重放旧计划");
  return structuredClone(job.data);
}
