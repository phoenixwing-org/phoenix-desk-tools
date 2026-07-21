/** pnwApiAdapter — SQLite/Python 兼容字段名转换适配层
 *
 * 规则：不动前端接口。SQLite snake_case → 统一转为历史前端接口格式。
 * Python 接口格式来源：phoenix/services/fcstd_map_service.py 等。
 *
 * ── 字段映射表 ────────────────────────────────
 * TypeScript/SQLite     → Python/Frontend
 * ─────────────────────────────────────────────
 * part_number           → PartNumber
 * part_version          → PartVersion
 * part_name             → PartName
 * type_code             → TypeCode
 * model_series          → ModelSeries
 * repo_rel_path         → repo_rel_path    (不变)
 * filename              → filename         (不变)
 * asset_kind            → asset_kind       (不变)
 * label                 → label            (不变)
 * file_status           → file_status      (不变)
 */

/** SQLite 行 → 前端兼容格式的 FcstdMapEntry */
export function toFcstdMapEntry(r: any): Record<string, any> {
  return {
    repo_rel_path: r.repo_rel_path || "",
    filename: r.filename || "",
    asset_kind: r.asset_kind || "",
    PartNumber: r.part_number || r.PartNumber || "",
    PartVersion: r.part_version || r.PartVersion || "",
    TypeCode: (r.type_code || r.TypeCode || "").toUpperCase(),
    ModelSeries: (r.model_series || r.ModelSeries || "").toUpperCase(),
    PartName: r.part_name || r.PartName || "",
    label: r.label || "",
    file_status: r.file_status || "present",
    last_seen_at: r.last_seen_at || "",
  };
}
