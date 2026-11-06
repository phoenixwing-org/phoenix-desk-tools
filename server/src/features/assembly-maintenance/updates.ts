import fs from "node:fs";
import path from "node:path";
import { randomUUID, createHash } from "node:crypto";
import type { AssemblyUpdateJob, AssemblyUpdatePhase, AssemblyUpdatePreview, AssemblyUpdateReconciliation } from "../../../../shared/assembly-maintenance.js";
export type { AssemblyUpdateReconciliation } from "../../../../shared/assembly-maintenance.js";
import { fcstdFingerprint, fcstdWorkspace, safeFcstdPath } from "../../lib/fcstdBatchFiles.js";
import { isFcstdObjectName } from "../../lib/fcstdLinkIdentity.js";
import { captureSavedAssemblyBaseline, verifySavedAssemblyBaseline, type SavedAssemblyBaseline } from "./baseline.js";
import { publishVerifiedAssembly, type VerifiedPublication } from "./publication.js";

export interface AssemblyNativePreviewInput {
  mirrorRoot: string;
  baseline: SavedAssemblyBaseline;
  selectedObjects: string[];
  signal: AbortSignal;
  phase: (phase: "native_update" | "native_reopen") => void;
}
export interface AssemblyNativePreviewResult {
  preview: AssemblyUpdatePreview;
  stagedFile: string;
  nativeProof: VerifiedPublication["nativeProof"];
}
/** Native is a host-composed, reviewed port. No request can supply scripts,
 * proofs, source hashes, stage paths or an engine executable. */
