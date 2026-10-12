import type { GalleryRow } from "./api";
export const category = (type: string) => type === "H" ? "一般件" : type === "S" ? "标准件" : type === "R" ? "虚拟件" : "其他 / 未分类";
export const boundingBoxDescription = "按模型 X / Y / Z 轴的边界盒尺寸（mm），不是加工公差尺寸。";
export function boundingBoxText(row: Pick<GalleryRow, "bounding_box">): string {
  const box = row.bounding_box;
  if (!box) return "尺寸未获取";
  const dimensions = [box.x_mm, box.y_mm, box.z_mm];
  if (!dimensions.every(value => typeof value === "number" && Number.isFinite(value) && value >= 0) || !dimensions.some(value => value > 0)) return "尺寸未获取";
  const format = (value: number) => {
    if (value === 0) return "0";
    const rounded = value.toFixed(2).replace(/(\.\d*?[1-9])0+$|\.0+$/, "$1");
    return Number(rounded) === 0 ? "<0.01" : rounded;
  };
  return dimensions.map(format).join(" × ") + " mm";
}
export function boundingBoxTitle(row: Pick<GalleryRow, "dimension_message">): string {
  return [boundingBoxDescription, row.dimension_message].filter(Boolean).join(" ");
}
const rank = (type: string) => type === "H" ? 0 : type === "S" ? 1 : type === "R" ? 2 : 3;
export function visibleGalleryRows(rows: GalleryRow[], query: string, type: string, assemblies: boolean, missing: boolean) {
  const needle = query.trim().toLocaleLowerCase();
  return rows.filter(row => row.role !== "drawing" && (assemblies || row.role !== "assembly") && (!missing || row.status !== "ready")
    && (!type || row.type_code === type) && (!needle || [row.rel, row.part_number, row.part_version, row.part_name].join(" ").toLocaleLowerCase().includes(needle)))
    .sort((a, b) => rank(a.type_code) - rank(b.type_code) || a.part_number.localeCompare(b.part_number, "en", { numeric: true }) || a.part_version.localeCompare(b.part_version, "en", { numeric: true }) || a.rel.localeCompare(b.rel));
}
