<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, type Component } from "vue";
import AppToolbar from "./AppToolbar.vue";
import NavSidebar from "./NavSidebar.vue";
import StatusBar from "./StatusBar.vue";
import WorkspaceTreeSidebar from "./WorkspaceTreeSidebar.vue";
import WorkbenchTabBar from "./WorkbenchTabBar.vue";
import HomePage from "../pages/HomePage.vue";
import ConfigPage from "../pages/ConfigPage.vue";
import FileDetailPage from "../pages/FileDetailPage.vue";
import FcstdMapPage from "../pages/FcstdMapPage.vue";
import XlinkFixPage from "../pages/XlinkFixPage.vue";
import PartDedupPage from "../pages/PartDedupPage.vue";
import StepBatchPage from "../pages/StepBatchPage.vue";
import SwStepExportPage from "../pages/SwStepExportPage.vue";
import ReorderMembersPage from "../pages/ReorderMembersPage.vue";
import PartCatalogPage from "../pages/PartCatalogPage.vue";
import PartKeyDetailPage from "../pages/PartKeyDetailPage.vue";
import FileRenamePage from "../pages/FileRenamePage.vue";
import BomExportPage from "../pages/BomExportPage.vue";
import PlaceholderPage from "../pages/PlaceholderPage.vue";
import { fetchPhoenixDatabaseStatus, recreatePhoenixDatabase } from "../api";
import { provideAppShell } from "../composables/useAppShell";
import ChoiceDialogHost from "../components/ChoiceDialogHost.vue";
import AppModalOverlay from "../components/AppModalOverlay.vue";

const shell = provideAppShell();
const loading = ref(true);
const loadError = ref("");
const legacyDbBanner = ref(false);
const legacyDbReasons = ref<string[]>([]);
const legacyDbRecreating = ref(false);
const legacyDbError = ref("");

const activeTab = computed(() => shell.activeTab());

const shellLayout = computed(() => shell.shellLayout.value);
const rightWidth = computed(() =>
  shellLayout.value.right_panel_open ? `${shellLayout.value.right_panel_width_px}px` : "0px",
);

const PAGE_COMPONENTS: Record<string, Component> = {
  home: HomePage,
  config: ConfigPage,
  bom_apply: FileDetailPage,
  file_detail: FileDetailPage,
  file_rename: FileRenamePage,
  rename_analysis: FileRenamePage,
  fcstd_map: FcstdMapPage,
  part_catalog: PartCatalogPage,
  part_key_detail: PartKeyDetailPage,
  xlink_fix: XlinkFixPage,
  part_dedup: PartDedupPage,
  step_batch: StepBatchPage,
  sw_step_export: SwStepExportPage,
  reorder_members: ReorderMembersPage,
  bom_export: BomExportPage,
};

function pageComponent(pageId: string): Component {
  return PAGE_COMPONENTS[pageId] ?? PlaceholderPage;
}

function onResizeStart(e: MouseEvent) {
  e.preventDefault();
  const startX = e.clientX;
  const startW = shell.shellLayout.value.right_panel_width_px;

  function onMove(ev: MouseEvent) {
    const delta = startX - ev.clientX;
    const next = Math.min(560, Math.max(160, startW + delta));
    shell.shellLayout.value.right_panel_width_px = next;
  }

  async function onUp() {
    window.removeEventListener("mousemove", onMove);
    window.removeEventListener("mouseup", onUp);
    await shell.persistShellLayout({
      right_panel_width_px: shell.shellLayout.value.right_panel_width_px,
    });
  }

  window.addEventListener("mousemove", onMove);
  window.addEventListener("mouseup", onUp);
}

async function refreshLegacyDatabaseBanner() {
  try {
    const status = await fetchPhoenixDatabaseStatus();
    legacyDbBanner.value = status.needs_recreate;
    legacyDbReasons.value = status.reasons;
    legacyDbError.value = "";
  } catch (e) {
    legacyDbError.value = String(e);
  }
}

async function confirmRecreateLegacyDatabase() {
  const ok = window.confirm(
    "将删除当前工作空间数据库并创建空的 phoenix-workspace.sqlite（schema v10）。\n"
      + "遗留文件（cad-database.sqlite / phoenix-cad.sqlite）与含旧表名的库也会被清除。\n"
      + "CAD 索引、BOM 引用与改名历史需重新扫描。\n\n确定继续？",
  );
  if (!ok) return;
  legacyDbRecreating.value = true;
  legacyDbError.value = "";
  try {
    await recreatePhoenixDatabase();
    window.location.reload();
  } catch (e) {
    legacyDbError.value = String(e);
  } finally {
    legacyDbRecreating.value = false;
  }
}

