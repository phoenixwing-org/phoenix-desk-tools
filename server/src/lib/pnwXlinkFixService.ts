/** pnwXlinkFixService — 对应 Python xlink_fix_service.py (~200行)
 *
 * XLink 路径修正：分析+执行。文件 I/O 需 Rust fcstd-xlink，当前 stub。
 */

/** 对应 Python: get_xlink_prefs */
export function getXlinkPrefs(_ws: string): any { return { batch_dir: "" }; }

/** 对应 Python: save_xlink_prefs */
export function saveXlinkPrefs(_ws: string, _patch: any): any { return { batch_dir: "" }; }

/** 对应 Python: list_xlink_fix_candidates */
export function listXlinkFixCandidates(_ws: string, _basename?: string): any {
  return { candidates: [], _stub: true };
}

/** 对应 Python: analyze_xlink_fix */
export function analyzeXlinkFix(_ws: string, _opts: any): any {
  return { hosts: [], summary: {}, _stub: true };
}

/** 对应 Python: run_xlink_fix */
export function runXlinkFix(_ws: string, _opts: any): any {
  return { fixed: 0, log: "XLink 修正待迁移到 Rust fcstd-xlink", _stub: true };
}

/** 对应 Python: apply_xlink_fix_override */
export function applyXlinkFixOverride(_ws: string, _opts: any): any {
  return { applied: 0, _stub: true };
}

/** 对应 Python: part_hints_from_xlink_old_path */
export function partHintsFromXlinkPath(path: string): Record<string, string> {
  const m = path.match(/(\d{6})\.(\d{3})/);
  return m ? { PartNumber: m[1], PartVersion: m[2] } : {};
}
