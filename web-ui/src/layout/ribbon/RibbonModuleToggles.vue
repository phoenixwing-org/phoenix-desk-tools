<script setup lang="ts">
import { NAV_MODULE_OPTIONS } from "../../constants/navModules";
import { useAppShell } from "../../composables/useAppShell";

defineProps<{
  layout?: "group" | "inline";
}>();

const shell = useAppShell();

function isModuleEnabled(id: string): boolean {
  return shell.enabledNavModules.value.includes(id);
}

function moduleChipTitle(opt: (typeof NAV_MODULE_OPTIONS)[number]): string {
  const on = isModuleEnabled(opt.id);
  return `${opt.label}：${opt.hint}（${on ? "已启用，点击关闭" : "已关闭，点击启用"}）`;
}

async function toggleModule(id: string) {
  await shell.toggleNavModule(id);
}
</script>

<template>
  <div
    class="ribbon-module-toggles"
    :class="{ 'layout-inline': layout === 'inline' }"
    aria-label="功能模块"
    data-tour="ribbon-modules"
  >
    <div class="ribbon-module-body">
      <button
        v-for="opt in NAV_MODULE_OPTIONS"
        :key="opt.id"
        type="button"
        class="ribbon-module-btn"
        :class="{ on: isModuleEnabled(opt.id) }"
        :title="moduleChipTitle(opt)"
        @click="toggleModule(opt.id)"
      >
        {{ opt.shortLabel }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.ribbon-module-toggles {
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  min-width: 0;
  padding: 0 8px;
  border-right: 1px solid var(--ribbon-group-divider);
  justify-content: center;
}

.ribbon-module-toggles.layout-inline {
  flex-direction: row;
  align-items: center;
  padding: 0 4px 0 6px;
  border-right: none;
  border-left: 1px solid var(--ribbon-group-divider);
}

.ribbon-module-body {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  justify-content: center;
  gap: 2px;
  flex: 1;
  min-height: 0;
  min-width: 48px;
  max-height: 66px;
  padding: 0;
}

.layout-inline .ribbon-module-body {
  flex-direction: row;
  align-items: center;
  max-height: none;
  min-width: 0;
  padding: 0;
  gap: 2px;
}

.ribbon-module-btn {
  height: 20px;
  min-width: 0;
  width: 100%;
  padding: 0 8px;
  border: 1px solid transparent;
  border-radius: var(--ribbon-btn-radius, 2px);
  background: transparent;
  color: #64748b;
  font-size: 0.66rem;
  font-weight: 600;
  line-height: 1;
  cursor: pointer;
  white-space: nowrap;
  text-align: center;
}

.layout-inline .ribbon-module-btn {
  height: 28px;
  min-width: 0;
  padding: 0 12px;
  font-size: 0.72rem;
}

.ribbon-module-btn.on {
  color: #1d4ed8;
  background: #dbeafe;
  border-color: #93c5fd;
}

.ribbon-module-btn:hover {
  background: var(--ribbon-btn-hover, rgba(148, 163, 184, 0.15));
  border-color: var(--border, #e2e8f0);
}

.ribbon-module-btn.on:hover {
  background: #bfdbfe;
  border-color: #60a5fa;
}
</style>
