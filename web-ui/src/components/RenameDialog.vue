<script setup lang="ts">
import { toRef } from "vue";
import type { BomFields } from "../api";
import { useRenameDialog } from "../composables/useRenameDialog";
import { formatLogTime } from "../utils/fileRename";
import AppModalOverlay from "./AppModalOverlay.vue";

const props = defineProps<{
  open: boolean;
  rel: string;
  originalFilename: string;
  preferredNewFilename?: string;
  form: Partial<BomFields>;
  baseline: Partial<BomFields>;
}>();

const emit = defineEmits<{
  close: [];
  renamed: [newRel: string];
}>();

const rd = useRenameDialog(
  toRef(props, "rel"),
  toRef(props, "originalFilename"),
  toRef(props, "form"),
  toRef(props, "baseline"),
);

// Sync parent open/close
import { watch } from "vue";
watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) rd.open({ preferredNewFilename: props.preferredNewFilename });
    else rd.close();
  },
);

function onDialogClose() {
  if (rd.busy.value) return; // 执行中不允许关闭
  emit("close");
}

async function onExecuteRename() {
  await rd.onRename();
  if (rd.renamed.value) {
    const newRel =
      rd.lastRenameLog.value?.new_repo_rel_path || props.rel;
    emit("renamed", newRel);
  }
}
</script>

<template>
  <AppModalOverlay
    :open="props.open"
    aria-label="改名分析"
    panel-class="rename-dialog-panel"
    :close-on-backdrop="!rd.busy.value"
    @close="onDialogClose"
  >
    <div class="rename-dialog">
      <h2 class="dialog-title">改名分析</h2>

      <!-- 错误提示 -->
      <el-alert
        v-if="rd.pageError.value"
        type="error"
        :title="rd.pageError.value"
        show-icon
        :closable="false"
        class="err-alert"
      />

      <!-- 名称区 -->
      <div class="rename-grid">
        <span class="label">磁盘当前名</span>
        <el-input
          :model-value="props.originalFilename"
          readonly
          class="mono"
        />

        <span class="label">目标文件名</span>
        <el-input
          v-model="rd.newFilename.value"
          class="mono"
          :readonly="rd.renamed.value || rd.busy.value"
          spellcheck="false"
          @keyup.enter="onExecuteRename"
        />
      </div>

      <!-- FCStd 引用修正选项 -->
      <fieldset v-if="rd.isFcstd.value" class="options-section">
        <legend>引用修正选项</legend>
        <div class="option-row">
          <el-checkbox v-model="rd.fixXref.value" :disabled="rd.busy.value">
            修改引用 (XLink path)
          </el-checkbox>
          <p class="option-hint muted">
            扫描并修正宿主文档中的 XLink 文件路径
          </p>
        </div>
        <div class="option-row">
          <el-checkbox v-model="rd.syncLabels.value" :disabled="rd.busy.value">
            同步引用标签 (Label)
          </el-checkbox>
          <p class="option-hint muted">
            同步宿主文档中引用实例的显示标签为 CAD 索引规则名
          </p>
        </div>
        <div class="option-row">
          <el-checkbox v-model="rd.fixBasename.value" :disabled="rd.busy.value">
            引用名字 (basename)
          </el-checkbox>
          <p class="option-hint muted">
            修正仅按 basename 匹配的引用
          </p>
        </div>
      </fieldset>

      <!-- 操作栏 -->
      <div class="actions">
        <el-button :disabled="rd.busy.value" @click="onDialogClose">
          取消
        </el-button>
        <el-button
          type="primary"
          :loading="rd.busy.value"
          :disabled="!rd.canRename.value"
          @click="onExecuteRename"
        >
          执行改名
        </el-button>
        <el-button
          v-if="rd.renamed.value"
          size="small"
          :disabled="rd.busy.value"
          @click="rd.resetWorkflow()"
        >
          再次改名
        </el-button>
        <el-button
          size="small"
          :loading="rd.logsLoading.value"
          :disabled="rd.busy.value || !props.rel.trim()"
          @click="rd.onRefreshLogs()"
        >
          刷新记录
        </el-button>
      </div>

      <!-- 进度提示（执行中） -->
      <p v-if="rd.busy.value" class="busy-hint muted">
        正在执行改名及引用修正，请稍候…
      </p>

      <!-- 改名记录 -->
      <section class="records-section">
        <h3>改名记录</h3>
        <p class="section-hint muted">
          历史改名（新→旧倒序）；点右侧按钮进入改名分析。
        </p>
        <div
          v-if="rd.logsLoading.value && !rd.displayRenameLogs.value.length"
          class="empty muted"
        >
          正在查询改名记录…
        </div>
        <div v-else-if="!rd.displayRenameLogs.value.length" class="empty muted">
          暂无改名记录
        </div>
        <ul v-else class="record-list">
          <li
            v-for="log in rd.displayRenameLogs.value"
            :key="log.id"
            class="record-card"
            :class="{ latest: rd.isCurrentRenameLog(log) }"
          >
            <div class="record-row">
              <div class="record-row-main">
                <span v-if="rd.isCurrentRenameLog(log)" class="record-badge">
                  本次
                </span>
                <span class="mono old">{{ log.old_basename }}</span>
                <span class="arrow">→</span>
                <span class="mono new">{{ log.new_basename }}</span>
              </div>
              <el-button
                size="small"
                :type="rd.isCurrentRenameLog(log) ? 'primary' : undefined"
                @click="rd.openRenameAnalysisForLog(log)"
              >
                {{ rd.isCurrentRenameLog(log) ? "改名分析" : "分析引用" }}
              </el-button>
            </div>
            <div class="record-row-meta muted">
              #{{ log.id }} · {{ formatLogTime(log.created_at) }}
              <span v-if="rd.isCurrentRenameLog(log)" class="record-meta-tip">
                · 可能仍有旧名引用
              </span>
            </div>
          </li>
        </ul>
      </section>
    </div>
  </AppModalOverlay>
