import { computed, onScopeDispose, ref, watch, type Ref } from "vue";
import { applyBatchAttributes, previewBatchAttributes, type BatchAttributePreview, type BatchAttributeResult } from "../api";
import type { BomNameSource } from "../utils/bomNameSource";
import { attributeDraftKey, draftStorage, readAttributeDrafts, validDraftName, type DraftStorage } from "./batchAttributeDraftCache";

export function useBatchAttributes(workspace: Ref<string>, directory: Ref<string>, overwrite: Ref<boolean>, nameSource: Ref<BomNameSource> = ref("label"), includeDrawings: Ref<boolean> = ref(false), storage: DraftStorage | undefined = draftStorage()) {
  const preview = ref<BatchAttributePreview | null>(null);
  // Retain a read-only before-write snapshot, never a reusable execution plan.
  const completedPreview = ref<BatchAttributePreview | null>(null);
  const cachedPreview = ref<BatchAttributePreview | null>(null);
  const draftNames = ref<Record<string, string>>({});
  const cacheWarning = ref("");
  const restored = computed(() => !preview.value && !completedPreview.value && !!cachedPreview.value);
  const displayPreview = computed(() => {
    const source = preview.value ?? completedPreview.value ?? cachedPreview.value;
    if (!source) return null;
    return { ...source, rows: source.rows.map(row => ({ ...row,
      ...(row.name_editable && Object.hasOwn(draftNames.value, row.rel) && !validDraftName(draftNames.value[row.rel]) ? { name_draft_invalid: true } : {}),
      changes: row.changes.map(change => {
      if (change.field !== "PartName" || !row.name_editable || !Object.hasOwn(draftNames.value, row.rel)) return change;
      const proposed = draftNames.value[row.rel]; const valid = validDraftName(proposed);
      return { ...change, proposed, source: "手工草稿", eligible: valid && proposed.trim() !== change.current, reason: valid ? proposed.trim() === change.current ? "unchanged" as const : "ready" as const : "invalid_name" as const,
        note: valid ? "手工草稿，仅应用后写入" : "零件名不能空白或仅一个英文字母，不含 .ASSY 等后缀或不安全字符（最多 255 字节）" };
    }) })) };
  });
  const completed = computed(() => completedPreview.value !== null);
  const result = ref<BatchAttributeResult | null>(null);
  const selection = ref<Record<string, string[]>>({});
  const submittedSelection = ref<Record<string, string[]>>({});
  const writing = ref(false);
  const writingFiles = ref<string[]>([]);
  const busy = ref(false); const error = ref("");
  let revision = 0;
  const cacheKey = () => attributeDraftKey(workspace.value, directory.value, overwrite.value, nameSource.value, includeDrawings.value);
  function persist() {
    const source = preview.value ?? completedPreview.value ?? cachedPreview.value;
    if (!source) return;
    if (!storage) { if (typeof window !== "undefined") cacheWarning.value = "本机草稿缓存不可用，刷新前请保留输入内容"; return; }
    try { storage.setItem(cacheKey(), JSON.stringify({ version: 1, preview: { ...source, plan_id: "" }, names: draftNames.value })); cacheWarning.value = ""; }
    catch { cacheWarning.value = "本机草稿缓存失败，刷新前请保留输入内容"; }
  }
  function reset() {
    revision++; preview.value = null; completedPreview.value = null; result.value = null; selection.value = {}; submittedSelection.value = {}; writing.value = false; writingFiles.value = []; error.value = "";
    const saved = readAttributeDrafts(storage, cacheKey()); cachedPreview.value = saved?.preview ?? null; draftNames.value = saved?.names ?? {};
  }
  watch([workspace, directory, overwrite, nameSource, includeDrawings], reset, { flush: "sync", immediate: true });
  onScopeDispose(() => { revision++; });
  function setName(rel: string, value: string) {
    if (busy.value || completed.value || submittedSelection.value[rel]?.length || !displayPreview.value?.rows.some(row => row.rel === rel && row.name_editable)) return;
    const selected = !!selection.value[rel]?.length;
    draftNames.value = { ...draftNames.value, [rel]: value };
    if (selected && validDraftName(value)) selectFile(rel, true);
    persist();
  }
  const selections = computed(() => (preview.value ? displayPreview.value?.rows || [] : []).flatMap(row => {
    if (submittedSelection.value[row.rel]?.length || row.name_draft_invalid) return [];
    const fields = row.changes.filter(change => change.eligible && selection.value[row.rel]?.includes(change.field)).map(change => change.field);
    return fields.length ? [{ rel: row.rel, fields }] : [];
  }));
  const canApply = computed(() => !!preview.value && selections.value.length > 0 && !busy.value);
  async function analyze() {
    if (busy.value) return;
    const names = draftNames.value;
    reset(); draftNames.value = names;
    const id = revision; busy.value = true;
    try {
      const data = await previewBatchAttributes(workspace.value, directory.value.trim() || ".", overwrite.value, nameSource.value, includeDrawings.value);
      if (id === revision) {
        preview.value = data;
        cachedPreview.value = null;
        selection.value = Object.fromEntries(data.rows.map(row => [row.rel, []]));
        persist();
      }
    } catch (e) { if (id === revision) error.value = String(e); }
    finally { busy.value = false; }
  }
  function selectAll(checked: boolean) {
    if (busy.value || !preview.value) return;
    selection.value = Object.fromEntries((displayPreview.value?.rows || []).map(row => [row.rel, checked && !row.name_draft_invalid && !submittedSelection.value[row.rel]?.length ? row.changes.filter(c => c.eligible).map(c => c.field) : []]));
  }
  function selectFile(rel: string, checked: boolean) {
    if (busy.value || !preview.value || submittedSelection.value[rel]?.length) return;
    const row = displayPreview.value?.rows.find(row => row.rel === rel);
    if (!row) return;
    selection.value[rel] = checked && !row.name_draft_invalid ? row.changes.filter(change => change.eligible).map(change => change.field) : [];
  }
  async function apply(expectedPlan: string) {
    if (!canApply.value || preview.value?.plan_id !== expectedPlan) return;
    const id = revision; const plan = displayPreview.value!; busy.value = true; writing.value = true; error.value = "";
    const requested = selections.value.map(withDraft);
    writingFiles.value = requested.map(row => row.rel);
    submittedSelection.value = { ...submittedSelection.value, ...Object.fromEntries(requested.map(row => [row.rel, row.fields])) };
    try {
      const data = await applyBatchAttributes(workspace.value, plan.plan_id, requested, plan.overwrite);
      if (id === revision) mergeResult(data);
    } catch (e) { if (id === revision) error.value = String(e); }
    finally {
      if (id === revision) { completedPreview.value = plan; selection.value = {}; preview.value = null; persist(); }
      writing.value = false;
      writingFiles.value = [];
      busy.value = false;
    }
  }
  function withDraft(row: { rel: string; fields: string[] }) {
    const values = row.fields.includes("PartName") && Object.hasOwn(draftNames.value, row.rel) ? { PartName: draftNames.value[row.rel] } : undefined;
    return { rel: row.rel, fields: [...row.fields], ...(values ? { values } : {}) };
  }
  function mergeResult(data: BatchAttributeResult) {
    const results = new Map(result.value?.results.map(row => [row.rel, row]));
    for (const row of data.results) { results.set(row.rel, row); if (row.status === "written") delete draftNames.value[row.rel]; }
    result.value = { results: [...results.values()] };
  }
  function rowFields(rel: string) {
    if (!preview.value || busy.value || submittedSelection.value[rel]?.length) return [];
    const row = displayPreview.value?.rows.find(row => row.rel === rel);
    return row && !row.name_draft_invalid ? row.changes.filter(change => change.eligible).map(change => change.field) : [];
  }
  async function applyOne(expectedPlan: string, rel: string) {
    const fields = rowFields(rel);
    if (!fields.length || preview.value?.plan_id !== expectedPlan) return;
    const id = revision; const ws = workspace.value; const plan = displayPreview.value!;
    const requested = withDraft({ rel, fields });
    submittedSelection.value = { ...submittedSelection.value, [rel]: fields };
    selection.value[rel] = []; busy.value = true; writing.value = true; error.value = "";
    writingFiles.value = [rel];
    try {
      const data = await applyBatchAttributes(ws, expectedPlan, [requested], plan.overwrite, true);
      if (id === revision) mergeResult(data);
    } catch (cause) { if (id === revision) error.value = `${String(cause)}；本行需重新预览核对后再试`; }
    finally {
      if (id === revision && preview.value) {
        preview.value = { ...preview.value, rows: preview.value.rows.map(row => row.rel === rel ? plan.rows.find(item => item.rel === rel)! : row) }; persist();
      }
      writing.value = false; writingFiles.value = []; busy.value = false;
    }
  }
  return { preview, displayPreview, completed, restored, cacheWarning, result, selection, submittedSelection, selections, canApply, busy, writing, writingFiles, error, analyze, apply, applyOne, rowFields, setName, selectAll, selectFile, reset };
}
