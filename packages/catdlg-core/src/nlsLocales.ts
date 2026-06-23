import { formatCatNlsLine } from "./patchCatNls.js";
import { normalizeRepoRel } from "./caaDialogPaths.js";

/** CAA / CATIA 简体中文消息目录名（见 msgcatalog 下子目录）。 */
export const CAA_NLS_LOCALE_SIMPLIFIED_CHINESE = "Simplified_Chinese";

/** 由默认 `.CATNls` 相对路径推导某语言子目录下的同名文件路径。 */
export function inferLocaleCatNlsRel(defaultCatNlsRel: string, localeDir: string): string {
  const norm = normalizeRepoRel(defaultCatNlsRel);
  const slash = norm.lastIndexOf("/");
  if (slash < 0) return norm;
  const msgDir = norm.slice(0, slash);
  const nlsName = norm.slice(slash + 1);
  const dir = localeDir.replace(/\\/g, "/").replace(/\/+$/, "");
  return `${msgDir}/${dir}/${nlsName}`;
}

/** 新建语言文件：与默认键一致，值留空供填写翻译。 */
export function buildLocaleNlsInitialKeys(defaultFlat: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of Object.keys(defaultFlat)) {
    out[key] = "";
  }
  return out;
}

export function emitCatNlsFile(
  keys: Record<string, string>,
  opts?: { headerLines?: string[]; wizardZone?: boolean },
): string {
  const wizard = opts?.wizardZone ?? true;
  const lines: string[] = [...(opts?.headerLines ?? [])];
  if (wizard) {
    if (lines.length) lines.push("");
    lines.push("// DO NOT EDIT :: THE CAA2 WIZARD WILL REPLACE ALL THE CODE HERE");
  }
  const sorted = Object.keys(keys).sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: "base" }),
  );
  for (const key of sorted) {
    lines.push(formatCatNlsLine(key, keys[key] ?? ""));
  }
  if (wizard) {
    lines.push("// END WIZARD REPLACEMENT ZONE");
  }
  return lines.join("\n");
}
