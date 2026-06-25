import fs from "node:fs/promises";
import path from "node:path";
import {
  inferCatNlsRelCandidates,
  inferCatRscRel,
  inferGraphicResourceDirsForNlsRel,
  inferMsgCatalogDir,
  normalizeRepoRel,
  type CaaNlsLocaleRef,
} from "@phoenix/catdlg-core";
import { caaLog } from "./caaLog.js";

const IMAGE_EXTS = new Set([".png", ".bmp", ".gif", ".jpg", ".jpeg", ".ico", ".svg"]);

export type PathProbe = {
  kind: string;
  rel: string;
  abs: string;
  exists: boolean;
};

export type DiscoveredBitmapFile = {
  repoRelPath: string;
  filename: string;
  sizeBytes: number;
};

export type DiscoveredDialogResources = {
  primaryNlsRel?: string;
  nlsLocales: CaaNlsLocaleRef[];
  catRscRel?: string;
  headerRel?: string;
  cppRel?: string;
  bitmapDirs: string[];
  bitmapFiles: DiscoveredBitmapFile[];
  bitmapFileCount: number;
  warnings: string[];
  pathProbes: PathProbe[];
};

async function exists(abs: string): Promise<boolean> {
  try {
    await fs.access(abs);
    return true;
  } catch {
    return false;
  }
}

