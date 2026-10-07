import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { pnwCodeReplaceStringByRules } from "@phoenix-wing/code-core";
import { effectiveCodeIgnorePatterns, isIgnoredName } from "../../lib/codeIgnoreService.js";
import { activeRoots, directory, safePath, validFilename, type RenameRules, type SyncPreview, type SyncRow, type SyncResult } from "./fileOperations.js";

const TTL = 30 * 60 * 1000, LIMIT = 256 * 1024 * 1024;
const key = (value: string) => value.normalize("NFC").toLowerCase();
const contains = (root: string, item: string) => item === root || item.startsWith(root + path.sep);
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);
type TreeEntry = { rel: string; mode: number; hash?: string };
const treeDigest = (tree: TreeEntry[]) => createHash("sha256").update(JSON.stringify([...tree].sort((a, b) => a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0))).digest("hex");
type Snapshot = { digest: string; tree: TreeEntry[]; bytes: number; ino: number; dev: number };
type Entry = { row: SyncRow; snapshot?: Snapshot };
type Plan = { workspace: string; owner: string; expires: number; preview: SyncPreview; entries: Entry[] };
const plans = new Map<string, Plan>();

/** Inspect all descendants, even ignored files: moving a parent moves them too. */
function snapshot(root: string, rel: string): Snapshot {
  const abs = safePath(root, rel), original = fs.lstatSync(abs);
  if (!original.isDirectory()) throw new Error("源文件夹已变化");
  const tree: TreeEntry[] = []; let bytes = 0, count = 0;
  function walk(current: string, relative: string) {
    if (++count > 20000) throw new Error("文件夹超过 20000 项，请缩小范围");
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink()) throw new Error("包含符号链接，不移动该文件夹");
    const entry: TreeEntry = { rel: relative, mode: stat.mode }; tree.push(entry);
    if ([".git", ".phoenix"].includes(path.basename(current).toLowerCase())) throw new Error("包含 Git 或工具数据目录，不移动该文件夹");
    if (stat.isDirectory()) {
      for (const name of fs.readdirSync(current).sort()) walk(path.join(current, name), path.posix.join(relative, name));
    } else if (stat.isFile()) {
      if (/\.(?:fcstd\d*|catpart|catproduct|catshape|catprocess|catanalysis|catmaterial|catalog|sldprt|sldasm|slddrw)$/i.test(current)) throw new Error("包含关联 CAD 模型，请使用 CAD 专用工具移动并修复引用");
      if (stat.nlink > 1) throw new Error("包含硬链接，不移动该文件夹");
      bytes += stat.size;
      if (stat.size > 64 * 1024 * 1024 || bytes > LIMIT) throw new Error("文件夹校验超过安全上限（单文件 64 MiB / 文件夹 256 MiB）");
      entry.hash = createHash("sha256").update(fs.readFileSync(current)).digest("hex");
    } else throw new Error("包含非普通文件，不移动该文件夹");
  }
  walk(abs, "");
  return { digest: treeDigest(tree), tree, bytes, ino: original.ino, dev: original.dev };
}
function unchanged(root: string, rel: string, expected: Snapshot) {
  const value = snapshot(root, rel);
  if (value.digest !== expected.digest || value.ino !== expected.ino || value.dev !== expected.dev) throw new Error("文件夹或子项在预览后已变化，请重新预览");
}
function freeTarget(root: string, rel: string) {
  const target = safePath(root, rel, false);
  if (fs.readdirSync(path.dirname(target)).some(name => key(name) === key(path.basename(target)))) throw new Error("目标名称已存在（含大小写 / Unicode 等价名称）");
  return target;
}
export function previewDirectoryChanges(workspace: string, body: { roots: string[]; filenames: boolean; contents: boolean }, rules: RenameRules, owner: string): SyncPreview {
  const ws = directory(workspace);
  if (body.filenames || body.contents) throw new Error("文件夹模式须独立执行，请关闭文件名和文件内容选项");
  if (!Array.isArray(body.roots) || !body.roots.length || body.roots.length > 12) throw new Error("请选择 1–12 个目录");
  const roots = body.roots.map(directory);
  if (roots.some((root, i) => roots.some((other, j) => i !== j && contains(root, other)))) throw new Error("处理目录有重复或包含关系");
  const now = Date.now();
  for (const [id, plan] of plans) if (plan.expires < now) plans.delete(id);
  if (plans.size >= 8) plans.delete(plans.keys().next().value!);
  const preview: SyncPreview = { plan_id: randomUUID(), expires_at: new Date(now + TTL).toISOString(), roots, excluded_rules: rules.excluded_rules, mappings: rules.mappings, conflicts: rules.conflicts, rows: [], warnings: [], scanned: 0, skipped: 0 };
  const entries: Entry[] = []; let visited = 0;
  if (!rules.conflicts.length) for (const root of roots) {
    const patterns = effectiveCodeIgnorePatterns(root), stack = [""];
    while (stack.length) {
      const relDir = stack.pop()!;
      for (const item of fs.readdirSync(relDir ? safePath(root, relDir) : root, { withFileTypes: true })) {
        if (++visited > 20000) throw new Error("扫描超过 20000 项，请缩小范围");
        if (item.isSymbolicLink() || isIgnoredName(item.name, patterns)) { preview.skipped++; continue; }
        if (!item.isDirectory()) continue;
        const rel = path.posix.join(relDir, item.name); stack.push(rel); preview.scanned++;
        const name = pnwCodeReplaceStringByRules(item.name, rules.rules).output;
        if (name === item.name) continue;
        const row: SyncRow = { kind: "directory", id: randomUUID(), root, rel, target: path.posix.join(relDir, name), occurrences: 0, binary: false, eligible: true, message: "待改文件夹名（包含全部子项路径，不修复内容引用）", diffs: [], truncated: false };
        const entry: Entry = { row };
        try {
          if (!validFilename(name) || name.startsWith(".")) throw new Error("目标文件夹名无效或为隐藏目录");
          freeTarget(root, row.target); entry.snapshot = snapshot(root, rel);
        } catch (error) { row.eligible = false; row.message = errorText(error); }
        entries.push(entry); preview.rows.push(row);
        if (entries.length > 2000) throw new Error("匹配文件夹超过 2000 个，请缩小范围");
      }
    }
  }
  const groups = new Map<string, Entry[]>();
  for (const entry of entries) { const id = key(path.join(entry.row.root, entry.row.target)); groups.set(id, [...(groups.get(id) || []), entry]); }
  for (const group of groups.values()) if (group.length > 1) for (const { row } of group) { row.eligible = false; row.message = "多个文件夹将使用同一目标名称"; }
  plans.set(preview.plan_id, { workspace: ws, owner, expires: now + TTL, preview, entries });
  return preview;
}
export function applyDirectoryChanges(workspace: string, body: { plan_id: string; ids: string[]; confirmed: boolean }, owner: string) {
  const ws = directory(workspace), plan = plans.get(body.plan_id);
  if (!plan || plan.workspace !== ws || plan.owner !== owner || plan.expires < Date.now()) throw new Error("预览已失效，请重新预览");
  if (body.confirmed !== true || !Array.isArray(body.ids) || !body.ids.length || plan.preview.conflicts.length) throw new Error("请勾选有效文件夹并确认应用");
  const selected = [...new Set(body.ids)].map(id => plan.entries.find(entry => entry.row.id === id));
  if (selected.some(entry => !entry?.row.eligible || !entry.snapshot)) throw new Error("选择包含无效文件夹");
  const entries = selected as Array<Entry & { snapshot: Snapshot }>;
  const roots = [...new Set(entries.map(entry => entry.row.root))];
  if (roots.some(root => [...activeRoots].some(other => contains(root, other) || contains(other, root)))) throw new Error("处理目录正有任务执行");
  plans.delete(body.plan_id); roots.forEach(root => activeRoots.add(root));
  const results: SyncResult[] = [], prepared: Array<{ entry: typeof entries[number]; result: SyncResult }> = [];
  try {
    // Validate selected subtrees before any path changes. User manages backups.
    for (const entry of entries) {
      const { row } = entry;
      const result: SyncResult = { id: row.id, root: row.root, rel: row.rel, target: row.target, status: "failed", message: "" };
      try {
        unchanged(row.root, row.rel, entry.snapshot); freeTarget(row.root, row.target);
        prepared.push({ entry, result });
      } catch (error) { result.message = errorText(error); }
      results.push(result);
    }
    // Child folders move first; their parents retain their original source paths until their turn.
    prepared.sort((a, b) => b.entry.row.rel.split("/").length - a.entry.row.rel.split("/").length);
    for (const item of prepared) {
      const { entry, result } = item, { row } = entry;
      let reservation: { path: string; ino: number; dev: number } | undefined;
      try {
        unchanged(row.root, row.rel, entry.snapshot);
        const source = safePath(row.root, row.rel), target = freeTarget(row.root, row.target);
        // Reserve a new empty name exclusively. POSIX rename can only replace this
        // empty directory; a concurrently populated destination makes it fail.
        fs.mkdirSync(target); const reserved = fs.lstatSync(target);
        reservation = { path: target, ino: reserved.ino, dev: reserved.dev };
        unchanged(row.root, row.rel, entry.snapshot); safePath(row.root, row.target);
        const current = fs.lstatSync(target);
        if (current.ino !== reserved.ino || current.dev !== reserved.dev || fs.readdirSync(target).length) throw new Error("目标目录预留状态变化，未移动");
        fs.renameSync(source, target); reservation = undefined;
        result.status = "applied"; result.message = "已改文件夹名；内容引用未修改";
        // Track our own child moves without treating them as external edits.
        for (const pending of prepared) if (pending !== item && pending.result.status !== "applied" && pending.entry.row.root === row.root && row.rel.startsWith(pending.entry.row.rel + "/")) {
          const oldPrefix = row.rel.slice(pending.entry.row.rel.length + 1), newPrefix = row.target.slice(pending.entry.row.rel.length + 1);
          const tree = pending.entry.snapshot.tree.map(node => node.rel === oldPrefix || node.rel.startsWith(oldPrefix + "/") ? { ...node, rel: newPrefix + node.rel.slice(oldPrefix.length) } : node);
          pending.entry.snapshot = { ...pending.entry.snapshot, tree, digest: treeDigest(tree) };
        }
        for (const previous of results) if (previous !== result && previous.status === "applied" && previous.root === row.root && previous.target.startsWith(row.rel + "/")) previous.target = row.target + previous.target.slice(row.rel.length);
      } catch (error) { result.message = errorText(error); }
      finally {
        if (reservation) try { const stat = fs.lstatSync(reservation.path); if (stat.ino === reservation.ino && stat.dev === reservation.dev && !fs.readdirSync(reservation.path).length) fs.rmdirSync(reservation.path); } catch { /* never remove somebody else's data */ }
      }
    }

  } finally { roots.forEach(root => activeRoots.delete(root)); }
  return { results, applied: results.filter(row => row.status === "applied").length, failed: results.filter(row => row.status === "failed").length };
}
