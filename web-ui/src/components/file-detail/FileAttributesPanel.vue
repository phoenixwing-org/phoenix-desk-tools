<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import type { BomApplyPrefs, BomFields, BomKindFilters } from "../../api";
import {
  fetchBomDocumentKinds,
  fetchBomPrefs,
  recommendBomField,
  saveBom,
} from "../../api";
import { useFileDetailContext } from "../../composables/useFileDetailContext";
import { useAppShell } from "../../composables/useAppShell";

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
const RECOMMEND_ALL_ORDER: EditableKey[] = [...EDITABLE_KEYS];

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

const {
  rel,
  preview,
  form,
  baseline,
  pageError,
  reloadFile,
  switchSubTab,
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
  drawing_and_assembly: true,
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
  return (
    String(form.value[key as keyof BomFields] ?? "").trim() !==
    String(baseline.value[key as keyof BomFields] ?? "").trim()
  );
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
  if (!rel.value) return;
  recommendingAll.value = true;
  shell.appendLog(`[文件详情] 全部推荐属性 ${rel.value}…`, { source: "file_detail", open: true });
  let working: Partial<BomFields> = { ...form.value };
  const filled: string[] = [];
  try {
    for (const key of RECOMMEND_ALL_ORDER) {
      if (key === "filename" && !isFcstd.value) continue;
      recommendingField.value = key;
      const data = await recommendBomField(rel.value, key, working, kindFilters.value);
      if (data.filled && data.value) {
        working = { ...working, [key]: data.value };
        patchField(key as keyof BomFields, data.value);
        filled.push(key);
      }
    }
    const msg = filled.length ? `全部推荐完成（${filled.length} 项）` : "未找到可推荐值";
    shell.appendLog(`[文件详情] ${msg}`, { source: "file_detail" });
    shell.setStatus(msg);
  } catch (e) {
    pageError.value = String(e);
    shell.appendLog(String(e), { source: "file_detail" });
  } finally {
    recommendingField.value = null;
    recommendingAll.value = false;
  }
}

async function onSave() {
  if (!rel.value || !isFcstd.value) return;
  busy.value = true;
  shell.appendLog(`[文件详情] 写入 Document.xml ${rel.value}…`, { source: "file_detail", open: true });
  try {
    await saveBom(rel.value, form.value);
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
    pageError.value = "请先填写目标文件名";
    return;
  }
  switchSubTab("rename");
}

onMounted(() => {
  void loadPrefs();
});
</script>

<template>
  <div v-if="preview" class="attrs-panel">
    <h3 class="panel-title">编辑属性</h3>
    <section class="toolbar">
      <button type="button" class="btn" :disabled="busy" @click="onReload">重新读取</button>
      <button
        type="button"
        class="btn recommend-all"
        :disabled="busy || recommendingAll || !isFcstd"
        @click="onRecommendAll"
      >
        {{ recommendingAll ? "推荐中…" : "全部推荐" }}
      </button>
      <button type="button" class="btn" :disabled="busy || !isFcstd" @click="onDetectKinds">
        识别类型
      </button>
      <button type="button" class="btn primary" :disabled="busy || !isFcstd" @click="onSave">
        {{ busy ? "…" : "写入文件" }}
      </button>
    </section>

    <section class="kind-row">
      <span class="kind-label">推荐文件名时匹配：</span>
      <label class="chk"><input v-model="kindFilters.part" type="checkbox" /> 零件</label>
      <label class="chk"><input v-model="kindFilters.assembly" type="checkbox" /> 装配</label>
      <label class="chk"><input v-model="kindFilters.drawing" type="checkbox" /> 图纸</label>
      <label class="chk"><input v-model="kindFilters.drawing_and_assembly" type="checkbox" /> 图纸+装配</label>
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
            <input
              v-model="form[row.key as keyof BomFields]"
              :readonly="!row.editable"
              :class="{ readonly: !row.editable }"
            />
            <button
              v-if="row.recommend"
              type="button"
              class="btn mini"
              :disabled="busy || recommendingAll || recommendingField === row.key"
              @click="onRecommendField(row.key as EditableKey)"
            >
              {{ recommendingField === row.key ? "…" : "推荐" }}
            </button>
            <button
              v-if="row.key === 'filename'"
              type="button"
              class="btn mini"
              :disabled="busy || !isFcstd"
              @click="onGoRename"
            >
              去改名
            </button>
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
.toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 10px;
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
.input-row input {
  flex: 1;
  min-width: 0;
  padding: 6px 10px;
  border: 1px solid var(--border-strong);
  border-radius: 6px;
  font-size: 0.85rem;
}
.input-row input.readonly {
  background: #f3f4f6;
}
.hint {
  margin-top: 12px;
  font-size: 0.78rem;
}
.muted {
  color: var(--muted);
}
</style>
