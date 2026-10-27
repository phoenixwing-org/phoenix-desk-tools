import type { GalleryRow } from "./types.js";

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const groupRank = (type: string) => type === "H" ? 0 : type === "S" ? 1 : type === "R" ? 2 : 3;
export function galleryBoundingBoxText(row: GalleryRow): string {
  const box = row.bounding_box, values = box ? [box.x_mm, box.y_mm, box.z_mm] : [];
  if (values.length !== 3 || !values.every(value => typeof value === "number" && Number.isFinite(value) && value >= 0) || !values.some(value => value > 0)) return "尺寸未获取";
  return values.map(value => value > 0 && value < 0.005 ? "<0.01" : value.toFixed(2).replace(/(\.\d*?[1-9])0+$|\.0+$/, "$1")).join(" × ") + " mm";
}
export const galleryCategory = (type: string) => type === "H" ? "一般件" : type === "S" ? "标准件" : type === "R" ? "虚拟件" : "其他 / 未分类";
export function sortGalleryRows(rows: GalleryRow[]): GalleryRow[] {
  return [...rows].sort((a, b) => groupRank(a.type_code) - groupRank(b.type_code)
    || a.part_number.localeCompare(b.part_number, "en", { numeric: true })
    || a.part_version.localeCompare(b.part_version, "en", { numeric: true }) || a.rel.localeCompare(b.rel));
}
/** Standalone, script-free output. Images are supplied as trusted data URIs or encoded relative paths. */
export function galleryDocument(rows: GalleryRow[], product: string, updated: string, image: (row: GalleryRow) => string,
  options: { showFilenames?: boolean; showCategory?: boolean; showDimensions?: boolean; showPartNumber?: boolean } = {}): string {
  const cardsPerPage = 20;
  const sorted = sortGalleryRows(rows), pages: string[] = [], pageCount = Math.max(1, Math.ceil(sorted.length / cardsPerPage));
  for (let page = 0; page < pageCount; page++) {
    const cards = sorted.slice(page * cardsPerPage, (page + 1) * cardsPerPage).map(row => {
      const src = row.status === "ready" ? image(row) : "";
      const number = [row.part_number, row.part_version].filter(Boolean).join(".") || "编号未设定";
      const filename = row.rel.split(/[\\/]/).pop() || row.rel;
      const badges = options.showCategory !== false ? `<div class="badges"><span>${escapeHtml(galleryCategory(row.type_code))}</span>${row.role === "assembly" ? "<span>总成</span>" : ""}</div>` : "";
      const dimensions = options.showDimensions !== false ? `<div class="dimensions" title="模型 X / Y / Z 轴边界盒（mm），非图片像素或加工公差尺寸">${escapeHtml(galleryBoundingBoxText(row))}</div>` : "";
      const partNumber = options.showPartNumber !== false ? `<span class="number">${escapeHtml(number)}</span>` : "";
      const file = options.showFilenames === true ? `<div class="file" title="${escapeHtml(filename)}">${escapeHtml(filename)}</div>` : "";
      return `<article class="card"><div class="image">${badges}${src ? `<img src="${escapeHtml(src)}" alt="${escapeHtml(row.part_name)}">` : `<span class="placeholder">缺少缩略图</span>`}${dimensions}</div><div class="identity">${partNumber}<span class="name">${escapeHtml(row.part_name)}</span></div>${file}</article>`;
    }).join("");
    pages.push(`<section class="sheet"><header><h1>零件图册</h1><div class="product" title="${escapeHtml(product || "全库零件")}">${escapeHtml(product || "全库零件")}</div><div class="summary">${sorted.length} 个文件 · 文件去重，非采购数量 BOM</div></header><main>${cards || "没有符合筛选的零件"}</main><footer><span>内嵌预览图 · 生成 ${escapeHtml(updated.replace("T", " ").slice(0, 19))} UTC</span><span>${page + 1} / ${pageCount}</span></footer></section>`);
  }
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: 'self'; style-src 'unsafe-inline'"><title>零件图册</title><style>
/* Rows size to their tallest card; ordinary content stays within the five-row A4 budget. */
*{box-sizing:border-box}body{margin:0;background:#e8ecf1;color:#142236;font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif}.sheet{width:210mm;height:297mm;margin:16px auto;padding:10mm;display:flex;flex-direction:column;background:white;box-shadow:0 2px 12px #172a4220}header{height:19mm;flex-shrink:0;border-bottom:2px solid #2c5878;margin-bottom:3mm}h1{font-size:17px;line-height:1.2;margin:0 0 1mm}.product{font-size:9px;line-height:1.2;overflow-wrap:anywhere;max-height:7mm;overflow:hidden}.summary{font-size:8px;color:#536579;margin-top:.8mm}main{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));grid-auto-rows:auto;gap:2mm;align-content:start;align-items:stretch;flex-shrink:0}.card{border:1px solid #d5dfe6;border-radius:4px;padding:1.2mm;break-inside:avoid;min-width:0}.image{position:relative;isolation:isolate;height:32mm;display:flex;align-items:center;justify-content:center;background:#f4f6f8;border-radius:3px;overflow:hidden}.image img{width:100%;height:100%;object-fit:contain}.placeholder{font-size:9px;color:#748393}.badges{position:absolute;z-index:1;top:1mm;left:1mm;max-width:calc(100% - 2mm);display:flex;gap:1mm;color:#617384;font-size:8px;line-height:1.2}.badges span{padding:.3mm .8mm;border:1px solid #d5dfe6;border-radius:2px;background:#f4f6f8;white-space:nowrap}.dimensions{position:absolute;right:1mm;bottom:1mm;max-width:calc(100% - 2mm);padding:.4mm .8mm;background:#fffffff0;border-radius:2px;font-size:8px;line-height:1.2;text-align:right;color:#536579;overflow-wrap:anywhere;font-variant-numeric:tabular-nums}.identity{display:flex;flex-wrap:wrap;align-items:baseline;gap:0 1mm;margin-top:.6mm;line-height:1.1}.number{font-size:11px;font-weight:700;max-width:100%;overflow-wrap:anywhere}.name{font-size:10px;min-width:0;max-width:100%;overflow-wrap:anywhere}.file{margin-top:.3mm;font-size:8px;line-height:1.1;color:#617384;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}footer{height:7mm;flex-shrink:0;margin-top:auto;display:flex;align-items:flex-end;justify-content:space-between;font-size:8px;line-height:1.2;color:#617384;padding-top:2mm;border-top:1px solid #e4e9ef}@page{size:A4 portrait;margin:0}@media print{body{background:white}.sheet{margin:0;box-shadow:none;break-after:page}.sheet:last-child{break-after:auto}*{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
</style></head><body>${pages.join("")}</body></html>`;
}
