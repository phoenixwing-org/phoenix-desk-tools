import { randomUUID } from "node:crypto";
import { fcstdWorkspace } from "../../lib/fcstdBatchFiles.js";
import { renameNames, type RenameProgress } from "./service.js";

type Result = Awaited<ReturnType<typeof renameNames>>;
export type RenameJob = RenameProgress & {
  id: string; state: "running" | "done" | "attention" | "failed";
  message: string; index_update?: Result["index_update"];
};
const jobs = new Map<string, { root: string; data: RenameJob }>();

/** Background execution survives a disconnected client; status is read-only.
 * Jobs are bounded in memory. A server restart requires disk/log reconciliation,
 * never automatic replay of a consumed confirmation. */
export function startRenameJob(workspace: string, body: Parameters<typeof renameNames>[1]) {
  const root = fcstdWorkspace(workspace);
  if ([...jobs.values()].some(job => job.root === root && job.data.state === "running")) throw new Error("当前工作空间已有批量改名任务，请等待完成");
  while (jobs.size >= 20) {
    const old = [...jobs].find(([, job]) => job.data.state !== "running");
    if (!old) throw new Error("批量任务过多，请等待完成");
    jobs.delete(old[0]);
  }
  const data: RenameJob = { id: randomUUID(), state: "running", completed: 0, total: body?.rels?.length || 0, current_rel: "", results: [], message: "正在校验并备份" };
  // Synchronous preflight errors reject the request before a job is accepted.
  const execution = renameNames(root, body, progress => {
    Object.assign(data, progress);
    data.message = `逐项改名与引用修正：${progress.completed} / ${progress.total}`;
  });
  jobs.set(data.id, { root, data });
  void execution.then(result => {
    Object.assign(data, result);
    data.completed = result.results.filter(row => row.status !== "skipped").length;
    data.current_rel = "";
    data.state = result.results.every(row => row.status === "renamed") ? "done" : "attention";
    const done = result.results.filter(row => row.status === "renamed").length;
    const skipped = result.results.filter(row => row.status === "skipped").length;
    data.message = data.state === "done" ? `逐项改名与引用修正完成：${done} 项` : `处理结束：完成 ${done} 项，需确认 ${result.results.length - done - skipped} 项${skipped ? `，全局安全检查阻止 ${skipped} 项（原因见逐项日志）` : "；其余项目已继续处理"}`;
  }).catch(error => {
    data.state = "failed";
    data.message = `批量任务异常，保留已完成结果；请核对改名记录：${error instanceof Error ? error.message : String(error)}`;
  });
  return structuredClone(data);
}

export function getRenameJob(workspace: string, id: string) {
  const job = jobs.get(id);
  if (!job || job.root !== fcstdWorkspace(workspace)) throw new Error("任务不存在或不属于当前工作空间；服务重启后请核对磁盘和改名记录，勿重复提交旧计划");
  return structuredClone(job.data);
}
