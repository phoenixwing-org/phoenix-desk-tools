<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import type { BomApplyPrefs, BomFields, BomKindFilters, BomPreview } from "../api";
import {
  applyLabelFormula,
  fetchBom,
  fetchBomDocumentKinds,
  fetchBomPrefs,
  fillBomFromEmbedded,
  fillBomFromFilename,
  fillRecommendedValues,
  recommendFilename,
  renameBomFile,
  saveBom,
} from "../api";
import { useAppShell } from "../composables/useAppShell";

const shell = useAppShell();

const FIELD_ROWS = [
  { key: "repo_rel_path", cn: "仓库相对路径", en: "RepoRelativePath", editable: false },
  { key: "filename", cn: "文件名", en: "Filename", editable: true },
  { key: "PartNumber", cn: "零件号", en: "PartNumber", editable: true },
  { key: "PartVersion", cn: "版本", en: "PartVersion", editable: true },
  { key: "TypeCode", cn: "类型码 (H/S/R)", en: "TypeCode", editable: true },
  { key: "ModelSeries", cn: "型号系列", en: "ModelSeries", editable: true },
  { key: "PartName", cn: "零件名称", en: "PartName", editable: true },
  { key: "label", cn: "标签", en: "Label", editable: true },
] as const;

const selectedRel = ref<string | null>(null);
const originalFilename = ref("");
const preview = ref<BomPreview | null>(null);
const form = ref<Partial<BomFields>>({});
const baseline = ref<Partial<BomFields>>({});
const bomPrefs = ref<BomApplyPrefs | null>(null);
const loadingBom = ref(false);
const busy = ref(false);
const pageError = ref("");
const filenameHint = ref("");

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
  return parts.length ? `工作空间推荐值：${parts.join(" · ")}` : "";
});

function isDirty(key: string) {
  const cur = String(form.value[key as keyof BomFields] ?? "").trim();
  const base = String(baseline.value[key as keyof BomFields] ?? "").trim();
  return cur !== base;
}

function hasUnsavedDocumentAttrs() {
  for (const k of ["PartNumber", "PartVersion", "TypeCode", "ModelSeries", "PartName", "label"] as const) {
    if (isDirty(k)) return true;
  }
  return false;
}

function applyFields(fields: Partial<BomFields>, resetBaseline = true) {
  form.value = { ...form.value, ...fields };
  if (resetBaseline) {
    baseline.value = { ...form.value };
  }
}

async function loadPrefs() {
  try {
    bomPrefs.value = await fetchBomPrefs();
  } catch {
    bomPrefs.value = null;
  }
}

