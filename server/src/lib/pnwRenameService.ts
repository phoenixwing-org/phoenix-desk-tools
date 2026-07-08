/** pnwRenameService — 对应 Python:
 *   rename_analysis_service.py (~400行) + rename_ref_service.py (~200行)
 *
 * 改名引用分析：查询→分析→修正 XLink。
 * 文件 I/O 部分需 Rust fcstd-xlink，当前 stub。
 */

// ── rename_ref_service.py ──────────────────────────────

/** 对应 Python: load_file_rename_context */
export function loadFileRenameContext(_ws: string, _rel: string): any {
  return { rel_path: "", preview: null, _stub: true };
}

/** 对应 Python: execute_file_rename */
export function executeFileRename(_ws: string, _rel: string, _newFilename: string, _current: any): any {
  return { rel_path: "", rename_log_id: null, _stub: true };
}

/** 对应 Python: preview_rename_unsaved */
export function previewRenameUnsaved(baseline: Record<string, string>, current: Record<string, string>): any {
  const changed = Object.keys(baseline).some(k => baseline[k] !== current[k]);
  return { has_unsaved_document_attrs: changed };
}

// ── rename_analysis_service.py ─────────────────────────

/** 对应 Python: list_rename_logs_payload */
export function listRenameLogs(_ws: string): any { return { entries: [], _stub: true }; }

/** 对应 Python: analyze_rename_references */
export function analyzeRenameReferences(_ws: string, _oldRel: string, _newRel: string): any {
  return { hosts: [], _stub: true };
}

/** 对应 Python: apply_rename_analysis_corrections */
export function applyRenameCorrections(_ws: string, _corrections: any[]): any {
  return { applied: 0, _stub: true };
}

/** 对应 Python: load_rename_analysis */
export function loadRenameAnalysis(_ws: string, _logId: number): any {
  return { hosts: [], _stub: true };
}

/** 对应 Python: export_rename_analysis_report */
export function exportRenameReport(_ws: string, _logId: number): any {
  return { path: "", _stub: true };
}
