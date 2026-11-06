import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createHash, randomUUID } from "node:crypto";
import { fcstdWorkspace, safeFcstdPath, readFcstdBatchArchive, fcstdFingerprint } from "../../lib/fcstdBatchFiles.js";
import { readThumbnailPng } from "../../lib/fcstdThumbnail.js";
import { isStandaloneDrawing } from "../../lib/fcstdDrawing.js";
import { fcstdNativeXlinkFiles } from "../../lib/fcstdNativeXlinkFiles.js";
import { buildFreecadChildEnvironment, redactSensitiveText } from "../../lib/freecadProcessSecurity.js";
import { guiExecutable } from "../drawing-research/jobs.js";
import { cacheRenderedThumbnail } from "../part-gallery/service.js";
import { relativeFile } from "../part-gallery/storage.js";
import { thumbnailRunner } from "./runner.js";
import { writeFcstdThumbnail } from "./archive.js";
import { acquireDrawingExecution, type DrawingExecutionLease } from "../drawing-research/executionGate.js";

export type ThumbnailOptions = { color: "original" | "neutral"; axonometric: boolean; fit: boolean };
export function thumbnailTimeoutStage(report: unknown): string {
  const value = report as { status?: string; stage?: string } | null;
  if (value?.status === "completed") return "退出渲染进程";
  const stages: Record<string, string> = { starting: "启动图形视图", opening: "打开模型", preparing: "设置配色与视角", rendering: "渲染图片", fitting: "调整图片边距", closing: "关闭只读模型" };
  const key = value?.stage || "";
  return Object.hasOwn(stages, key) ? stages[key] : "启动 FreeCAD 图形程序";
}
export function thumbnailOptions(value: unknown): ThumbnailOptions {
  const v = value as Partial<ThumbnailOptions> | null;
  if (!v || !["original", "neutral"].includes(v.color!) || typeof v.axonometric !== "boolean" || typeof v.fit !== "boolean") throw new Error("无效的缩略图选项");
  return { color: v.color!, axonometric: v.axonometric, fit: v.fit };
}

export class ThumbnailSourceError extends Error {
  constructor(readonly code: "thumbnail_source_missing" | "thumbnail_dependency_missing", readonly rel: string) {
    super(code === "thumbnail_source_missing"
      ? `[${code}] 源模型不存在：${rel}。文件可能已移动或删除，请刷新 CAD 索引和图册后重试；未写入缩略图。`
      : `[${code}] 引用文件不存在：${rel}。请先修复装配链接，再重新生成缩略图；未写入缩略图。`);
    this.name = "ThumbnailSourceError";
  }
}
/** Classify only an absent source/dependency, never permissions, aliases or bad archives. */
function readThumbnailSource<T>(root: string, rel: string, dependency: boolean, read: (file: string) => T): T {
  const key = relativeFile(rel);
  if (!/\.fcstd$/i.test(key)) throw new Error("只支持 FCStd 模型");
  try {
    return read(safeFcstdPath(root, key));
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      throw new ThumbnailSourceError(dependency ? "thumbnail_dependency_missing" : "thumbnail_source_missing", key);
    }
    throw error;
  }
}

/** Guard the source and linked FCStd files; no unrelated directory scan. */
export function thumbnailSources(root: string, rel: string) {
  const snapshots = new Map<string, string>(), queue = [relativeFile(rel)];
  for (let i = 0; i < queue.length; i++) {
    const { file, archive } = readThumbnailSource(root, queue[i], i !== 0, file => ({ file, archive: readFcstdBatchArchive(file) }));
    if (snapshots.has(file)) continue;
    if (i === 0 && isStandaloneDrawing(rel, archive.xml)) throw new Error("图纸请使用源模型生成缩略图");
    snapshots.set(file, fcstdFingerprint(archive.bytes));
    for (const dependency of fcstdNativeXlinkFiles(archive.xml)) {
      const normalized = dependency.replace(/\\/g, "/");
      if (!/\.fcstd$/i.test(normalized) || /^(?:\/|[A-Za-z][\w+.-]*:)/.test(normalized)) throw new Error("模型依赖不是工作空间内的 FCStd");
      const target = path.resolve(path.dirname(file), normalized);
      const key = relativeFile(path.relative(root, target).replace(/\\/g, "/"));
      if (!queue.includes(key)) queue.push(key);
      if (queue.length > 500) throw new Error("引用超过 500 个文件，请选择单个零件测试");
    }
  }
  return snapshots;
}

