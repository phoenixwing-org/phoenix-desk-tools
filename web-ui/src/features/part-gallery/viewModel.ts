import type { GalleryRow } from "./api";
export const category = (type: string) => type === "H" ? "自制 / 一般件" : type === "S" ? "标准件" : type === "R" ? "虚拟件" : "其他 / 未分类";
const rank = (type: string) => type === "H" ? 0 : type === "S" ? 1 : type === "R" ? 2 : 3;
export function visibleGalleryRows(rows: GalleryRow[], query: string, type: string, assemblies: boolean, missing: boolean) {
  const needle = query.trim().toLocaleLowerCase();
  return rows.filter(row => row.role !== "drawing" && (assemblies || row.role !== "assembly") && (!missing || row.status !== "ready")
    && (!type || row.type_code === type) && (!needle || [row.rel, row.part_number, row.part_version, row.part_name].join(" ").toLocaleLowerCase().includes(needle)))
    .sort((a, b) => rank(a.type_code) - rank(b.type_code) || a.part_number.localeCompare(b.part_number, "en", { numeric: true }) || a.part_version.localeCompare(b.part_version, "en", { numeric: true }) || a.rel.localeCompare(b.rel));
}