onMounted(async () => {
  try {
    await shell.init();
    await refreshLegacyDatabaseBanner();
  } catch (e) {
    loadError.value = String(e);
  } finally {
    loading.value = false;
  }
});

onUnmounted(() => {
  for (const tab of shell.tabs.value) {
    shell.registerTreeSelect(tab.id, null);
  }
});
</script>

<template>
  <div v-if="loading" class="shell-loading">载入中…</div>
  <div v-else-if="loadError" class="shell-loading err">{{ loadError }}</div>
  <div v-else class="shell">
    <div v-if="legacyDbBanner" class="legacy-db-banner" role="alert">
      <div class="legacy-db-banner-text">
        <strong>检测到旧版 CAD 数据库</strong>
        <span>（旧库文件名或旧表名）。需重建为 phoenix-workspace.sqlite 后才能继续使用索引与 BOM 功能。</span>
        <span v-if="legacyDbReasons.length" class="legacy-db-reasons">{{ legacyDbReasons.join(" · ") }}</span>
        <span v-if="legacyDbError" class="legacy-db-error">{{ legacyDbError }}</span>
      </div>
      <button
        type="button"
        class="legacy-db-action"
        :disabled="legacyDbRecreating"
        @click="confirmRecreateLegacyDatabase"
      >
        {{ legacyDbRecreating ? "重建中…" : "确认重建数据库" }}
      </button>
    </div>
    <AppToolbar />
    <div class="shell-body">
      <NavSidebar />
      <main class="shell-main" :style="{ marginRight: rightWidth }">
        <WorkbenchTabBar v-if="shell.showTabBar.value" />
        <div class="shell-pages" data-tour="main-content">
          <KeepAlive :max="24">
            <component
              v-if="activeTab"
              :key="activeTab.id"
              :is="pageComponent(activeTab.pageId)"
              :workbench-tab-id="activeTab.id"
            />
          </KeepAlive>
        </div>
      </main>
      <div
        v-if="shellLayout.right_panel_open"
        class="shell-resizer"
        :style="{ right: rightWidth }"
        title="拖拽调节宽度"
        @mousedown="onResizeStart"
      />
      <WorkspaceTreeSidebar />
    </div>
    <StatusBar />
    <ChoiceDialogHost />
    <AppModalOverlay
      :open="shell.configOverlayOpen.value"
      aria-label="配置"
      panel-class="config-modal-panel"
      @close="shell.closeConfig()"
    >
      <ConfigPage />
    </AppModalOverlay>
  </div>
</template>

<style scoped>
.shell {
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--shell-bg);
}

.legacy-db-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 10px 16px;
  background: #fef3c7;
  border-bottom: 1px solid #f59e0b;
  color: #92400e;
  font-size: 13px;
}

.legacy-db-banner-text {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.legacy-db-reasons,
.legacy-db-error {
  font-size: 12px;
  opacity: 0.9;
}

.legacy-db-error {
  color: #b45309;
}

.legacy-db-action {
  flex-shrink: 0;
  padding: 6px 12px;
  border: 1px solid #d97706;
  border-radius: 6px;
  background: #fff;
  color: #92400e;
  cursor: pointer;
  font-size: 13px;
}

.legacy-db-action:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.shell-loading {
  min-height: 100vh;
  display: grid;
  place-items: center;
  color: #64748b;
}

.shell-loading.err {
  color: #b45309;
  padding: 24px;
  text-align: center;
}

.shell-body {
  flex: 1;
  display: flex;
  min-height: 0;
  position: relative;
}

.shell-main {
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  background: var(--page-bg);
  transition: margin-right 0.15s ease;
}

.shell-pages {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  position: relative;
}

.shell-pages :deep(> .page),
.shell-pages :deep(> div) {
  width: 100%;
  max-width: none;
  box-sizing: border-box;
  height: 100%;
  overflow: auto;
}

.shell-resizer {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 6px;
  margin-right: -3px;
  cursor: col-resize;
  z-index: 5;
  background: transparent;
}

.shell-resizer:hover {
  background: rgba(59, 130, 246, 0.25);
}
</style>

<style>
/* 配置弹层内容区（非 scoped，作用于 ConfigPage 根节点） */
.config-modal-panel .config-page {
  padding: 20px 24px 28px;
  box-sizing: border-box;
}
</style>
