/** 文件详情 / 零件详情 Tab 去重：统一规范化 contextKey */

export function normalizeDetailTabRel(rel: string): string {
  return rel.replace(/\\/g, "/").replace(/^\.\//, "").trim();
}

export function partKeyTabContextKey(partNumber: string, partVersion: string): string {
  return `${partNumber.trim()}.${partVersion.trim()}`;
}
