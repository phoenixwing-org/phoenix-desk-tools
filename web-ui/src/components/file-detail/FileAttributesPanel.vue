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
import { useDrawingBomReadonly } from "../../composables/useDrawingBomReadonly";
import { useAppShell } from "../../composables/useAppShell";
import ComboTextInput from "phoenix-wing/components/PnwComboTextInput.vue";
import { TYPE_CODE_OPTIONS } from "../../utils/typeCodeOptions";
import { bomNameSourceOptions, bomNameSourceHint, type BomNameSource } from "../../utils/bomNameSource";

const emit = defineEmits<{ "busy-change": [busy: boolean] }>();

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
  rememberFilenameDraft,
} = useFileDetailContext();
const shell = useAppShell();
const {
  bomReadonly,
  attrsPanelTitle,
  canOpenSourceModel,
  openSourceModel,
  readonlyDescription,
} = useDrawingBomReadonly(preview);
const visibleFieldRows = computed(() => bomReadonly.value ? FIELD_ROWS.filter(row => row.key === "filename") : FIELD_ROWS);
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

const bomPrefs = ref<BomApplyPrefs | null>(null);
const initialFields = ref<Partial<BomFields>>({});
const busy = ref(false);
const recommendingField = ref<string | null>(null);
const recommendingAll = ref(false);
const operationsBusy = computed(() => busy.value || recommendingAll.value || !!recommendingField.value);
const partNameRecommendDisabled = computed(() => operationsBusy.value || bomReadonly.value || !rel.value);
const nameSource = ref<BomNameSource>("label");
const kindFilters = ref<BomKindFilters>({
  part: true,
  assembly: true,
  drawing: true,
});

const isFcstd = computed(() => preview.value?.is_fcstd ?? false);

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
  if (bomReadonly.value && key !== "filename") return false;
  return (
    String(form.value[key as keyof BomFields] ?? "").trim() !==
    String(baseline.value[key as keyof BomFields] ?? "").trim()
  );
}

function patchField(key: keyof BomFields, value: string) {
  form.value = { ...form.value, [key]: value };
}

function onRestoreField(key: EditableKey) {
  if (busy.value || recommendingAll.value || recommendingField.value || (bomReadonly.value && key !== "filename")) return;
  patchField(key as keyof BomFields, String(initialFields.value[key as keyof BomFields] ?? ""));
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
  if (operationsBusy.value) return;
  shell.appendLog(`[文件详情] 从磁盘重新读取 ${rel.value}…`, { source: "file_detail", open: true });
  try {
    await reloadFile();
    shell.appendLog("[文件详情] 已从磁盘重新读取", { source: "file_detail" });
    shell.setStatus("已从磁盘重新读取");
  } catch (e) {
    shell.appendLog(String(e), { source: "file_detail" });
  }
}

async function onRecommendField(key: EditableKey, explicitSource?: BomNameSource) {
  if (!rel.value || operationsBusy.value) return;
  if (bomReadonly.value && key !== "filename") return;
  if (key === "filename" && !isFcstd.value) {
    shell.setStatus("仅 FCStd 可推荐文件名");
    return;
  }
  pageError.value = "";
  const requestRel = rel.value;
  const requestPreview = preview.value;
  const requestFields = { ...form.value };
  const requestValues = EDITABLE_KEYS.map(field => String(requestFields[field] ?? ""));
  const isCurrentRequest = () => rel.value === requestRel && preview.value === requestPreview &&
    EDITABLE_KEYS.every((field, index) => String(form.value[field] ?? "") === requestValues[index]);
  recommendingField.value = key;
  try {
    const data = key === "PartName" && explicitSource
      ? await recommendBomField(requestRel, key, requestFields, kindFilters.value, explicitSource, true)
      : await recommendBomField(requestRel, key, requestFields, kindFilters.value, nameSource.value);
    // Compare scalar drafts, not form identity: stores may replace an unchanged
    // form object, while any edited input can invalidate a recommendation formula.
    if (!isCurrentRequest()) {
      shell.setStatus("推荐已过期，请重试");
      return;
    }
    if (data.filled && data.value) {
      patchField(key as keyof BomFields, data.value);
      if (!bomReadonly.value && (key === "TypeCode" || key === "filename")) applyStandardPartModelSeriesRule();
      shell.setStatus(`${key} ← ${data.source_note}`);
    } else if (key === "ModelSeries" && data.filled && !data.value) {
      patchField("ModelSeries", "");
      shell.setStatus(data.source_note || "标准件不含型号系列");
    } else {
      shell.setStatus(data.source_note || "未找到可推荐值");
    }
  } catch (e) {
    if (!isCurrentRequest()) shell.setStatus("推荐已过期，请重试");
    else pageError.value = String(e);
  } finally {
    recommendingField.value = null;
  }
}

async function onRecommendPartName(command: unknown) {
  if (command === "default") await onRecommendField("PartName");
  else if (command === "filename" || command === "label") await onRecommendField("PartName", command);
}

