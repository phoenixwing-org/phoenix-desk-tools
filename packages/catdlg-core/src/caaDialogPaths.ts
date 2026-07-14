/** CAA 对话框路径启发式（列表分组、Nls 推断）。 */

export function normalizeRepoRel(rel: string): string {
  return rel.replace(/\\/g, "/").replace(/^\/+/, "");
}

/** 按 `*UI.m` 模块目录分组；否则取父目录名。 */
export function caaDialogGroupKey(catDlgRel: string): string {
  const norm = normalizeRepoRel(catDlgRel);
  const uiMatch = norm.match(/(?:^|\/)([^/]+UI\.m)(?:\/|$)/i);
  if (uiMatch) return uiMatch[1];
  const parts = norm.split("/");
  if (parts.length >= 2) return parts[parts.length - 2]!;
  return "(根目录)";
}

export function caaDialogGroupLabel(groupKey: string): string {
  return groupKey;
}

function catDlgNlsBasename(catDlgRel: string): string | undefined {
  const norm = normalizeRepoRel(catDlgRel);
  const fileName = norm.split("/").pop();
  if (!fileName?.toLowerCase().endsWith(".catdlg")) return undefined;
  return fileName.replace(/\.CATDlg$/i, ".CATNls");
}

function uiModulePrefix(catDlgRel: string): { parent: string; uiModule: string } | undefined {
  const norm = normalizeRepoRel(catDlgRel);
  const localIdx = norm.indexOf("/LocalInterfaces/");
  if (localIdx <= 0) return undefined;
  const prefix = norm.slice(0, localIdx);
  const slash = prefix.lastIndexOf("/");
  if (slash < 0) return { parent: "", uiModule: prefix };
  return { parent: prefix.slice(0, slash), uiModule: prefix.slice(slash + 1) };
}

/**
 * 从 `…/XUI.m/LocalInterfaces/Foo.CATDlg` 推断 `.CATNls` 候选路径（按常见 CAA 布局排序）。
 *
 * 1. `…/WorkshopPkg/CNext/resources/msgcatalog/` — 包级 CNext（如 PNX `PNXBomAnalysisFrm/CNext/…`）
 * 2. `…/WorkshopPkg/XFrm/CNext/resources/msgcatalog/` — UI 与 Frm 模块并列
 */
export function inferCatNlsRelCandidates(catDlgRel: string): string[] {
  const nlsName = catDlgNlsBasename(catDlgRel);
  const parts = uiModulePrefix(catDlgRel);
  if (!nlsName) return [];

  const normalized = normalizeRepoRel(catDlgRel);
  const slash = normalized.lastIndexOf("/");
  const adjacent = slash >= 0 ? `${normalized.slice(0, slash)}/${nlsName}` : nlsName;
  if (!parts) return [adjacent];

  const { parent, uiModule } = parts;
  const out: string[] = [];

  if (parent) {
    out.push(`${parent}/CNext/resources/msgcatalog/${nlsName}`);
  }
  if (/UI\.m$/i.test(uiModule) && parent) {
    const frmModule = uiModule.replace(/UI\.m$/i, "Frm");
    const parentBase = parent.split("/").pop() ?? "";
    // `.edu` / 包名已是 Frm 时，CNext 在包级；勿再探测并列 Frm 子目录
    if (!/\.edu$/i.test(parentBase) && parentBase.toLowerCase() !== frmModule.toLowerCase()) {
      out.push(`${parent}/${frmModule}/CNext/resources/msgcatalog/${nlsName}`);
    }
  }

  // The dialog creator and lightweight workspaces keep CATDlg/CATNls together.
  // Probe that layout after the canonical CNext/msgcatalog locations.
  if (!out.includes(adjacent)) out.push(adjacent);

  return out;
}

/** 首选候选（探测磁盘时应遍历 {@link inferCatNlsRelCandidates}）。 */
export function inferCatNlsRel(catDlgRel: string): string | undefined {
  return inferCatNlsRelCandidates(catDlgRel)[0];
}

/** 与 `.CATNls` 同目录、同 basename 的 `.CATRsc`。 */
export function inferCatRscRel(catDlgRel: string): string | undefined {
  const nls = inferCatNlsRel(catDlgRel);
  if (!nls) return undefined;
  return nls.replace(/\.CATNls$/i, ".CATRsc");
}

export function inferMsgCatalogDir(catDlgRel: string): string | undefined {
  const nls = inferCatNlsRel(catDlgRel);
  if (!nls) return undefined;
  const norm = normalizeRepoRel(nls);
  const idx = norm.lastIndexOf("/");
  return idx >= 0 ? norm.slice(0, idx) : undefined;
}

/** 由已解析的 `.CATNls` 相对路径推导位图等资源目录（避免探测无效 Frm 并列路径）。 */
export function inferGraphicResourceDirsForNlsRel(catNlsRel: string): string[] {
  const norm = normalizeRepoRel(catNlsRel);
  const idx = norm.indexOf("/msgcatalog");
  if (idx <= 0) return [];
  const base = norm.slice(0, idx);
  return [`${base}/graphic`, `${base}/bitmaps`, `${base}/icons`];
}

/** 由 Nls 候选推导 `CNext/resources` 前缀，再列出位图等目录。 */
export function inferGraphicResourceDirs(catDlgRel: string): string[] {
  const bases = new Set<string>();
  for (const nlsCand of inferCatNlsRelCandidates(catDlgRel)) {
    const norm = normalizeRepoRel(nlsCand);
    const idx = norm.indexOf("/msgcatalog");
    if (idx > 0) bases.add(norm.slice(0, idx));
  }
  const dirs: string[] = [];
  for (const base of bases) {
    dirs.push(
      `${base}/msgcatalog`,
      `${base}/graphic`,
      `${base}/bitmaps`,
      `${base}/icons`,
    );
  }
  return dirs;
}

export type CaaNlsLocaleRef = {
  locale: string;
  catNlsRel: string;
};

/** 推断 msgcatalog 下默认与各语言子目录中的 `.CATNls` 相对路径（不含磁盘探测）。 */
export function inferCatNlsLocaleRefs(catDlgRel: string, localeDirNames: string[]): CaaNlsLocaleRef[] {
  const defaultRel = inferCatNlsRel(catDlgRel);
  if (!defaultRel) return [];
  const norm = normalizeRepoRel(defaultRel);
  const msgDir = norm.slice(0, norm.lastIndexOf("/"));
  const nlsName = norm.split("/").pop()!;
  const out: CaaNlsLocaleRef[] = [{ locale: "default", catNlsRel: defaultRel }];
  for (const dir of localeDirNames) {
    const rel = `${msgDir}/${dir}/${nlsName}`;
    if (rel !== defaultRel) out.push({ locale: dir, catNlsRel: rel });
  }
  return out;
}
