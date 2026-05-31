<script setup lang="ts">
import { computed, onActivated, onDeactivated, onMounted, onUnmounted, ref, watch } from "vue";
import type { BomApplyPrefs, BomFields, BomKindFilters, BomPreview } from "../api";
import {
  fetchBom,
  fetchBomDocumentKinds,
  fetchBomPrefs,
  recommendBomField,
  saveBom,
} from "../api";
import { useAppShell } from "../composables/useAppShell";
import { usePageSession } from "../composables/usePageSession";
import { promptChoice } from "../composables/choiceDialog";

const props = defineProps<{
  workbenchTabId?: string;
}>();

const shell = useAppShell();

const SESSION_V = 1;

const EDITABLE_KEYS = [
  "PartNumber",
  "PartVersion",
  "TypeCode",
  "ModelSeries",
  "PartName",
  "label",
  "filename",
] as const;

/** 全部推荐顺序：基础字段 → 标签 → 文件名 */
const RECOMMEND_ALL_ORDER: EditableKey[] = [...EDITABLE_KEYS];

type EditableKey = (typeof EDITABLE_KEYS)[number];

const FIELD_ROWS = [
  { key: "repo_rel_path", cn: "仓库相对路径", en: "RepoRelativePath", editable: false, recommend: false },
  { key: "filename", cn: "文件名", en: "Filename", editable: true, recommend: true },
  { key: "PartNumber", cn: "零件号", en: "PartNumber", editable: true, recommend: true },
  { key: "PartVersion", cn: "版本", en: "PartVersion", editable: true, recommend: true },
  { key: "TypeCode", cn: "类型码 (H/S/R)", en: "TypeCode", editable: true, recommend: true },
  { key: "ModelSeries", cn: "型号系列", en: "ModelSeries", editable: true, recommend: true },
  { key: "PartName", cn: "零件名称", en: "PartName", editable: true, recommend: true },
  { key: "label", cn: "标签", en: "Label", editable: true, recommend: true },
] as const;

const selectedRel = ref<string | null>(null);
const originalFilename = ref("");
const preview = ref<BomPreview | null>(null);
const form = ref<Partial<BomFields>>({});
const initialFields = ref<Partial<BomFields>>({});
const baseline = ref<Partial<BomFields>>({});
const bomPrefs = ref<BomApplyPrefs | null>(null);
const loadingBom = ref(false);
const busy = ref(false);
const recommendingField = ref<string | null>(null);
const recommendingAll = ref(false);
const pageError = ref("");

const kindFilters = ref<BomKindFilters>({
  part: true,
  assembly: true,
  drawing: true,
  drawing_and_assembly: true,
});

const selectedName = computed(() => selectedRel.value?.split("/").pop() ?? "");

const recommendedFillLine = computed(() => {
  const r = bomPrefs.value?.recommended_fill;
  if (!r) return "";
  const parts = [
    r.PartNumber && `零件号 ${r.PartNumber}`,
    r.PartVersion && `版本 ${r.PartVersion}`,
    r.TypeCode && `类型 ${r.TypeCode}`,
    r.ModelSeries && `型号 ${r.ModelSeries}`,
  ].filter(Boolean);
  return parts.length ? `工作空间记忆：${parts.join(" · ")}` : "";
});

function displayInitial(key: string) {
  const v = String(initialFields.value[key as keyof BomFields] ?? "").trim();
  return v || "（空）";
}

function isDirty(key: string) {
  const cur = String(form.value[key as keyof BomFields] ?? "").trim();
  const base = String(baseline.value[key as keyof BomFields] ?? "").trim();
  return cur !== base;
}

function hasUnsavedDocumentAttrs() {
  for (const k of EDITABLE_KEYS) {
    if (k === "filename") continue;
    if (isDirty(k)) return true;
  }
  return false;
}

function setFormFields(fields: Partial<BomFields>, opts?: { resetBaseline?: boolean; resetInitial?: boolean }) {
  form.value = { ...fields };
  if (opts?.resetBaseline !== false) {
    baseline.value = { ...form.value };
  }
  if (opts?.resetInitial) {
    initialFields.value = { ...form.value };
  }
}

function patchField(key: keyof BomFields, value: string) {
  form.value = { ...form.value, [key]: value };
}

async function loadPrefs() {
  try {
    bomPrefs.value = await fetchBomPrefs();
  } catch {
    bomPrefs.value = null;
  }
}

