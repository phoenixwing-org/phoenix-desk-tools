<script setup lang="ts">
import { ref } from "vue";
import { ArrowDown, FolderOpened } from "@element-plus/icons-vue";
import { useWorkspaceSwitcher } from "../../composables/useWorkspaceSwitcher";

defineProps<{
  layout?: "group" | "inline";
}>();

const menuOpen = ref(false);

const { workspacePath, workspaceShort, recent, pickRecent, removeRecent, openConfig } =
  useWorkspaceSwitcher();

async function onPick(path: string) {
  menuOpen.value = false;
  await pickRecent(path);
}

function onManage() {
  menuOpen.value = false;
  openConfig();
}
</script>

<template>
  <div
    class="ribbon-workspace-switcher"
    :class="{ 'layout-inline': layout === 'inline' }"
    data-tour="ribbon-workspace"
  >
    <div class="ribbon-workspace-body">
      <el-popover
        v-model:visible="menuOpen"
        placement="bottom-start"
        :width="360"
        trigger="click"
        popper-class="ribbon-workspace-popover"
      >
        <template #reference>
          <span class="ribbon-workspace-ref">
            <button
              v-if="layout === 'inline'"
              type="button"
              class="ribbon-workspace-trigger"
              :class="{ open: menuOpen }"
              :title="workspacePath || '未设置工作空间'"
            >
              <FolderOpened class="ribbon-workspace-icon" />
              <span class="ribbon-workspace-name">{{ workspaceShort }}</span>
              <ArrowDown class="ribbon-workspace-chevron" />
            </button>
            <el-tooltip
              v-else
              placement="bottom"
              :content="workspacePath || '未设置工作空间'"
              :show-after="400"
              popper-class="shell-panel-toggle-tooltip"
            >
              <button
                type="button"
                class="ribbon-workspace-stacked"
                :class="{ open: menuOpen }"
                :aria-label="`工作空间：${workspaceShort || '未设置'}`"
              >
                <el-icon class="ribbon-workspace-big-icon" aria-hidden="true">
                  <FolderOpened />
                </el-icon>
                <span class="ribbon-workspace-combo" aria-hidden="true">
                  <span class="ribbon-workspace-name">{{ workspaceShort || "选择…" }}</span>
                  <ArrowDown class="ribbon-workspace-chevron" />
                </span>
              </button>
            </el-tooltip>
          </span>
        </template>

        <div class="ribbon-workspace-menu">
          <div v-for="p in recent" :key="p" class="recent-row">
            <button
              type="button"
              class="recent-item"
              :class="{ current: p === workspacePath }"
              @click="onPick(p)"
            >
              {{ p === workspacePath ? "● " : "" }}{{ p }}
            </button>
            <button
              type="button"
              class="recent-remove"
              title="从最近列表移除"
              @click="removeRecent(p, $event)"
            >
              ×
            </button>
          </div>
          <p v-if="!recent.length" class="recent-empty">尚无记录</p>
          <button v-if="recent.length" type="button" class="recent-manage" @click="onManage">
            管理最近列表…
          </button>
          <button v-else type="button" class="recent-manage" @click="onManage">
            打开配置设置工作空间…
          </button>
        </div>
      </el-popover>
    </div>
  </div>
</template>

<style scoped>
.ribbon-workspace-switcher {
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  min-width: 0;
  padding: 0 8px;
  border-right: 1px solid var(--ribbon-group-divider);
  justify-content: center;
}

.ribbon-workspace-switcher.layout-inline {
  flex-direction: row;
  align-items: center;
  padding: 0 4px 0 6px;
  border-right: none;
  border-left: 1px solid var(--ribbon-group-divider);
}

.ribbon-workspace-body {
  display: flex;
  align-items: center;
  flex: 1;
  min-height: 0;
  padding: 0;
}

.ribbon-workspace-ref {
  display: inline-flex;
  line-height: 0;
}

.ribbon-workspace-ref :deep(.el-tooltip__trigger) {
  display: inline-flex;
}

