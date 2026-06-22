<script setup lang="ts">
import { ref } from "vue";
import { Collection, Document, FolderOpened, List, Operation } from "@element-plus/icons-vue";
import RibbonToolButton from "../layout/ribbon/RibbonToolButton.vue";
import SideDockPrefsPanel from "./SideDockPrefsPanel.vue";
import { useShellPanelToggles } from "../composables/useShellPanelToggles";

withDefaults(
  defineProps<{
    /** ribbon = Ribbon 右侧壳层区；footer = 页脚 VS Code 式图标 */
    variant?: "ribbon" | "footer";
    /** ribbon 时分组大图标 / 单行紧凑 */
    layout?: "group" | "inline";
  }>(),
  { variant: "footer", layout: "group" },
);

const sideDockOpen = ref(false);

const {
  panelOpen,
  logOpen,
  propsOpen,
  worksetOpen,
  hasProperties,
  hasLogContent,
  treeTip,
  propsTip,
  logTip,
  worksetTip,
  sideDockTip,
  togglePanel,
  toggleLog,
  toggleProps,
  openWorksetPanel,
} = useShellPanelToggles();

const footerTipProps = {
  placement: "top" as const,
  showAfter: 400,
  popperClass: "shell-panel-toggle-tooltip",
};
</script>

<template>
  <div
    class="shell-panel-toggles"
    :class="[
      `variant-${variant}`,
      variant === 'ribbon' ? `layout-${layout}` : '',
    ]"
  >
    <template v-if="variant === 'footer'">
      <el-tooltip v-bind="footerTipProps" :content="treeTip">
        <button
          type="button"
          class="status-toggle"
          :class="{ active: panelOpen }"
          :aria-label="treeTip"
          :aria-pressed="panelOpen"
          @click="togglePanel"
        >
          <el-icon><FolderOpened /></el-icon>
        </button>
      </el-tooltip>
      <el-tooltip v-if="hasProperties" v-bind="footerTipProps" :content="propsTip">
        <button
          type="button"
          class="status-toggle"
          :class="{ active: propsOpen }"
          :aria-label="propsTip"
          :aria-pressed="propsOpen"
          @click="toggleProps"
        >
          <el-icon><List /></el-icon>
        </button>
      </el-tooltip>
      <el-tooltip v-bind="footerTipProps" :content="logTip">
        <button
          type="button"
          class="status-toggle"
          :class="{ active: logOpen }"
          :aria-label="logTip"
          :aria-pressed="logOpen"
          @click="toggleLog"
        >
          <el-icon><Document /></el-icon>
          <span v-if="hasLogContent && !logOpen" class="toggle-dot" aria-hidden="true" />
        </button>
      </el-tooltip>
      <el-tooltip v-bind="footerTipProps" :content="worksetTip">
        <button
          type="button"
          class="status-toggle"
          :class="{ active: worksetOpen }"
          :aria-label="worksetTip"
          :aria-pressed="worksetOpen"
          @click="openWorksetPanel"
        >
          <el-icon><Collection /></el-icon>
        </button>
      </el-tooltip>
      <el-popover
        v-model:visible="sideDockOpen"
        placement="top-end"
        :width="280"
        trigger="click"
        popper-class="ribbon-side-dock-popover"
        title="侧栏停靠"
      >
        <template #reference>
          <span class="status-toggle-ref">
            <el-tooltip v-bind="footerTipProps" :content="sideDockTip" :disabled="sideDockOpen">
              <button
                type="button"
                class="status-toggle"
                :class="{ active: sideDockOpen }"
                :aria-label="sideDockTip"
                :aria-pressed="sideDockOpen"
              >
                <el-icon><Operation /></el-icon>
              </button>
            </el-tooltip>
          </span>
        </template>
        <SideDockPrefsPanel compact :show-log-switch="false" />
      </el-popover>
    </template>

    <template v-else-if="layout === 'inline'">
      <button
        type="button"
        class="ribbon-util-btn"
        :class="{ active: panelOpen }"
        :title="treeTip"
        @click="togglePanel"
      >
        <span class="ribbon-util-icon"><el-icon><FolderOpened /></el-icon></span>
        <span class="ribbon-util-label">工作空间树</span>
      </button>
      <button
        type="button"
        class="ribbon-util-btn"
        :class="{ active: worksetOpen }"
        :title="worksetTip"
        @click="openWorksetPanel"
      >
        <span class="ribbon-util-icon"><el-icon><Collection /></el-icon></span>
        <span class="ribbon-util-label">工作集</span>
      </button>
      <button
        v-if="hasProperties"
        type="button"
        class="ribbon-util-btn"
        :class="{ active: propsOpen }"
        :title="propsTip"
        @click="toggleProps"
      >
        <span class="ribbon-util-icon"><el-icon><List /></el-icon></span>
        <span class="ribbon-util-label">页面属性</span>
      </button>
      <button
        type="button"
        class="ribbon-util-btn"
        :class="{ active: logOpen }"
        :title="logTip"
        @click="toggleLog"
      >
        <span class="ribbon-util-icon"><el-icon><Document /></el-icon></span>
        <span class="ribbon-util-label">运行日志</span>
      </button>
      <el-popover
        v-model:visible="sideDockOpen"
        placement="bottom-end"
        :width="280"
        trigger="click"
        popper-class="ribbon-side-dock-popover"
        title="侧栏停靠"
      >
        <template #reference>
          <button
            type="button"
            class="ribbon-util-btn"
            :class="{ active: sideDockOpen }"
            :title="sideDockTip"
          >
            <span class="ribbon-util-icon"><el-icon><Operation /></el-icon></span>
            <span class="ribbon-util-label">侧栏</span>
          </button>
        </template>
        <SideDockPrefsPanel compact :show-log-switch="false" />
      </el-popover>
    </template>

    <template v-else>
      <RibbonToolButton
        label="工作空间树"
        :icon="FolderOpened"
        size="large"
        layout="stacked"
        :active="panelOpen"
        :title="treeTip"
        @click="togglePanel"
      />
      <RibbonToolButton
        label="工作集"
        :icon="Collection"
        size="large"
        layout="stacked"
        :active="worksetOpen"
        :title="worksetTip"
        @click="openWorksetPanel"
      />
      <RibbonToolButton
        v-if="hasProperties"
        label="页面属性"
        :icon="List"
        size="large"
        layout="stacked"
        :active="propsOpen"
        :title="propsTip"
        @click="toggleProps"
      />
      <RibbonToolButton
        label="运行日志"
        :icon="Document"
        size="large"
        layout="stacked"
        :active="logOpen"
        :title="logTip"
        @click="toggleLog"
      />
      <el-popover
        v-model:visible="sideDockOpen"
        placement="bottom-end"
        :width="280"
        trigger="click"
        popper-class="ribbon-side-dock-popover"
        title="侧栏停靠"
      >
        <template #reference>
          <span class="ribbon-util-ref">
            <RibbonToolButton
              label="侧栏"
              :icon="Operation"
              size="large"
              layout="stacked"
              :active="sideDockOpen"
              :title="sideDockTip"
            />
          </span>
        </template>
        <SideDockPrefsPanel compact :show-log-switch="false" />
      </el-popover>
    </template>
  </div>
