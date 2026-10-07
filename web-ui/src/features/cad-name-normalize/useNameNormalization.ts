import { computed, onScopeDispose, ref, watch, type Ref } from "vue";
import { analyzeNames, previewNames, startRenameJob, fetchRenameJob, writeNames, type AttributeResults, type NamePreview, type NameRow, type RenameAnalysis, type RenameResults, type RenameOptions, type IndexUpdate, type RenameJob } from "./api";
import { fetchCadIndexScan } from "../../api";
import type { BomNameSource } from "../../utils/bomNameSource";

export function useNameNormalization(workspace: Ref<string>, directory: Ref<string>, options?: Ref<RenameOptions>, nameSource: Ref<BomNameSource> = ref("label"), mode: Ref<"models" | "drawings"> = ref("models"), onRenameFinished?: (workspace: string) => void) {
  const preview = ref<NamePreview | null>(null);
  const attributes = ref<AttributeResults | null>(null);
  const analysis = ref<RenameAnalysis | null>(null);
  const renamed = ref<RenameResults | null>(null);
  const renameJob = ref<RenameJob | null>(null);
  const indexUpdate = ref<IndexUpdate | null>(null);
  const indexing = computed(() => indexUpdate.value?.state === "running");
  let pollTimer: ReturnType<typeof setTimeout> | undefined;
  const selected = ref<string[]>([]); const renameSelected = ref<string[]>([]);
  const attributeSubmitted = ref<string[]>([]); const renameSubmitted = ref<string[]>([]);
  const attributeDone = ref(false); const renameDone = ref(false);
  const requesting = ref(false); const action = ref(""); const error = ref("");
  const busy = computed(() => requesting.value || renameJob.value?.state === "running");
  let renamePollTimer: ReturnType<typeof setTimeout> | undefined;
  let revision = 0;
  function reset() {
    revision++; preview.value = null; attributes.value = null; analysis.value = null; renamed.value = null;
    selected.value = []; renameSelected.value = []; attributeSubmitted.value = []; renameSubmitted.value = [];
    attributeDone.value = false; renameDone.value = false; error.value = "";
    clearTimeout(pollTimer); indexUpdate.value = null;
    clearTimeout(renamePollTimer); renameJob.value = null;
  }
  watch([workspace, directory, nameSource, mode], reset, { flush: "sync" }); onScopeDispose(reset);
  if (options) watch(options, () => {
    if (busy.value || renameDone.value) return;
    analysis.value = null; renameSelected.value = []; renamed.value = null; renameSubmitted.value = [];
  }, { deep: true, flush: "sync" });
  const canWrite = computed(() => mode.value !== "drawings" && !!preview.value && !attributeDone.value && selected.value.length > 0 && !busy.value && !indexing.value);
  const canAnalyze = computed(() => (!!attributes.value?.prepared_id || (!attributeDone.value && !!preview.value?.rows.length)) && !renameDone.value && !busy.value && !indexing.value);
  const canRename = computed(() => !!analysis.value && renameSelected.value.length > 0 && !renameDone.value && !busy.value && !indexing.value);
  function followIndex(job: IndexUpdate | undefined, epoch: number) {
    if (!job || epoch !== revision) return;
    indexUpdate.value = job;
    if (job.state !== "running") return;
    const ws = workspace.value;
    pollTimer = setTimeout(async () => {
      try { const next = await fetchCadIndexScan(ws, job.id); if (epoch === revision) followIndex(next, epoch); }
      catch (cause) { if (epoch === revision) indexUpdate.value = { state: "failed", message: `索引状态读取失败：${String(cause)}；任务可能仍在运行，请打开 CAD 索引核对` }; }
    }, 500);
  }
  async function run(name: string, operation: (id: number) => Promise<void>) {
    if (busy.value || indexing.value) return;
    const id = revision; requesting.value = true; action.value = name; error.value = "";
    try { await operation(id); } catch (cause) { if (id === revision) error.value = String(cause); }
    finally { requesting.value = false; if (renameJob.value?.state !== "running") action.value = ""; }
  }
  async function analyzePreview() {
    if (busy.value || indexing.value) return;
    reset();
    await run("preview", async id => {
      const data = await previewNames(workspace.value, directory.value, nameSource.value, mode.value);
      if (id === revision) preview.value = data;
    });
  }
  function select(rel: string, checked: boolean, phase: "attributes" | "rename" = "attributes") {
    if (busy.value || (phase === "attributes" ? attributeDone.value : renameDone.value)) return;
    const rows = phase === "attributes" ? preview.value?.rows : analysis.value?.rows;
    if (!rows?.some(row => row.rel === rel && row.eligible)) return;
    const selection = phase === "attributes" ? selected : renameSelected;
    selection.value = checked ? [...new Set([...selection.value, rel])] : selection.value.filter(value => value !== rel);
  }
  function selectAll(checked: boolean, phase: "attributes" | "rename" = "attributes") {
    const rows = phase === "attributes" ? preview.value?.rows : analysis.value?.rows;
    for (const row of rows || []) select(row.rel, checked, phase);
  }
  async function write(expectedPlan: string) {
    if (!canWrite.value || preview.value?.plan_id !== expectedPlan) return;
    analysis.value = null; renameSelected.value = []; renameSubmitted.value = [];
    const rels = [...selected.value]; attributeSubmitted.value = rels;
    await run("attributes", async id => {
      try { const data = await writeNames(workspace.value, expectedPlan, rels); if (id === revision) { attributes.value = data; followIndex(data.index_update, id); } }
      finally { if (id === revision) { attributeDone.value = true; selected.value = []; } }
    });
  }
  async function analyzeRename() {
    if (!canAnalyze.value) return;
    const source = attributes.value?.prepared_id ? { prepared_id: attributes.value.prepared_id } : { plan_id: preview.value!.plan_id };
    analysis.value = null; renameSelected.value = [];
    await run("analyze", async id => { const data = await analyzeNames(workspace.value, source, options?.value); if (id === revision) analysis.value = data; });
  }
  /** Submit a confirmed server plan; no filesystem operation runs in the View. */
  function followRename(job: RenameJob, ws: string, epoch: number) {
    if (epoch !== revision) return;
    renameJob.value = job; renamed.value = { results: job.results, index_update: job.index_update };
    if (job.state !== "running") {
      action.value = ""; renameDone.value = true; renameSelected.value = [];
      attributeDone.value = true; selected.value = []; followIndex(job.index_update, epoch);
      // One filesystem refresh for the whole batch, independent of CAD-index completion.
      onRenameFinished?.(ws);
      if (job.state === "failed") error.value = job.message;
      return;
    }
    const poll = async () => {
      try { const next = await fetchRenameJob(ws, job.id); if (epoch === revision) { error.value = ""; followRename(next, ws, epoch); } }
      catch (cause) {
        if (epoch !== revision) return;
        error.value = `读取改名进度失败：${String(cause)}；后台可能仍在执行，正在重试，请勿重复改名`;
        renamePollTimer = setTimeout(poll, 1500);
      }
    };
    renamePollTimer = setTimeout(poll, 300);
  }
  async function submitRenamePlan(expectedAnalysis: string) {
    if (!canRename.value || analysis.value?.analysis_id !== expectedAnalysis) return;
    const rels = [...renameSelected.value]; renameSubmitted.value = rels;
    await run("rename", async id => {
      const ws = workspace.value;
      try { const data = await startRenameJob(ws, expectedAnalysis, rels); followRename(data, ws, id); }
      catch (cause) {
        // A lost POST response is not permission to replay the write.
        if (id === revision) { renameDone.value = true; attributeDone.value = true; renameSelected.value = []; selected.value = []; onRenameFinished?.(ws); }
        throw cause;
      }
    });
  }
  function attributeStatus(row: NameRow) {
    const result = attributes.value?.results.find(item => item.rel === row.rel);
    if (result) return result.message;
    if (attributeSubmitted.value.includes(row.rel)) return action.value === "attributes" ? "写入中" : "写入结果待确认，请重新预览核对";
    if (attributeDone.value && row.eligible) return "未勾选，未写入";
    return row.message;
  }
  function renameStatus(rel: string) {
    const result = renamed.value?.results.find(item => item.rel === rel);
    if (result) return result.message;
    if (renameSubmitted.value.includes(rel)) return action.value === "rename" ? "改名中" : "改名结果待确认，请核对磁盘与改名记录";
    if (renameDone.value) return "未勾选，未改名";
    return analysis.value?.rows.find(row => row.rel === rel)?.message || "尚未分析改名";
  }
  return { preview, attributes, analysis, renamed, renameJob, indexUpdate, indexing, selected, renameSelected, attributeSubmitted, renameSubmitted, attributeDone, renameDone, busy, action, error, canWrite, canAnalyze, canRename,
    analyzePreview, select, selectAll, write, analyzeRename, submitRenamePlan, attributeStatus, renameStatus };
}