/* 单行模式 */
.ribbon-workspace-trigger {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  max-width: min(220px, 28vw);
  height: 32px;
  margin: 0;
  padding: 0 10px;
  border: 1px solid #c8ced8;
  border-radius: var(--ribbon-btn-radius, 2px);
  background: linear-gradient(180deg, #fff 0%, #f4f6f8 100%);
  color: #334155;
  font-size: 0.72rem;
  line-height: 1.2;
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
}

/* 分组模式：大图标 + 下方 comb */
.ribbon-workspace-stacked {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 3px;
  width: 76px;
  min-width: 76px;
  max-width: 88px;
  min-height: 54px;
  margin: 0;
  padding: 4px 2px 3px;
  border: 1px solid transparent;
  border-radius: var(--ribbon-btn-radius, 2px);
  background: transparent;
  color: #334155;
  cursor: pointer;
}

.ribbon-workspace-stacked:hover,
.ribbon-workspace-stacked.open {
  background: var(--ribbon-btn-hover, rgba(148, 163, 184, 0.12));
}

.ribbon-workspace-big-icon {
  width: 26px;
  height: 26px;
  font-size: 24px;
  color: #334155;
}

.ribbon-workspace-stacked:hover .ribbon-workspace-big-icon,
.ribbon-workspace-stacked.open .ribbon-workspace-big-icon {
  color: var(--phoenix-wps-accent, #217346);
}

.ribbon-workspace-combo {
  display: inline-flex;
  align-items: center;
  gap: 1px;
  width: 100%;
  max-width: 72px;
  height: 18px;
  padding: 0 3px 0 5px;
  border: 1px solid #c8ced8;
  border-radius: 2px;
  background: linear-gradient(180deg, #fff 0%, #f4f6f8 100%);
  box-sizing: border-box;
}

.ribbon-workspace-stacked:hover .ribbon-workspace-combo,
.ribbon-workspace-stacked.open .ribbon-workspace-combo {
  border-color: #93c5fd;
  background: #eff6ff;
  color: #1d4ed8;
}

.ribbon-workspace-trigger:hover,
.ribbon-workspace-trigger.open {
  border-color: #93c5fd;
  background: #eff6ff;
  color: #1d4ed8;
}

.ribbon-workspace-icon {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
  color: #64748b;
}

.ribbon-workspace-trigger:hover .ribbon-workspace-icon,
.ribbon-workspace-trigger.open .ribbon-workspace-icon {
  color: #1d4ed8;
}

.ribbon-workspace-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
  font-size: 0.62rem;
  line-height: 1.1;
  white-space: nowrap;
  text-align: left;
}

.ribbon-workspace-combo .ribbon-workspace-name {
  text-align: left;
}

.ribbon-workspace-chevron {
  width: 10px;
  height: 10px;
  flex-shrink: 0;
  color: #64748b;
}

.ribbon-workspace-stacked.open .ribbon-workspace-chevron,
.ribbon-workspace-stacked:hover .ribbon-workspace-chevron {
  color: #1d4ed8;
}

.ribbon-workspace-menu {
  padding: 2px;
}

.recent-row {
  display: flex;
  align-items: stretch;
  gap: 4px;
  margin-bottom: 2px;
}

.recent-item {
  flex: 1;
  display: block;
  text-align: left;
  padding: 8px 10px;
  border: none;
  border-radius: 6px;
  background: transparent;
  font-size: 0.82rem;
  word-break: break-all;
  cursor: pointer;
}

.recent-item:hover {
  background: #eef2ff;
}

.recent-item.current {
  background: #dbeafe;
  font-weight: 500;
}

.recent-remove {
  flex-shrink: 0;
  width: 28px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--muted, #64748b);
  font-size: 1rem;
  line-height: 1;
  cursor: pointer;
}

.recent-remove:hover {
  background: #fee2e2;
  color: #b91c1c;
}

.recent-manage {
  display: block;
  width: 100%;
  margin-top: 4px;
  padding: 6px 10px;
  border: none;
  border-top: 1px solid var(--border, #e2e8f0);
  border-radius: 0 0 6px 6px;
  background: transparent;
  font-size: 0.78rem;
  color: var(--muted, #64748b);
  text-align: left;
  cursor: pointer;
}

.recent-manage:hover {
  background: #f8fafc;
  color: var(--accent, #2563eb);
}

.recent-empty {
  margin: 8px;
  font-size: 0.82rem;
  color: var(--muted, #64748b);
}
</style>

<style>
.ribbon-workspace-popover {
  z-index: 8000 !important;
}
</style>
