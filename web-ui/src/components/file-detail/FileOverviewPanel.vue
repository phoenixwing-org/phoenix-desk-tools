<script setup lang="ts">
import { computed } from "vue";
import { useFileDetailContext } from "../../composables/useFileDetailContext";
import { useAppShell } from "../../composables/useAppShell";

const { preview, form, incomingCount, outgoingCount, switchSubTab } = useFileDetailContext();
const shell = useAppShell();

const bomReadonly = computed(() => preview.value?.bom_readonly ?? false);
const bomSourceRel = computed(() => preview.value?.bom_source_rel ?? null);

function openSourceModel() {
  const src = bomSourceRel.value;
  if (!src) return;
  shell.openFileDetailForRel(src, { subTab: "edit" });
}

const partKey = computed(() => {
  const pn = String(form.value.PartNumber ?? "").trim();
  const pv = String(form.value.PartVersion ?? "").trim();
  if (!pn || !pv) return "";
  return `${pn}.${pv}`;
});

const canOpenPart = computed(() => Boolean(partKey.value));

function openPartKey() {
  const pn = String(form.value.PartNumber ?? "").trim();
  const pv = String(form.value.PartVersion ?? "").trim();
  if (!pn || !pv) return;
  shell.openPartKeyDetail(pn, pv, {
    partName: String(form.value.PartName ?? "").trim() || undefined,
  });
}

const summaryRows = computed(() => {
  const f = form.value;
  const keys = [
    { key: "PartNumber", label: "零件号" },
    { key: "PartVersion", label: "版本" },
    { key: "TypeCode", label: "类型码" },
    { key: "ModelSeries", label: "型号系列" },
    { key: "PartName", label: "零件名称" },
    { key: "label", label: "标签" },
  ] as const;
  return keys.map(({ key, label }) => ({
    label,
    value: String(f[key] ?? "").trim() || "（空）",
  }));
});
</script>

<template>
  <div v-if="preview" class="overview-panel">
    <section class="info-block">
      <p class="path mono">{{ preview.abs_path_display }}</p>
      <p v-if="preview.document_kinds" class="kinds">
        文档类型：{{ preview.document_kinds.display }} · 后缀
        {{ preview.document_kinds.recommended_suffix }}
      </p>
      <p v-if="preview.file_size_display" class="file-size">
        文件大小：{{ preview.file_size_display }}
      </p>
      <p class="counts">
        入向宿主 {{ incomingCount }} · 出向引用 {{ outgoingCount }}
      </p>
      <p v-if="preview.source_note" class="source muted">{{ preview.source_note }}</p>
      <p v-if="bomReadonly" class="readonly-note">
        BOM 只读（图纸 · App::Link）
        <template v-if="bomSourceRel">
          · 来源
          <button type="button" class="link-btn mono" @click="openSourceModel">{{ bomSourceRel }}</button>
        </template>
      </p>
      <p v-if="preview.embedded_warning" class="warn">{{ preview.embedded_warning }}</p>
    </section>

    <section class="attrs-block">
      <h3 class="section-title">BOM 属性摘要</h3>
      <dl class="summary-grid">
        <dt>零件标识</dt>
        <dd>
          <button
            v-if="canOpenPart"
            type="button"
            class="part-key-link mono"
            title="打开零件详情"
            @click="openPartKey"
          >
            {{ partKey }}
          </button>
          <span v-else class="muted">（空）</span>
        </dd>
        <template v-for="row in summaryRows" :key="row.label">
          <dt>{{ row.label }}</dt>
          <dd>{{ row.value }}</dd>
        </template>
      </dl>
    </section>

    <section class="quick-links">
      <el-button v-if="canOpenPart" size="small" class="mono" @click="openPartKey">
        {{ partKey }}
      </el-button>
      <el-button v-if="bomReadonly && bomSourceRel" size="small" @click="openSourceModel">
        打开模型
      </el-button>
      <el-button size="small" @click="switchSubTab('edit')">编辑属性</el-button>
      <el-button v-if="incomingCount + outgoingCount" size="small" @click="switchSubTab('xref')">
        查看引用
      </el-button>
      <el-button size="small" @click="switchSubTab('rename')">改名</el-button>
    </section>
  </div>
</template>

<style scoped>
.overview-panel {
  padding-top: 4px;
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.info-block {
  padding: 14px 16px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: #fafafa;
}

.path {
  margin: 0 0 8px;
  font-size: 0.88rem;
  word-break: break-all;
}

.kinds {
  margin: 0 0 6px;
  font-size: 0.85rem;
  color: #0369a1;
}

.counts {
  margin: 0;
  font-size: 0.85rem;
}

.file-size {
  margin: 0 0 6px;
  font-size: 0.85rem;
}

.source {
  margin: 8px 0 0;
  font-size: 0.78rem;
}

.readonly-note {
  margin: 8px 0 0;
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

.warn {
  margin: 8px 0 0;
  font-size: 0.78rem;
  color: #b45309;
}

.section-title {
  margin: 0 0 10px;
  font-size: 0.88rem;
  font-weight: 600;
}

.summary-grid {
  display: grid;
  grid-template-columns: 100px 1fr;
  gap: 8px 12px;
  margin: 0;
  font-size: 0.85rem;
}

.summary-grid dt {
  margin: 0;
  color: var(--muted);
}

.summary-grid dd {
  margin: 0;
  word-break: break-word;
}

.quick-links {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.btn {
  padding: 6px 12px;
  border-radius: 6px;
  border: 1px solid var(--border-strong);
  background: var(--btn-bg);
  font-size: 0.82rem;
  cursor: pointer;
}

.part-btn {
  color: var(--accent, #2563eb);
  border-color: #bfdbfe;
  background: #eff6ff;
}

.part-key-link {
  padding: 0;
  border: none;
  background: none;
  color: var(--accent, #2563eb);
  cursor: pointer;
  font: inherit;
  font-size: 0.85rem;
}

.part-key-link:hover {
  text-decoration: underline;
}

.mono {
  font-family: var(--font-mono);
}

.muted {
  color: var(--muted);
}
</style>