async function confirmSwitchFile(targetRel: string): Promise<boolean> {
  if (!hasUnsavedDocumentAttrs()) return true;
  const name = selectedRel.value?.split("/").pop() ?? "当前文件";
  const next = targetRel.split("/").pop() ?? targetRel;

  const choice = await promptChoice({
    title: "切换文件",
    message: `「${name}」有尚未写入文件的属性（● 标记）。\n\n要打开「${next}」？`,
    choices: [
      { id: "save", label: "写入属性并切换", variant: "primary" },
      { id: "discard", label: "放弃修改并切换", variant: "danger" },
      { id: "cancel", label: "取消切换" },
    ],
  });

  if (choice === "cancel" || choice === null) {
    shell.setStatus("已取消切换文件");
    return false;
  }
  if (choice === "discard") return true;

  if (!selectedRel.value || !preview.value?.is_fcstd) {
    pageError.value = "当前非 FCStd，无法写入属性";
    return false;
  }
  busy.value = true;
  pageError.value = "";
  try {
    await saveBom(selectedRel.value, form.value);
    baseline.value = { ...form.value };
    shell.setStatus("已写入文件，正在切换…");
    await loadPrefs();
    return true;
  } catch (e) {
    pageError.value = String(e);
    return false;
  } finally {
    busy.value = false;
  }
}

async function loadBom(rel: string) {
  selectedRel.value = rel;
  loadingBom.value = true;
  pageError.value = "";
  if (props.workbenchTabId) {
    shell.updateTab(props.workbenchTabId, {
      title: rel.split("/").pop() ?? rel,
      subtitle: rel,
    });
  }
  try {
    const data = await fetchBom(rel);
    preview.value = data;
    originalFilename.value = data.fields.filename || rel.split("/").pop() || "";
    setFormFields(data.fields, { resetBaseline: true, resetInitial: true });
    if (data.embedded_warning) {
      shell.setStatus(`警告: ${data.embedded_warning}`);
    } else {
      shell.setStatus(data.source_note);
    }
  } catch (e) {
    pageError.value = String(e);
    preview.value = null;
  } finally {
    loadingBom.value = false;
  }
}

async function onReload() {
  if (!selectedRel.value) return;
  await loadBom(selectedRel.value);
  shell.setStatus("已从磁盘重新读取");
}

async function onRecommendField(key: EditableKey) {
  if (!selectedRel.value) return;
  if (key === "filename" && !preview.value?.is_fcstd) {
    shell.setStatus("仅 FCStd 可推荐文件名");
    return;
  }
  recommendingField.value = key;
  pageError.value = "";
  try {
    const data = await recommendBomField(selectedRel.value, key, form.value, kindFilters.value);
    if (data.filled && data.value) {
      patchField(key as keyof BomFields, data.value);
      shell.setStatus(`${key} ← ${data.source_note}`);
    } else {
      shell.setStatus(data.source_note || "未找到可推荐值");
    }
  } catch (e) {
    pageError.value = String(e);
  } finally {
    recommendingField.value = null;
  }
}

async function onRecommendAll() {
  if (!selectedRel.value) return;
  recommendingAll.value = true;
  pageError.value = "";
  let working: Partial<BomFields> = { ...form.value };
  const filled: string[] = [];
  try {
    for (const key of RECOMMEND_ALL_ORDER) {
      if (key === "filename" && !preview.value?.is_fcstd) continue;
      recommendingField.value = key;
      const data = await recommendBomField(selectedRel.value, key, working, kindFilters.value);
      if (data.filled && data.value) {
        working = { ...working, [key]: data.value };
        patchField(key as keyof BomFields, data.value);
        filled.push(key);
      }
    }
    if (filled.length) {
      shell.setStatus(`全部推荐完成（${filled.length} 项）：${filled.join(" → ")}`);
    } else {
      shell.setStatus("未找到可推荐值");
    }
  } catch (e) {
    pageError.value = String(e);
  } finally {
    recommendingField.value = null;
    recommendingAll.value = false;
  }
}

async function onSave() {
  if (!selectedRel.value || !preview.value?.is_fcstd) return;
  busy.value = true;
  pageError.value = "";
  try {
    await saveBom(selectedRel.value, form.value);
    shell.setStatus("已写入文件（Document.xml）");
    await loadBom(selectedRel.value);
    await loadPrefs();
  } catch (e) {
    pageError.value = String(e);
  } finally {
    busy.value = false;
  }
}

