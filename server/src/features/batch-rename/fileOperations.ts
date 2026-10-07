import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { setImmediate } from "node:timers/promises";
import { pnwCodeReplaceStringByRules, pnwCodeReplaceTextByRules } from "@phoenix-wing/code-core";
import { effectiveCodeIgnorePatterns, isIgnoredName } from "../../lib/codeIgnoreService.js";
import { decodeSourceBuffer, encodeSourceText } from "../../lib/sourceTextCodec.js";
import type { pnwCodeResolveReplacementRules } from "@phoenix-wing/code-core";
import { runtimeHomeDirectory } from "../../lib/appRuntimePaths.js";

const MAX_FILE = 64 * 1024 * 1024, MAX_TEXT = 4 * 1024 * 1024, MAX_PLAN = 32 * 1024 * 1024;
const TTL = 30 * 60 * 1000;
export type SyncMapping = { old: string; target: string; chain: string[] };
export type ExcludedRule = { row: number; old: string; target: string; reason: string };
export type RenameRules = { excluded_rules?: ExcludedRule[]; mappings: SyncMapping[]; conflicts: string[]; rules: ReturnType<typeof pnwCodeResolveReplacementRules> };
export type FileOptions = { roots?: string[]; filenames?: boolean; contents?: boolean };
const CATIA_LINKED = /\.(?:catpart|catproduct|catshape|catprocess|catanalysis|catmaterial|catalog)$/i;
const CATIA_DRAWING = /\.catdrawing$/i;
const STEP = /\.(?:stp|step)$/i;
const BINARY = /\.(?:fcstd\d*|fcbak|pdf|png|jpe?g|gif|webp|ico|bmp|tiff?|zip|gz|7z|rar|exe|dll|so|dylib|bin|sqlite\d?|db|woff2?|ttf|otf|mp[34]|mov|wav|docx?|xlsx?|pptx?|sldprt|sldasm|slddrw)$/i;
export type SyncRow = { kind?: "file" | "directory"; id: string; root: string; rel: string; target: string; occurrences: number; binary: boolean; eligible: boolean; message: string; diffs: Array<{ line: number; before: string; after: string }>; truncated: boolean };
export type SyncPreview = { excluded_rules?: ExcludedRule[]; plan_id: string; expires_at: string; roots: string[]; mappings: SyncMapping[]; conflicts: string[]; rows: SyncRow[]; scanned: number; skipped: number; warnings: string[] };
type FilePlan = { row: SyncRow; fingerprint: string; output?: Buffer; mode: number };
type Plan = { workspace: string; owner: string; expires: number; files: FilePlan[]; preview: SyncPreview; consumed: boolean };
const plans = new Map<string, Plan>();
export const activeRoots = new Set<string>();
const fingerprint = (raw: Buffer) => createHash("sha256").update(raw).digest("hex");
// Treat canonical Unicode forms and casing as the same destination on every host.
const filenameKey = (value: string) => value.normalize("NFC").toLowerCase();
const message = (error: unknown) => error instanceof Error ? error.message : String(error);
const inside = (root: string, candidate: string) => candidate === root || (!path.relative(root, candidate).startsWith(`..${path.sep}`) && path.relative(root, candidate) !== ".." && !path.isAbsolute(path.relative(root, candidate)));

export function directory(raw: unknown) {
  if (typeof raw !== "string" || !path.isAbsolute(raw)) throw new Error("目录须为绝对路径");
  const root = fs.realpathSync(raw);
  if (!fs.statSync(root).isDirectory()) throw new Error("所选路径不是目录");
  if (root === path.parse(root).root || root === fs.realpathSync(runtimeHomeDirectory())) throw new Error("请选择具体项目或文档目录，不允许扫描整个磁盘或主目录");
  return root;
}