</template>

<style scoped>
.dialog-title {
  margin: 0 0 16px;
  font-size: 1.05rem;
}

.err-alert {
  margin-bottom: 12px;
}

.rename-grid {
  display: grid;
  grid-template-columns: 100px 1fr;
  gap: 8px 12px;
  align-items: center;
  margin-bottom: 16px;
}

.label {
  font-size: 0.82rem;
  color: var(--muted);
}

.options-section {
  margin: 0 0 16px;
  padding: 12px 14px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: #fafbfc;
}

.options-section legend {
  font-size: 0.85rem;
  font-weight: 600;
  padding: 0 4px;
}

.option-row {
  margin-top: 8px;
}

.option-hint {
  margin: 2px 0 0 24px;
  font-size: 0.75rem;
  line-height: 1.35;
}

.actions {
  display: flex;
  gap: 10px;
  align-items: center;
  margin-bottom: 12px;
}

.busy-hint {
  margin: 0 0 12px;
  font-size: 0.8rem;
}

.records-section {
  border-top: 1px solid var(--border);
  padding-top: 14px;
  margin-top: 4px;
}

.records-section h3 {
  margin: 0 0 6px;
  font-size: 0.92rem;
}

.section-hint {
  margin: 0 0 10px;
  font-size: 0.76rem;
  line-height: 1.4;
}

.record-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.record-card {
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: #fafbfc;
}

.record-card.latest {
  border-color: #93c5fd;
  background: #eff6ff;
}

.record-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.record-row-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 6px;
  font-size: 0.82rem;
  font-weight: 600;
}

.record-badge {
  display: inline-block;
  padding: 1px 6px;
  border-radius: 999px;
  font-size: 0.68rem;
  font-weight: 600;
  color: #1d4ed8;
  background: #dbeafe;
  border: 1px solid #93c5fd;
  flex-shrink: 0;
}

.record-row-main .old {
  color: #64748b;
  text-decoration: line-through;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 42%;
}

.record-row-main .new {
  color: #0f172a;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 42%;
}

.arrow {
  color: var(--muted);
  flex-shrink: 0;
}

.record-row-meta {
  margin-top: 4px;
  font-size: 0.72rem;
  line-height: 1.3;
}

.record-meta-tip {
  color: #1d4ed8;
}

.empty {
  padding: 12px;
  text-align: center;
  font-size: 0.8rem;
}

.mono {
  font-family: var(--font-mono);
}

.muted {
  color: var(--muted);
}
</style>

<!-- 非 scoped 样式：弹窗面板宽度 -->
<style>
.rename-dialog-panel {
  width: min(620px, 92vw) !important;
  max-height: min(92vh, 960px);
  padding: 20px 24px;
}
</style>
