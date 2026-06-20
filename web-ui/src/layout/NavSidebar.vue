<script setup lang="ts">
import { computed } from "vue";
import { useAppShell } from "../composables/useAppShell";

const shell = useAppShell();
const shellLayout = computed(() => shell.shellLayout.value);

async function toggleRight() {
  await shell.persistShellLayout({
    right_panel_open: !shell.shellLayout.value.right_panel_open,
  });
}

function openGuide() {
  shell.openOnboardingGuide();
}

function openSettings() {
  shell.openConfig();
}

function hover(tip: string | null) {
  shell.navHover.value = tip;
}
</script>

<template>
  <nav class="quick-rail" data-tour="quick-rail">
    <div class="quick-rail-spacer" />

    <button
      type="button"
      class="quick-rail-btn"
      title="新手指南与界面巡游"
      data-tour="nav-guide"
      @click="openGuide"
      @mouseenter="hover('新手指引：四步开工清单')"
      @mouseleave="hover(null)"
    >
      ?
    </button>

    <button
      type="button"
      class="quick-rail-btn"
      data-tour="nav-config"
      :class="{ active: shell.configOverlayOpen.value }"
      title="配置"
      @click="openSettings"
      @mouseenter="hover('工作空间、FreeCAD 路径与界面偏好')"
      @mouseleave="hover(null)"
    >
      ⚙
    </button>

    <button
      type="button"
      class="quick-rail-btn quick-rail-dock"
      :title="shellLayout.right_panel_open ? '收起工作空间树' : '展开工作空间树'"
      @click="toggleRight"
      @mouseenter="hover('工作空间树：展开 / 收起')"
      @mouseleave="hover(null)"
    >
      {{ shellLayout.right_panel_open ? "«" : "»" }}
    </button>
  </nav>
</template>

<style scoped>
.quick-rail {
  width: 28px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  background: var(--nav-bg);
  border-right: 1px solid var(--border);
  padding: 4px 2px 6px;
}

.quick-rail-spacer {
  flex: 1;
  min-height: 4px;
}

.quick-rail-btn {
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--text);
  font-size: 0.82rem;
  line-height: 1;
  cursor: pointer;
  min-height: 28px;
  margin: 1px 0;
  padding: 0;
  text-align: center;
}

.quick-rail-btn:hover {
  background: var(--nav-hover);
}

.quick-rail-btn.active {
  background: var(--accent);
  color: #fff;
}

.quick-rail-dock {
  margin-top: 4px;
  padding-top: 4px;
  border-top: 1px solid var(--border);
  color: var(--muted);
  font-size: 0.95rem;
}
</style>