const MAX_NATIVE_REPORT = 16 * 1024, MAX_PNG = 4 * 1024 * 1024, MAX_NATIVE_OUTPUT = 256 * 1024;
const nativeStamp = (stat: fs.BigIntStats) => [stat.dev,stat.ino,stat.size,stat.mtimeNs,stat.ctimeNs].join(":");
function nativeBytes(filename: string, maximum: number): Buffer {
  const before = fs.lstatSync(filename, {bigint: true});
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1n || before.size > BigInt(maximum)) throw new Error("原生缩略图文件不安全或超过上限");
  const fd = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    if (nativeStamp(fs.fstatSync(fd, {bigint: true})) !== nativeStamp(before)) throw new Error("原生缩略图文件已变化");
    const bytes = Buffer.alloc(Number(before.size) + 1); let offset = 0;
    while (offset < bytes.length) {const count = fs.readSync(fd, bytes, offset, Math.min(65536, bytes.length - offset), offset); if (!count) break; offset += count;}
    if (BigInt(offset) !== before.size || nativeStamp(fs.fstatSync(fd, {bigint: true})) !== nativeStamp(before)
      || nativeStamp(fs.lstatSync(filename, {bigint: true})) !== nativeStamp(before)) throw new Error("原生缩略图文件已变化");
    return bytes.subarray(0,offset);
  } finally {fs.closeSync(fd);}
}
function nativeJson(filename: string): Record<string,unknown> {
  try {
    const bytes = nativeBytes(filename, MAX_NATIVE_REPORT);
    if (bytes.includes(0)) throw new Error();
    const value: unknown = JSON.parse(new TextDecoder("utf-8", {fatal: true}).decode(bytes));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value as Record<string,unknown>;
  } catch {throw new Error("原生缩略图报告缺失、损坏或超过上限");}
}
function ownerMarker(folder: string, pid: number, nonce: string) {
  const temporary = path.join(folder, ".owner-" + randomUUID() + ".tmp"), target = path.join(folder, "owner.json");
  const data = Buffer.from(JSON.stringify({pid,nonce})); let fd: number | undefined, identity: fs.BigIntStats | undefined;
  try {
    fd = fs.openSync(temporary, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW | fs.constants.O_RDWR, 0o600);
    identity = fs.fstatSync(fd,{bigint:true}); let offset = 0;
    while (offset < data.length) {const count = fs.writeSync(fd,data,offset,data.length-offset); if (count < 1) throw new Error(); offset += count;}
    fs.fsyncSync(fd);
    if (!nativeBytes(temporary,4096).equals(data)) throw new Error();
    fs.linkSync(temporary,target);
    const published = fs.lstatSync(target,{bigint:true});
    if (!published.isFile() || published.isSymbolicLink() || published.dev !== identity.dev || published.ino !== identity.ino) throw new Error();
  } finally {
    if (identity) try {const named=fs.lstatSync(temporary,{bigint:true}); if(named.isFile()&&!named.isSymbolicLink()&&named.dev===identity.dev&&named.ino===identity.ino)fs.unlinkSync(temporary);} catch {/* Retain uncertain evidence. */}
    if (fd !== undefined) try {fs.closeSync(fd);} catch {/* Native close still governs settlement. */}
  }
}
function privateEnvironment(folder: string): NodeJS.ProcessEnv {
  const directories = Object.fromEntries(["home","data","temp","xdg-config","xdg-cache","xdg-data","xdg-runtime"].map(name => {
    const directory=path.join(folder,name);fs.mkdirSync(directory,{mode:0o700});return [name,directory];
  }));
  const env:NodeJS.ProcessEnv = {...buildFreecadChildEnvironment(process.env), FREECAD_USER_HOME:directories.home, FREECAD_USER_DATA:directories.data,
    FREECAD_USER_TEMP:directories.temp, XDG_CONFIG_HOME:directories["xdg-config"], XDG_CACHE_HOME:directories["xdg-cache"],
    XDG_DATA_HOME:directories["xdg-data"], XDG_RUNTIME_DIR:directories["xdg-runtime"], TMPDIR:directories.temp,TMP:directories.temp,TEMP:directories.temp};
  delete env.QT_QPA_PLATFORM; // Owned GUI renderer needs Coin/OpenGL, not a user GUI RPC.
  return env;
}
export async function renderThumbnail(source: string, options: ThumbnailOptions, context: {signal?: AbortSignal} = {}): Promise<Buffer> {
  const lease = acquireDrawingExecution("thumbnail:" + randomUUID());
  try {return await renderThumbnailOwned(source, options, lease, context.signal);}
  finally {lease();}
}
async function renderThumbnailOwned(source: string, options: ThumbnailOptions, lease: DrawingExecutionLease, signal?: AbortSignal): Promise<Buffer> {
  if (signal?.aborted) throw new Error("缩略图渲染已取消，未启动原生程序");
  const executable = guiExecutable();
  const folder = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "desk-thumbnail-render-"))); fs.chmodSync(folder,0o700);
  try {
    const report = path.join(folder, "result.json"), output = path.join(folder, "thumbnail.png");
    const config = path.join(folder, "job.json"), macro = path.join(folder, "render.FCMacro");
    const nonce=randomUUID(),spec=JSON.stringify({source,options,output,report,nonce,owner:path.join(folder,"owner.json")});
    if(Buffer.byteLength(spec)>MAX_NATIVE_REPORT)throw new Error("缩略图任务配置超过安全上限");
    fs.writeFileSync(config,spec,{flag:"wx",mode:0o600});
    fs.writeFileSync(macro, `JOB_PATH = ${JSON.stringify(config)}\n${thumbnailRunner}`,{flag:"wx",mode:0o600});
    const env = privateEnvironment(folder); let ownedPid: number | undefined;
    await new Promise<void>((resolve, reject) => {
      let child: ReturnType<DrawingExecutionLease["spawn"]>;
      try {child=lease.spawn(executable,["-u",path.join(folder,"user.cfg"),"-s",path.join(folder,"system.cfg"),macro],{cwd:folder,env,stdio:["ignore","pipe","pipe"]});}
      catch (error) {reject(error); return;}
      let reason="",closed=false,outputBytes=0,grace:ReturnType<typeof setTimeout>|undefined;
      const stop=(why:string)=>{
        if(closed||reason)return;reason=why;
        if(child.pid){grace=setTimeout(()=>{try{child.kill("SIGKILL");}catch{/* Keep waiting for close. */}},1000);grace.unref();try{child.kill("SIGTERM");}catch{/* Keep waiting for close. */}}
      };
      const aborted=()=>stop("缩略图渲染已取消，已等待自有进程关闭");
      const data=(chunk:Uint8Array)=>{outputBytes=Math.min(MAX_NATIVE_OUTPUT+1,outputBytes+chunk.byteLength);if(outputBytes>MAX_NATIVE_OUTPUT)stop("缩略图进程输出超过安全上限，原缩略图保留");};
      const timer=setTimeout(()=>{
        let progress:Record<string,unknown>={};try{const value=nativeJson(report);if(value.native_pid===ownedPid&&value.native_nonce===nonce)progress=value;}catch{/* Fixed unknown stage. */}
        stop(`生成缩略图超过 2 分钟（${thumbnailTimeoutStage(progress)}），已等待自有渲染进程关闭，原缩略图保留`);
      },120000);timer.unref();
      child.stdout?.on("data",data);child.stderr?.on("data",data);
      child.once("spawn",()=>{
        if(closed||reason||signal?.aborted)return;
        try{if(!Number.isSafeInteger(child.pid)||Number(child.pid)<1)throw new Error();ownedPid=child.pid;lease.assertHealthy();ownerMarker(folder,ownedPid!,nonce);}
        catch{stop("原生缩略图归属记录未确认，未授权图形操作");}
      });
      child.once("error",()=>stop("无法启动或继续自有 FreeCAD 渲染进程，原缩略图保留"));
      child.once("close",(code,exitSignal)=>{closed=true;clearTimeout(timer);if(grace)clearTimeout(grace);signal?.removeEventListener("abort",aborted);
        child.stdout?.removeListener("data",data);child.stderr?.removeListener("data",data);
        if(reason)reject(new Error(reason));else if(code!==0||exitSignal)reject(new Error("FreeCAD 渲染进程未正常退出，原缩略图保留"));else resolve();});
      signal?.addEventListener("abort",aborted,{once:true});if(signal?.aborted)aborted();
    });
    if(signal?.aborted)throw new Error("缩略图渲染已取消，原缩略图保留");
    lease.assertHealthy();const result=nativeJson(report),keys=Object.keys(result).sort().join(",");
    if(!ownedPid||result.version!==1||result.native_pid!==ownedPid||result.native_nonce!==nonce)throw new Error("原生缩略图报告进程归属不匹配");
    if(result.status!=="completed")throw new Error("自有 FreeCAD 未完成可信缩略图渲染，原缩略图保留");
    if(keys!==["version","status","native_pid","native_nonce","private_paths_checked","documents_closed","output_sha256","output_bytes"].sort().join(",")
      ||result.private_paths_checked!==true||result.documents_closed!==true||typeof result.output_sha256!=="string"||!/^[a-f0-9]{64}$/.test(result.output_sha256)
      ||!Number.isSafeInteger(result.output_bytes)||Number(result.output_bytes)<1||Number(result.output_bytes)>MAX_PNG)throw new Error("原生缩略图报告不完整或无效");
    const png=nativeBytes(output,MAX_PNG);
    if(png.length!==result.output_bytes||createHash("sha256").update(png).digest("hex")!==result.output_sha256)throw new Error("原生缩略图PNG与报告不一致");
    return readThumbnailPng(png).bytes;
  } finally {
    fs.rmSync(folder, { recursive: true, force: true });
  }
}

