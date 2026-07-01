<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { Close, Delete } from "@element-plus/icons-vue";
import SidebarBlock from "phoenix-wing/layout/PnwSidebarBlock.vue";
import { useAppShell } from "../composables/useAppShell";

const shell = useAppShell();

const preRef = ref<HTMLElement | null>(null);

const sourceLabel = computed(() => {
  const src = shell.logSource.value;
  if (!src) return "";
  const nav = shell.appConfig.value?.navigation.find((n) => n.page === src);
  return nav?.label ?? src;
});

function onClear() {
  shell.clearLog();
}

async function onClose() {
  await shell.setLogOpen(false);
}

watch(
  () => shell.logText.value,
  async () => {
    await nextTick();
    const el = preRef.value;
    if (el) el.scrollTop = el.scrollHeight;
  },
);
</script>

<template>
  <SidebarBlock
    class="log-panel"
    title="运行日志"
    variant="strip"
    body-scroll
    data-tour="shell-log"
    aria-label="运行日志"
  >
    <template #title>
      运行日志
      <span v-if="sourceLabel" class="log-src">· {{ sourceLabel }}</span>
    </template>
    <template #actions>
      <el-button text size="small" class="log-icon-btn" title="清空日志" @click="onClear">
        <el-icon><Delete /></el-icon>
      </el-button>
      <el-button text size="small" class="log-icon-btn" title="收起日志区" @click="onClose">
        <el-icon><Close /></el-icon>
      </el-button>
    </template>
    <pre ref="preRef" class="log-body">{{ shell.logText.value || "（暂无日志）" }}</pre>
  </SidebarBlock>
</template>

<style scoped>
.log-panel {
  border-top: 1px solid var(--border);
}

.log-panel :deep(.sidebar-block-body) {
  padding: 0;
}

.log-src {
  font-weight: 400;
  color: var(--muted);
}

.log-icon-btn {
  padding: 2px 4px;
  min-height: 0;
}

.log-body {
  flex: 1 1 auto;
  min-height: 0;
  margin: 0;
  padding: 6px 8px;
  overflow: auto;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 11px;
  line-height: 1.45;
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--text);
  background: transparent;
}
</style>
