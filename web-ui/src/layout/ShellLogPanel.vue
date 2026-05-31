<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
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
  <section class="log-panel">
    <header class="log-head">
      <span class="log-title">
        运行日志
        <span v-if="sourceLabel" class="log-src">· {{ sourceLabel }}</span>
      </span>
      <div class="log-actions">
        <button type="button" class="mini" title="清空日志" @click="onClear">清空</button>
        <button type="button" class="mini" title="收起日志区" @click="onClose">×</button>
      </div>
    </header>
    <pre ref="preRef" class="log-body">{{ shell.logText.value || "（暂无日志）" }}</pre>
  </section>
</template>

<style scoped>
.log-panel {
  min-height: 0;
  height: 100%;
  display: flex;
  flex-direction: column;
  border-top: 1px solid var(--border);
  background: var(--sidebar-bg);
  overflow: hidden;
}

.log-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 4px 8px;
  border-bottom: 1px solid var(--border);
  background: var(--panel-head-bg);
}

.log-title {
  font-weight: 600;
  font-size: 0.78rem;
}

.log-src {
  font-weight: 400;
  color: var(--muted);
}

.log-actions {
  display: flex;
  gap: 4px;
}

.mini {
  padding: 1px 7px;
  border: 1px solid var(--border-strong);
  border-radius: 4px;
  background: var(--btn-bg);
  font-size: 0.72rem;
  cursor: pointer;
  line-height: 1.4;
}

.log-body {
  flex: 1;
  margin: 0;
  padding: 6px 8px 10px;
  overflow: auto;
  font-family: ui-monospace, Menlo, Consolas, monospace;
  font-size: 0.72rem;
  line-height: 1.35;
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--text);
}
</style>
