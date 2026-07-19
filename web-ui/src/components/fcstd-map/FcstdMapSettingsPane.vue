<script setup lang="ts">
defineProps<{
  workspacePath: string;
  hasIndex: boolean;
  exporting: boolean;
  debugSql: string;
}>();

const emit = defineEmits<{
  exportJson: [];
}>();
</script>

<template>
  <div class="fcstd-map-settings-pane">
    <section class="settings-block">
      <h2 class="block-title">扫描</h2>
      <p class="block-desc">
        从<strong>当前工作空间根</strong>递归扫描 FCStd、Markdown、PDF、图片、DXF/DWG 等，写入
        <code>.phoenix/phoenix-workspace.sqlite</code>。请使用页顶「工程内搜索」；再次扫描时磁盘上已不存在的条目标记为缺失。
      </p>
      <p v-if="workspacePath" class="meta-line mono">工作空间：{{ workspacePath }}</p>
      <p class="hint">
        「强制更新零件名」变更后自动保存。重新扫描会覆盖索引中已有零件名（不写回 FCStd）。
      </p>
    </section>

    <section class="settings-block">
      <h2 class="block-title">导出</h2>
      <p class="block-desc">
        导出 <code>fcstd_map.json</code> 仅含 FCStd 条目，供 xlink 脚本等外部工具使用。
      </p>
      <el-button
        size="small"
        :loading="exporting"
        :disabled="!hasIndex"
        @click="emit('exportJson')"
      >
        导出 fcstd_map.json
      </el-button>
    </section>

    <section v-if="debugSql" class="settings-block">
      <h2 class="block-title">调试 SQL</h2>
      <p class="block-desc">最近一次列表查询（可复制到 SQLite 客户端执行）。</p>
      <pre class="debug-sql mono">{{ debugSql }}</pre>
    </section>
  </div>
</template>

<style scoped>
.fcstd-map-settings-pane {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.settings-block {
  padding: 14px 16px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: #fff;
}

.block-title {
  margin: 0 0 8px;
  font-size: 0.92rem;
}

.block-desc {
  margin: 0 0 12px;
  font-size: 0.82rem;
  color: var(--muted);
  line-height: 1.5;
}

.meta-line {
  margin: 0 0 6px;
  font-size: 0.78rem;
  color: var(--muted);
  word-break: break-all;
}

.hint {
  margin: 8px 0 0;
  font-size: 0.78rem;
  color: var(--muted);
  line-height: 1.45;
}

.debug-sql {
  margin: 0;
  padding: 10px 12px;
  background: #f8fafc;
  border: 1px solid var(--border);
  border-radius: 6px;
  font-size: 0.72rem;
  line-height: 1.45;
  white-space: pre-wrap;
  word-break: break-all;
  max-height: 200px;
  overflow: auto;
}

.mono {
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
  font-feature-settings: "tnum" 1;
  font-size: 0.76rem;
}

code {
  font-size: 0.9em;
}
</style>
