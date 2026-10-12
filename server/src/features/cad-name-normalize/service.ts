import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { setImmediate as yieldToHost } from "node:timers/promises";
import { strToU8, zipSync } from "fflate";
import { pnwCreateDb } from "@phoenix-wing/db-node";
import { readBomBatchHints, renameBomFcstdFile } from "../../lib/bomAttributeService.js";
import { bomNameSource } from "../../lib/bomNameRecommendation.js";
import { fcstdFingerprint, fcstdWorkspace, readFcstdBatchArchive, safeFcstdPath, visitFcstdBatch } from "../../lib/fcstdBatchFiles.js";
import { FcstdBatchTargetAmbiguityError, inspectFcstdBatchTarget, patchFcstdEmbeddedBomDocumentXml, replaceFileAtomically } from "../../lib/fcstdDocumentXmlService.js";
import { updateCadIndexEntryAfterBomWrite } from "../../lib/cadIndexMutationService.js";
import { analyzeRenameReferences, type RefScanPayload } from "../../lib/pnwRenameService.js";
import { proposeNameNormalization } from "./proposal.js";
import { correctRenamedReferences, renameOptions, type RenameOptions } from "./referenceCorrections.js";
import { startCadIndexScan } from "../../lib/cadIndexScanService.js";
import { isDrawingDocument, proposeDrawingName } from "./drawingNames.js";

export type NameRow = {
  kind?: "model" | "drawing"; source_rel?: string;
  rel: string; object_name: string; current_name: string; current_label: string;
  proposed_name: string; proposed_label: string; target_rel: string;
  attributes_changed: boolean; rename_changed: boolean; eligible: boolean; message: string; warnings: string[];
  status: "normal" | "needs_fix" | "needs_review";
};
type FilePlan = { row: NameRow; hash: string; backup?: string; source?: { rel: string; hash: string } };
type Plan = { root: string; scope: string; expires: number; files: Map<string, FilePlan>; mode?: "models" | "drawings" };
type Analysis = { plan: Plan; rels: string[]; scans: Map<string, RefScanPayload>; blocked: Set<string>; indexHash: string; hostHashes: Map<string, string>; options: RenameOptions };
const previews = new Map<string, Plan>();
const prepared = new Map<string, Plan>();
const analyses = new Map<string, Analysis>();
const activeRenameRoots = new Set<string>();
const ttl = 10 * 60_000;
const cleanError = (error: unknown) => error instanceof Error ? error.message : String(error);
function refreshIndexAfterBatch(root: string) {
  try { return startCadIndexScan(root, () => {}); }
  catch (error) { return { state: "failed" as const, message: `文件处理已结束，但自动更新 CAD 索引未启动：${cleanError(error)}；请到 CAD 索引重试` }; }
}
function put<T extends Plan>(store: Map<string, T>, plan: T) {
  for (const [key, item] of store) if (item.expires <= Date.now()) store.delete(key);
  while (store.size >= 20) store.delete(store.keys().next().value!);
  const id = randomUUID(); store.set(id, plan); return id;
}
function get(store: Map<string, Plan>, workspace: string, id?: string) {
  const plan = store.get(id || "");
  if (!plan || plan.root !== fcstdWorkspace(workspace) || plan.expires <= Date.now()) throw new Error("计划已失效，请重新预览；计划仅限原工作空间且 10 分钟有效");
  return plan;
}
function selected(plan: Plan, rels: unknown): string[] {
  if (!Array.isArray(rels) || !rels.length || rels.length > 1000 || new Set(rels).size !== rels.length || rels.some(rel => typeof rel !== "string" || !plan.files.has(rel) || !plan.files.get(rel)!.row.eligible)) throw new Error("只能执行本次预览中明确勾选的可用文件");
  return rels;
}
function unchanged(root: string, rel: string, hash: string) {
  const filename = safeFcstdPath(root, rel);
  if (fcstdFingerprint(fs.readFileSync(filename)) !== hash) throw new Error("分析后源文件已变化，请重新预览");
  return filename;
}
function targetFree(root: string, row: NameRow) {
  if (!row.rename_changed) return;
  const parent = safeFcstdPath(root, path.posix.dirname(row.rel));
  const target = path.posix.basename(row.target_rel).normalize("NFC").toLowerCase();
  // Reject case-only renames as well, avoiding platform-dependent overwrite semantics.
  if (fs.readdirSync(parent).some(name => name.normalize("NFC").toLowerCase() === target)) throw new Error("目标文件名已存在或仅大小写不同，禁止覆盖");
}
function backupFile(root: string, rel: string, filename: string, id: string) {
  const backupRel = `.phoenix/name-normalize-backups/${id}/${rel}`;
  let parent = root;
  for (const segment of path.posix.dirname(backupRel).split("/")) {
    parent = path.join(parent, segment);
    if (!fs.existsSync(parent)) fs.mkdirSync(parent);
    safeFcstdPath(root, path.relative(root, parent));
    if (!fs.statSync(parent).isDirectory()) throw new Error("备份路径不是目录");
  }
  fs.copyFileSync(filename, path.join(root, backupRel), fs.constants.COPYFILE_EXCL);
  return backupRel;
}