function onGoRename() {
  if (!selectedRel.value) return;
  const newName = (form.value.filename ?? "").trim();
  if (!newName) {
    pageError.value = "请先填写目标文件名";
    return;
  }
  if (newName === originalFilename.value) {
    shell.setStatus("文件名与磁盘相同，无需改名");
    return;
  }
  shell.openFileRenameForRel(selectedRel.value, form.value, baseline.value);
}

async function onDetectKinds() {
  if (!selectedRel.value) return;
  busy.value = true;
  pageError.value = "";
  try {
    const data = await fetchBomDocumentKinds(selectedRel.value);
    if (preview.value) {
      preview.value = { ...preview.value, document_kinds: data.document_kinds };
    }
    shell.setStatus(`已识别：${data.document_kinds.display}`);
  } catch (e) {
    pageError.value = String(e);
  } finally {
    busy.value = false;
  }
}

async function onTreeSelect(rel: string) {
  if (rel === selectedRel.value) return;
  if (!(await confirmSwitchFile(rel))) return;
  await loadBom(rel);
}

async function openPendingRel(rel: string) {
  if (selectedRel.value && rel !== selectedRel.value && !(await confirmSwitchFile(rel))) return;
  await loadBom(rel);
}

function registerTreeHandler() {
  if (!props.workbenchTabId) return;
  shell.registerTreeSelect(props.workbenchTabId, (rel) => {
    void onTreeSelect(rel);
  });
}

function unregisterTreeHandler() {
  if (!props.workbenchTabId) return;
  shell.registerTreeSelect(props.workbenchTabId, null);
}

function consumeTabPayload() {
  if (!props.workbenchTabId) return;
  const payload = shell.consumeTabPayload(props.workbenchTabId);
  const rel = payload?.bomRel?.trim();
  if (rel) void openPendingRel(rel);
}

async function hydratePageSession(snap: Record<string, unknown>): Promise<boolean> {
  if (snap.v !== SESSION_V) return false;
  if (snap.kindFilters && typeof snap.kindFilters === "object") {
    kindFilters.value = { ...kindFilters.value, ...(snap.kindFilters as BomKindFilters) };
  }
  const rel = String(snap.rel ?? "").trim();
  if (!rel) return true;
  form.value = { ...(snap.form as Partial<BomFields>) };
  baseline.value = { ...(snap.baseline as Partial<BomFields>) };
  initialFields.value = { ...(snap.initialFields as Partial<BomFields>) };
  await loadBom(rel);
  return true;
}

function applyInitialTabState() {
  if (!props.workbenchTabId) return;
  const pageState = shell.consumeTabPageState(props.workbenchTabId);
  if (pageState) {
    void hydratePageSession(pageState);
    return;
  }
  consumeTabPayload();
}

usePageSession(props.workbenchTabId, {
  serialize: () => ({
    v: SESSION_V,
    rel: selectedRel.value,
    form: form.value,
    baseline: baseline.value,
    initialFields: initialFields.value,
    kindFilters: kindFilters.value,
  }),
  hydrate: hydratePageSession,
  isDirty: hasUnsavedDocumentAttrs,
  flush: async () => {
    if (!hasUnsavedDocumentAttrs()) return true;
    if (!selectedRel.value || !preview.value?.is_fcstd) {
      pageError.value = "当前非 FCStd，无法写入属性";
      return false;
    }
    busy.value = true;
    pageError.value = "";
    try {
      await saveBom(selectedRel.value, form.value);
      baseline.value = { ...form.value };
      shell.setStatus("已写入文件");
      return true;
    } catch (e) {
      pageError.value = String(e);
      return false;
    } finally {
      busy.value = false;
    }
  },
});

watch([selectedRel, form, baseline, kindFilters], () => shell.scheduleWorkbenchSave(), { deep: true });

onMounted(() => {
  void loadPrefs();
  applyInitialTabState();
  registerTreeHandler();
});

onActivated(() => {
  registerTreeHandler();
});

onDeactivated(() => {
  /* handler 保留在 Tab map 中，由 activeTabId 路由 */
});

watch(
  () => hasUnsavedDocumentAttrs(),
  (dirty) => {
    if (props.workbenchTabId) shell.setTabDirty(props.workbenchTabId, dirty);
  },
  { immediate: true },
);

onUnmounted(() => {
  unregisterTreeHandler();
  if (props.workbenchTabId) shell.setTabDirty(props.workbenchTabId, false);
});
</script>

