import path from "node:path";
import { randomUUID } from "node:crypto";
import { applyDirectoryChanges, previewDirectoryChanges, retainDirectoryChanges, trackDirectoryFileMutation } from "./directoryOperations.js";
import { activeRoots, applyFileChanges, directory, previewFileChanges, retainFileChanges, type RenameRules, type SyncPreview, type SyncResult } from "./fileOperations.js";
import type { RenameTaskDraft } from "./tasks.js";

type Plan = { workspace: string; owner: string; expires: number; preview: SyncPreview; files?: string; directories?: string };
const plans = new Map<string, Plan>();
const key = (value: string) => value.normalize("NFC").toLowerCase();
const contains = (root: string, item: string) => root === item || item.startsWith(root + path.sep);

export async function previewJointChanges(workspace: string, task: RenameTaskDraft, rules: RenameRules, owner: string) {
  const ws = directory(workspace);
  if (!task.directories && !task.filenames && !task.contents) throw new Error("至少选择文件夹名、文件名或文件内容");
  const files = task.filenames || task.contents ? await previewFileChanges(ws, task, rules, owner) : undefined;
  const directories = task.directories ? previewDirectoryChanges(ws, { ...task, filenames: false, contents: false }, rules, owner) : undefined;
  const parts = [files, directories].filter((part): part is SyncPreview => Boolean(part));
  const now = Date.now();
  for (const [id, plan] of plans) if (plan.expires <= now) plans.delete(id);
  if (plans.size >= 8) plans.delete(plans.keys().next().value!);
  const preview: SyncPreview = { ...parts[0], plan_id: randomUUID(), expires_at: new Date(Math.min(...parts.map(part => Date.parse(part.expires_at)))).toISOString(), rows: parts.flatMap(part => part.rows), scanned: parts.reduce((sum, part) => sum + part.scanned, 0), skipped: Math.max(...parts.map(part => part.skipped)), warnings: [...new Set(parts.flatMap(part => part.warnings))] };
  if (preview.rows.length > 2000) throw new Error("联合匹配结果超过 2000 项，请缩小范围");
  // Include cross-kind collisions: a file and a directory share one name space.
  const targets = new Map<string, typeof preview.rows>();
  for (const row of preview.rows) if (row.target !== row.rel) {
    const target = key(path.join(row.root, row.target));
    targets.set(target, [...(targets.get(target) || []), row]);
  }
  for (const group of targets.values()) if (group.length > 1) for (const row of group) { row.eligible = false; row.message = "文件或文件夹将写入同一目标名称"; }
  plans.set(preview.plan_id, { workspace: ws, owner, expires: Date.parse(preview.expires_at), preview, files: files?.plan_id, directories: directories?.plan_id });
  return preview;
}

export async function applyJointChanges(workspace: string, body: { plan_id: string; ids: string[]; confirmed: boolean }, owner: string) {
  const ws = directory(workspace), plan = plans.get(body.plan_id);
  if (!plan || plan.workspace !== ws || plan.owner !== owner || plan.expires <= Date.now()) throw new Error("预览已失效或已应用，请重新搜索预览");
  if (body.confirmed !== true || !Array.isArray(body.ids) || !body.ids.length || plan.preview.conflicts.length) throw new Error("请勾选有效项并应用");
  const ids = [...new Set(body.ids)], rows = ids.map(id => plan.preview.rows.find(row => row.id === id));
  if (rows.some(row => !row?.eligible)) throw new Error("选择包含无效或冲突项，请重新预览");
  const selected = rows as SyncPreview["rows"], roots = [...new Set(selected.map(row => row.root))];
  if (roots.some(root => [...activeRoots].some(other => contains(root, other) || contains(other, root)))) throw new Error("所选目录正有改名任务执行，请稍后重试");
  const fileIds = selected.filter(row => row.kind !== "directory").map(row => row.id), directoryIds = selected.filter(row => row.kind === "directory").map(row => row.id);
  // Pin both immutable preview inputs before the first write. Runtime TTL/cache
  // turnover must not revoke an execution already accepted by the host.
  const release: Array<() => void> = [];
  try {
    if (fileIds.length && plan.files) release.push(retainFileChanges(ws, plan.files, owner));
    if (directoryIds.length && plan.directories) release.push(retainDirectoryChanges(ws, plan.directories, owner));
  } catch (error) { release.forEach(done => done()); throw error; }
  plans.delete(body.plan_id); roots.forEach(root => activeRoots.add(root));
  const results: SyncResult[] = [];
  try {
    if (fileIds.length && plan.files) {
      const output = await applyFileChanges(ws, { ...body, plan_id: plan.files, ids: fileIds }, owner, { rootsLocked: true, phased: true, onMutation: mutation => {
        if (directoryIds.length && plan.directories) trackDirectoryFileMutation(ws, plan.directories, directoryIds, mutation, owner);
      } });
      results.push(...output.results);
    }
    if (directoryIds.length && plan.directories) {
      let output: ReturnType<typeof applyDirectoryChanges>;
      try { output = applyDirectoryChanges(ws, { ...body, plan_id: plan.directories, ids: directoryIds }, owner, { rootsLocked: true }); }
      catch (error) { output = { results: selected.filter(row => row.kind === "directory").map(row => ({ id: row.id, root: row.root, rel: row.rel, target: row.target, status: "failed" as const, message: error instanceof Error ? error.message : String(error) })), applied: 0, failed: directoryIds.length }; }
      // Child directory results are already projected through successful parent moves.
      const moved = output.results.filter(row => row.status === "applied").sort((a, b) => b.rel.split("/").length - a.rel.split("/").length);
      for (const result of results) if (result.status === "applied") for (const dir of moved) if (dir.root === result.root && result.target.startsWith(dir.rel + "/")) result.target = dir.target + result.target.slice(dir.rel.length);
      results.push(...output.results);
    }
  } finally { release.forEach(done => done()); roots.forEach(root => activeRoots.delete(root)); }
  return { results, applied: results.filter(row => row.status === "applied").length, failed: results.filter(row => row.status === "failed").length };
}