export async function previewNames(workspace: string, body: { batch_dir?: string; name_source?: unknown; mode?: "models" | "drawings" } = {}) {
  if (body.mode && !["models", "drawings"].includes(body.mode)) throw new Error("未知名称处理模式");
  const mode = body.mode || "models";
  const nameSource = bomNameSource(body.name_source);
  const root = fcstdWorkspace(workspace);
  const scope = String(body.batch_dir ?? "").trim().replace(/\\/g, "/");
  if (!scope || scope.split("/").includes("..")) throw new Error("请明确选择搜索目录，根目录使用 .；不允许 ..");
  const rows: NameRow[] = []; const files = new Map<string, FilePlan>();
  const scan = await visitFcstdBatch(root, scope, (rel, filename) => {
    const row: NameRow = { rel, object_name: "", current_name: "", current_label: "", proposed_name: "", proposed_label: "", target_rel: "", attributes_changed: false, rename_changed: false, eligible: false, message: "", warnings: [], status: "needs_review" };
    rows.push(row);
    try {
      const archive = readFcstdBatchArchive(filename);
      row.kind = isDrawingDocument(rel, archive.xml) ? "drawing" : "model";
      if (mode === "drawings") {
        if (row.kind !== "drawing") { rows.pop(); return; }
        const proposal = proposeDrawingName(root, rel, archive.xml);
        Object.assign(row, { source_rel: proposal.sourceRel, target_rel: proposal.targetRel, rename_changed: rel !== proposal.targetRel });
        targetFree(root, row);
        row.eligible = row.rename_changed;
        row.status = row.eligible ? "needs_fix" : "normal";
        row.message = row.eligible ? "随源模型同步图纸文件名；不写 BOM 属性，可直接分析改名" : "图纸文件名已与源模型一致";
        files.set(rel, { row, hash: fcstdFingerprint(archive.bytes), source: { rel: proposal.sourceRel, hash: proposal.sourceHash } });
        return;
      }
      if (row.kind === "drawing") throw new Error("图纸不参与模型名称规则；请切换到图纸名称同步");
      const target = inspectFcstdBatchTarget(archive.xml);
      Object.assign(row, { object_name: target.objectName, current_name: target.current.PartName, current_label: target.current.label });
      const proposal = proposeNameNormalization(rel, target.current, target.types, readBomBatchHints(root, rel), nameSource, target);
      Object.assign(row, { proposed_name: proposal.PartName, proposed_label: proposal.label, target_rel: proposal.targetRel, warnings: proposal.warnings,
        attributes_changed: target.current.PartName !== proposal.PartName || target.current.label !== proposal.label,
        rename_changed: rel !== proposal.targetRel });
      targetFree(root, row);
      row.eligible = row.attributes_changed || row.rename_changed;
      row.status = row.eligible ? "needs_fix" : "normal";
      row.message = row.attributes_changed ? "属性有差异；可选写入属性，也可直接改文件名（保留当前属性）" : row.rename_changed ? "属性已一致，可直接分析改名与引用" : "已一致（本次未写入）";
      files.set(rel, { row, hash: fcstdFingerprint(archive.bytes) });
    } catch (error) {
      if (error instanceof FcstdBatchTargetAmbiguityError) Object.assign(row, { object_name: error.objectName, current_name: error.current.PartName, current_label: error.current.label });
      row.message = cleanError(error);
    }
  });
  const targets = new Map<string, NameRow[]>();
  for (const row of rows.filter(row => row.target_rel)) {
    const key = row.target_rel.normalize("NFC").toLowerCase();
    targets.set(key, [...(targets.get(key) || []), row]);
  }
  for (const group of targets.values()) if (group.length > 1) for (const row of group) { row.eligible = false; row.status = "needs_review"; row.message = "多个源文件推荐到同一目标文件名，禁止批量执行"; }
  const plan_id = put(previews, { root, scope: scan.batch_dir, expires: Date.now() + ttl, files, mode });
  return { plan_id, mode, ...scan, rows };
}

