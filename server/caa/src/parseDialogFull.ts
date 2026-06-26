import {
  extractWizardBindingsFromCpp,
  mergeDialogIr,
  parseCatNls,
  type CaaDialogIr,
  type CaaDialogParseMeta,
} from "@phoenix/catdlg-core";
import { discoverDialogResources, type DiscoveredDialogResources } from "./discoverDialogResources.js";
import { caaLog, caaLogLines } from "./caaLog.js";

export type ParseDialogFullOpts = {
  readUtf8: (absPath: string) => Promise<string>;
  resolveAbs: (rel: string) => string;
  catDlgRel: string;
  catDlgAbs: string;
  workspaceRoot?: string;
  /** 显式指定默认 Nls（跳过发现） */
  catNlsRel?: string;
};

function pushProbeLogs(logs: string[], discovered: DiscoveredDialogResources): void {
  for (const p of discovered.pathProbes) {
    logs.push(`[${p.exists ? "OK" : "MISS"}] ${p.kind}: ${p.rel}`);
    logs.push(`       → ${p.abs}`);
  }
}

function collectControlIds(node: CaaDialogIr["root"]): string[] {
  const out: string[] = [];
  const visit = (n: CaaDialogIr["root"]) => {
    if (n.id && !out.includes(n.id)) out.push(n.id);
    for (const child of n.children ?? []) visit(child);
  };
  visit(node);
  return out;
}

