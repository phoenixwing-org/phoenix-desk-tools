import type { CaaDialogIr } from "../types/caaDialogIr";

export type CaaDialogRelatedFileRow = {
  id: string;
  filename: string;
  repoRelPath: string;
  /** 侧栏/日志用 */
  kindLabel: string;
};

function normRel(rel: string): string {
  return rel.replace(/\\/g, "/").trim();
}

function bitmapKindLabel(filename: string): string {
  const ext = filename.includes(".") ? filename.split(".").pop()?.toLowerCase() : "";
  return ext ? `位图 .${ext}` : "位图";
}

/** 从解析 IR 汇总关联资源（CATDlg / Nls / Rsc / 位图文件等） */
export function buildCaaDialogRelatedFiles(ir: CaaDialogIr): CaaDialogRelatedFileRow[] {
  const rows: CaaDialogRelatedFileRow[] = [];
  const seenFiles = new Set<string>();

  function pushFile(kindLabel: string, rel: string) {
    const norm = normRel(rel);
    if (!norm || seenFiles.has(norm)) return;
    seenFiles.add(norm);
    const filename = norm.split("/").pop() ?? norm;
    rows.push({
      id: `file:${norm}`,
      kindLabel,
      filename,
      repoRelPath: norm,
    });
  }

  pushFile(".CATDlg", ir.sources.catDlg);
  if (ir.sources.catNls) pushFile(".CATNls", ir.sources.catNls);
  if (ir.sources.catRsc) pushFile(".CATRsc", ir.sources.catRsc);
  if (ir.sources.header) pushFile(".h Wizard", ir.sources.header);
  if (ir.sources.cpp) pushFile(".cpp Wizard", ir.sources.cpp);

  const extraNls = new Map<string, string>();
  if (ir.sources.nlsLocales) {
    for (const [locale, rel] of Object.entries(ir.sources.nlsLocales)) {
      extraNls.set(normRel(rel), locale);
    }
  }
  for (const loc of ir.parseMeta?.locales ?? []) {
    extraNls.set(normRel(loc.catNlsRel), loc.id);
  }
  for (const [rel, locale] of extraNls) {
    if (rel === normRel(ir.sources.catNls ?? "")) continue;
    pushFile(`.CATNls (${locale})`, rel);
  }

  for (const img of ir.parseMeta?.bitmapFiles ?? []) {
    pushFile(bitmapKindLabel(img.filename), img.repoRelPath);
  }

  return rows;
}