async function loadBom(rel: string, fromSidebar = true) {
  if (fromSidebar && selectedRel.value && hasUnsavedDocumentAttrs()) {
    shell.setStatus("已从树切换：未保存的编辑已丢弃");
  }
  selectedRel.value = rel;
  loadingBom.value = true;
  pageError.value = "";
  filenameHint.value = "";
  try {
    const data = await fetchBom(rel);
    preview.value = data;
    originalFilename.value = data.fields.filename || rel.split("/").pop() || "";
    applyFields(data.fields);
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
  await loadBom(selectedRel.value, false);
  shell.setStatus("已从磁盘重新读取");
}

async function onFillRecommended() {
  if (!selectedRel.value) return;
  busy.value = true;
  pageError.value = "";
  try {
    const data = await fillRecommendedValues(selectedRel.value, form.value);
    applyFields(data.fields, false);
    const msg =
      data.filled_keys.length > 0
        ? `已填入推荐值：${data.filled_keys.join("、")}`
        : "各字段已有值，无需填入";
    shell.setStatus(msg);
  } catch (e) {
    pageError.value = String(e);
  } finally {
    busy.value = false;
  }
}

async function onFillFromZip() {
  if (!selectedRel.value) return;
  busy.value = true;
  pageError.value = "";
  try {
    const data = await fillBomFromEmbedded(selectedRel.value, form.value, kindFilters.value);
    applyFields(data.fields);
    if (data.document_kinds && preview.value) {
      preview.value = { ...preview.value, document_kinds: data.document_kinds };
    }
    shell.setStatus("已从 ZIP 嵌入属性填入界面（尚未保存）");
  } catch (e) {
    pageError.value = String(e);
  } finally {
    busy.value = false;
  }
}

async function onFillFromFilename() {
  if (!selectedRel.value) return;
  busy.value = true;
  pageError.value = "";
  try {
    const data = await fillBomFromFilename(selectedRel.value);
    applyFields(data.fields);
    shell.setStatus("已从文件名 / 路径推断填入界面（尚未写入 ZIP）");
  } catch (e) {
    pageError.value = String(e);
  } finally {
    busy.value = false;
  }
}

async function onLabelFormula() {
  if (!selectedRel.value) return;
  busy.value = true;
  pageError.value = "";
  try {
    const data = await applyLabelFormula(selectedRel.value, form.value);
    applyFields(data.fields, false);
    const extra = data.filled_keys.length ? `（已补全 ${data.filled_keys.join("、")}）` : "";
    shell.setStatus(`Label 已填为「${data.label}」${extra}（未写入 ZIP）`);
  } catch (e) {
    pageError.value = String(e);
  } finally {
    busy.value = false;
  }
}

async function onRecommendFilename() {
  if (!selectedRel.value) return;
  busy.value = true;
  pageError.value = "";
  try {
    const data = await recommendFilename(selectedRel.value, form.value, {
      kindFilters: kindFilters.value,
      originalFilename: originalFilename.value,
    });
    applyFields({ ...data.fields, filename: data.recommended_filename }, false);
    filenameHint.value = data.hint_text;
    if (data.document_kinds && preview.value) {
      preview.value = { ...preview.value, document_kinds: data.document_kinds };
    }
    let msg = "文件名已填入推荐值";
    if (data.filled_keys.length) {
      msg = `已用记忆值补全 ${data.filled_keys.join("、")}；${msg}`;
    }
    if (data.matches_disk_name) {
      msg += "（与磁盘当前名称一致）";
    } else {
      msg += "（未改磁盘；请先保存属性到 ZIP，再点改名）";
    }
    shell.setStatus(msg);
    await loadPrefs();
  } catch (e) {
    pageError.value = String(e);
  } finally {
    busy.value = false;
  }
}

async function onSave() {
  if (!selectedRel.value || !preview.value?.is_fcstd) return;
  busy.value = true;
  pageError.value = "";
  try {
    await saveBom(selectedRel.value, form.value);
    shell.setStatus("已写入 Document.xml（ZIP）");
    await loadBom(selectedRel.value, false);
    await loadPrefs();
  } catch (e) {
    pageError.value = String(e);
  } finally {
    busy.value = false;
  }
}

async function onRename() {
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
  if (
    !window.confirm(
      `将重命名磁盘文件：\n\n${originalFilename.value}\n    ↓\n${newName}\n\n请确认 FreeCAD 等已关闭占用。`,
    )
  ) {
    return;
  }
  busy.value = true;
  pageError.value = "";
  try {
    const data = await renameBomFile(selectedRel.value, form.value, baseline.value);
    shell.setStatus(
      data.map_updated
        ? `已重命名为 ${data.filename}（已更新索引库）`
        : `已重命名为 ${data.filename}`,
    );
    shell.requestTreeRescan(data.rel_path);
    await loadBom(data.rel_path, false);
  } catch (e) {
    pageError.value = String(e);
  } finally {
    busy.value = false;
  }
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

onMounted(() => {
  loadPrefs();
  shell.registerTreeSelect((rel) => loadBom(rel));
});

onUnmounted(() => {
  shell.registerTreeSelect(null);
});
</script>

<template>
  <div class="page bom-page">
    <header class="page-head">
      <h1 class="page-title">属性回写</h1>
      <p class="page-desc">
        在右侧工作空间树选择 .FCStd，编辑 BOM 字段并写回 ZIP。空字段可用工作空间记忆（上次零件号 +1、版本
        001、类型 H、上次型号）。
      </p>
    </header>

    <div v-if="pageError" class="banner err">{{ pageError }}</div>

    <div v-if="!selectedRel" class="empty">在右侧侧栏选择 .FCStd 文件</div>
    <div v-else-if="loadingBom" class="empty">载入中…</div>
    <template v-else-if="preview">
      <div class="file-head">
        <h2 class="file-name">{{ selectedName }}</h2>
        <p class="meta">{{ preview.abs_path_display }}</p>
        <p v-if="preview.document_kinds" class="meta kinds">
          文档类型：{{ preview.document_kinds.display }} · 后缀
          {{ preview.document_kinds.recommended_suffix }}
        </p>
        <p v-else class="meta">文档类型：—（非 FCStd 或未识别）</p>
        <p class="meta note">{{ preview.source_note }}</p>
        <p v-if="recommendedFillLine" class="meta prefs">{{ recommendedFillLine }}</p>
      </div>

      <section class="kind-row">
        <span class="kind-label">读取/推荐时匹配：</span>
        <label class="chk"><input v-model="kindFilters.part" type="checkbox" /> 零件</label>
        <label class="chk"><input v-model="kindFilters.assembly" type="checkbox" /> 装配</label>
        <label class="chk"><input v-model="kindFilters.drawing" type="checkbox" /> 图纸</label>
        <label class="chk">
          <input v-model="kindFilters.drawing_and_assembly" type="checkbox" /> 图纸+装配
        </label>
        <button type="button" class="btn mini" :disabled="busy" @click="onDetectKinds">识别类型</button>
      </section>

      <section class="toolbar">
        <button type="button" class="btn" :disabled="busy" @click="onReload">重新读取</button>
        <button type="button" class="btn" :disabled="busy || !preview.is_fcstd" @click="onFillRecommended">
          填入推荐值
        </button>
        <button type="button" class="btn" :disabled="busy || !preview.is_fcstd" @click="onFillFromZip">
          从 ZIP 写入界面
        </button>
        <button type="button" class="btn" :disabled="busy || !preview.is_fcstd" @click="onFillFromFilename">
          从文件名写入
        </button>
        <button type="button" class="btn" :disabled="busy || !preview.is_fcstd" @click="onLabelFormula">
          Label←编号公式
        </button>
        <button type="button" class="btn" :disabled="busy || !preview.is_fcstd" @click="onRecommendFilename">
          推荐文件名
        </button>
        <button type="button" class="btn primary" :disabled="busy || !preview.is_fcstd" @click="onSave">
          {{ busy ? "…" : "保存到 ZIP" }}
        </button>
      </section>

      <div v-if="!preview.is_fcstd" class="banner warn">当前非 FCStd，仅展示推断字段</div>

      <form class="form" @submit.prevent="onSave">
        <div class="form-head">
          <span class="col-mark" />
          <span class="col-meta">说明 / 英文名</span>
          <span class="col-val">值</span>
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
            <input
              v-model="form[row.key as keyof BomFields]"
              :readonly="!row.editable"
              :class="{ readonly: !row.editable }"
            />
            <button
              v-if="row.key === 'filename'"
              type="button"
              class="btn rename"
              :disabled="busy || !preview.is_fcstd"
              @click="onRename"
            >
              改名
            </button>
          </div>
        </div>
        <p v-if="filenameHint" class="filename-hint">{{ filenameHint }}</p>
      </form>
    </template>
  </div>
</template>

<style scoped>
.bom-page {
  padding: 20px 24px 32px;
  max-width: 920px;
}

.page-head {
  margin-bottom: 16px;
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
  margin-bottom: 12px;
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

.meta.note,
.meta.prefs {
  margin-top: 6px;
}

.meta.prefs {
  color: #15803d;
}

.kind-row {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
  margin-bottom: 10px;
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

.toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 14px;
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

.btn.rename {
  flex-shrink: 0;
  margin-left: 6px;
}

.btn:disabled {
  opacity: 0.5;
}

.banner {
  padding: 8px 12px;
  border-radius: 6px;
  font-size: 0.85rem;
  margin-bottom: 12px;
}

.banner.warn {
  background: #fff7ed;
  color: #9a3412;
}

.banner.err {
  background: #fef2f2;
  color: #b91c1c;
}

.form {
  display: grid;
  gap: 0;
}

.form-head,
.form-row {
  display: grid;
  grid-template-columns: 20px 180px 1fr;
  gap: 10px;
  align-items: start;
}

.form-head {
  font-size: 0.78rem;
  font-weight: 600;
  color: var(--muted);
  margin-bottom: 4px;
}

.col-mark {
  text-align: center;
  color: #c2410c;
  font-size: 1rem;
  line-height: 2rem;
}

.col-meta {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding-top: 6px;
}

.col-meta .cn {
  font-size: 0.85rem;
}

.col-meta .en {
  font-size: 0.75rem;
  color: var(--muted);
  font-family: ui-monospace, monospace;
}

.col-val {
  display: flex;
  align-items: center;
  gap: 0;
}

.col-val input {
  flex: 1;
  padding: 6px 10px;
  border: 1px solid var(--border-strong);
  border-radius: 6px;
  font-size: 0.85rem;
}

.col-val input.readonly {
  background: #f3f4f6;
}

.filename-hint {
  margin: 10px 0 0 210px;
  font-size: 0.78rem;
  color: var(--muted);
  white-space: pre-wrap;
  line-height: 1.5;
}
</style>
