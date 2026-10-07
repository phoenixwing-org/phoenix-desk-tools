import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { setImmediate as yieldToHost } from "node:timers/promises";
import { pnwCreateDb } from "@phoenix-wing/db-node";
import { PNW_CAD_INDEX_EXCLUDED_DIRECTORIES, pnwAnalyzeCadIndexDocumentXml, pnwBuildCadWorkspaceIndex, pnwInferBomDocumentKinds, type PnwCadIndexRecord } from "@phoenix-wing/cad-core";
import { pnwReadCadIndexRevisionV1, pnwWriteCadWorkspaceIndexV1, pnwPreviewCadIndexResetV1, pnwResetCadWorkspaceIndexV1, type PnwCadIndexResetPreviewV1 } from "@phoenix-wing/cad-contracts";
import { PNW_WORKSPACE_SCHEMA_V13_DDL } from "@phoenix-wing/workspace-schema";
import { fcstdWorkspace, readFcstdBatchArchive, safeFcstdPath, visitFcstdBatch } from "./fcstdBatchFiles.js";
import { phoenixDatabasePath } from "./phoenixDatabaseService.js";

type Progress = { phase: "reading" | "checking" | "committing"; scanned: number };
type Options = { signal?: AbortSignal; assertActive?: () => void; onProgress?: (progress: Progress) => void };
function sameStat(a: fs.Stats, b: fs.Stats) {
  return a.isFile() && b.isFile() && a.size === b.size && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs && a.ino === b.ino && a.dev === b.dev;
}
function assertSchema(db: ReturnType<typeof pnwCreateDb>) {
  if (db.get<{ value: string }>("SELECT value FROM phoenix_meta WHERE key='schema_version'")?.value !== "13") throw new Error("索引需要 Schema v13；不会自动迁移或重建数据库");
}
function assertDatabaseLocation(root: string, filename: string) {
  for (const entry of [path.dirname(filename), filename]) {
    if (fs.existsSync(entry) && fs.lstatSync(entry).isSymbolicLink()) throw new Error("工作空间索引目录/文件不能是符号链接");
  }
  if (fs.existsSync(path.dirname(filename)) && fs.realpathSync(path.dirname(filename)) !== path.join(root, ".phoenix")) throw new Error("索引目录已改变");
}

