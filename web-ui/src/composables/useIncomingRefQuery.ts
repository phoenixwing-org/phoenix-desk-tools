import { ref } from "vue";
import { useAppShell } from "./useAppShell";
import { useWorkspaceFileQuery } from "./useWorkspaceFileQuery";
import {
  buildRenameAnalyzeParams,
  describeIncomingTargetQuery,
  formatIncomingHostSummary,
  incomingQueryToBasename,
  resolveIncomingTargetQuery,
  type TargetFileQuery,
} from "../utils/workspaceFileQuery";

export type IncomingRefLogSource = "bom_xref" | "file_rename";

const LOG_PREFIX: Record<IncomingRefLogSource, string> = {
  bom_xref: "BOM引用",
  file_rename: "改名分析",
};

/** 入向引用查询共用：树选 + 搜索框 + 传递闭包 + 日志/摘要 */
export function useIncomingRefQuery(
  workbenchTabId?: string,
  logSource: IncomingRefLogSource = "bom_xref",
) {
  const shell = useAppShell();
  const fileQuery = useWorkspaceFileQuery(workbenchTabId);
  const includeTransitive = ref(true);

  function resolveIncomingQuery(): TargetFileQuery | null {
    return resolveIncomingTargetQuery(fileQuery.queryText.value, fileQuery.pickedRel.value);
  }

  function logIncoming(line: string, opts?: { open?: boolean }) {
    shell.appendLog(`[${LOG_PREFIX[logSource]}] ${line}`, {
      source: logSource,
      open: opts?.open ?? true,
    });
  }

  function transitiveLabel() {
    return includeTransitive.value ? "含传递闭包" : "仅直接";
  }

  function logIncomingStart(q: TargetFileQuery | null, actionLabel = "查询") {
    if (!q) return;
    logIncoming(`开始 ${actionLabel} · ${describeIncomingTargetQuery(q)} · ${transitiveLabel()}`);
  }

  function   formatHostSummary(opts: {
    hostCount: number;
    directHostCount?: number;
    edgeCount?: number;
    hitCount?: number;
    pendingHitCount?: number;
    mode?: "query" | "analyze";
  }) {
    return formatIncomingHostSummary({
      ...opts,
      transitive: includeTransitive.value,
    });
  }

  return {
    queryText: fileQuery.queryText,
    pickedRel: fileQuery.pickedRel,
    clearPickedOnInput: fileQuery.clearPickedOnInput,
    applyTreeSelection: fileQuery.applyTreeSelection,
    registerTreeSelectHandler: fileQuery.registerTreeSelectHandler,
    unregisterTreeSelectHandler: fileQuery.unregisterTreeSelectHandler,
    includeTransitive,
    resolveIncomingQuery,
    describeIncomingQuery: describeIncomingTargetQuery,
    buildRenameAnalyzeParams,
    incomingQueryToBasename,
    formatHostSummary,
    logIncoming,
    logIncomingStart,
    transitiveLabel,
    setStatus: shell.setStatus,
  };
}
