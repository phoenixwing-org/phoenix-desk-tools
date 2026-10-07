<script setup lang="ts">
import { computed } from "vue";
import { useFileDetailContext } from "../../composables/useFileDetailContext";
import { useDrawingBomReadonly } from "../../composables/useDrawingBomReadonly";
import { useAppShell } from "../../composables/useAppShell";

const { preview, form, incomingCount, outgoingCount, switchSubTab, triggerRename } = useFileDetailContext();
const shell = useAppShell();
const { canOpenSourceModel, editSubTabLabel, openSourceModel } = useDrawingBomReadonly(preview);

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
      <p v-if="preview.embedded_warning" class="warn">{{ preview.embedded_warning }}</p>
    </section>

    <section class="attrs-block">
      <header class="file-panel-header">
        <h3 class="panel-title">BOM 属性摘要</h3>
        <div class="file-panel-actions">
          <el-button v-if="canOpenSourceModel" type="primary" size="small" @click="openSourceModel">打开模型</el-button>
          <el-button v-if="canOpenPart" size="small" class="mono" @click="openPartKey">{{ partKey }}</el-button>
          <el-button size="small" @click="switchSubTab('edit')">{{ editSubTabLabel }}</el-button>
          <el-button v-if="incomingCount + outgoingCount" size="small" @click="switchSubTab('xref')">查看引用</el-button>
          <el-button size="small" @click="triggerRename()">改名</el-button>
        </div>
      </header>
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

  </div>
</template>

<style scoped>
@import "./file-panel-header.css";
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
  background: var(--phoenix-bg-elevated);
  color: var(--phoenix-text);
}

.path {
  margin: 0 0 8px;
  font-size: 0.88rem;
  word-break: break-all;
}

.kinds {
  margin: 0 0 6px;
  font-size: 0.85rem;
  color: var(--phoenix-accent);
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

.warn {
  margin: 8px 0 0;
  font-size: 0.78rem;
  color: var(--phoenix-warning-text);
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


.part-key-link {
  padding: 0;
  border: none;
  background: none;
  color: var(--phoenix-accent);
  cursor: pointer;
  font: inherit;
  font-size: 0.85rem;
}

.part-key-link:hover {
  color: var(--phoenix-accent-hover);
  text-decoration: underline;
}

.mono {
  font-family: var(--font-mono);
}

.muted {
  color: var(--muted);
}
</style>