export function writeNames(workspace: string, body: { plan_id?: string; rels?: string[]; confirmed?: boolean } = {}) {
  const plan = get(previews, workspace, body.plan_id);
  if (plan.mode === "drawings") throw new Error("图纸名称同步不写 BOM 属性，请直接分析改名");
  const rels = selected(plan, body.rels);
  if (body.confirmed !== true) throw new Error("属性写入需要明确确认");
  previews.delete(body.plan_id!);
  for (const [id, analysis] of analyses) if (analysis.plan === plan) analyses.delete(id);
  const files = new Map<string, FilePlan>();
  const results: Array<{ rel: string; status: "written" | "unchanged" | "failed"; message: string; backup?: string }> = [];
  for (const rel of rels) {
    const item = plan.files.get(rel)!; let committed = false; let backup: string | undefined;
    try {
      const filename = unchanged(plan.root, rel, item.hash);
      targetFree(plan.root, item.row);
      const archive = readFcstdBatchArchive(filename, true);
      if (fcstdFingerprint(archive.bytes) !== item.hash) throw new Error("预览后文件已变化");
      const patched = patchFcstdEmbeddedBomDocumentXml(archive.xml, { PartName: item.row.proposed_name, label: item.row.proposed_label });
      if (patched.objectName !== item.row.object_name) throw new Error("目标对象已改变");
      backup = backupFile(plan.root, rel, filename, body.plan_id!);
      unchanged(plan.root, rel, item.hash);
      if (item.row.attributes_changed) {
        archive.files["Document.xml"] = strToU8(patched.xml);
        replaceFileAtomically(filename, zipSync(archive.files, { level: 6 })); committed = true;
      }
      let updated = false;
      if (committed) try { updated = updateCadIndexEntryAfterBomWrite(plan.root, rel, { PartName: item.row.proposed_name, label: item.row.proposed_label }, ["PartName", "label"]); } catch { /* File already committed. */ }
      files.set(rel, { ...item, hash: fcstdFingerprint(fs.readFileSync(filename)), backup });
      results.push({ rel, status: committed ? "written" : "unchanged", backup, message: `${committed ? "PartName / Label 已写入" : "属性已一致，无需写入"}${committed && !updated ? "；索引未更新" : ""}；${item.row.rename_changed ? "尚未改名，请分析引用" : "无需改名"}` });
    } catch (error) { results.push({ rel, status: committed ? "written" : "failed", backup, message: `${committed ? "属性已写入，但改名准备失败；请重新预览：" : ""}${cleanError(error)}` }); }
  }
  const needsRename = [...files.values()].some(item => item.row.rename_changed);
  const prepared_id = files.size ? put(prepared, { root: plan.root, scope: plan.scope, expires: Date.now() + ttl, files }) : null;
  const index_update = !needsRename && results.some(result => result.status === "written") ? refreshIndexAfterBatch(plan.root) : undefined;
  return { prepared_id, results, index_update };
}

function indexSnapshot(root: string) {
  const file = path.join(root, ".phoenix/phoenix-workspace.sqlite");
  if (!fs.existsSync(file)) throw new Error("缺少引用索引，无法可靠分析改名；请先刷新 CAD 索引");
  safeFcstdPath(root, ".phoenix/phoenix-workspace.sqlite");
  const db = pnwCreateDb(file);
  try {
    const table = db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='phoenix_cad_bom_xref'");
    if (!table) throw new Error("引用索引尚未建立；先刷新索引再预览");
    const assets = db.all<{ repo_rel_path: string; filename: string }>("SELECT repo_rel_path, filename FROM phoenix_cad_file_asset WHERE file_status='present' ORDER BY repo_rel_path");
    const edges = db.all("SELECT * FROM phoenix_cad_bom_xref ORDER BY host_repo_rel_path, xlink_file_attr");
    return { assets, hash: fcstdFingerprint(strToU8(JSON.stringify([assets, edges]))) };
  } finally { db.close(); }
}
function terms(row: NameRow) { return { old_basename: path.posix.basename(row.rel), new_basename: path.posix.basename(row.target_rel), old_repo_rel_path: row.rel, new_repo_rel_path: row.target_rel, exclude_repo_rel: row.rel, transitive: true }; }

