<script setup lang="ts">
import { computed, inject, unref } from "vue";
import { Grid, ChatLineSquare, Picture, Document } from "@element-plus/icons-vue";
import { useCaaDialogPageStore } from "../../stores/caaDialogPage";
import { ElMessage } from "element-plus";
import type { CaaDialogIr } from "../../types/caaDialogIr";
import { buildCaaDialogRelatedFiles } from "../../utils/caaDialogRelatedFiles";
import { useCaaRelatedFilePreview } from "../../composables/useCaaRelatedFilePreview";
import { CAA_NLS_SESSION_KEY } from "../../composables/caaNlsEdit";
import { useAppShell } from "../../composables/useAppShell";

/** 根据 kindLabel 返回文件类型图标组件 */
function fileIcon(kind: string) {
  if (kind.startsWith(".CATDlg")) return Grid;
  if (kind.startsWith(".CATNls")) return ChatLineSquare;
  if (kind.startsWith(".CATRsc")) return Picture;
  if (kind.startsWith(".h") || kind.startsWith(".cpp")) return Document;
  if (kind.startsWith("位图")) return Picture;
  return Document;
}

const props = defineProps<{
  ir: CaaDialogIr;
}>();

const shell = useAppShell();
const nlsSession = inject(CAA_NLS_SESSION_KEY, null);
const { previewFile } = useCaaRelatedFilePreview();

const rows = computed(() => buildCaaDialogRelatedFiles(props.ir));

const workspaceRoot = computed(
  () => props.ir.parseMeta?.resolvedAbs?.workspaceRoot?.trim() || shell.workspacePath.value.trim(),
);

const primaryCatNlsRel = computed(() => unref(nlsSession?.primaryCatNlsRel) ?? "");

function isCatNlsRow(filename: string): boolean {
  return filename.toLowerCase().endsWith(".catnls");
}

function normRel(rel: string): string {
  return rel.replace(/\\/g, "/").trim();
}

function canEditRow(row: { filename: string; repoRelPath: string }): boolean {
  if (!unref(nlsSession?.canEdit)) return false;
  if (!isCatNlsRow(row.filename)) return false;
  const rel = normRel(row.repoRelPath);
  const primary = normRel(primaryCatNlsRel.value);
  if (rel === primary) return true;
  const locales = props.ir.sources.nlsLocales ?? {};
  for (const path of Object.values(locales)) {
    if (normRel(path) === rel) return true;
  }
  return false;
}

function onRowClick(row: { filename: string; repoRelPath: string; kindLabel: string }) {
  const ws = workspaceRoot.value;
  if (!ws) {
    ElMessage.warning("请先配置工作空间根目录");
    return;
  }
  void previewFile(ws, row.repoRelPath, row.kindLabel);
}

function onEditNls(row: { repoRelPath: string }) {
  nlsSession?.openCatNlsEditor(row.repoRelPath);
}

const store = useCaaDialogPageStore();
function toggleCollapse() { store.toggleRelatedFiles(); }
</script>

<template>
  <section class="caa-related-files">
    <header class="caa-related-head" @click="toggleCollapse">
      <span class="caa-related-arrow" :class="{ expanded: !store.relatedFilesCollapsed }">▸</span>
      <span class="caa-related-title">关联文件</span>
      <span class="caa-related-hint muted small">共 {{ rows.length }} 项 · 点击行预览 · .CATNls 可编辑</span>
    </header>
    <el-table
      v-show="!store.relatedFilesCollapsed"
      class="caa-related-table"
      :data="rows"
      size="small"
      stripe
      empty-text="无关联资源"
      highlight-current-row
      @row-click="onRowClick"
    >
      <el-table-column label="文件名" min-width="140" show-overflow-tooltip>
        <template #default="{ row }">
          <el-icon class="file-type-icon"><component :is="fileIcon(row.kindLabel)" /></el-icon>
          <span class="mono cell-name">{{ row.filename }}</span>
        </template>
      </el-table-column>
      <el-table-column label="相对路径" min-width="240" show-overflow-tooltip>
        <template #default="{ row }">
          <span class="mono cell-path">{{ row.repoRelPath }}</span>
        </template>
      </el-table-column>
      <el-table-column label="" width="72" align="center" class-name="col-actions">
        <template #default="{ row }">
          <el-button
            v-if="canEditRow(row)"
            type="primary"
            link
            size="small"
            @click.stop="onEditNls(row)"
          >
            编辑
          </el-button>
        </template>
      </el-table-column>
    </el-table>
  </section>
</template>

<style scoped>
.caa-related-files {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
  border: 1px solid var(--border, #e2e8f0);
  border-radius: 6px;
  background: var(--page-bg, #fff);
  padding: 8px 10px;
}

.caa-related-head {
  display: flex;
  align-items: baseline;
  gap: 6px;
  flex-shrink: 0;
  cursor: pointer;
  user-select: none;
}

.caa-related-head:hover .caa-related-title { color: var(--accent, #3b82f6); }

.caa-related-arrow {
  display: inline-block; width: 12px; font-size: 0.7rem;
  color: var(--muted, #94a3b8); transition: transform 0.15s;
}
.caa-related-arrow.expanded { transform: rotate(90deg); }

.caa-related-title {
  font-size: 0.82rem;
  font-weight: 600;
}

.caa-related-hint {
  font-size: 0.72rem;
}

.caa-related-table {
  font-size: 0.76rem;
}

.caa-related-table :deep(.el-table__row) {
  cursor: pointer;
}

.caa-related-table :deep(.col-actions .cell) {
  padding: 0 4px;
}

.caa-related-table :deep(.el-table__row:hover .file-type-icon) {
  color: var(--accent, #3b82f6);
}

.file-type-icon {
  margin-right: 2px;
  font-size: 13px;
  color: var(--el-text-color-secondary);
}

.cell-name {
  font-size: 0.78rem;
}

.cell-path {
  font-size: 0.72rem;
  color: var(--muted, #64748b);
}
</style>
