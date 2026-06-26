<script setup lang="ts">
import { computed, ref } from "vue";
import { ElMessage } from "element-plus";
import type { CaaDialogIr } from "../../types/caaDialogIr";
import { buildCaaDialogRscPreviewRows } from "../../utils/caaDialogRscPreview";
import { useAppShell } from "../../composables/useAppShell";
import { useCaaRelatedFilePreview } from "../../composables/useCaaRelatedFilePreview";

const props = defineProps<{
  ir: CaaDialogIr;
}>();

const shell = useAppShell();
const { previewFile } = useCaaRelatedFilePreview();
const collapsed = ref(false);

const rows = computed(() => buildCaaDialogRscPreviewRows(props.ir));
const matchedCount = computed(() => rows.value.filter((row) => row.bitmapRel).length);
const workspaceRoot = computed(
  () => props.ir.parseMeta?.resolvedAbs?.workspaceRoot?.trim() || shell.workspacePath.value.trim(),
);

function toggleCollapse() {
  collapsed.value = !collapsed.value;
}

function onRowClick(row: { bitmapRel?: string }) {
  if (!row.bitmapRel) return;
  const ws = workspaceRoot.value;
  if (!ws) {
    ElMessage.warning("请先配置工作空间根目录");
    return;
  }
  void previewFile(ws, row.bitmapRel, "CATRsc 图标");
}
</script>

<template>
  <section v-if="rows.length" class="caa-rsc-preview">
    <header class="caa-rsc-head" @click="toggleCollapse">
      <span class="caa-rsc-arrow" :class="{ expanded: !collapsed }">▸</span>
      <span class="caa-rsc-title">CATRsc 图标资源</span>
      <span class="caa-rsc-hint muted small">
        {{ rows.length }} 条 · 匹配 {{ matchedCount }} 张
      </span>
    </header>
    <el-table
      v-show="!collapsed"
      class="caa-rsc-table"
      :data="rows"
      size="small"
      stripe
      empty-text="无 CATRsc 资源"
      highlight-current-row
      @row-click="onRowClick"
    >
      <el-table-column label="Key" min-width="220" show-overflow-tooltip>
        <template #default="{ row }">
          <span class="mono cell-key">{{ row.key }}</span>
        </template>
      </el-table-column>
      <el-table-column label="资源名" min-width="140" show-overflow-tooltip>
        <template #default="{ row }">
          <span class="mono cell-resource">{{ row.resourceName || "—" }}</span>
        </template>
      </el-table-column>
      <el-table-column label="图片文件" min-width="220" show-overflow-tooltip>
        <template #default="{ row }">
          <span v-if="row.bitmapRel" class="mono cell-path">{{ row.bitmapRel }}</span>
          <span v-else class="muted">未匹配</span>
        </template>
      </el-table-column>
    </el-table>
  </section>
</template>

<style scoped>
.caa-rsc-preview {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
  border: 1px solid var(--border, #e2e8f0);
  border-radius: 6px;
  background: var(--page-bg, #fff);
  padding: 8px 10px;
}

.caa-rsc-head {
  display: flex;
  align-items: baseline;
  gap: 6px;
  flex-shrink: 0;
  cursor: pointer;
  user-select: none;
}

.caa-rsc-head:hover .caa-rsc-title {
  color: var(--accent, #3b82f6);
}

.caa-rsc-arrow {
  display: inline-block;
  width: 12px;
  font-size: 0.7rem;
  color: var(--muted, #94a3b8);
  transition: transform 0.15s;
}

.caa-rsc-arrow.expanded {
  transform: rotate(90deg);
}

.caa-rsc-title {
  font-size: 0.82rem;
  font-weight: 600;
}

.caa-rsc-hint {
  font-size: 0.72rem;
}

.caa-rsc-table {
  font-size: 0.76rem;
}

.caa-rsc-table :deep(.el-table__row) {
  cursor: pointer;
}

.cell-key,
.cell-resource {
  font-size: 0.76rem;
}

.cell-path {
  font-size: 0.72rem;
  color: var(--muted, #64748b);
}
</style>
