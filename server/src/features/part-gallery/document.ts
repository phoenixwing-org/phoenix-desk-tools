import type { GalleryRow } from "./types.js";

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const groupRank = (type: string) => type === "H" ? 0 : type === "S" ? 1 : type === "R" ? 2 : 3;
export const galleryCategory = (type: string) => type === "H" ? "自制 / 一般件" : type === "S" ? "标准件" : type === "R" ? "虚拟件" : "其他 / 未分类";
export function sortGalleryRows(rows: GalleryRow[]): GalleryRow[] {
  return [...rows].sort((a, b) => groupRank(a.type_code) - groupRank(b.type_code)
    || a.part_number.localeCompare(b.part_number, "en", { numeric: true })
    || a.part_version.localeCompare(b.part_version, "en", { numeric: true }) || a.rel.localeCompare(b.rel));
}
/** Standalone, script-free output. Images are supplied as trusted data URIs or encoded relative paths. */
export function galleryDocument(rows: GalleryRow[], product: string, updated: string, image: (row: GalleryRow) => string): string {
  const sorted = sortGalleryRows(rows), pages: string[] = [], pageCount = Math.max(1, Math.ceil(sorted.length / 12));
  for (let page = 0; page < pageCount; page++) {
    const cards = sorted.slice(page * 12, page * 12 + 12).map(row => {
      const src = row.status === "ready" ? image(row) : "";
      return `<article><div class="image">${src ? `<img src="${escapeHtml(src)}" alt="${escapeHtml(row.part_name)}">` : `<span>缺少缩略图</span>`}</div><div class="meta">${escapeHtml(galleryCategory(row.type_code))}${row.role === "assembly" ? " · 子总成" : ""}</div><div class="number">${escapeHtml([row.part_number, row.part_version].filter(Boolean).join(".") || "编号未设定")}</div><div class="name">${escapeHtml(row.part_name)}</div></article>`;
    }).join("");
    pages.push(`<section class="sheet"><header><h1>零件图册</h1><div class="product">${escapeHtml(product || "全库零件")}</div><div class="summary">${sorted.length} 个文件 · 文件去重，非采购数量 BOM</div></header><main>${cards || "没有符合筛选的零件"}</main><footer><span>内嵌预览图 · 生成 ${escapeHtml(updated.replace("T", " ").slice(0, 19))} UTC</span><span>${page + 1} / ${pageCount}</span></footer></section>`);
  }
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: 'self'; style-src 'unsafe-inline'"><title>零件图册</title><style>
*{box-sizing:border-box}body{margin:0;background:#e8ecf1;color:#142236;font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif}.sheet{width:210mm;height:297mm;margin:16px auto;padding:12mm;display:flex;flex-direction:column;background:white;box-shadow:0 2px 12px #172a4220;overflow:hidden}header{height:29mm;flex-shrink:0;border-bottom:2px solid #2c5878;margin-bottom:5mm}h1{font-size:21px;margin:0 0 4px}.product{font-size:10px;overflow-wrap:anywhere;max-height:12mm;overflow:hidden}.summary{font-size:9px;color:#536579;margin-top:4px}main{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));grid-template-rows:repeat(4,54mm);gap:3mm;align-content:start}article{border:1px solid #d5dfe6;border-radius:5px;padding:2.4mm;break-inside:avoid;min-width:0}.image{height:30mm;display:flex;align-items:center;justify-content:center;background:#f4f6f8;border-radius:3px;overflow:hidden}.image img{max-width:100%;max-height:100%;object-fit:contain}.image span{font-size:11px;color:#748393}.meta{font-size:8px;color:#617384;margin-top:2mm}.number{font-size:12px;font-weight:700;margin-top:1mm}.name{font-size:10px;line-height:1.35;margin-top:1mm;overflow-wrap:anywhere}footer{margin-top:auto;display:flex;justify-content:space-between;font-size:8px;color:#617384;padding-top:3mm;border-top:1px solid #e4e9ef}@page{size:A4 portrait;margin:0}@media print{body{background:white}.sheet{margin:0;box-shadow:none;break-after:page}.sheet:last-child{break-after:auto}*{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
</style></head><body>${pages.join("")}</body></html>`;
}