export interface AssemblyUpdatePorts {
  native: (input: AssemblyNativePreviewInput) => Promise<AssemblyNativePreviewResult>;
  refresh?: (root: string, rel: string) => Promise<string[]>;
  now?: () => number;
}
type InternalJob = { root: string; directory: string; public: AssemblyUpdateJob; controller: AbortController;
  completion?: Promise<void>; baseline?: SavedAssemblyBaseline; verified?: AssemblyNativePreviewResult;
  stagedSha256?: string; digest?: string; consumed: boolean; preparationRunning: boolean };
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const lifetime = 10 * 60_000;
const MAX_RETAINED_JOBS = 128, MAX_RECORD_BYTES = 2 * 1024 * 1024, MAX_FILE_BYTES = 64 * 1024 * 1024;
const SHA = /^[a-f0-9]{64}$/;
const clone = <T>(value: T): T => structuredClone(value);
const relative = (root: string, file: string) => path.relative(root, file).replace(/\\/g, "/");
function safeRoot(value: string) {
  try { return fcstdWorkspace(value); }
  catch { throw new Error("工作空间不可读，请重新打开工作空间"); }
}
function publicError(code: string, message: string) { return Object.assign(new Error(message), { code }); }
function fixedFailure(job: InternalJob, code: string, message: string) {
  job.consumed = true; job.public.can_publish = false; job.public.phase = "completed";
  job.public.status = "needs_reconcile"; job.public.error = { code, message };
}
function readableFile(filename: string, maximum: number) {
  const before = fs.lstatSync(filename);
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || before.size > maximum) throw new Error("记录或文件不安全");
  const fd = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  const same = (a: fs.Stats, b: fs.Stats) => a.ino === b.ino && a.dev === b.dev && a.size === b.size
    && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs && a.nlink === b.nlink;
  try {
    if (!same(before, fs.fstatSync(fd))) throw new Error("记录或文件已变化");
    const bytes = Buffer.alloc(before.size + 1); let length = 0;
    while (length < bytes.length) {
      const count = fs.readSync(fd, bytes, length, Math.min(64 * 1024, bytes.length - length), length);
      if (!count) break; length += count;
    }
    if (length !== before.size || !same(before, fs.fstatSync(fd)) || !same(before, fs.lstatSync(filename))) throw new Error("记录或文件已变化");
    return bytes.subarray(0, length);
  } finally { fs.closeSync(fd); }
}
const hash = (file: string) => fcstdFingerprint(readableFile(file, MAX_FILE_BYTES));
function safeRel(value: unknown): value is string {
  return typeof value === "string" && !!value && value.length <= 4096 && !/[\x00-\x1f\\:]/.test(value)
    && !path.posix.isAbsolute(value) && value.split("/").every(part => part && part !== "." && part !== "..") && /\.fcstd$/i.test(value);
}
function warning(value: unknown): string {
  return typeof value === "string" && value.length <= 512 && !/[\x00-\x1f]/.test(value)
    && !/(?:^|[\s:'"(])(?:\/[A-Za-z]|[A-Za-z]:[\\/])/.test(value) ? value : "派生状态刷新返回需人工核对的信息；请检查本地运行记录";
}
function safeJobDirectory(root: string, id: string, create: boolean): string {
  if (!UUID.test(id)) throw new Error("更新记录标识无效");
  let current = root;
  for (const segment of [".phoenix", "assembly-maintenance", id]) {
    current = path.join(current, segment);
    if (create && !fs.existsSync(current)) fs.mkdirSync(current, { mode: 0o700 });
    const stat = fs.lstatSync(current);
    if (!stat.isDirectory() || stat.isSymbolicLink() || fs.realpathSync(current) !== current) throw new Error("更新记录目录不安全");
  }
  if ((fs.statSync(current).mode & 0o077) !== 0) throw new Error("更新记录目录必须为私有目录");
  return current;
}
function persist(job: InternalJob) {
  safeJobDirectory(job.root, job.public.id, false);
  const file = path.join(job.directory, "operation.json"), temporary = path.join(job.directory, randomUUID() + ".tmp");
  const bytes = JSON.stringify({ version: 1, public: job.public, plan_digest: job.digest ?? null, staged_sha256: job.stagedSha256 ?? null });
  const fd = fs.openSync(temporary, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY | fs.constants.O_NOFOLLOW, 0o600);
  try { if (Buffer.byteLength(bytes) > MAX_RECORD_BYTES) throw new Error("更新记录超过安全上限"); fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); }
  finally { fs.closeSync(fd); }
  fs.renameSync(temporary, file);
  const dir = fs.openSync(job.directory, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
  try { fs.fsyncSync(dir); } finally { fs.closeSync(dir); }
}
function errorCode(error: unknown): string {
  const code = error && typeof error === "object" && "code" in error ? error.code : "preview_failed";
  return typeof code === "string" && /^[a-z][a-z0-9_]{0,63}$/.test(code) ? code : "preview_failed";
}
function diagnosticReason(error: unknown): string {
  const value = error && typeof error === "object" && "reason" in error ? error.reason : null;
  const candidate = typeof value === "string" ? value.split(":", 1)[0] : "";
  return /^[a-z][a-z0-9_]{0,79}$/.test(candidate) ? candidate : errorCode(error);
}
function requireProof(proof: VerifiedPublication["nativeProof"]) {
  const values = [proof?.update, proof?.reopen];
  if (values.some(item => !item || !UUID.test(item.nonce) || !Number.isSafeInteger(item.pid) || Number(item.pid) < 1
    || item.actual_close_observed !== true || item.exit_code !== 0 || item.signal !== null)
    || proof.update.nonce === proof.reopen.nonce || proof.update.pid === proof.reopen.pid) throw new Error("缺少独立原生更新与重开回执");
}
function requirePreview(value: AssemblyUpdatePreview) {
  if (!value || ![value.added, value.removed].every(Array.isArray) || value.added.length + value.removed.length > 10_000
    || !value.engine_version || !Number.isSafeInteger(value.preserved_joint_count) || value.preserved_joint_count < 0
    || !Number.isSafeInteger(value.preserved_instance_count) || value.preserved_instance_count < 0
    || [value.rigid_unchanged, value.placements_unchanged, value.joint_frames_unchanged,
      value.dependency_bytes_unchanged, value.independently_reopened].some(flag => flag !== true)) throw new Error("更新预览缺少完整安全证据");
  if (typeof value.engine_version !== "string" || value.engine_version.length > 512 || /[\x00-\x1f]/.test(value.engine_version)
    || [...value.added, ...value.removed].some(row => !row || !isFcstdObjectName(row.object_name)
      || !isFcstdObjectName(row.parent_object) || typeof row.label !== "string" || row.label.length > 1024
      || typeof row.type_id !== "string" || row.type_id.length > 128)) throw new Error("更新预览结构无效");
}

type JsonObject = Record<string, unknown>;
function object(value: unknown): value is JsonObject { return !!value && typeof value === "object" && !Array.isArray(value); }
function jsonRecord(directory: string, filename: string, maximum = MAX_RECORD_BYTES): JsonObject | null {
  let bytes: Buffer;
  try { bytes = readableFile(path.join(directory, filename), maximum); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
  const value: unknown = JSON.parse(bytes.toString("utf8"));
  if (!object(value)) throw new Error("记录结构无效");
  return value;
}
function safeStorageDirectory(root: string) {
  let current = root;
  for (const segment of [".phoenix", "assembly-maintenance"]) {
    current = path.join(current, segment);
    const stat = fs.lstatSync(current);
    if (!stat.isDirectory() || stat.isSymbolicLink() || fs.realpathSync(current) !== current) throw new Error("记录目录不安全");
  }
  return current;
}
function observedHash(root: string, rel: string): { state: "missing" | "unknown"; sha256?: never; bytes?: never } | { state: "present"; sha256: string; bytes: number } {
  try {
    const bytes = readableFile(safeFcstdPath(root, rel), MAX_FILE_BYTES);
    return { state: "present", sha256: fcstdFingerprint(bytes), bytes: bytes.length };
  } catch (error) {
    return { state: ["ENOENT", "ENOTDIR"].includes((error as NodeJS.ErrnoException).code ?? "") ? "missing" : "unknown" };
  }
}
/** Reads only fixed, host-derived filenames. Disk records are evidence to
 * observe, never restored capability, executable input or a repair command. */
function reconcileRecord(root: string, id: string, inspectBytes: boolean): AssemblyUpdateReconciliation {
  if (!UUID.test(id)) throw new Error("更新记录标识无效");
  const result: AssemblyUpdateReconciliation = {
    protocol_version: 1, id, read_only: true, can_publish: false, operation: null,
    observed_publication: "unknown", receipt_state: "unknown", source_state: "unknown", target_state: "unknown",
    backup_state: "unknown", dependencies_state: "unknown", requires_manual_review: true,
    message: "仅观察当前历史与磁盘状态；不恢复写入权限，缺失记录不证明从未写入",
  };
  try {
    const directory = safeJobDirectory(root, id, false), operation = jsonRecord(directory, "operation.json");
    if (!operation || operation.version !== 1 || !object(operation.public)) return result;
    const saved = operation.public;
    const statuses: string[] = ["preparing", "ready", "unchanged", "blocked", "failed", "cancelled", "published", "needs_reconcile"];
    const phases: string[] = ["capturing", "mirroring", "native_update", "native_reopen", "ready", "publishing", "completed"];
    if (saved.protocol_version !== 1 || saved.id !== id || !safeRel(saved.file_path) || saved.file_path.split("/").includes(".phoenix")
      || typeof saved.status !== "string" || !statuses.includes(saved.status) || typeof saved.phase !== "string" || !phases.includes(saved.phase)
      || typeof saved.created_at !== "string" || !Number.isFinite(Date.parse(saved.created_at))
      || (saved.output_rel !== null && !safeRel(saved.output_rel))
      || (saved.suggested_copy_rel !== null && (!safeRel(saved.suggested_copy_rel)
        || path.posix.dirname(saved.suggested_copy_rel) !== path.posix.dirname(saved.file_path)))) return result;
    result.operation = { file_path: saved.file_path, status: saved.status as AssemblyUpdateJob["status"],
      phase: saved.phase as AssemblyUpdatePhase, created_at: new Date(Date.parse(saved.created_at)).toISOString(), output_rel: saved.output_rel as string | null };
    const sourceSha = typeof saved.source_sha256 === "string" && SHA.test(saved.source_sha256) ? saved.source_sha256 : null;
    const stageSha = typeof operation.staged_sha256 === "string" && SHA.test(operation.staged_sha256) ? operation.staged_sha256 : null;
    const planDigest = typeof operation.plan_digest === "string" && SHA.test(operation.plan_digest) ? operation.plan_digest : null;
    if (inspectBytes && sourceSha) {
      const source = observedHash(root, saved.file_path);
      result.source_state = source.state === "present" ? source.sha256 === sourceSha ? "original" : source.sha256 === stageSha ? "updated" : "other" : source.state;
    }
    const publication = path.join(directory, "publication");
    try {
      const stat = fs.lstatSync(publication);
      if (!stat.isDirectory() || stat.isSymbolicLink() || fs.realpathSync(publication) !== publication || (stat.mode & 0o077) !== 0) return result;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") return result;
      result.receipt_state = "absent";
      if (inspectBytes && result.source_state === "original" && !["published", "needs_reconcile"].includes(saved.status)) {
        result.observed_publication = "not_published_observed";
        result.message = "未发现发布阶段记录且源字节与冻结值相符；仅为当前观察，不恢复预览权限";
      }
      return result;
    }
    const intent = jsonRecord(publication, "publish_intent.json", 512 * 1024);
    const claimed = jsonRecord(publication, "source_claimed.json", 512 * 1024);
    const published = jsonRecord(publication, "published.json", 512 * 1024);
    const failure = jsonRecord(publication, "failure.json", 512 * 1024);
    if (!intent || !sourceSha || !stageSha || !planDigest || intent.version !== 1 || intent.stage !== "publish_intent"
      || intent.sourceRel !== saved.file_path || intent.sourceSha256 !== sourceSha || intent.stagedSha256 !== stageSha || intent.planDigest !== planDigest
      || !["verified_copy", "replace_source"].includes(String(intent.mode)) || !safeRel(intent.targetRel)
      || intent.targetRel !== (intent.mode === "replace_source" ? saved.file_path : saved.suggested_copy_rel)
      || path.posix.dirname(intent.targetRel) !== path.posix.dirname(saved.file_path)) return result;
    const bound = (row: JsonObject | null, stage: string) => !row || row.version === 1 && row.stage === stage
      && ["mode", "sourceRel", "targetRel", "sourceSha256", "stagedSha256", "planDigest"].every(key => row[key] === intent[key])
      && JSON.stringify(row.nativeProof) === JSON.stringify(intent.nativeProof)
      && JSON.stringify(row.dependencyFingerprints) === JSON.stringify(intent.dependencyFingerprints);
    if (!bound(claimed, "source_claimed") || !bound(published, "published") || !bound(failure, "failure")) return result;
    try { requireProof(intent.nativeProof as VerifiedPublication["nativeProof"]); } catch { return result; }
    if (intent.mode === "replace_source" && published && !claimed) return result;
    result.receipt_state = failure ? "failure" : published ? "published" : claimed ? "source_claimed" : "intent";
    if (!inspectBytes) return result; // Listing is metadata-only; do not hash 50 CAD closures.
    const target = observedHash(root, intent.targetRel);
    result.target_state = target.state === "present" ? target.sha256 === stageSha ? "verified" : "other" : target.state;
    const backup = observedHash(root, relative(root, path.join(publication, "before.FCStd")));
    result.backup_state = backup.state === "present" ? backup.sha256 === sourceSha ? "verified" : "other" : backup.state;
    if (!Array.isArray(intent.dependencyFingerprints) || intent.dependencyFingerprints.length > 99) return result;
    const seen = new Set([saved.file_path]); let total = 0;
    result.dependencies_state = "unchanged";
    for (const item of intent.dependencyFingerprints) {
      if (!object(item) || !safeRel(item.rel) || typeof item.sha256 !== "string" || !SHA.test(item.sha256) || seen.has(item.rel) || item.rel === intent.targetRel) {
        result.dependencies_state = "unknown"; return result;
      }
      seen.add(item.rel);
      const observed = observedHash(root, item.rel);
      if (observed.state !== "present") { result.dependencies_state = "unknown"; return result; }
      total += observed.bytes;
      if (total > MAX_FILE_BYTES) { result.dependencies_state = "unknown"; return result; }
      if (observed.sha256 !== item.sha256) result.dependencies_state = "changed";
    }
    if (published && !failure && result.target_state === "verified" && result.backup_state === "verified"
      && result.dependencies_state === "unchanged" && result.source_state === (intent.mode === "replace_source" ? "updated" : "original")) {
      result.observed_publication = "published_observed"; result.requires_manual_review = false;
      result.message = "发布阶段记录与当前输出、备份和依赖字节相符；仅只读核对，不恢复写入权限";
    }
    return result;
  } catch { return result; } // Never forward raw fs/JSON errors or private paths.
}

export function createAssemblyUpdateService(ports: AssemblyUpdatePorts) {
  const jobs = new Map<string, InternalJob>(), now = ports.now ?? Date.now;
  function prune() {
    for (const [id, job] of jobs) {
      if (jobs.size < MAX_RETAINED_JOBS) break;
      const active = job.preparationRunning || job.public.phase === "publishing"
        || (job.public.status === "ready" && !job.consumed && !!job.public.expires_at && Date.parse(job.public.expires_at) > now());
      if (!active) jobs.delete(id); // Durable history remains read-only; never rehydrate authority.
    }
  }
  function read(root: string, id: string): InternalJob {
    const job = jobs.get(id);
    if (!job || job.root !== root) throw new Error("此更新预览不在当前服务会话中；仅可核对历史，不恢复写入权限");
    return job;
  }
  function snapshot(job: InternalJob): AssemblyUpdateJob {
    const result = clone(job.public);
    result.can_publish = result.status === "ready" && !job.consumed && !!result.expires_at && Date.parse(result.expires_at) > now();
    return result;
  }
  function phase(job: InternalJob, value: AssemblyUpdatePhase) {
    if (job.controller.signal.aborted) throw publicError("cancelled", "预览已取消");
    job.public.phase = value; persist(job);
  }
  async function prepare(job: InternalJob) {
    try {
      const baseline = await captureSavedAssemblyBaseline(job.root, job.public.file_path, job.controller.signal, { selectedHostObjects: job.public.selected_objects });
      if (job.controller.signal.aborted) throw new Error("cancelled");
      const host = baseline.files.find(file => file.rel === baseline.hostRel)!;
      if (job.public.selected_objects.some(name => !host.objects.some(object => object.name === name && object.typeId === "Assembly::AssemblyLink"))) {
        throw new Error("所选对象不再是明确的子装配实例");
      }
      job.baseline = baseline; job.public.file_path = baseline.hostRel; job.public.source_sha256 = host.sha256;
      job.digest = createHash("sha256").update(JSON.stringify({ baseline, selected: job.public.selected_objects })).digest("hex");
      const frozen = path.join(job.directory, "opening-before.json");
      fs.writeFileSync(frozen, JSON.stringify(baseline), { flag: "wx", mode: 0o600 });
      phase(job, "mirroring");
      const mirrorRoot = path.join(job.directory, "mirror"); fs.mkdirSync(mirrorRoot, { mode: 0o700 });
      await verifySavedAssemblyBaseline(baseline, job.controller.signal);
      for (const file of baseline.files) {
        if (job.controller.signal.aborted) throw new Error("cancelled");
        const source = safeFcstdPath(job.root, file.rel), target = path.join(mirrorRoot, file.rel);
        fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
        fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL); fs.chmodSync(target, 0o600);
        if (hash(target) !== file.sha256) throw new Error("镜像与冻结源文件不一致");
      }
      await verifySavedAssemblyBaseline(baseline, job.controller.signal);
      const verified = clone(await ports.native({ mirrorRoot, baseline: clone(baseline), selectedObjects: [...job.public.selected_objects], signal: job.controller.signal,
        phase: value => phase(job, value) }));
      if (job.controller.signal.aborted) throw new Error("cancelled");
      requireProof(verified.nativeProof); requirePreview(verified.preview);
      const staged = safeFcstdPath(mirrorRoot, baseline.hostRel);
      if (verified.stagedFile !== staged || !fs.statSync(staged).isFile()) throw new Error("原生结果不属于本次明确宿主");
      for (const file of baseline.files) if (file.rel !== baseline.hostRel && hash(safeFcstdPath(mirrorRoot, file.rel)) !== file.sha256) {
        throw new Error("原生更新改写了依赖文件；原件保持");
      }
      await verifySavedAssemblyBaseline(baseline, job.controller.signal);
      job.verified = clone(verified); job.stagedSha256 = hash(staged); job.public.preview = clone(verified.preview);
      if ((verified.preview.added.length || verified.preview.removed.length) && job.stagedSha256 === host.sha256) throw new Error("原生差异与暂存文件不一致");
      const filename = path.posix.basename(baseline.hostRel).replace(/\.fcstd$/i, `.Refreshed.${job.public.id.slice(0, 8)}.FCStd`);
      job.public.suggested_copy_rel = path.posix.join(path.posix.dirname(baseline.hostRel), filename);
      job.public.status = verified.preview.added.length || verified.preview.removed.length ? "ready" : "unchanged";
      job.public.phase = "ready"; job.public.expires_at = new Date(now() + lifetime).toISOString();
      job.public.can_publish = job.public.status === "ready"; persist(job);
    } catch (error) {
      const cancelled = job.controller.signal.aborted;
      job.public.status = cancelled ? "cancelled" : errorCode(error) === "manual_required" ? "blocked" : "failed";
      job.public.phase = "completed"; job.public.can_publish = false; job.consumed = true;
      job.public.error = { code: cancelled ? "cancelled" : errorCode(error), message: cancelled ? "已停止未完成的预览，未发布原件" : "装配更新未通过安全核验，未发布原件；请查看问题详情" };
      if (!cancelled) job.public.warnings.push(`安全核验未通过（${diagnosticReason(error)}）；未发布原件，请核对该项后重新生成预览`);
      try { persist(job); } catch { fixedFailure(job, "receipt_failed", "更新记录写入失败，原件未发布；请核对本地记录"); }
    } finally {
      job.preparationRunning = false;
    }
  }
  return {
    start(workspacePath: string, filePath: string, selectedObjects: string[]): AssemblyUpdateJob {
      const root = safeRoot(workspacePath);
      if (typeof filePath !== "string" || !filePath || filePath.split(/[\\/]/).includes(".phoenix")
        || !Array.isArray(selectedObjects) || !selectedObjects.length || selectedObjects.length > 50
        || selectedObjects.some(name => typeof name !== "string" || !isFcstdObjectName(name))
        || new Set(selectedObjects).size !== selectedObjects.length) throw new Error("请明确选择当前总成内的子装配实例");
      let file: string;
      try { file = safeFcstdPath(root, filePath); if (!/\.fcstd$/i.test(file) || !fs.statSync(file).isFile()) throw new Error(); }
      catch { throw new Error("请选择工作空间内可读、非符号链接的 FCStd 总成"); }
      prune();
      if ([...jobs.values()].filter(job => job.preparationRunning || job.public.phase === "publishing"
        || job.public.status === "ready" && !job.consumed && !!job.public.expires_at && Date.parse(job.public.expires_at) > now()).length >= 20) {
        throw new Error("等待处理的更新预览过多，请先完成或取消已有预览");
      }
      if (jobs.size >= MAX_RETAINED_JOBS) throw new Error("更新会话已达到安全上限，请等待当前预览完成");
      const id = randomUUID(); let directory: string;
      try { directory = safeJobDirectory(root, id, true); }
      catch { throw new Error("无法建立私有更新记录目录，请检查工作空间权限"); }
      const job: InternalJob = { root, directory, controller: new AbortController(), consumed: false, preparationRunning: true, public: {
        protocol_version: 1, id, file_path: relative(root, file), selected_objects: [...selectedObjects].sort(), status: "preparing", phase: "capturing",
        created_at: new Date(now()).toISOString(), expires_at: null, source_sha256: null, preview: null, can_publish: false,
        suggested_copy_rel: null, output_rel: null, backup_rel: null, error: null,
        warnings: ["预览在私有完整镜像中运行 FreeCAD，不保存真实依赖；发布须另行确认。", "保留原有显示属性和内嵌缩略图，本次不重新渲染；发布后请按需重新生成缩略图。"],
      } };
      try { persist(job); } catch { throw new Error("无法持久记录更新任务，未启动原生预览"); }
      jobs.set(id, job); job.completion = prepare(job); return snapshot(job);
    },
    reconcile(workspacePath: string, id: string) { return reconcileRecord(safeRoot(workspacePath), id, true); },
    history(workspacePath: string, limit = 50): { protocol_version: 1; records: AssemblyUpdateReconciliation[]; truncated: boolean } {
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50) throw new Error("历史记录数量必须为 1 至 50");
      const root = safeRoot(workspacePath), records: AssemblyUpdateReconciliation[] = [];
      let directory: string;
      try { directory = safeStorageDirectory(root); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return { protocol_version: 1, records, truncated: false };
        throw new Error("历史目录不可安全读取；未恢复任何写入权限");
      }
      let handle: fs.Dir | undefined, truncated = false;
      try {
        handle = fs.opendirSync(directory); let inspected = 0;
        while (inspected < 256 && records.length < limit) {
          const entry = handle.readSync(); if (!entry) break; inspected++;
          if (!entry.isDirectory() || !UUID.test(entry.name)) continue;
          records.push(reconcileRecord(root, entry.name, false));
        }
        if (inspected === 256 || records.length === limit) truncated = !!handle.readSync();
      } catch { throw new Error("历史目录读取未完成；未恢复任何写入权限"); }
      finally { try { handle?.closeSync(); } catch { /* Read-only close failure grants no authority. */ } }
      records.sort((a, b) => (b.operation?.created_at ?? "").localeCompare(a.operation?.created_at ?? ""));
      return { protocol_version: 1, records, truncated };
    },
    get(workspacePath: string, id: string) { return snapshot(read(safeRoot(workspacePath), id)); },
    async wait(workspacePath: string, id: string) { const job = read(safeRoot(workspacePath), id); await job.completion; return snapshot(job); },
    cancel(workspacePath: string, id: string) {
      const job = read(safeRoot(workspacePath), id);
      // A consumed publication, including an uncertain one, cannot be changed
      // into "cancelled/no-write" while its refresh or receipt is outstanding.
      if (job.consumed || job.public.phase === "publishing") return snapshot(job);
      if (job.public.status === "preparing" || job.public.status === "ready") {
        job.consumed = true; job.public.can_publish = false; job.controller.abort();
        if (job.public.status === "ready") { job.public.status = "cancelled"; job.public.phase = "completed"; }
        // A preparing Native stage remains preparing until its owned close is
        // observed by prepare(). Cancellation is not a fabricated close proof.
        job.public.error = { code: "cancelled", message: "已请求停止预览；等待自有进程结束，不发布原件" };
        try { persist(job); } catch { fixedFailure(job, "receipt_failed", "取消请求已生效，但更新记录未确认；请核对本地记录"); }
      }
      return snapshot(job);
    },
    async publish(workspacePath: string, id: string, mode: "verified_copy" | "replace_source", confirmation: { closed: boolean; notReopened: boolean }) {
      const job = read(safeRoot(workspacePath), id), publicJob = snapshot(job);
      if (job.consumed || job.public.status === "published" || job.public.status === "needs_reconcile") return publicJob;
      if (!publicJob.can_publish || !job.baseline || !job.verified || !job.stagedSha256 || !job.digest) throw new Error("更新预览已过期或未完成；请重新生成预览");
      if (mode !== "verified_copy" && mode !== "replace_source") throw new Error("发布模式无效");
      if (!confirmation || typeof confirmation.closed !== "boolean" || typeof confirmation.notReopened !== "boolean") throw new Error("发布确认参数无效");
      try { await verifySavedAssemblyBaseline(job.baseline, job.controller.signal); }
      catch (error) {
        if (job.consumed) return snapshot(job);
        job.consumed = true; job.public.can_publish = false; job.public.status = "blocked"; job.public.phase = "completed";
        job.public.error = { code: errorCode(error), message: "源文件或依赖已变化，预览权限已失效；请重新生成预览" };
        try { persist(job); } catch { fixedFailure(job, "receipt_failed", "预览核对失败且记录未确认；请核对本地记录"); }
        throw publicError(errorCode(error), "源文件或依赖核对失败，预览权限已失效；请重新生成预览");
      }
      if (job.consumed) return snapshot(job);
      if (!snapshot(job).can_publish) throw new Error("更新预览已过期；请重新生成预览");
      // A publish attempt is consumed before the first publication IO. An
      // uncertain response can only be reconciled, never replayed as a new write.
      job.consumed = true; job.public.can_publish = false;
      try { phase(job, "publishing"); }
      catch {
        fixedFailure(job, "receipt_failed", "发布意图无法持久确认，本次未调用文件发布；请核对记录，不要重复执行");
        try { persist(job); } catch { /* Remain consumed, never restore authority. */ }
        return snapshot(job);
      }
      let publication: ReturnType<typeof publishVerifiedAssembly>;
      try { publication = publishVerifiedAssembly({ root: job.root, sourceRel: job.baseline.hostRel, stagedFile: job.verified.stagedFile,
        sourceSha256: job.public.source_sha256!, stagedSha256: job.stagedSha256, jobDirectory: job.directory,
        dependencyFingerprints: job.baseline.files.filter(file => file.rel !== job.baseline!.hostRel).map(file => ({ rel: file.rel, sha256: file.sha256 })), planDigest: job.digest,
        mode, targetRel: mode === "replace_source" ? job.baseline.hostRel : job.public.suggested_copy_rel!,
        nativeProof: job.verified.nativeProof, confirmedClosed: confirmation.closed, confirmedNotReopened: confirmation.notReopened }); }
      catch {
        job.public.status = "needs_reconcile"; job.public.phase = "completed";
        job.public.error = { code: "publication_unknown", message: "发布调用未取得可确认回执；请核对本地记录，不要重新执行" };
        try { persist(job); } catch { /* Existing durable intent remains the reconciliation source. */ }
        return snapshot(job);
      }
      job.public.phase = "completed";
      if (publication.status === "published") {
        job.public.status = "published"; job.public.output_rel = publication.targetRel;
        job.public.backup_rel = relative(job.root, publication.evidenceDirectory);
        try { const warnings = await ports.refresh?.(job.root, publication.targetRel); job.public.warnings.push(...(warnings ?? []).slice(0, 20).map(warning)); }
        catch { job.public.warnings.push("文件已发布，派生索引/缓存刷新失败；请手动更新索引，不要重复写入"); }
      } else {
        job.public.status = publication.status === "unknown" ? "needs_reconcile" : "blocked";
        job.public.error = { code: publication.code, message: publication.requiresManualReview ? "发布结果需要核对，保留备份和回执；不会自动重试" : "本次未完成发布；请核对占用、源文件或目标冲突后重新预览" };
      }
      try { persist(job); } catch { fixedFailure(job, "receipt_failed", "发布可能已完成，但最终记录未确认；请核对输出和备份，不要重复运行"); }
      return snapshot(job);
    },
  };
}
export type AssemblyUpdateService = ReturnType<typeof createAssemblyUpdateService>;
