<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import type { BomApplyPrefs, BomFields, BomKindFilters } from "../../api";
import {
  fetchBomDocumentKinds,
  fetchBomPrefs,
  recommendBomField,
  recommendBomFieldsAll,
  saveBom,
} from "../../api";
import { useFileDetailContext } from "../../composables/useFileDetailContext";
import { useAppShell } from "../../composables/useAppShell";
import ComboTextInput from "../ComboTextInput.vue";
import { TYPE_CODE_OPTIONS } from "../../utils/typeCodeOptions";

const EDITABLE_KEYS = [
  "PartNumber",
  "PartVersion",
  "TypeCode",
  "ModelSeries",
  "PartName",
  "label",
  "filename",
] as const;
type EditableKey = (typeof EDITABLE_KEYS)[number];

const FIELD_ROWS = [
  { key: "repo_rel_path", cn: "仓库相对路径", en: "RepoRelativePath", editable: false, recommend: false },
  { key: "filename", cn: "文件名", en: "Filename", editable: true, recommend: true },
  { key: "PartNumber", cn: "零件号", en: "PartNumber", editable: true, recommend: true },
  { key: "PartVersion", cn: "版本", en: "PartVersion", editable: true, recommend: true },
  { key: "TypeCode", cn: "类型码", en: "TypeCode", editable: true, recommend: true },
  { key: "ModelSeries", cn: "型号系列", en: "ModelSeries", editable: true, recommend: true },
  { key: "PartName", cn: "零件名称", en: "PartName", editable: true, recommend: true },
  { key: "label", cn: "标签", en: "Label", editable: true, recommend: true },
] as const;

const {
  rel,
  preview,
  form,
  baseline,
  pageError,
  reloadFile,
  openRenameTab,
  rememberFilenameDraft,
} = useFileDetailContext();
const shell = useAppShell();
const bomPrefs = ref<BomApplyPrefs | null>(null);
const initialFields = ref<Partial<BomFields>>({});
const busy = ref(false);
const recommendingField = ref<string | null>(null);
const recommendingAll = ref(false);
const kindFilters = ref<BomKindFilters>({
  part: true,
  assembly: true,
  drawing: true,
});

const isFcstd = computed(() => preview.value?.is_fcstd ?? false);
const bomReadonly = computed(() => preview.value?.bom_readonly ?? false);
const bomSourceRel = computed(() => preview.value?.bom_source_rel ?? null);
const documentKindsDisplay = computed(
  () => preview.value?.document_kinds?.display?.trim() || "",
);
const documentKindsSuffix = computed(
  () => preview.value?.document_kinds?.recommended_suffix?.trim() || "",
);

type DocKindTag = {
  key: string;
  label: string;
  tone: "part" | "assembly" | "drawing";
};

const docKindTags = computed((): DocKindTag[] => {
  const dk = preview.value?.document_kinds;
  if (!dk) return [];
  const tags: DocKindTag[] = [];
  if (dk.part) tags.push({ key: "part", label: "零件", tone: "part" });
  if (dk.assembly) tags.push({ key: "assembly", label: "装配", tone: "assembly" });
  if (dk.drawing) tags.push({ key: "drawing", label: "图纸", tone: "drawing" });
  if (tags.length) return tags;
  const display = documentKindsDisplay.value;
  if (!display || display === "未识别") return [];
  return display.split(/[、,]/).map((piece) => {
    const label = piece.trim();
    let tone: DocKindTag["tone"] = "part";
    if (label.includes("装配")) tone = "assembly";
    else if (label.includes("图纸")) tone = "drawing";
    return { key: label, label, tone };
  });
});

function openSourceModel() {
  const src = bomSourceRel.value;
  if (!src) return;
  shell.openFileDetailForRel(src, { subTab: "edit" });
}

const recommendedFillLine = () => {
  const r = bomPrefs.value?.recommended_fill;
  if (!r) return "";
  const parts = [
    r.PartNumber && `零件号 ${r.PartNumber}`,
    r.PartVersion && `版本 ${r.PartVersion}`,
    r.TypeCode && `类型 ${r.TypeCode}`,
    r.ModelSeries && `型号 ${r.ModelSeries}`,
  ].filter(Boolean);
  return parts.length ? `工作空间记忆：${parts.join(" · ")}` : "";
};