/** Recheck every component, including backup directories; never follow a new symlink. */
export function safePath(root: string, rel: string, mustExist = true) {
  if (fs.realpathSync(root) !== root) throw new Error("目录已被替换，请重新预览");
  const abs = path.resolve(root, rel);
  if (!inside(root, abs) || abs === root) throw new Error("路径超出所选目录");
  let current = root;
  const parts = path.relative(root, abs).split(path.sep);
  for (let i = 0; i < parts.length; i++) {
    current = path.join(current, parts[i]);
    try { if (fs.lstatSync(current).isSymbolicLink()) throw new Error("不处理符号链接"); }
    catch (error) { if (!mustExist && (error as NodeJS.ErrnoException).code === "ENOENT") break; throw error; }
  }
  return abs;
}

export function validFilename(name: string) {
  return name.length > 0 && Buffer.byteLength(name) <= 255 && !/[<>:"/\\|?*\x00-\x1f]/.test(name) && name !== "." && name !== ".." && !/[. ]$/.test(name);
}

export async function previewFileChanges(workspace: string, body: FileOptions, resolved: RenameRules, owner = "document-sync") {
  const ws = directory(workspace);
  if (!Array.isArray(body.roots) || !body.roots.length || body.roots.length > 12) throw new Error("请选择 1–12 个目录");
  if (body.filenames === false && body.contents === false) throw new Error("至少选择文件名或文本内容");
  const roots: string[] = [];
  for (const input of body.roots) {
    const root = directory(input);
    if (roots.some(other => inside(other, root) || inside(root, other))) throw new Error("目录有重复或包含关系，请只保留外层目录");
    roots.push(root);
  }
  const now = Date.now();
  for (const [id, plan] of plans) if (plan.expires < now || plan.consumed) plans.delete(id);
  if (plans.size >= 8) plans.delete(plans.keys().next().value!);
  const plan_id = randomUUID();
  const preview: SyncPreview = { plan_id, expires_at: new Date(now + TTL).toISOString(), roots, excluded_rules: resolved.excluded_rules, mappings: resolved.mappings, conflicts: resolved.conflicts, rows: [], scanned: 0, skipped: 0, warnings: [] };
  const files: FilePlan[] = [];
  let bytes = 0, visited = 0;
  if (!resolved.conflicts.length && resolved.rules.length) for (const root of roots) {
    const patterns = effectiveCodeIgnorePatterns(root);
    const stack = [""];
    while (stack.length) {
      const relDir = stack.pop()!;
      const dir = relDir ? safePath(root, relDir) : root;
      for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
        if (++visited > 20_000) throw new Error("目录超过 20000 项，请缩小范围后重新预览（未写入）");
        if (visited % 40 === 0) await setImmediate();
        if (entry.isSymbolicLink() || isIgnoredName(entry.name, patterns)) { preview.skipped++; continue; }
        const rel = path.posix.join(relDir, entry.name);
        if (entry.isDirectory()) { stack.push(rel); continue; }
        if (!entry.isFile()) { preview.skipped++; continue; }
        preview.scanned++;
        try {
          const abs = safePath(root, rel), stat = fs.statSync(abs);
          if (stat.size > MAX_FILE) { preview.warnings.push(`${root}/${rel}：超过 64 MiB，跳过`); continue; }
          const name = body.filenames === false ? entry.name : pnwCodeReplaceStringByRules(entry.name, resolved.rules).output;
          const raw = fs.readFileSync(abs);
          const decoded = BINARY.test(entry.name) || CATIA_LINKED.test(entry.name) || CATIA_DRAWING.test(entry.name) || raw.length > MAX_TEXT || /[\x00-\x08\x0b\x0e-\x1f]/.test(raw.subarray(0, 8192).toString("latin1")) ? null : decodeSourceBuffer(raw);
          const relevant = decoded ? resolved.rules.filter(rule => decoded.text.includes(rule.search)) : [];
          // STEP is text-encoded CAD, not an ordinary prose document. A disk rename
          // must not rewrite entity names, geometry, or exporter header strings.
          const replacement = decoded && !STEP.test(entry.name) && body.contents !== false && relevant.some(rule => rule.search !== rule.replace) ? pnwCodeReplaceTextByRules(decoded.text, relevant) : null;
          const changedText = replacement && replacement.output !== decoded!.text;
          if (name === entry.name && !changedText) continue;
          const target = path.posix.join(path.posix.dirname(rel), name);
          const row: SyncRow = { id: randomUUID(), root, rel, target, occurrences: changedText ? replacement.matches.filter(match => match.search !== match.replace).reduce((sum, match) => sum + match.occurrences, 0) : 0, binary: !decoded, eligible: true, message: "待应用", diffs: [], truncated: false };
          if (STEP.test(entry.name)) row.message = "待改文件名（STEP 内部内容保持不变）";
          if (CATIA_DRAWING.test(entry.name)) row.message = "待改文件名（CATDrawing 内部内容及引用不修改）";
          if (!validFilename(name)) { row.eligible = false; row.message = "目标文件名无效"; }
          if ([entry.name, name].some(value => /\.fcstd\d*$/i.test(value))) { row.eligible = false; row.message = "FCStd 文件改名请走 CAD 改名入口，以同步引用"; }
          if (CATIA_DRAWING.test(entry.name) !== CATIA_DRAWING.test(name)) { row.eligible = false; row.message = "CATDrawing 仅允许保留图纸后缀的文件名修改"; }
          if (CATIA_LINKED.test(entry.name) || CATIA_LINKED.test(name)) { row.eligible = false; row.message = "CATIA 模型及关联文档请在 CATIA 中改名，以同步关联"; }
          if (stat.nlink > 1) { row.eligible = false; row.message = "文件存在硬链接，请人工确认"; }
          let output: Buffer | undefined;
          if (changedText) {
            output = encodeSourceText(decoded!, replacement.output);
            bytes += output.length;
            const before = decoded!.text.split("\n"), after = replacement.output.split("\n");
            const lines = replacement.lines.filter(line => before[line - 1] !== after[line - 1]);
            row.diffs = lines.slice(0, 80).map(line => ({ line, before: (before[line - 1] || "").slice(0, 1500), after: (after[line - 1] || "").slice(0, 1500) }));
            row.truncated = lines.length > 80 || row.diffs.some(diff => (before[diff.line - 1] || "").length > 1500 || (after[diff.line - 1] || "").length > 1500);
          }
          if (bytes > MAX_PLAN || files.length >= 2000) throw new Error("匹配结果过多，请缩小目录或记录范围");
          files.push({ row, fingerprint: fingerprint(raw), output, mode: stat.mode });
          preview.rows.push(row);
        } catch (error) {
          if (bytes > MAX_PLAN || files.length >= 2000) throw error;
          preview.warnings.push(`${root}/${rel}：${message(error)}`);
        }
      }
    }
  }
  // Conservatively reject collisions, even if another selected row would vacate the name.
  const destinations = new Map<string, FilePlan[]>();
  for (const file of files) {
    const key = filenameKey(path.join(file.row.root, file.row.target));
    destinations.set(key, [...(destinations.get(key) || []), file]);
    if (file.row.target !== file.row.rel) {
      const parent = path.dirname(safePath(file.row.root, file.row.rel));
      const name = filenameKey(path.basename(file.row.target));
      if (fs.readdirSync(parent).some(existing => filenameKey(existing) === name)) { file.row.eligible = false; file.row.message = "目标名称已存在（含大小写冲突）"; }
    }
  }
  for (const group of destinations.values()) if (group.length > 1) for (const file of group) { file.row.eligible = false; file.row.message = "多个文件将写入同一目标"; }
  plans.set(plan_id, { workspace: ws, owner, expires: now + TTL, preview, files, consumed: false });
  return preview;
}