/** Explicit full-workspace index refresh. It never changes FCStd files or invokes FreeCAD. */
export async function scanCadWorkspaceIndex(workspace: string, options: Options = {}) {
  const root = fcstdWorkspace(workspace);
  const filename = phoenixDatabasePath(root);
  const assertActive = () => {
    options.signal?.throwIfAborted(); options.assertActive?.();
    if (fcstdWorkspace(workspace) !== root) throw new Error("工作空间已改变，请重新扫描");
  };
  assertActive(); assertDatabaseLocation(root, filename);
  let expectedScanId = 0;
  if (fs.existsSync(filename)) {
    const db = pnwCreateDb(filename);
    try { db.exec("PRAGMA query_only=ON"); assertSchema(db); expectedScanId = pnwReadCadIndexRevisionV1(db); }
    finally { db.close(); }
  }
  const records: PnwCadIndexRecord[] = [];
  const snapshots = new Map<string, fs.Stats>();
  const discovery = await visitFcstdBatch(root, ".", async (rel, file) => {
    const before = fs.statSync(file);
    const { xml } = readFcstdBatchArchive(file);
    const analysis = pnwAnalyzeCadIndexDocumentXml(xml);
    const after = fs.statSync(file);
    if (!sameStat(before, after)) throw new Error("读取期间文件改变，请重试");
    snapshots.set(rel, after);
    records.push({ relativePath: rel, filename: path.basename(rel), documentKind: pnwInferBomDocumentKinds(rel).display,
      sizeBytes: after.size, modifiedAtMs: after.mtimeMs, ...analysis });
    if (records.length % 10 === 0) {
      options.onProgress?.({ phase: "reading", scanned: records.length });
      await yieldToHost(); assertActive();
    }
  }, { maxFiles: 5000, assertActive, excludedDirectories: PNW_CAD_INDEX_EXCLUDED_DIRECTORIES });
  if (discovery.errors.length) throw new Error(`扫描未完整完成，原索引保持不变：${discovery.errors.slice(0, 5).map(row => `${row.rel}：${row.message}`).join("；")}`);
  assertActive();
  options.onProgress?.({ phase: "checking", scanned: records.length });
  const confirmed = new Set<string>();
  const check = await visitFcstdBatch(root, ".", (rel, file) => {
    const previous = snapshots.get(rel);
    if (!previous || !sameStat(previous, fs.statSync(file))) throw new Error("扫描后文件列表或内容改变");
    confirmed.add(rel);
  }, { maxFiles: 5000, assertActive, excludedDirectories: PNW_CAD_INDEX_EXCLUDED_DIRECTORIES });
  if (check.errors.length || confirmed.size !== snapshots.size) throw new Error("扫描后文件列表或内容改变，请重新扫描；未写入索引");
  const plan = pnwBuildCadWorkspaceIndex(records);
  assertActive(); assertDatabaseLocation(root, filename);
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  const db = pnwCreateDb(filename);
  try {
    db.exec("PRAGMA foreign_keys=ON");
    db.exec("BEGIN IMMEDIATE");
    try {
      if (db.all("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").length) assertSchema(db);
      else { db.exec(PNW_WORKSPACE_SCHEMA_V13_DDL); db.run("INSERT INTO phoenix_meta(key,value) VALUES ('schema_version','13')"); }
      db.exec("COMMIT");
    } catch (error) { db.exec("ROLLBACK"); throw error; }
    options.onProgress?.({ phase: "committing", scanned: records.length });
    return pnwWriteCadWorkspaceIndexV1(db, plan, {
      scanUuid: randomUUID(), scanRoot: root, scannedAt: new Date().toISOString(), scope: "workspace", complete: true, expectedScanId,
      assertCurrent: () => {
        assertActive(); assertDatabaseLocation(root, filename);
        for (const [rel, stat] of snapshots) if (!sameStat(stat, fs.statSync(safeFcstdPath(root, rel)))) throw new Error("文件快照过期，索引事务已取消");
      },
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    if (detail.startsWith("Duplicate legacy CAD paths")) throw new Error(`旧索引存在重复路径，同一文件可能同时记录为“./路径”和“路径”。本次未提交；可确认「清理旧索引」后重新更新，或保留旧关联另行核对。${detail.includes(": ") ? `冲突：${detail.split(": ").slice(1).join(": ")}` : ""}`);
    throw error;
  } finally { db.close(); }
}

export type CadIndexScanJob = {
  id: string; workspace: string; state: "running" | "done" | "failed" | "cancelled";
  phase: string; scanned: number; message: string;
  result?: Awaited<ReturnType<typeof scanCadWorkspaceIndex>>;
};
const jobs = new Map<string, { data: CadIndexScanJob; controller: AbortController }>();
function assertNoActiveScan(root: string) {
  if ([...jobs.values()].some(job => job.data.workspace === root && job.data.state === "running")) throw new Error("当前工作空间正在索引，请等待或取消");
}
export function previewCadIndexReset(workspace: string) {
  const root = fcstdWorkspace(workspace); assertNoActiveScan(root);
  const filename = phoenixDatabasePath(root); assertDatabaseLocation(root, filename);
  if (!fs.existsSync(filename)) throw new Error("没有可清理的索引数据库");
  const db = pnwCreateDb(filename);
  try { db.exec("PRAGMA query_only=ON"); return pnwPreviewCadIndexResetV1(db); }
  finally { db.close(); }
}
export function resetCadIndex(workspace: string, expected: PnwCadIndexResetPreviewV1, confirmRemoveFileLinks: boolean, assertActive: () => void) {
  const root = fcstdWorkspace(workspace); assertActive(); assertNoActiveScan(root);
  const filename = phoenixDatabasePath(root); assertDatabaseLocation(root, filename);
  if (!fs.existsSync(filename)) throw new Error("索引数据库不存在");
  const backup = `${filename}.before-index-reset-${Date.now()}-${randomUUID().slice(0, 8)}.bak`;
  const db = pnwCreateDb(filename);
  try {
    db.exec("PRAGMA foreign_keys=ON");
    const result = pnwResetCadWorkspaceIndexV1(db, { expected, confirmRemoveFileLinks,
      scanUuid: randomUUID(), scannedAt: new Date().toISOString(), scanRoot: root,
      beforeReset() {
        assertActive(); assertDatabaseLocation(root, filename);
        // A raw main-file copy is recoverable only with rollback journaling, before any writes.
        const mode = db.get<{ journal_mode: string }>("PRAGMA journal_mode")?.journal_mode;
        if (!["delete", "truncate", "persist"].includes(mode || "")) throw new Error("数据库日志模式不支持安全备份，未清理索引");
        fs.copyFileSync(filename, backup, fs.constants.COPYFILE_EXCL);
      },
    });
    return { ...result, backup, message: "旧 CAD 索引已清理，可重新更新索引；磁盘文件和零件资料未删除。" };
  } finally { db.close(); }
}
export function startCadIndexScan(workspace: string, assertActive: () => void) {
  const root = fcstdWorkspace(workspace);
  assertNoActiveScan(root);
  while (jobs.size >= 20) {
    const old = [...jobs].find(([, job]) => job.data.state !== "running");
    if (!old) throw new Error("索引任务过多，请等待现有任务结束");
    jobs.delete(old[0]);
  }
  const id = randomUUID();
  const controller = new AbortController();
  const data: CadIndexScanJob = { id, workspace: root, state: "running", phase: "reading", scanned: 0, message: "正在读取 FCStd" };
  jobs.set(id, { data, controller });
  void scanCadWorkspaceIndex(root, { assertActive, signal: controller.signal, onProgress: progress => Object.assign(data, progress) })
    .then(result => { data.result = result; data.state = "done"; data.message = "索引已更新；未修改 CAD 文件"; })
    .catch(error => { data.state = controller.signal.aborted ? "cancelled" : "failed"; data.message = error instanceof Error ? error.message : String(error); });
  return { ...data };
}
export function getCadIndexScan(workspace: string, id: string) {
  const job = jobs.get(id);
  if (!job || job.data.workspace !== fcstdWorkspace(workspace)) throw new Error("索引任务不存在或不属于当前工作空间");
  return { ...job.data };
}
export function cancelCadIndexScan(workspace: string, id: string) {
  getCadIndexScan(workspace, id);
  const job = jobs.get(id)!;
  if (job.data.state === "running") job.controller.abort(new Error("索引已取消；未完成事务保持原索引"));
  return { ok: true };
}