async function onRecommendAll() {
  if (!rel.value || bomReadonly.value || operationsBusy.value) return;
  recommendingAll.value = true;
  shell.appendLog(`[文件详情] 全部推荐属性 ${rel.value}…`, { source: "file_detail", open: true });
  try {
    const data = await recommendBomFieldsAll(rel.value, form.value, kindFilters.value, nameSource.value);
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
  if (!rel.value || !isFcstd.value || bomReadonly.value || operationsBusy.value) return;
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
  if (!rel.value || operationsBusy.value) return;
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

watch(() => busy.value || recommendingAll.value || !!recommendingField.value,
  value => emit("busy-change", value), { flush: "sync" });

onMounted(() => {
  void loadPrefs();
});
</script>

<template>
  <div v-if="preview" class="attrs-panel">
    <header class="file-panel-header">
      <h3 class="panel-title">{{ attrsPanelTitle }}</h3>
      <div class="file-panel-actions">
        <el-button v-if="canOpenSourceModel" type="primary" size="small" @click="openSourceModel">
          打开模型
        </el-button>
        <el-button size="small" :disabled="operationsBusy" @click="onReload">重新读取</el-button>
        <el-button
          v-if="!bomReadonly"
          size="small"
          :loading="recommendingAll"
          :disabled="operationsBusy || !isFcstd || bomReadonly"
          @click="onRecommendAll"
        >
          全部推荐
        </el-button>
        <el-button size="small" :disabled="operationsBusy || !isFcstd" @click="onDetectKinds">识别类型</el-button>
        <el-button
          v-if="!bomReadonly"
          type="primary"
          size="small"
          :loading="busy"
          :disabled="operationsBusy || !isFcstd || bomReadonly"
          @click="onSave"
        >
          写入文件
        </el-button>
      </div>
    </header>

    <section class="attribute-options" aria-label="文档类型与文件名推荐选项">
      <div v-if="!bomReadonly" class="kind-row" :title="bomNameSourceHint">
        <span class="kind-label">名称补全来源</span>
        <el-radio-group v-model="nameSource" size="small" aria-label="名称补全来源" :disabled="busy || recommendingAll || !!recommendingField || bomReadonly">
          <el-radio-button v-for="option in bomNameSourceOptions" :key="option.value" :value="option.value">{{ option.label }}</el-radio-button>
        </el-radio-group>
        <small class="muted">已有 PartName 优先</small>
      </div>
      <div v-if="isFcstd" class="doc-kind-row">
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
      <div v-if="!bomReadonly" class="kind-row">
        <span class="kind-label">文件名匹配</span>
        <el-checkbox v-model="kindFilters.part" size="small">零件</el-checkbox>
        <el-checkbox v-model="kindFilters.assembly" size="small">装配</el-checkbox>
        <el-checkbox v-model="kindFilters.drawing" size="small">图纸</el-checkbox>
      </div>
    </section>

    <p v-if="bomReadonly" class="hint muted" role="status">{{ readonlyDescription }}</p>
    <form class="attribute-form" @submit.prevent="onSave">
      <div class="attribute-columns" aria-hidden="true">
        <span>名称</span>
        <span>原值</span>
        <span>编辑值</span>
        <span>操作</span>
      </div>
      <div
        v-for="row in visibleFieldRows"
        :key="row.key"
        class="attribute-field"
        role="group"
        :aria-label="row.cn"
      >
        <span class="field-label" :title="`${row.cn} · ${row.en}`">
          {{ row.cn }}
          <span v-if="isDirty(row.key)" class="dirty-mark" title="尚未写入" aria-label="尚未写入">●</span>
        </span>
        <span
          class="field-original"
          :title="row.editable ? displayInitial(row.key) : String(form[row.key as keyof BomFields] ?? '')"
        >
          {{ row.editable ? displayInitial(row.key) : form[row.key as keyof BomFields] }}
        </span>
        <div class="input-row" :title="`原值：${displayInitial(row.key)}`">
          <ComboTextInput
            v-if="row.key === 'TypeCode'"
            v-model="form.TypeCode"
            :options="TYPE_CODE_OPTIONS"
            :readonly="!row.editable"
          />
          <input
            v-else
            v-model="form[row.key as keyof BomFields]"
            :aria-label="row.cn"
            :title="row.editable ? `原值：${displayInitial(row.key)}` : String(form[row.key as keyof BomFields] ?? '')"
            :readonly="!row.editable"
            :class="{ readonly: !row.editable }"
          />
        </div>
        <div class="field-actions">
          <el-button
            v-if="row.editable"
            size="small"
            :aria-label="`恢复${row.cn}`"
            :disabled="busy || recommendingAll || !!recommendingField || !isDirty(row.key)"
            @click="onRestoreField(row.key as EditableKey)"
          >
            恢复
          </el-button>
          <el-dropdown
            v-if="row.recommend && row.key === 'PartName'"
            class="part-name-recommend"
            size="small"
            trigger="click"
            placement="bottom-end"
            :disabled="partNameRecommendDisabled"
            @command="onRecommendPartName"
          >
            <el-button
              class="part-name-recommend-trigger"
              size="small"
              aria-label="推荐零件名称来源"
              title="默认规则保留已有有效 PartName；明确来源仅替换本行草稿"
              :loading="recommendingField === 'PartName'"
              :disabled="partNameRecommendDisabled"
            >
              推荐<span class="recommend-arrow" aria-hidden="true">▾</span>
            </el-button>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item command="default" :disabled="partNameRecommendDisabled">按默认规则</el-dropdown-item>
                <el-dropdown-item command="filename" :disabled="partNameRecommendDisabled">从文件名推荐</el-dropdown-item>
                <el-dropdown-item command="label" :disabled="partNameRecommendDisabled">从节点标签推荐</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
          <el-button
            v-else-if="row.recommend"
            size="small"
            :loading="recommendingField === row.key"
            :disabled="operationsBusy || (bomReadonly && !canOpenSourceModel)"
            @click="onRecommendField(row.key as EditableKey)"
          >
            推荐
          </el-button>
        </div>
      </div>
    </form>

    <p v-if="!bomReadonly && recommendedFillLine()" class="hint muted">{{ recommendedFillLine() }}</p>
    <p class="file-location">
      <span>仓库相对路径</span>
      <code :title="rel">{{ rel }}</code>
    </p>
  </div>
</template>

<style scoped>
@import "./file-panel-header.css";
.attrs-panel {
  padding-top: 4px;
}
.attribute-options {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 8px;
  padding: 4px 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  overflow-x: auto;
  scrollbar-width: thin;
  white-space: nowrap;
}
.doc-kind-row {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 8px;
  font-size: 0.78rem;
}
.doc-kind-label {
  font-weight: 600;
  color: var(--muted);
}
.doc-kind-tags {
  display: flex;
  align-items: center;
  gap: 8px;
}
.doc-kind-tag {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 0.8rem;
  font-weight: 600;
  line-height: 1.3;
  border: 1px solid transparent;
}
.doc-kind-tag.tone-part {
  color: var(--phoenix-text-secondary);
  background: var(--phoenix-bg-muted);
  border-color: var(--phoenix-border);
}
.doc-kind-tag.tone-assembly {
  color: var(--phoenix-accent);
  background: var(--phoenix-accent-soft);
  border-color: var(--phoenix-accent-border);
}
.doc-kind-tag.tone-drawing {
  color: var(--phoenix-warning-text);
  background: var(--phoenix-warning-bg);
  border-color: var(--phoenix-warning-border);
}
.doc-suffix-wrap {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-left: 2px;
}
.doc-suffix-label {
  font-size: 0.76rem;
  color: var(--phoenix-text-muted);
}
.doc-suffix-tag {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 6px;
  font-family: var(--font-mono);
  font-size: 0.76rem;
  font-weight: 600;
  color: var(--phoenix-success-text);
  background: var(--phoenix-success-bg);
  border: 1px solid var(--phoenix-success-border);
}
.doc-kind-empty {
  font-size: 0.82rem;
}
.kind-row {
  display: flex;
  flex: 0 0 auto;
  gap: 8px;
  align-items: center;
  font-size: 0.78rem;
  margin-left: auto;
}
.kind-label {
  color: var(--muted);
}
.kind-row .el-checkbox {
  margin: 0;
}
.attribute-form {
  margin: 0;
}
.attribute-columns,
.attribute-field {
  display: grid;
  grid-template-columns: 100px minmax(0, 1fr) minmax(0, 1.3fr) 106px;
  align-items: center;
  gap: 8px;
  min-width: 0;
  padding: 3px 0;
}
.attribute-columns {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--muted);
}
.attribute-field + .attribute-field {
  border-top: 1px solid var(--border);
}
.field-label {
  font-size: 0.8rem;
}
.dirty-mark {
  color: var(--phoenix-warning-text);
}
.field-original {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--muted);
  font-size: 0.8rem;
}
.input-row {
  display: flex;
  min-width: 0;
  align-items: center;
}
.input-row input,
.input-row .pnw-combo-wrap {
  flex: 1;
  min-width: 0;
}
.input-row input {
  box-sizing: border-box;
  height: 28px;
  padding: 3px 8px;
  border: 1px solid var(--border-strong);
  border-radius: 6px;
  font-size: 0.85rem;
  color: var(--phoenix-text);
  background: var(--phoenix-bg-elevated);
}
.input-row input.readonly {
  background: var(--el-fill-color-light);
}
.input-row :deep(.pnw-combo-text-input) {
  height: 28px;
  font-size: 0.85rem;
  padding: 3px 8px;
}
.field-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}
.field-actions > .el-button {
  flex: 0 0 auto;
  height: 28px;
  margin: 0;
}
.part-name-recommend {
  flex: 0 0 auto;
}
.part-name-recommend-trigger {
  height: 28px;
  margin: 0;
  padding: 0 7px;
}
.recommend-arrow {
  margin-left: 2px;
  font-size: 0.65rem;
}
.hint {
  margin: 8px 0 0;
  font-size: 0.78rem;
}
.file-location {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin: 8px 0 0;
  font-size: 0.78rem;
  color: var(--muted);
}
.file-location > span { flex: 0 0 auto; }
.file-location > code {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--font-mono);
}
.muted {
  color: var(--muted);
}
</style>