function displayInitial(key: string) {
  const v = String(initialFields.value[key as keyof BomFields] ?? "").trim();
  return v || "（空）";
}

function isDirty(key: string) {
  return (
    String(form.value[key as keyof BomFields] ?? "").trim() !==
    String(baseline.value[key as keyof BomFields] ?? "").trim()
  );
}

function patchField(key: keyof BomFields, value: string) {
  form.value = { ...form.value, [key]: value };
}

/** 类型码 S（标准件）：文件名不含型号系列，表单中型号系列置空 */
function applyStandardPartModelSeriesRule() {
  const tc = String(form.value.TypeCode ?? "").trim().toUpperCase();
  if (tc !== "S") return;
  if (String(form.value.ModelSeries ?? "").trim()) {
    patchField("ModelSeries", "");
  }
}

async function loadPrefs() {
  try {
    bomPrefs.value = await fetchBomPrefs();
  } catch {
    bomPrefs.value = null;
  }
}

watch(
  () => preview.value,
  (p) => {
    if (p) initialFields.value = { ...p.fields };
  },
  { immediate: true },
);

async function onReload() {
  shell.appendLog(`[文件详情] 从磁盘重新读取 ${rel.value}…`, { source: "file_detail", open: true });
  try {
    await reloadFile();
    shell.appendLog("[文件详情] 已从磁盘重新读取", { source: "file_detail" });
    shell.setStatus("已从磁盘重新读取");
  } catch (e) {
    shell.appendLog(String(e), { source: "file_detail" });
  }
}