export type SyncResult = { id: string; root: string; rel: string; target: string; status: "applied" | "failed"; message: string; backup?: string };
export async function applyFileChanges(workspace: string, body: { plan_id?: string; ids?: string[]; confirmed?: boolean }, owner = "document-sync") {
  const ws = directory(workspace), plan = plans.get(String(body.plan_id));
  if (!plan || plan.workspace !== ws || plan.owner !== owner || plan.expires < Date.now() || plan.consumed) throw new Error("预览已失效或已应用，请重新搜索预览");
  if (body.confirmed !== true || !Array.isArray(body.ids) || !body.ids.length) throw new Error("请勾选预览结果并确认应用");
  const ids = [...new Set(body.ids)];
  const files = ids.map(id => plan.files.find(file => file.row.id === id));
  if (files.some(file => !file?.row.eligible) || plan.preview.conflicts.length) throw new Error("选择包含无效或冲突项，请重新预览");
  const roots = [...new Set(files.map(file => file!.row.root))];
  if (roots.some(root => [...activeRoots].some(other => inside(root, other) || inside(other, root)))) throw new Error("所选目录正有同步任务执行，请稍后重试");
  plan.consumed = true;
  for (const root of roots) activeRoots.add(root);
  const results: SyncResult[] = [];
  try {
    for (const file of files as FilePlan[]) {
      const { row } = file;
      const result: SyncResult = { id: row.id, root: row.root, rel: row.rel, target: row.target, status: "failed", message: "" };
      let temp = "", receipt = "";
      try {
        const abs = safePath(row.root, row.rel), target = safePath(row.root, row.target, false);
        const current = fs.statSync(abs);
        if (!current.isFile() || current.size > MAX_FILE || current.nlink > 1) throw new Error("源文件状态已变化，请重新预览");
        const raw = fs.readFileSync(abs);
        if (fingerprint(raw) !== file.fingerprint) throw new Error("文件在预览后已变化，本项未写入");
        if (target !== abs && fs.readdirSync(path.dirname(target)).some(name => filenameKey(name) === filenameKey(path.basename(target)))) throw new Error("目标文件已存在，本项未写入");
        if (!owner.startsWith("task:")) {
        const backupRel = path.posix.join(owner === "document-sync" ? ".phoenix/document-sync-backups" : ".phoenix/rename-task-backups", body.plan_id!, `${row.id}.original`);
        const backup = safePath(row.root, backupRel, false);
        fs.mkdirSync(path.dirname(backup), { recursive: true });
        safePath(row.root, path.posix.dirname(backupRel));
        fs.writeFileSync(backup, raw, { flag: "wx", mode: 0o600 });
        result.backup = backup;
        receipt = `${backup}.json`;
        fs.writeFileSync(receipt, JSON.stringify({ ...result, status: "prepared", mappings: plan.preview.mappings, created_at: new Date().toISOString() }, null, 2), { flag: "wx", mode: 0o600 });
        }
        temp = path.join(path.dirname(abs), `.document-sync-${randomUUID()}.tmp`);
        fs.writeFileSync(temp, file.output || raw, { flag: "wx", mode: file.mode & 0o777 });
        // Check again after backup, before replacing bytes. Other independent rows may continue on failure.
        safePath(row.root, row.rel); safePath(row.root, row.target, false);
        if (fingerprint(fs.readFileSync(abs)) !== file.fingerprint) throw new Error("应用前源文件变化，本项未写入");
        if (target === abs) { fs.renameSync(temp, abs); temp = ""; }
        else {
          fs.linkSync(temp, target); // atomic create-if-absent, never overwrite another file
          fs.unlinkSync(temp); temp = "";
          try { fs.unlinkSync(abs); }
          catch (error) { throw new Error(`新文件已生成，但旧文件未移除，请人工核对：${message(error)}`); }
        }
        result.status = "applied"; result.message = owner.startsWith("task:") ? "已应用" : "已应用并备份";
      } catch (error) { result.message = message(error); }
      finally {
        if (temp) try { fs.unlinkSync(temp); } catch { /* preserve original error */ }
        if (receipt) try { fs.writeFileSync(receipt, JSON.stringify({ ...result, created_at: new Date().toISOString() }, null, 2)); }
        catch (error) { result.message += `；结果日志更新失败：${message(error)}`; }
      }
      results.push(result);
      await setImmediate();
    }
  } finally { for (const root of roots) activeRoots.delete(root); }
  return { results, applied: results.filter(row => row.status === "applied").length, failed: results.filter(row => row.status === "failed").length };
}
