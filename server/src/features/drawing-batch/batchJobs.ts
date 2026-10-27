import { randomUUID } from 'node:crypto';
import { fcstdWorkspace } from '../../lib/fcstdBatchFiles.js';
import { DrawingBatchQueueError } from './errors.js';
import type { DrawingBatchJob, DrawingBatchResult } from './types.js';

type Item = { id: string; rel: string };
type Entry = { job: DrawingBatchJob; controller: AbortController; items: Item[] };
const jobs = new Map<string, Entry>();
let queue: Promise<void> = Promise.resolve();
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);

/** All batch workers share one queue, including repair and generation. */
export function startBatchJob<T extends Item>(root: string, kind: DrawingBatchJob['kind'], items: T[], worker: (item: T, signal: AbortSignal) => Promise<DrawingBatchResult>): DrawingBatchJob {
  root = fcstdWorkspace(root);
  if (!items.length || items.length > 500 || new Set(items.map(item => item.id)).size !== items.length) throw new Error('请选择 1–500 个不同的有效项目');
  const active=[...jobs.values()].filter(entry=>['queued','running'].includes(entry.job.status));
  if(active.some(entry=>entry.job.workspace===root))throw new DrawingBatchQueueError('queue_busy','当前工作空间已有批量图纸任务，请等待完成或取消');
  if(active.length>=32)throw new DrawingBatchQueueError('queue_full','批量图纸队列已满，请稍后重试');
  const controller = new AbortController();
  const job: DrawingBatchJob = { id: randomUUID(), workspace: root, kind, status: 'queued', total: items.length, completed: 0, failed: 0, cancel_requested: false, results: [] };
  jobs.set(job.id, { job, controller, items });
  for (const [id, value] of jobs) if (jobs.size > 100 && !['queued', 'running'].includes(value.job.status)) jobs.delete(id);
  const run = async () => {
    if(job.status==='cancelled')return;
    job.status = 'running';
    for (const item of items) {
      if (controller.signal.aborted) {
        job.results.push({ id: item.id, rel: item.rel, status: 'cancelled', message: '未执行：任务已取消', manual_review_required: true });
        continue;
      }
      job.active_rel = item.rel;
      let result: DrawingBatchResult;
      try { result = await worker(item, controller.signal); }
      catch (error) { result = { id: item.id, rel: item.rel, status: controller.signal.aborted ? 'cancelled' : 'failed', message: errorText(error), manual_review_required: true }; }
      job.results.push(result);
      if (result.status === 'completed') job.completed++;
      if (result.status === 'failed') job.failed++;
    }
    delete job.active_rel;
    job.status = job.completed===job.total ? 'completed' : controller.signal.aborted ? 'cancelled' : job.failed ? 'failed' : 'completed';
  };
  queue = queue.then(run, run).catch(error => { job.status = 'failed'; job.error = errorText(error); delete job.active_rel; });
  return job;
}
export function getBatchJob(root: string, id: string): DrawingBatchJob {
  const entry = jobs.get(id);
  if (!entry || entry.job.workspace !== fcstdWorkspace(root)) throw new Error('批量图纸任务不存在或不属于当前工作空间');
  return entry.job;
}
export function cancelBatchJob(root: string, id: string): DrawingBatchJob {
  const job = getBatchJob(root, id);
  if (['queued', 'running'].includes(job.status)) { const entry=jobs.get(id)!;job.cancel_requested = true;entry.controller.abort();if(job.status==='queued'){job.status='cancelled';job.results=entry.items.map(item=>({id:item.id,rel:item.rel,status:'cancelled',message:'未执行：排队任务已取消',manual_review_required:true}));} }
  return job;
}