async function onRecommendField(key: EditableKey) {
  if (!rel.value) return;
  if (key === "filename" && !isFcstd.value) {
    shell.setStatus("仅 FCStd 可推荐文件名");
    return;
  }
  recommendingField.value = key;
  try {
    const data = await recommendBomField(rel.value, key, form.value, kindFilters.value);
    if (data.filled && data.value) {
      patchField(key as keyof BomFields, data.value);
      if (key === "TypeCode" || key === "filename") applyStandardPartModelSeriesRule();
      shell.setStatus(`${key} ← ${data.source_note}`);
    } else if (key === "ModelSeries" && data.filled && !data.value) {
      patchField("ModelSeries", "");
      shell.setStatus(data.source_note || "标准件不含型号系列");
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
  if (!rel.value) return;
  recommendingAll.value = true;
  shell.appendLog(`[文件详情] 全部推荐属性 ${rel.value}…`, { source: "file_detail", open: true });
  try {
    const data = await recommendBomFieldsAll(rel.value, form.value, kindFilters.value);
    const next: Partial<BomFields> = { ...form.value };
    for (const key of data.filled_keys) {
      const row = data.results[key];
      if (!row?.filled) continue;
      next[key as keyof BomFields] = row.value ?? "";
    }
    form.value = { ...form.value, ...next };
    applyStandardPartModelSeriesRule();
    const filled = data.filled_keys.length;
    const msg = filled ? `全部推荐完成（${filled} 项）` : "未找到可推荐值";
    shell.appendLog(`[文件详情] ${msg}`, { source: "file_detail" });
    shell.setStatus(msg);
  } catch (e) {
    pageError.value = String(e);
    shell.appendLog(String(e), { source: "file_detail" });
  } finally {
    recommendingAll.value = false;
  }
}

async function onSave() {
  if (!rel.value || !isFcstd.value || bomReadonly.value) return;
  busy.value = true;
  const filenameDraft = (form.value.filename ?? "").trim();
  shell.appendLog(`[文件详情] 写入 Document.xml ${rel.value}…`, { source: "file_detail", open: true });
  try {
    await saveBom(rel.value, form.value);
    if (filenameDraft) rememberFilenameDraft(filenameDraft);
    shell.appendLog("[文件详情] 已写入文件（Document.xml）", { source: "file_detail" });
    shell.setStatus("已写入文件（Document.xml）");
    await reloadFile();
    await loadPrefs();
  } catch (e) {
    pageError.value = String(e);
    shell.appendLog(String(e), { source: "file_detail" });
  } finally {
    busy.value = false;
  }
}

async function onDetectKinds() {
  if (!rel.value) return;
  busy.value = true;
  shell.appendLog(`[文件详情] 识别文档类型 ${rel.value}…`, { source: "file_detail", open: true });
  try {
    const data = await fetchBomDocumentKinds(rel.value);
    if (preview.value) {
      preview.value = { ...preview.value, document_kinds: data.document_kinds };
    }
    const msg = `已识别：${data.document_kinds.display}`;
    shell.appendLog(`[文件详情] ${msg}`, { source: "file_detail" });
    shell.setStatus(msg);
  } catch (e) {
    pageError.value = String(e);
    shell.appendLog(String(e), { source: "file_detail" });
  } finally {
    busy.value = false;
  }
}

function onGoRename() {
  const name = (form.value.filename ?? "").trim();
  if (!name) {
    pageError.value = "请先填写目标文件名，或点「推荐」生成";
    return;
  }
  openRenameTab(name);
}

onMounted(() => {
  void loadPrefs();
});
</script>

<template>
  <div v-if="preview" class="attrs-panel">
    <h3 class="panel-title">编辑属性</h3>
    <p v-if="bomReadonly" class="readonly-banner">
      图纸文件 BOM 只读（属性挂载于 App::Link）。
      <template v-if="bomSourceRel">
        来源模型：
        <button type="button" class="link-btn mono" @click="openSourceModel">{{ bomSourceRel }}</button>
      </template>
      <template v-else>请在 Link 指向的模型 FCStd 中编辑。</template>
    </p>
    <section class="toolbar">
      <el-button size="small" :disabled="busy" @click="onReload">重新读取</el-button>
      <el-button
        size="small"
        :loading="recommendingAll"
        :disabled="busy || !isFcstd || bomReadonly"
        @click="onRecommendAll"
      >
        全部推荐
      </el-button>
      <el-button size="small" :disabled="busy || !isFcstd" @click="onDetectKinds">识别类型</el-button>
      <el-button
        type="primary"
        size="small"
        :loading="busy"
        :disabled="!isFcstd || bomReadonly"
        @click="onSave"
      >
        写入文件
      </el-button>
    </section>

    <section v-if="isFcstd" class="doc-kind-block">
      <div class="doc-kind-row">
        <span class="doc-kind-label">文档类型</span>
        <div v-if="docKindTags.length || documentKindsSuffix" class="doc-kind-tags">
          <span
            v-for="tag in docKindTags"
            :key="tag.key"
            class="doc-kind-tag"
            :class="`tone-${tag.tone}`"
          >
            {{ tag.label }}
          </span>
          <span v-if="documentKindsSuffix" class="doc-suffix-wrap">
            <span class="doc-suffix-label">推荐后缀</span>
            <code class="doc-suffix-tag">{{ documentKindsSuffix }}</code>
          </span>
        </div>
        <span v-else class="doc-kind-empty muted">未识别（点「识别类型」或打开文件时自动识别）</span>
      </div>
    </section>

    <section class="kind-row">
      <span class="kind-label">推荐文件名时匹配：</span>
      <el-checkbox v-model="kindFilters.part">零件</el-checkbox>
      <el-checkbox v-model="kindFilters.assembly">装配</el-checkbox>
      <el-checkbox v-model="kindFilters.drawing">图纸</el-checkbox>
    </section>

    <form class="form" @submit.prevent="onSave">
      <div class="form-head">
        <span class="col-mark" />
        <span class="col-meta">字段</span>
        <span class="col-val">值</span>
      </div>
      <div v-for="row in FIELD_ROWS" :key="row.key" class="form-row">
        <span class="col-mark" :class="{ dirty: isDirty(row.key) }">{{ isDirty(row.key) ? "●" : "" }}</span>
        <div class="col-meta">
          <span class="cn">{{ row.cn }}</span>
          <span class="en">{{ row.en }}</span>
        </div>
        <div class="col-val">
          <p v-if="row.editable" class="initial-line">初始：{{ displayInitial(row.key) }}</p>
          <div class="input-row">
            <ComboTextInput
              v-if="row.key === 'TypeCode'"
              v-model="form.TypeCode"
              :options="TYPE_CODE_OPTIONS"
              :readonly="!row.editable || bomReadonly"
            />
            <input
              v-else
              v-model="form[row.key as keyof BomFields]"
              :readonly="!row.editable || bomReadonly"
              :class="{ readonly: !row.editable || bomReadonly }"
            />
            <el-button
              v-if="row.recommend"
              size="small"
              :loading="recommendingField === row.key"
              :disabled="busy || recommendingAll || bomReadonly"
              @click="onRecommendField(row.key as EditableKey)"
            >
              推荐
            </el-button>
            <el-button
              v-if="row.key === 'filename'"
              size="small"
              :disabled="busy || !isFcstd || bomReadonly"
              @click="onGoRename"
            >
              去改名
            </el-button>
          </div>
        </div>
      </div>
    </form>

    <p v-if="recommendedFillLine()" class="hint muted">{{ recommendedFillLine() }}</p>
  </div>
</template>

<style scoped>
.attrs-panel {
  padding-top: 4px;
}
.panel-title {
  margin: 0 0 10px;
  font-size: 0.92rem;
  font-weight: 600;
}
.readonly-banner {
  margin: 0 0 10px;
  padding: 10px 12px;
  border-radius: 6px;
  border: 1px solid #bfdbfe;
  background: #eff6ff;
  font-size: 0.82rem;
  color: #1e40af;
}
.link-btn {
  padding: 0;
  border: none;
  background: none;
  color: var(--accent, #2563eb);
  cursor: pointer;
  font: inherit;
}
.link-btn:hover {
  text-decoration: underline;
}
.toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 10px;
}
.doc-kind-block {
  margin-bottom: 12px;
  padding: 10px 12px;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  background: #f8fafc;
}
.doc-kind-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px 12px;
  font-size: 0.84rem;
}
.doc-kind-label {
  font-weight: 600;
  color: #475569;
  min-width: 4.5em;
  flex-shrink: 0;
}
.doc-kind-tags {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.doc-kind-tag {
  display: inline-flex;
  align-items: center;
  padding: 3px 10px;
  border-radius: 999px;
  font-size: 0.8rem;
  font-weight: 600;
  line-height: 1.3;
  border: 1px solid transparent;
}
.doc-kind-tag.tone-part {
  color: #334155;
  background: #f1f5f9;
  border-color: #cbd5e1;
}
.doc-kind-tag.tone-assembly {
  color: #1d4ed8;
  background: #dbeafe;
  border-color: #93c5fd;
}
.doc-kind-tag.tone-drawing {
  color: #b45309;
  background: #fef3c7;
  border-color: #fcd34d;
}
.doc-suffix-wrap {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-left: 2px;
}
.doc-suffix-label {
  font-size: 0.76rem;
  color: #64748b;
}
.doc-suffix-tag {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 6px;
  font-family: var(--font-mono);
  font-size: 0.76rem;
  font-weight: 600;
  color: #0f766e;
  background: #ecfdf5;
  border: 1px solid #6ee7b7;
}
.doc-kind-empty {
  font-size: 0.82rem;
}
.kind-row {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
  margin-bottom: 12px;
  font-size: 0.82rem;
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
}
.btn.primary {
  background: var(--accent);
  color: #fff;
  border-color: var(--accent);
}
.btn:disabled {
  opacity: 0.5;
}
.form-head,
.form-row {
  display: grid;
  grid-template-columns: 20px 140px 1fr;
  gap: 10px;
  align-items: start;
}
.form-head {
  font-size: 0.78rem;
  font-weight: 600;
  color: var(--muted);
  margin-bottom: 4px;
}
.col-mark.dirty {
  color: #c2410c;
}
.col-meta .cn {
  font-size: 0.85rem;
}
.col-meta .en {
  font-size: 0.75rem;
  color: var(--muted);
}
.initial-line {
  margin: 0 0 4px;
  font-size: 0.72rem;
  color: var(--muted);
}
.input-row {
  display: flex;
  gap: 6px;
  align-items: center;
}
.input-row input,
.input-row .combo-wrap {
  flex: 1;
  min-width: 0;
}
.input-row input {
  padding: 6px 10px;
  border: 1px solid var(--border-strong);
  border-radius: 6px;
  font-size: 0.85rem;
}
.input-row input.readonly {
  background: #f3f4f6;
}
.input-row :deep(.combo-text-input) {
  font-size: 0.85rem;
  padding: 6px 10px;
}
.hint {
  margin-top: 12px;
  font-size: 0.78rem;
}
.muted {
  color: var(--muted);
}
</style>
