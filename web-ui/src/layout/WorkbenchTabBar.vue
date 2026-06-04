<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from "vue";
import { useAppShell } from "../composables/useAppShell";

const shell = useAppShell();

const tabs = computed(() => shell.tabBarTabs.value);
const activeId = computed(() => shell.activeTabId.value);

const scrollEl = ref<HTMLElement | null>(null);
const tabEls = new Map<string, HTMLElement>();

function setTabRef(tabId: string, el: Element | null) {
  if (el instanceof HTMLElement) tabEls.set(tabId, el);
  else tabEls.delete(tabId);
}

function scrollActiveIntoView(behavior: ScrollBehavior = "smooth") {
  const id = activeId.value;
  if (!id) return;
  const container = scrollEl.value;
  const el = tabEls.get(id);
  if (!container || !el) return;

  const pad = 6;
  const tabLeft = el.offsetLeft;
  const tabRight = tabLeft + el.offsetWidth;
  const viewLeft = container.scrollLeft;
  const viewRight = viewLeft + container.clientWidth;

  if (tabLeft < viewLeft + pad) {
    container.scrollTo({ left: Math.max(0, tabLeft - pad), behavior });
  } else if (tabRight > viewRight - pad) {
    container.scrollTo({
      left: tabRight - container.clientWidth + pad,
      behavior,
    });
  }
}

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

const canCloseAll = computed(() => tabs.value.length > 1);
const closingAll = ref(false);

async function onCloseAll() {
  if (!canCloseAll.value || closingAll.value) return;
  const count = tabs.value.length;
  closingAll.value = true;
  try {
    const ok = await shell.closeAllTabs();
    if (ok) {
      const msg = `已关闭 ${count} 个 Tab，已回到首页`;
      shell.setStatus(msg);
      shell.appendLog(`[Tab] ${msg}`, { source: "workbench" });
    } else {
      shell.setStatus("已取消：未关闭 Tab");
    }
  } catch (e) {
    shell.setStatus(String(e));
  } finally {
    closingAll.value = false;
  }
}

watch(activeId, () => {
  void nextTick(() => scrollActiveIntoView());
});

watch(
  tabs,
  () => {
    void nextTick(() => scrollActiveIntoView("auto"));
  },
  { deep: true },
);

onMounted(() => {
  void nextTick(() => scrollActiveIntoView("auto"));
});
</script>

<template>
  <div class="tab-bar" data-tour="tab-bar">
    <div ref="scrollEl" class="tab-scroll" role="tablist">
      <button
        v-for="tab in tabs"
        :key="tab.id"
        :ref="(el) => setTabRef(tab.id, el as Element | null)"
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
    </div>
    <button
      v-if="canCloseAll"
      type="button"
      class="tab-close-all"
      :disabled="closingAll"
      title="关闭当前打开的全部 Tab（有未保存时将提示确认）"
      @click="onCloseAll"
    >
      {{ closingAll ? "…" : "全部关闭" }}
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
  gap: 0;
  min-height: 36px;
  padding: 4px 8px 0;
  background: var(--shell-bg, #f1f5f9);
  border-bottom: 1px solid var(--border, #e2e8f0);
  overflow: hidden;
}

.tab-scroll {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: stretch;
  gap: 2px;
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: thin;
  padding-right: 2px;
}

.tab-scroll::-webkit-scrollbar {
  height: 4px;
}

.tab-scroll::-webkit-scrollbar-thumb {
  background: rgba(148, 163, 184, 0.45);
  border-radius: 4px;
}

.tab-item {
  display: inline-flex;
  flex-shrink: 0;
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

.tab-close-all {
  flex-shrink: 0;
  align-self: center;
  height: 28px;
  margin-left: 8px;
  padding: 0 10px;
  border: 1px solid var(--border, #cbd5e1);
  border-radius: 6px;
  background: var(--shell-bg, #f1f5f9);
  color: var(--muted, #64748b);
  font-size: 0.75rem;
  cursor: pointer;
  box-shadow: -6px 0 8px -4px var(--shell-bg, #f1f5f9);
}

.tab-close-all:hover:not(:disabled) {
  border-color: #f87171;
  color: #b91c1c;
  background: #fef2f2;
}

.tab-close-all:disabled {
  opacity: 0.55;
  cursor: default;
}

.tab-add {
  flex-shrink: 0;
  align-self: center;
  width: 28px;
  height: 28px;
  margin-left: 6px;
  border: 1px dashed var(--border, #cbd5e1);
  border-radius: 6px;
  background: var(--shell-bg, #f1f5f9);
  color: var(--muted, #64748b);
  font-size: 1.1rem;
  cursor: pointer;
  box-shadow: -6px 0 8px -4px var(--shell-bg, #f1f5f9);
}

.tab-add:hover {
  border-color: var(--accent, #3b82f6);
  color: var(--accent, #3b82f6);
}
</style>