export async function parseDialogFull(opts: ParseDialogFullOpts): Promise<CaaDialogIr> {
  const { readUtf8, resolveAbs, catDlgRel, catDlgAbs, workspaceRoot } = opts;
  const logs: string[] = [];

  logs.push(`工作空间根: ${workspaceRoot ?? "(demo/仓库)"}`);
  logs.push(`.CATDlg 相对: ${catDlgRel}`);
  logs.push(`.CATDlg 绝对: ${catDlgAbs}`);

  caaLog("parse 开始", { catDlgRel, catDlgAbs, workspaceRoot });

  const discovered = await discoverDialogResources(resolveAbs, catDlgRel);
  const warnings = [...discovered.warnings];
  pushProbeLogs(logs, discovered);

  const primaryNlsRel = opts.catNlsRel?.trim() || discovered.primaryNlsRel;
  const nlsLocales = discovered.nlsLocales.length
    ? discovered.nlsLocales
    : primaryNlsRel
      ? [{ locale: "default", catNlsRel: primaryNlsRel }]
      : [];

  const sources: CaaDialogIr["sources"] = { catDlg: catDlgRel };
  if (discovered.headerRel) sources.header = discovered.headerRel;
  if (discovered.cppRel) sources.cpp = discovered.cppRel;
  const nlsLocalePaths: Record<string, string> = {};
  for (const ref of nlsLocales) {
    nlsLocalePaths[ref.locale] = ref.catNlsRel;
  }
  if (Object.keys(nlsLocalePaths).length) sources.nlsLocales = nlsLocalePaths;

  let catNlsText: string | undefined;
  let catNlsAbs: string | undefined;
  const localeNlsTexts: Record<string, string> = {};
  const localeMeta: CaaDialogParseMeta["locales"] = [];

  for (const ref of nlsLocales) {
    const abs = resolveAbs(ref.catNlsRel);
    try {
      const text = await readUtf8(abs);
      const parsed = parseCatNls(text);
      const keyCount = Object.keys(parsed).length;
      const keyPreview = Object.keys(parsed).slice(0, 12).join(", ");
      localeMeta.push({
        id: ref.locale,
        catNlsRel: ref.catNlsRel,
        keyCount,
        sourceText: text,
      });
      logs.push(`已读 .CATNls [${ref.locale}] ${keyCount} 键 → ${abs}`);
      if (keyCount > 0) {
        logs.push(`       键名: ${keyPreview}${keyCount > 12 ? " …" : ""}`);
      }
      caaLog(`read catNls [${ref.locale}]`, { rel: ref.catNlsRel, abs, keyCount, keys: Object.keys(parsed) });
      if (ref.locale === "default" || ref.catNlsRel === primaryNlsRel) {
        catNlsText = text;
        catNlsAbs = abs;
        sources.catNls = ref.catNlsRel;
      } else {
        localeNlsTexts[ref.locale] = text;
      }
    } catch (err) {
      const msg = `无法读取 .CATNls（${ref.locale}）：${ref.catNlsRel}`;
      warnings.push(msg);
      logs.push(`${msg} → ${abs}`);
      caaLog(`warn: ${msg}`, { abs, err: String(err) });
    }
  }

  let catRscText: string | undefined;
  let catRscAbs: string | undefined;
  let rscKeyCount = 0;
  const imageRefs: string[] = [];
  if (discovered.catRscRel) {
    catRscAbs = resolveAbs(discovered.catRscRel);
    try {
      catRscText = await readUtf8(catRscAbs);
      const rsc = parseCatNls(catRscText);
      rscKeyCount = Object.keys(rsc).length;
      sources.catRsc = discovered.catRscRel;
      logs.push(`已读 .CATRsc ${rscKeyCount} 键 → ${catRscAbs}`);
      caaLog("read catRsc", { rel: discovered.catRscRel, abs: catRscAbs, rscKeyCount });
      for (const v of Object.values(rsc)) {
        if (v && !imageRefs.includes(v)) imageRefs.push(v);
      }
    } catch (err) {
      const msg = `无法读取 .CATRsc：${discovered.catRscRel}`;
      warnings.push(msg);
      logs.push(`${msg} → ${catRscAbs}`);
      caaLog(`warn: ${msg}`, { abs: catRscAbs, err: String(err) });
    }
  }

  let catDlgText: string;
  try {
    catDlgText = await readUtf8(catDlgAbs);
    logs.push(`已读 .CATDlg ${catDlgText.length} 字符`);
    caaLog("read catDlg OK", { bytes: catDlgText.length });
  } catch (err) {
    const msg = `无法读取 .CATDlg：${catDlgRel}`;
    logs.push(`${msg} → ${catDlgAbs}`);
    caaLog(`error: ${msg}`, { abs: catDlgAbs, err: String(err) });
    throw new Error(`${msg}（${catDlgAbs}）`);
  }

  let cppText: string | undefined;
  let cppAbs: string | undefined;
  if (discovered.cppRel) {
    cppAbs = resolveAbs(discovered.cppRel);
    try {
      cppText = await readUtf8(cppAbs);
      logs.push(`Read .cpp ${cppText.length} chars -> ${cppAbs}`);
      caaLog("read cpp OK", { rel: discovered.cppRel, abs: cppAbs, bytes: cppText.length });
    } catch (err) {
      const msg = `Cannot read .cpp: ${discovered.cppRel}`;
      warnings.push(msg);
      logs.push(`${msg} -> ${cppAbs}`);
      caaLog(`warn: ${msg}`, { abs: cppAbs, err: String(err) });
    }
  }

  const msgCatalogDirRel = primaryNlsRel
    ? primaryNlsRel.replace(/\\/g, "/").replace(/\/[^/]+$/, "")
    : discovered.pathProbes.find((p) => p.kind === "msgcatalogDir" && p.exists)?.rel;

  const localeNlsSourceTexts: Record<string, string> = {};
  for (const loc of localeMeta) {
    if (loc.id === "default" || loc.catNlsRel === primaryNlsRel) continue;
    if (loc.sourceText) localeNlsSourceTexts[loc.id] = loc.sourceText;
  }

  const parseMeta: CaaDialogParseMeta = {
    locales: localeMeta,
    primaryLocale: localeMeta[0]?.id ?? "default",
    catRscRel: discovered.catRscRel,
    rscKeyCount,
    bitmapDirs: discovered.bitmapDirs,
    bitmapFileCount: discovered.bitmapFileCount,
    bitmapFiles: discovered.bitmapFiles,
    imageRefs,
    warnings,
    catNlsSourceText: catNlsText,
    localeNlsSourceTexts:
      Object.keys(localeNlsSourceTexts).length > 0 ? localeNlsSourceTexts : undefined,
    logs,
    resolvedAbs: {
      workspaceRoot: workspaceRoot ?? undefined,
      catDlg: catDlgAbs,
      catNls: catNlsAbs,
      catRsc: catRscAbs,
      header: discovered.headerRel ? resolveAbs(discovered.headerRel) : undefined,
      cpp: cppAbs,
      msgCatalogDir: msgCatalogDirRel ? resolveAbs(msgCatalogDirRel) : undefined,
    },
  };

  const ir = mergeDialogIr({
    catDlgText,
    catNlsText,
    localeNlsTexts: Object.keys(localeNlsTexts).length ? localeNlsTexts : undefined,
    catRscText,
    sources,
    parseMeta,
  });

  logs.push(
    `合并 IR：dialog=${ir.dialogName} 控件树子节点=${ir.root.children.length} title=${ir.title ?? "(无)"}`,
  );
  caaLog("parse 完成", {
    dialogName: ir.dialogName,
    title: ir.title,
    childCount: ir.root.children.length,
    localeCount: localeMeta.length,
    warnings: warnings.length,
  });
  if (cppText && ir.parseMeta) {
    const bindings = extractWizardBindingsFromCpp(cppText, {
      knownControlIds: collectControlIds(ir.root),
    });
    if (bindings.length > 0) ir.parseMeta.bindings = bindings;
    logs.push(`Parsed cpp field bindings: ${bindings.length}`);
    caaLog("parse cpp bindings", { bindingCount: bindings.length });
  }
  caaLogLines(logs);

  return ir;
}

export type { DiscoveredDialogResources };