let rendering = false;
export async function regenerateThumbnail(workspace: string, rel: string, value: unknown, render = renderThumbnail) {
  if (rendering) throw new Error("已有缩略图正在生成，请稍后再试");
  const options = thumbnailOptions(value), root = fcstdWorkspace(workspace), key = relativeFile(rel);
  rendering = true;
  let lease:DrawingExecutionLease|undefined;
  try {
    const sources = thumbnailSources(root, key), source = readThumbnailSource(root, key, false, file => file);
    lease=acquireDrawingExecution("thumbnail:"+randomUUID());
    const png = render===renderThumbnail ? await renderThumbnailOwned(source,options,lease) : await render(source,options);
    for (const [file, hash] of sources) {
      const current = readThumbnailSource(root, path.relative(root, file), file !== source, readFcstdBatchArchive);
      if (fcstdFingerprint(current.bytes) !== hash) throw new Error("模型或引用文件已变化，保留原缩略图，请重新生成");
    }
    const image = writeFcstdThumbnail(root, key, png, sources.get(source)!);
    try { cacheRenderedThumbnail(root, key, png, image.sourceHash, true); }
    catch { return { width: image.width, height: image.height, backup: image.backup,
      message: "缩略图已写入 FCStd，原文件已备份；网页缓存更新失败，请重新读取" }; }
    return { width: image.width, height: image.height, backup: image.backup,
      message: "缩略图已写入 FCStd 并更新缓存，原文件已备份；未修改用户 GUI 偏好" };
  } catch (error) {
    if (error instanceof ThumbnailSourceError) throw error;
    throw new Error(redactSensitiveText(error instanceof Error ? error.message : String(error)).split(root).join("[工作空间]"));
  } finally {try{lease?.();}finally{rendering = false;}}
}
