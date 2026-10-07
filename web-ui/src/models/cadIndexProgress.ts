import type { CadIndexScanJob } from "../api";
import type { PagePrimaryProgress } from "../composables/usePagePrimaryContribution";

export function cadIndexProgress(job?: Pick<CadIndexScanJob, "state" | "phase" | "scanned" | "message"> | null): PagePrimaryProgress {
  return {
    label: "CAD 索引更新", state: job?.state || "idle", completed: job?.scanned,
    detail: job?.message || "扫描整个工作空间；成功后统一提交，不修改 CAD 文件",
    stages: ["读取文件", "核对快照", "提交索引"],
    activeStage: job ? Math.max(0, ["reading", "checking", "committing"].indexOf(job.phase)) : undefined,
    // Reading discovers files incrementally. Do not invent a percentage from
    // the old index count, which can differ after additions/deletions.
  };
}