export function analyzeNames(workspace: string, body: { prepared_id?: string; plan_id?: string; options?: Partial<RenameOptions> } = {}) {
  if (body.prepared_id && body.plan_id) throw new Error("只能选择一个预览或属性完成计划");
  const fromPreview = !body.prepared_id;
  const plan = fromPreview ? get(previews, workspace, body.plan_id) : get(prepared, workspace, body.prepared_id);
  const scans = new Map<string, RefScanPayload>(); const blocked = new Set<string>();
  const options = renameOptions(body.options); const hostHashes = new Map<string, string>();
  let snapshot: ReturnType<typeof indexSnapshot> | undefined; let indexError = "";
  try { snapshot = indexSnapshot(plan.root); } catch (error) { indexError = cleanError(error); }
  const rows = [...plan.files.values()].map(item => {
    const row = { rel: item.row.rel, target_rel: item.row.target_rel, kind: item.row.kind, source_rel: item.row.source_rel, eligible: false, status: "needs_review" as NameRow["status"], message: "", hosts: [] as RefScanPayload["hosts"], outside_scope: [] as string[] };
    try {
      unchanged(plan.root, row.rel, item.hash); targetFree(plan.root, item.row);
      if (item.source) unchanged(plan.root, item.source.rel, item.source.hash);
      if (!item.row.eligible && item.row.status === "needs_review") throw new Error(item.row.message);
      if (!item.row.rename_changed) {
        row.status = fromPreview && item.row.attributes_changed ? "needs_fix" : "normal";
        row.message = fromPreview && item.row.attributes_changed ? "文件名已一致，无需改名；属性仍有待写入差异" : "文件名已一致，无需改名";
        return row;
      }
      if (!snapshot) throw new Error(indexError);
      const sameName = snapshot.assets.filter(asset => asset.filename.toLowerCase() === path.posix.basename(row.rel).toLowerCase());
      if (sameName.length !== 1 || sameName[0].repo_rel_path.replace(/^\.\//, "") !== row.rel) throw new Error("源文件未可靠入索引或有同名文件歧义，禁止自动改名");
      // Candidate scope limits renamed files only. Query the entire CAD index,
      // including direct and indirect hosts outside the selected directory.
      const scan = analyzeRenameReferences(plan.root, terms(item.row));
      row.hosts = scan.hosts;
      for (const host of scan.hosts) {
        const filename = safeFcstdPath(plan.root, host.host_repo_rel_path);
        if (host.hits.length) hostHashes.set(host.host_repo_rel_path, fcstdFingerprint(readFcstdBatchArchive(filename).bytes));
        for (const hit of host.hits) {
          const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(host.host_repo_rel_path), hit.matched_text.replace(/\\/g, "/")));
          const basenameOnly = !/[\\/]/.test(hit.matched_text) && hit.matched_text === path.posix.basename(row.rel);
          if (resolved !== row.rel && !(options.fixBasename && basenameOnly)) throw new Error("同名引用或非相对引用歧义，禁止自动改名；请打开引用分析人工确认");
        }
      }
      row.outside_scope = scan.hosts.map(host => host.host_repo_rel_path).filter(rel => plan.scope !== "." && !rel.startsWith(`${plan.scope}/`));
      row.eligible = true;
      row.status = "needs_fix";
      row.message = (scan.hit_count ? `需改名；整个 CAD 索引发现 ${scan.hit_count} 处直接引用，将按勾选选项自动修正并校验` : "需改名；整个 CAD 索引未发现入向引用，引用修正将正常跳过")
        + (fromPreview && item.row.attributes_changed ? "；本次只改文件名，属性差异保留，可另行写入" : "");
      scans.set(row.rel, scan);
    } catch (error) { row.message = cleanError(error); blocked.add(row.rel); }
    return row;
  });
  while (analyses.size >= 20) analyses.delete(analyses.keys().next().value!);
  const analysis_id = randomUUID();
  analyses.set(analysis_id, { plan, rels: rows.filter(row => row.eligible).map(row => row.rel), scans, blocked, indexHash: snapshot?.hash || "", hostHashes, options });
  return { analysis_id, rows, options, warning: "引用分析范围：整个工作空间 CAD 索引，包含搜索目录外的直接及间接宿主。搜索目录只限定待改名文件。执行时按勾选选项自动修正 XLink 路径、basename 引用及引用标签，并备份待修改宿主；未完成的单独标记。外部修改后请先更新 CAD 索引，未入索引或工作空间外的依赖无法保证覆盖。" };
}