<template>
  <div class="page bom-page">
    <header class="page-head">
      <h1 class="page-title">属性回写</h1>
      <p class="page-desc">在右侧选择 .FCStd，编辑 BOM 字段后写入文件；可逐字段「推荐」或一次「全部推荐」。</p>
    </header>

    <div v-if="pageError" class="banner err">{{ pageError }}</div>

    <div v-if="!selectedRel" class="empty">在右侧侧栏选择 .FCStd 文件</div>
    <div v-else-if="loadingBom" class="empty">载入中…</div>
    <template v-else-if="preview">
      <div class="file-head">
        <h2 class="file-name mono">{{ selectedName }}</h2>
        <p class="meta">{{ preview.abs_path_display }}</p>
        <p v-if="preview.document_kinds" class="meta kinds">
          文档类型：{{ preview.document_kinds.display }} · 后缀
          {{ preview.document_kinds.recommended_suffix }}
        </p>
        <p v-else class="meta">文档类型：—（非 FCStd 或未识别）</p>
      </div>

      <section class="toolbar">
        <button type="button" class="btn" :disabled="busy" @click="onReload">重新读取</button>
        <button
          type="button"
          class="btn recommend-all"
          :disabled="busy || recommendingAll || !preview.is_fcstd"
          @click="onRecommendAll"
        >
          {{ recommendingAll ? "推荐中…" : "全部推荐" }}
        </button>
        <button type="button" class="btn" :disabled="busy || !preview.is_fcstd" @click="onDetectKinds">
          识别类型
        </button>
        <button type="button" class="btn primary" :disabled="busy || !preview.is_fcstd" @click="onSave">
          {{ busy ? "…" : "写入文件" }}
        </button>
      </section>

      <div v-if="!preview.is_fcstd" class="banner warn">当前非 FCStd，仅展示推断字段</div>

      <section class="kind-row">
        <span class="kind-label">推荐文件名时匹配：</span>
        <label class="chk"><input v-model="kindFilters.part" type="checkbox" /> 零件</label>
        <label class="chk"><input v-model="kindFilters.assembly" type="checkbox" /> 装配</label>
        <label class="chk"><input v-model="kindFilters.drawing" type="checkbox" /> 图纸</label>
        <label class="chk">
          <input v-model="kindFilters.drawing_and_assembly" type="checkbox" /> 图纸+装配
        </label>
      </section>

      <div class="form-scroll">
        <form class="form" @submit.prevent="onSave">
          <div class="form-head">
            <span class="col-mark" />
            <span class="col-meta">字段</span>
            <span class="col-val">值</span>
            <span class="col-act" />
          </div>
          <div v-for="row in FIELD_ROWS" :key="row.key" class="form-row">
            <span class="col-mark" :class="{ dirty: isDirty(row.key) }">
              {{ isDirty(row.key) ? "●" : "" }}
            </span>
            <div class="col-meta">
              <span class="cn">{{ row.cn }}</span>
              <span class="en">{{ row.en }}</span>
            </div>
            <div class="col-val">
              <p v-if="row.editable" class="initial-line">
                初始：{{ displayInitial(row.key) }}
              </p>
              <div class="input-row">
                <input
                  v-model="form[row.key as keyof BomFields]"
                  :readonly="!row.editable"
                  :class="{ readonly: !row.editable }"
                />
                <button
                  v-if="row.recommend"
                  type="button"
                  class="btn mini recommend"
                  :disabled="
                    busy ||
                    recommendingAll ||
                    recommendingField === row.key ||
                    (row.key === 'filename' && !preview.is_fcstd)
                  "
                  @click="onRecommendField(row.key as EditableKey)"
                >
                  {{ recommendingField === row.key ? "…" : "推荐" }}
                </button>
                <button
                  v-if="row.key === 'filename'"
                  type="button"
                  class="btn mini"
                  :disabled="busy || !preview.is_fcstd"
                  @click="onGoRename"
                >
                  改名
                </button>
              </div>
            </div>
            <span class="col-act" />
          </div>
        </form>

        <section class="help-panel">
          <h3 class="help-title">说明</h3>
          <ul class="help-list">
            <li>{{ preview.source_note }}</li>
            <li v-if="recommendedFillLine">{{ recommendedFillLine }}</li>
            <li>
              <strong>全部推荐</strong>按顺序填充：零件号 → 版本 → 类型 → 型号 → 零件名称 → 标签 → 文件名（后项会用前项结果）。
            </li>
            <li>
              <strong>Label</strong>：建立索引时优先保留文件内已有 Label；「推荐」按
              PartNumber.PartVersion-PartName（如 100001.001-拉力机2），不含类型码/型号。
            </li>
            <li>仅更新当前字段，不会清空其他已填内容。</li>
            <li>输入框<strong>右键</strong>恢复为打开/重新读取时的初始值（● 表示相对初始值有改动）。</li>
            <li>「写入文件」将 BOM 属性写回 FCStd；「改名」改磁盘文件名。有 ● 未保存属性时，改名会询问是否<strong>写入并改名</strong>。</li>
            <li>写入成功后工作空间记忆会更新（零件号 +1、版本 001、类型 H 等），供下次推荐。</li>
          </ul>
        </section>
      </div>
    </template>
  </div>