</template>

<style scoped>
.shell-panel-toggles {
  display: flex;
  align-items: center;
  flex-shrink: 0;
}

.variant-footer {
  gap: 2px;
  padding-left: 8px;
  border-left: 1px solid var(--phoenix-border, #e2e8f0);
}

.variant-footer :deep(.el-tooltip__trigger) {
  display: inline-flex;
}

.status-toggle-ref {
  display: inline-flex;
  line-height: 0;
}

.status-toggle {
  position: relative;
  width: 26px;
  height: 22px;
  padding: 0;
  margin: 0;
  border: none;
  border-radius: 3px;
  background: transparent;
  color: var(--phoenix-text-muted, #64748b);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}

.status-toggle:hover {
  background: color-mix(in srgb, var(--phoenix-text-muted) 12%, transparent);
  color: var(--text, #334155);
}

.status-toggle.active {
  color: #1d4ed8;
  background: rgba(59, 130, 246, 0.14);
}

.status-toggle :deep(.el-icon) {
  font-size: 14px;
}

.toggle-dot {
  position: absolute;
  top: 2px;
  right: 2px;
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: #f59e0b;
}

.variant-ribbon {
  gap: 2px;
}

.variant-ribbon.layout-group {
  align-items: stretch;
  padding: 0 8px;
  border-left: 1px solid var(--ribbon-group-divider);
}

.variant-ribbon.layout-inline {
  gap: 2px;
}

.ribbon-util-ref {
  display: inline-flex;
  line-height: 0;
}

.ribbon-util-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  flex-shrink: 0;
  height: 36px;
  margin: 0;
  padding: 0 10px;
  border: 1px solid transparent;
  border-radius: var(--ribbon-btn-radius, 2px);
  background: transparent;
  color: var(--text, #334155);
  font-size: 0.72rem;
  line-height: 1.2;
  cursor: pointer;
  white-space: nowrap;
}

.ribbon-util-btn:hover {
  background: var(--ribbon-btn-hover, rgba(148, 163, 184, 0.15));
  border-color: var(--border, #e2e8f0);
}

.ribbon-util-btn.active {
  background: #dbeafe;
  border-color: #93c5fd;
  color: #1d4ed8;
}

.ribbon-util-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 15px;
  height: 15px;
}

.ribbon-util-icon :deep(svg) {
  width: 15px;
  height: 15px;
}

.ribbon-util-btn.active .ribbon-util-icon {
  color: #1d4ed8;
}
</style>

<style>
.ribbon-side-dock-popover {
  z-index: 8000 !important;
}

.shell-panel-toggle-tooltip {
  max-width: 280px;
  font-size: 0.78rem;
  line-height: 1.35;
}
</style>