export type RenameResult = { rel: string; target_rel: string; status: "renamed" | "references_pending" | "failed" | "uncertain" | "skipped"; message: string; rename_log_id?: number; backup?: string; xlink_patches?: number; label_patches?: number; failed_hosts?: Array<{ host_repo_rel_path: string; error: string }>; host_backups?: Array<{ rel: string; backup: string }> };
export type RenameProgress = { completed: number; total: number; current_rel: string; results: RenameResult[] };
export function renameNames(workspace: string, body: { analysis_id?: string; rels?: string[]; confirmed?: boolean } = {}, onProgress?: (progress: RenameProgress) => void) {
  const analysis = analyses.get(body.analysis_id || "");
  if (!analysis || analysis.plan.root !== fcstdWorkspace(workspace) || analysis.plan.expires <= Date.now()) throw new Error("改名分析已失效，请重新预览");
  if (activeRenameRoots.has(analysis.plan.root)) throw new Error("当前工作空间已有批量改名任务，请等待完成");
  const rels = selected(analysis.plan, body.rels);
  if (body.confirmed !== true || rels.some(rel => !analysis.rels.includes(rel))) throw new Error("仅允许明确确认的、已完成引用分析且无冲突的文件改名");
  analyses.delete(body.analysis_id!);
  for (const [id, plan] of previews) if (plan === analysis.plan) previews.delete(id);
  for (const [id, plan] of prepared) if (plan === analysis.plan) prepared.delete(id);
  for (const [id, item] of analyses) if (item.plan === analysis.plan) analyses.delete(id);
  if (indexSnapshot(analysis.plan.root).hash !== analysis.indexHash) throw new Error("分析后引用索引已变化；本次计划已作废，请重新预览");
  // Preflight and back up each item before mutation. A local failure does not
  // discard independent items; affected hosts still block every dependent item.
  const preflightErrors = new Map<string, string>();
  for (const rel of rels) {
    const item = analysis.plan.files.get(rel)!;
    try { unchanged(analysis.plan.root, rel, item.hash); targetFree(analysis.plan.root, item.row); if (item.source) unchanged(analysis.plan.root, item.source.rel, item.source.hash); }
    catch (error) { preflightErrors.set(rel, cleanError(error)); }
  }
  const hosts = [...new Set(rels.flatMap(rel => analysis.scans.get(rel)?.hosts.filter(host => host.hits.length).map(host => host.host_repo_rel_path) || []))];
  const hostBackups = new Map<string, string>();
  for (const host of hosts) {
    try { unchanged(analysis.plan.root, host, analysis.hostHashes.get(host)!); hostBackups.set(host, backupFile(analysis.plan.root, host, safeFcstdPath(analysis.plan.root, host), `${body.analysis_id}/hosts`)); }
    catch (error) {
      for (const rel of rels) if (analysis.scans.get(rel)?.hosts.some(item => item.host_repo_rel_path === host && item.hits.length)) preflightErrors.set(rel, `宿主 ${host}：${cleanError(error)}`);
    }
  }
  // Direct rename can start from a read-only preview without an attribute write.
  for (const rel of rels) {
    const item = analysis.plan.files.get(rel)!;
    if (!preflightErrors.has(rel) && !item.backup) try { item.backup = backupFile(analysis.plan.root, rel, safeFcstdPath(analysis.plan.root, rel), `${body.analysis_id}/sources`); }
    catch (error) { preflightErrors.set(rel, `源文件备份失败：${cleanError(error)}`); }
  }
  const movedPaths = new Map<string, string>();
  const hostHashes = new Map(analysis.hostHashes);
  const results: RenameResult[] = [];
  let expectedIndexHash = analysis.indexHash;
  activeRenameRoots.add(analysis.plan.root);
  return (async () => {
  try {
  for (const rel of rels) {
    const item = analysis.plan.files.get(rel)!;
    onProgress?.({ completed: results.length, total: rels.length, current_rel: rel, results: [...results] });
    await yieldToHost();
    const originalHosts = analysis.scans.get(rel)?.hosts.filter(host => host.hits.length).map(host => host.host_repo_rel_path) || [];
    const currentHosts = originalHosts.map(host => movedPaths.get(host) || host);
    const result: RenameResult = { rel, target_rel: item.row.target_rel, status: "failed", backup: item.backup, message: "", host_backups: originalHosts.filter(host => hostBackups.has(host)).map(host => ({ rel: host, backup: hostBackups.get(host)! })) };
    let stopReason = "";
    try {
      try {
        if (indexSnapshot(analysis.plan.root).hash !== expectedIndexHash) throw new Error("处理期间索引被其他操作改变");
      } catch (error) { stopReason = `${cleanError(error)}；无法安全继续，请重新分析`; throw new Error(stopReason); }
      if (preflightErrors.has(rel)) throw new Error(preflightErrors.get(rel));
      // Earlier items may have corrected this source as a host. Accept only our
      // own tracked writes, never re-baseline arbitrary external changes.
      unchanged(analysis.plan.root, rel, hostHashes.get(rel) ?? item.hash); targetFree(analysis.plan.root, item.row);
      if (item.source) unchanged(analysis.plan.root, item.source.rel, item.source.hash);
      for (const host of currentHosts) unchanged(analysis.plan.root, host, hostHashes.get(host)!);
      // Exact same FCStd rename entry as the single-file dialog. Attributes were
      // already confirmed by this plan; do not write them a second time.
      const renamed = await renameBomFcstdFile(analysis.plan.root, rel, { filename: path.posix.basename(item.row.target_rel) });
      movedPaths.set(rel, renamed.rel_path);
      if (hostHashes.has(rel)) { hostHashes.set(renamed.rel_path, hostHashes.get(rel)!); hostHashes.delete(rel); }
      Object.assign(result, { target_rel: renamed.rel_path, rename_log_id: renamed.rename_log_id, status: renamed.map_updated ? "renamed" : "uncertain" });
      if (!renamed.map_updated) { stopReason = "文件已改名，但局部索引未更新，无法安全继续"; throw new Error(stopReason); }
      const corrected = correctRenamedReferences(analysis.plan.root, renamed.rename_log_id, renamed.rel_path, analysis.options, originalHosts.map(host => movedPaths.get(host) || host), hostHashes);
      result.xlink_patches = corrected.xlink_patches; result.label_patches = corrected.label_patches; result.failed_hosts = corrected.failed_hosts;
      result.status = corrected.pending ? "references_pending" : "renamed";
      result.message = corrected.pending
        ? `文件已改名，引用修正未完成：路径 ${corrected.xlink_patches} 处、标签 ${corrected.label_patches} 处已处理；请查看宿主明细或修正选项`
        : `全部完成：文件已改名，引用路径 ${corrected.xlink_patches} 处、标签 ${corrected.label_patches} 处已修正${corrected.host_count ? "" : "；整个 CAD 索引未发现引用，已跳过引用修正"}`;
      if (corrected.notes.length) result.message += `；${corrected.notes.join("；")}`;
      expectedIndexHash = indexSnapshot(analysis.plan.root).hash;
    } catch (error) {
      const moved = !fs.existsSync(path.join(analysis.plan.root, rel)) && fs.existsSync(path.join(analysis.plan.root, item.row.target_rel));
      result.status = result.rename_log_id ? (result.status === "uncertain" ? "uncertain" : "references_pending") : moved ? "uncertain" : "failed";
      result.message = `${moved ? "磁盘已改名或结果不明，请打开改名分析核对：" : "本次改名失败，未撤销此前属性操作："}${cleanError(error)}`;
      // An exception after a move can leave the index/reference state unknown.
      // Do not adopt a fresh index hash and accidentally bless external changes.
      if (moved || result.rename_log_id) stopReason ||= `改名后状态未可靠确认：${cleanError(error)}`;
    }
    results.push(result);
    onProgress?.({ completed: results.length, total: rels.length, current_rel: rel, results: [...results] });
    if (stopReason) {
      for (const remaining of rels.slice(results.length)) results.push({ rel: remaining, target_rel: analysis.plan.files.get(remaining)!.row.target_rel, status: "skipped", message: `全局安全检查未通过，未执行：${stopReason}（发生于 ${rel}）` });
      break;
    }
  }
  const changed = results.some(result => result.rename_log_id || result.status === "uncertain");
  return { results, index_update: changed ? refreshIndexAfterBatch(analysis.plan.root) : undefined };
  } finally { activeRenameRoots.delete(analysis.plan.root); }
  })();
}
