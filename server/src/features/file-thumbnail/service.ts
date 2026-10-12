import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { fcstdWorkspace, safeFcstdPath, readFcstdBatchArchive, fcstdFingerprint } from "../../lib/fcstdBatchFiles.js";
import { readThumbnailPng } from "../../lib/fcstdThumbnail.js";
import { isStandaloneDrawing } from "../../lib/fcstdDrawing.js";
import { fcstdNativeXlinkFiles } from "../../lib/fcstdNativeXlinkFiles.js";
import { buildFreecadChildEnvironment, redactSensitiveText } from "../../lib/freecadProcessSecurity.js";
import { guiExecutable } from "../drawing-research/jobs.js";
import { cacheRenderedThumbnail } from "../part-gallery/service.js";
import { relativeFile } from "../part-gallery/storage.js";
import { thumbnailRunner } from "./runner.js";
import { ensureSaveThumbnail } from "./preferences.js";
import { writeFcstdThumbnail } from "./archive.js";

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

/** Guard the source and linked FCStd files; no unrelated directory scan. */
export function thumbnailSources(root: string, rel: string) {
  const snapshots = new Map<string, string>(), queue = [relativeFile(rel)];
  for (let i = 0; i < queue.length; i++) {
    const file = safeFcstdPath(root, queue[i]);
    if (snapshots.has(file)) continue;
    if (!/\.fcstd$/i.test(file)) throw new Error("只支持 FCStd 模型");
    const archive = readFcstdBatchArchive(file);
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

export async function renderThumbnail(source: string, options: ThumbnailOptions): Promise<Buffer> {
  const executable = guiExecutable();
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "desk-thumbnail-render-"));
  try {
    const report = path.join(folder, "result.json"), output = path.join(folder, "thumbnail.png");
    const config = path.join(folder, "job.json"), macro = path.join(folder, "render.FCMacro");
    fs.writeFileSync(config, JSON.stringify({ source, options, output, report }));
    fs.writeFileSync(macro, `JOB_PATH = ${JSON.stringify(config)}\n${thumbnailRunner}`);
    const env = buildFreecadChildEnvironment(process.env);
    // Coin/OpenGL rendering needs a GUI process; use the same isolated GUI path as single-part drawing.
    delete env.QT_QPA_PLATFORM;
    await new Promise<void>((resolve, reject) => {
      const child = spawn(executable, ["-u", path.join(folder, "user.cfg"), "-s", path.join(folder, "system.cfg"), macro], { cwd: path.dirname(source), env, stdio: "ignore" });
      let expired = false;
      const timer = setTimeout(() => { expired = true; child.kill("SIGKILL"); }, 120000);
      timer.unref();
      child.once("error", error => { clearTimeout(timer); reject(error); });
      child.once("close", code => {
        clearTimeout(timer);
        if (expired) {
          let progress: unknown;
          try { progress = JSON.parse(fs.readFileSync(report, "utf8")); } catch { /* FreeCAD may not have started the macro. */ }
          reject(new Error(`生成缩略图超过 2 分钟（${thumbnailTimeoutStage(progress)}），已终止本次渲染，原缩略图保留`));
        }
        else if (code !== 0) reject(new Error(`FreeCAD 渲染进程退出（${code}），原缩略图保留`));
        else resolve();
      });
    });
    if (!fs.existsSync(report)) throw new Error("FreeCAD 未返回缩略图结果");
    const result = JSON.parse(fs.readFileSync(report, "utf8"));
    if (result.status !== "completed") throw new Error(String(result.error || "生成缩略图失败"));
    if (fs.statSync(output).size > 4 * 1024 * 1024) throw new Error("生成的缩略图超过 4 MiB 上限");
    return readThumbnailPng(fs.readFileSync(output)).bytes;
  } finally {
    fs.rmSync(folder, { recursive: true, force: true });
  }
}

let rendering = false;
export async function regenerateThumbnail(workspace: string, rel: string, value: unknown, render = renderThumbnail) {
  if (rendering) throw new Error("已有缩略图正在生成，请稍后再试");
  const options = thumbnailOptions(value), root = fcstdWorkspace(workspace), key = relativeFile(rel);
  rendering = true;
  try {
    const sources = thumbnailSources(root, key), source = safeFcstdPath(root, key);
    // Persist in the actual connected GUI process. The isolated renderer's
    // temporary -u/-s configuration must never stand in for this preference.
    await ensureSaveThumbnail();
    const png = await render(source, options);
    for (const [file, hash] of sources) {
      const current = safeFcstdPath(root, path.relative(root, file));
      if (fcstdFingerprint(readFcstdBatchArchive(current).bytes) !== hash) throw new Error("模型或引用文件已变化，保留原缩略图，请重新生成");
    }
    const image = writeFcstdThumbnail(root, key, png, sources.get(source)!);
    try { cacheRenderedThumbnail(root, key, png, image.sourceHash, true); }
    catch { return { width: image.width, height: image.height, backup: image.backup,
      message: "缩略图已写入 FCStd，原文件已备份；网页缓存更新失败，请重新读取。FreeCAD 保存缩略图已开启并持久化" }; }
    return { width: image.width, height: image.height, backup: image.backup,
      message: "缩略图已写入 FCStd 并更新缓存，原文件已备份；FreeCAD 保存缩略图已开启并持久化" };
  } catch (error) {
    throw new Error(redactSensitiveText(error instanceof Error ? error.message : String(error)).split(root).join("[工作空间]"));
  } finally { rendering = false; }
}