async function listImagesInDir(
  resolveAbs: (rel: string) => string,
  dirRel: string,
  depth = 0,
): Promise<DiscoveredBitmapFile[]> {
  const MAX_DEPTH = 12;
  const absDir = resolveAbs(dirRel);
  const normDir = normalizeRepoRel(dirRel).replace(/\/+$/, "");
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(absDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: DiscoveredBitmapFile[] = [];
  for (const ent of entries) {
    if (ent.isDirectory()) {
      if (depth < MAX_DEPTH) {
        out.push(...await listImagesInDir(resolveAbs, `${normDir}/${ent.name}`, depth + 1));
      }
      continue;
    }
    if (!ent.isFile()) continue;
    const ext = path.extname(ent.name).toLowerCase();
    if (!IMAGE_EXTS.has(ext)) continue;
    const repoRelPath = `${normDir}/${ent.name}`;
    let sizeBytes = 0;
    try {
      sizeBytes = (await fs.stat(path.join(absDir, ent.name))).size;
    } catch {
      /* ignore */
    }
    out.push({ repoRelPath, filename: ent.name, sizeBytes });
  }
  return out.sort((a, b) => a.repoRelPath.localeCompare(b.repoRelPath, undefined, { sensitivity: "base" }));
}

function msgCatalogDirFromNlsRel(nlsRel: string): string {
  const norm = normalizeRepoRel(nlsRel);
  const idx = norm.lastIndexOf("/");
  return idx >= 0 ? norm.slice(0, idx) : norm;
}

function dialogBaseRel(catDlgRel: string): string {
  return normalizeRepoRel(catDlgRel).replace(/\.CATDlg$/i, "");
}

function inferHeaderCandidates(catDlgRel: string): string[] {
  const base = dialogBaseRel(catDlgRel);
  return [`${base}.h`, `${base}.hpp`];
}

function inferCppCandidates(catDlgRel: string): string[] {
  const base = dialogBaseRel(catDlgRel);
  const candidates = [`${base}.cpp`];
  const srcBase = base.replace(/\/LocalInterfaces\//i, "/src/");
  if (srcBase !== base) candidates.push(`${srcBase}.cpp`);
  return candidates;
}

async function probePath(
  resolveAbs: (rel: string) => string,
  probes: PathProbe[],
  kind: string,
  rel: string,
): Promise<boolean> {
  const abs = resolveAbs(rel);
  const ok = await exists(abs);
  probes.push({ kind, rel, abs, exists: ok });
  caaLog(`probe ${kind}: ${ok ? "OK" : "MISS"} ${rel}`, { abs });
  return ok;
}

/** 扫描 msgcatalog / graphic 等目录，定位 `.CATNls` 多语言与 `.CATRsc`。 */
export async function discoverDialogResources(
  resolveAbs: (rel: string) => string,
  catDlgRel: string,
): Promise<DiscoveredDialogResources> {
  const warnings: string[] = [];
  const pathProbes: PathProbe[] = [];
  const nlsLocales: CaaNlsLocaleRef[] = [];
  let headerRel: string | undefined;
  let cppRel: string | undefined;
  const nlsCandidates = inferCatNlsRelCandidates(catDlgRel);
  let primaryNlsRel: string | undefined;
  let catRscRel: string | undefined;

  caaLog(`discover: CATNls 候选 ${nlsCandidates.length} 条`, { candidates: nlsCandidates });

  for (const cand of nlsCandidates) {
    if (await probePath(resolveAbs, pathProbes, "catNls", cand)) {
      primaryNlsRel = cand;
      nlsLocales.push({ locale: "default", catNlsRel: cand });
      break;
    }
  }

  if (!primaryNlsRel && nlsCandidates.length > 0) {
    const msg = `未找到默认 .CATNls：${nlsCandidates.join(" 或 ")}`;
    warnings.push(msg);
    caaLog(`warn: ${msg}`);
  }

  const nlsName = primaryNlsRel
    ? path.posix.basename(normalizeRepoRel(primaryNlsRel))
    : nlsCandidates[0]
      ? path.posix.basename(normalizeRepoRel(nlsCandidates[0]))
      : undefined;

  let msgDirRel: string | undefined = primaryNlsRel
    ? msgCatalogDirFromNlsRel(primaryNlsRel)
    : inferMsgCatalogDir(catDlgRel);

  if (!primaryNlsRel && nlsCandidates.length > 0) {
    for (const cand of nlsCandidates) {
      const dirRel = msgCatalogDirFromNlsRel(cand);
      if (await probePath(resolveAbs, pathProbes, "msgcatalogDir", dirRel)) {
        msgDirRel = dirRel;
        break;
      }
    }
  }

  if (msgDirRel) {
    const msgAbs = resolveAbs(msgDirRel);
    pathProbes.push({
      kind: "msgcatalogDir",
      rel: msgDirRel,
      abs: msgAbs,
      exists: await exists(msgAbs),
    });
    try {
      const entries = await fs.readdir(msgAbs, { withFileTypes: true });
      caaLog(`msgcatalog 目录可读：${msgDirRel}（${entries.length} 项）`);
      if (!primaryNlsRel && nlsName) {
        const rootNls = `${msgDirRel}/${nlsName}`.replace(/\\/g, "/");
        if (await probePath(resolveAbs, pathProbes, "catNls", rootNls)) {
          primaryNlsRel = rootNls;
          nlsLocales.push({ locale: "default", catNlsRel: rootNls });
        }
      }
      for (const ent of entries) {
        if (!ent.isDirectory()) continue;
        if (!nlsName) continue;
        const localeRel = `${msgDirRel}/${ent.name}/${nlsName}`.replace(/\\/g, "/");
        if (localeRel === primaryNlsRel) continue;
        if (await probePath(resolveAbs, pathProbes, `catNls:${ent.name}`, localeRel)) {
          nlsLocales.push({ locale: ent.name, catNlsRel: localeRel });
        }
      }
    } catch (err) {
      const msg = `无法读取 msgcatalog 目录：${msgDirRel}`;
      warnings.push(msg);
      caaLog(`warn: ${msg}`, { err: String(err) });
    }
  }

  const rscCandidates = primaryNlsRel
    ? [primaryNlsRel.replace(/\.CATNls$/i, ".CATRsc")]
    : nlsCandidates.map((c) => c.replace(/\.CATNls$/i, ".CATRsc"));
  const inferredRsc = inferCatRscRel(catDlgRel);
  if (inferredRsc && !rscCandidates.includes(inferredRsc)) rscCandidates.push(inferredRsc);

  for (const cand of rscCandidates) {
    if (cand && (await probePath(resolveAbs, pathProbes, "catRsc", cand))) {
      catRscRel = cand;
      break;
    }
  }

  for (const cand of inferHeaderCandidates(catDlgRel)) {
    if (await probePath(resolveAbs, pathProbes, "header", cand)) {
      headerRel = cand;
      break;
    }
  }

  for (const cand of inferCppCandidates(catDlgRel)) {
    if (await probePath(resolveAbs, pathProbes, "cpp", cand)) {
      cppRel = cand;
      break;
    }
  }

  const bitmapDirs: string[] = [];
  const bitmapFiles: DiscoveredBitmapFile[] = [];
  const seenBitmapPaths = new Set<string>();
  const graphicDirCandidates = primaryNlsRel
    ? inferGraphicResourceDirsForNlsRel(primaryNlsRel)
    : nlsCandidates.flatMap((c) => inferGraphicResourceDirsForNlsRel(c));
  for (const dirRel of graphicDirCandidates) {
    const abs = resolveAbs(dirRel);
    const ok = await exists(abs);
    pathProbes.push({ kind: "graphicDir", rel: dirRel, abs, exists: ok });
    if (!ok) continue;
    bitmapDirs.push(dirRel);
    const files = await listImagesInDir(resolveAbs, dirRel);
    for (const file of files) {
      if (seenBitmapPaths.has(file.repoRelPath)) continue;
      seenBitmapPaths.add(file.repoRelPath);
      bitmapFiles.push(file);
      pathProbes.push({
        kind: "bitmap",
        rel: file.repoRelPath,
        abs: resolveAbs(file.repoRelPath),
        exists: true,
      });
    }
    if (files.length) {
      caaLog(`graphicDir OK: ${dirRel}（${files.length} 个图片）`);
    } else {
      caaLog(`graphicDir OK: ${dirRel}（无图片文件）`);
    }
  }
  const bitmapFileCount = bitmapFiles.length;

  caaLog("discover 完成", {
    primaryNlsRel,
    nlsLocaleCount: nlsLocales.length,
    catRscRel,
    headerRel,
    cppRel,
    bitmapDirs,
    bitmapFileCount,
    bitmapFiles: bitmapFiles.map((f) => f.repoRelPath),
    warningCount: warnings.length,
  });

  return {
    primaryNlsRel,
    nlsLocales,
    catRscRel,
    headerRel,
    cppRel,
    bitmapDirs,
    bitmapFiles,
    bitmapFileCount,
    warnings,
    pathProbes,
  };
}
