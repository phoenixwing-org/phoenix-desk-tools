import type { BomXrefCounts, CadIndexReadState, FileDetailXrefsPayload } from "../api";

/** Keep Primary and the reference panel on the same returned index revision. */
export function xrefCountsFromPayload(data: FileDetailXrefsPayload): BomXrefCounts {
  return {
    outgoing_count: data.outgoing.count,
    direct_incoming_count: data.incoming.direct_count ?? data.incoming.count,
    index_state: data.index_state,
    index_pending: data.index_pending,
    index_stale: data.index_stale,
    index_reason: data.index_reason,
    bom_index_state: data.bom_index_state,
    bom_index_pending: data.bom_index_pending,
    bom_index_stale: data.bom_index_stale,
    scan_id: data.scan_id,
    freshness_scope: data.freshness_scope,
  };
}

export function cadIndexReadStateLabel(state?: CadIndexReadState | null): string {
  if (!state) return "未检查";
  if (state.index_pending || state.bom_index_pending || state.index_state === "missing" || state.index_state === "incomplete") return "待完整扫描";
  if (state.index_stale || state.bom_index_stale || state.index_state === "stale") return "递归 BOM 待更新";
  return state.index_state === "ready" ? "已有索引" : "未检查";
}

export function cadIndexReadStateWarning(state?: CadIndexReadState | null): string {
  if (!state) return "";
  if (state.index_pending || state.bom_index_pending || state.index_state === "missing" || state.index_state === "incomplete") {
    return "索引尚未完整建立或最近扫描未完成，请在「CAD 索引」检查并更新。显示的数量不能作为完整 BOM 结果。";
  }
  if (state.index_stale || state.bom_index_stale || state.index_state === "stale") {
    return "文件或引用已变化，递归 BOM 快照待更新。下方为现有引用投影；请在「CAD 索引」完整更新后再核对 BOM 数量。";
  }
  return "";
}
