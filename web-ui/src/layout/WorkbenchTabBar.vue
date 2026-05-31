<script setup lang="ts">
import { computed } from "vue";
import { useAppShell } from "../composables/useAppShell";

const shell = useAppShell();

const tabs = computed(() => shell.tabBarTabs.value);
const activeId = computed(() => shell.activeTabId.value);

function onSelect(tabId: string) {
  shell.activateTab(tabId);
}

async function onClose(tabId: string, e: MouseEvent) {
  e.stopPropagation();
  await shell.closeTab(tabId);
}

function onNewTab() {
  const tab = shell.activeTab();
  if (!tab) return;
  try {
    shell.openNewTabForPage(tab.pageId);
  } catch (err) {
    shell.setStatus(String(err));
  }
}

const canAdd = computed(() => {
  const tab = shell.activeTab();
  if (!tab) return false;
  return shell.canOpenNewTab(tab.pageId);
});
</script>

<template>
  <div class="tab-bar" role="tablist">
    <button
      v-for="tab in tabs"
      :key="tab.id"
      type="button"
      class="tab-item"
      :class="{ active: tab.id === activeId, dirty: tab.dirty }"
      role="tab"
      :aria-selected="tab.id === activeId"
      :title="tab.subtitle || tab.title"
      @click="onSelect(tab.id)"
    >
      <span class="tab-title">{{ tab.title }}</span>
      <span v-if="tab.dirty" class="tab-dot" aria-label="未保存">●</span>
      <span class="tab-close" title="关闭 Tab" @click="onClose(tab.id, $event)">×</span>
    </button>
    <button
      v-if="canAdd"
      type="button"
      class="tab-add"
      title="新建 Tab"
      @click="onNewTab"
    >
      +
    </button>
  </div>
</template>

<style scoped>
.tab-bar {
  flex-shrink: 0;
  display: flex;
  align-items: stretch;
  gap: 2px;
  min-height: 36px;
  padding: 4px 8px 0;
  background: var(--shell-bg, #f1f5f9);
  border-bottom: 1px solid var(--border, #e2e8f0);
  overflow-x: auto;
}

.tab-item {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  max-width: 220px;
  padding: 6px 8px 6px 12px;
  border: 1px solid transparent;
  border-bottom: none;
  border-radius: 6px 6px 0 0;
  background: transparent;
  color: var(--muted, #64748b);
  font-size: 0.82rem;
  cursor: pointer;
  white-space: nowrap;
}

.tab-item:hover {
  background: var(--nav-hover, rgba(148, 163, 184, 0.15));
  color: var(--text, #334155);
}

.tab-item.active {
  background: var(--page-bg, #fff);
  border-color: var(--border, #e2e8f0);
  color: var(--text, #0f172a);
  margin-bottom: -1px;
  padding-bottom: 7px;
}

.tab-title {
  overflow: hidden;
  text-overflow: ellipsis;
}

.tab-dot {
  color: #f59e0b;
  font-size: 0.65rem;
  line-height: 1;
}

.tab-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  margin-left: 2px;
  border-radius: 4px;
  font-size: 1rem;
  line-height: 1;
  opacity: 0.55;
}

.tab-close:hover {
  opacity: 1;
  background: rgba(148, 163, 184, 0.25);
}

.tab-add {
  flex-shrink: 0;
  align-self: center;
  width: 28px;
  height: 28px;
  margin-left: 4px;
  border: 1px dashed var(--border, #cbd5e1);
  border-radius: 6px;
  background: transparent;
  color: var(--muted, #64748b);
  font-size: 1.1rem;
  cursor: pointer;
}

.tab-add:hover {
  border-color: var(--accent, #3b82f6);
  color: var(--accent, #3b82f6);
}
</style>
