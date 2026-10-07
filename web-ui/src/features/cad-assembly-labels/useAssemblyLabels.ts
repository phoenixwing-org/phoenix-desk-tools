import { computed, onScopeDispose, ref, watch, type Ref } from "vue";
import { ApiError } from "../../api";
import { fetchAssemblyLabelJob, previewAssemblyLabels, startAssemblyLabelJob, type LabelPreview, type LabelJob } from "./api";

export function useAssemblyLabels(workspace: Ref<string>, directory: Ref<string>) {
  const preview = ref<LabelPreview | null>(null), job = ref<LabelJob | null>(null);
  const selected = ref<string[]>([]), submitted = ref<string[]>([]);
  const requesting = ref(false), consumed = ref(false), error = ref("");
  const busy = computed(() => requesting.value || job.value?.state === "running");
  const canApply = computed(() => !!preview.value && !!selected.value.length && !consumed.value && !busy.value);
  let revision = 0, timer: ReturnType<typeof setTimeout> | undefined;
  function reset() { revision++; clearTimeout(timer); preview.value = null; job.value = null; selected.value = []; submitted.value = []; consumed.value = false; error.value = ""; }
  watch([workspace, directory], reset, { flush: "sync" }); onScopeDispose(reset);
  async function analyze() {
    if (busy.value) return;
    reset(); const epoch = revision; requesting.value = true;
    try { const data = await previewAssemblyLabels(workspace.value, directory.value); if (epoch === revision) preview.value = data; }
    catch (cause) { if (epoch === revision) error.value = String(cause); }
    finally { requesting.value = false; }
  }
  function select(rel: string, checked: boolean) {
    if (busy.value || consumed.value || !preview.value?.rows.some(row => row.rel === rel && row.eligible)) return;
    selected.value = checked ? [...new Set([...selected.value, rel])] : selected.value.filter(item => item !== rel);
  }
  function clearSelection() { if (!busy.value) selected.value = []; }
  function follow(next: LabelJob, ws: string, epoch: number) {
    if (epoch !== revision) return;
    job.value = next;
    if (next.state !== "running") { selected.value = []; return; }
    const poll = async () => {
      try { const result = await fetchAssemblyLabelJob(ws, next.id); if (epoch === revision) { error.value = ""; follow(result, ws, epoch); } }
      catch (cause) {
        if (epoch !== revision) return;
        if (cause instanceof ApiError && cause.status === 404) {
          job.value = { ...next, state: "failed", message: "任务记录不可用，请重新预览核对磁盘；不要重放旧计划" }; error.value = job.value.message; return;
        }
        error.value = `进度读取失败，后台可能仍在执行，正在重试：${String(cause)}`;
        timer = setTimeout(poll, 1500);
      }
    };
    timer = setTimeout(poll, 300);
  }
  async function apply(expectedPlan: string) {
    if (!canApply.value || preview.value?.plan_id !== expectedPlan) return;
    const ws = workspace.value, epoch = revision, rels = [...selected.value];
    requesting.value = true; consumed.value = true; submitted.value = rels; error.value = "";
    try { follow(await startAssemblyLabelJob(ws, expectedPlan, rels), ws, epoch); }
    catch (cause) { if (epoch === revision) error.value = `未确认执行结果，请重新预览核对，勿重复提交旧计划：${String(cause)}`; }
    finally { requesting.value = false; }
  }
  return { preview, job, selected, submitted, requesting, consumed, error, busy, canApply, reset, analyze, select, clearSelection, apply };
}