</template>

<style scoped>
.bom-page {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding: 20px 24px 16px;
  max-width: 960px;
  height: 100%;
}

.page-head {
  flex-shrink: 0;
  margin-bottom: 12px;
}

.page-title {
  margin: 0 0 4px;
  font-size: 1.15rem;
}

.page-desc {
  margin: 0;
  font-size: 0.85rem;
  color: var(--muted);
  line-height: 1.55;
}

.empty {
  padding: 32px 0;
  color: var(--muted);
}

.file-head {
  flex-shrink: 0;
  margin-bottom: 10px;
}

.file-name {
  margin: 0 0 6px;
  font-size: 1rem;
}

.meta {
  margin: 0;
  font-size: 0.82rem;
  color: var(--muted);
}

.meta.kinds {
  color: #0369a1;
  margin-top: 4px;
}

.toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 10px;
  flex-shrink: 0;
}

.kind-row {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
  margin-bottom: 12px;
  font-size: 0.82rem;
  flex-shrink: 0;
}

.kind-label {
  color: var(--muted);
}

.chk {
  display: flex;
  align-items: center;
  gap: 4px;
}

.btn {
  padding: 6px 12px;
  border-radius: 6px;
  border: 1px solid var(--border-strong);
  background: var(--btn-bg);
  font-size: 0.82rem;
}

.btn.mini {
  padding: 4px 10px;
  font-size: 0.78rem;
  flex-shrink: 0;
}

.btn.recommend {
  min-width: 52px;
}

.btn.recommend-all {
  font-weight: 600;
}

.btn.primary {
  background: var(--accent);
  color: #fff;
  border-color: var(--accent);
}

.btn:disabled {
  opacity: 0.5;
}

.banner {
  padding: 8px 12px;
  border-radius: 6px;
  font-size: 0.85rem;
  margin-bottom: 10px;
  flex-shrink: 0;
}

.banner.warn {
  background: #fff7ed;
  color: #9a3412;
}

.banner.err {
  background: #fef2f2;
  color: #b91c1c;
}

.form-scroll {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding-bottom: 12px;
}

.form {
  display: grid;
  gap: 0;
  align-content: start;
}

.form-head,
.form-row {
  display: grid;
  grid-template-columns: 20px 160px 1fr 0;
  gap: 10px;
  align-items: start;
}

.form-head {
  font-size: 0.78rem;
  font-weight: 600;
  color: var(--muted);
  margin-bottom: 4px;
  position: sticky;
  top: 0;
  background: var(--page-bg);
  z-index: 1;
  padding-bottom: 4px;
}

.col-mark {
  text-align: center;
  color: #c2410c;
  font-size: 1rem;
  line-height: 1.6rem;
}

.col-mark.dirty {
  font-weight: 700;
}

.col-meta {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding-top: 4px;
}

.col-meta .cn {
  font-size: 0.85rem;
}

.col-meta .en {
  font-size: 0.75rem;
  color: var(--muted);
  font-family: var(--font-mono);
}

.initial-line {
  margin: 0 0 4px;
  font-size: 0.72rem;
  color: var(--muted);
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
}

.input-row {
  display: flex;
  align-items: center;
  gap: 6px;
}

.col-val input {
  flex: 1;
  min-width: 0;
  padding: 6px 10px;
  border: 1px solid var(--border-strong);
  border-radius: 6px;
  font-size: 0.85rem;
}

.col-val input.readonly {
  background: #f3f4f6;
}

.help-panel {
  margin-top: 16px;
  padding: 12px 14px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: #fff;
}

.help-title {
  margin: 0 0 8px;
  font-size: 0.88rem;
}

.help-list {
  margin: 0;
  padding-left: 1.1rem;
  font-size: 0.8rem;
  color: var(--muted);
  line-height: 1.55;
}

.help-list li + li {
  margin-top: 6px;
}

.mono {
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
}
</style>
