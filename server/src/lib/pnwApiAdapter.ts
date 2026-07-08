/** pnwApiAdapter — Rust/Python 字段名转换适配层
 *
 * 规则：不动前端接口。Rust 输出 snake_case → 统一转为 Python 接口格式。
 * Python 接口格式来源：phoenix/services/fcstd_map_service.py 等。
 *
 * ── 字段映射表 ────────────────────────────────
 * Rust (fcstd-query)    → Python/Frontend
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
 * file_count            → (数字)            (不变)
 * host_rel              → host_rel         (不变)
 * host_filename         → host_filename    (不变)
 * target_repo_rel_path  → target_repo_rel_path
 * link_label            → link_label
 */

/** Rust 行 → Python API 格式的 FcstdMapEntry */
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

/** Rust part key 行 → Python API 格式 */
export function toPartKeyEntry(r: any): Record<string, any> {
  return {
    part_number: r.part_number || "",
    part_version: r.part_version || "",
    part_key: [r.part_number, r.part_version].filter(Boolean).join("."),
    PartName: r.part_name || r.PartName || "",
    TypeCode: (r.type_code || r.TypeCode || "").toUpperCase(),
    ModelSeries: (r.model_series || r.ModelSeries || "").toUpperCase(),
    label: r.label || r.part_name || "",
    status: r.status || "active",
    files: r.file_count ?? 0,
    notes: r.notes || "",
  };
}

/** Rust BOM host 行 → Python API 格式 */
export function toBomHost(r: any): Record<string, any> {
  return {
    host_rel: r.host_rel || "",
    host_filename: r.host_filename || "",
    direct_children: r.direct_children ?? 0,
    total_descendants: r.total_descendants ?? 0,
    incoming_count: r.incoming_count ?? 0,
    issues_count: r.issues_count ?? 0,
  };
}
