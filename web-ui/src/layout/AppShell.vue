<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, type Component } from "vue";
import AppToolbar from "./AppToolbar.vue";
import NavSidebar from "./NavSidebar.vue";
import StatusBar from "./StatusBar.vue";
import WorkspaceTreeSidebar from "./WorkspaceTreeSidebar.vue";
import WorkbenchTabBar from "./WorkbenchTabBar.vue";
import HomePage from "../pages/HomePage.vue";
import BomApplyPage from "../pages/BomApplyPage.vue";
import FcstdMapPage from "../pages/FcstdMapPage.vue";
import XlinkFixPage from "../pages/XlinkFixPage.vue";
import PartDedupPage from "../pages/PartDedupPage.vue";
import StepBatchPage from "../pages/StepBatchPage.vue";
import SwStepExportPage from "../pages/SwStepExportPage.vue";
import PartCatalogPage from "../pages/PartCatalogPage.vue";
import PartKeyDetailPage from "../pages/PartKeyDetailPage.vue";
import FileRenamePage from "../pages/FileRenamePage.vue";
import BomExportPage from "../pages/BomExportPage.vue";
import PlaceholderPage from "../pages/PlaceholderPage.vue";
import { provideAppShell } from "../composables/useAppShell";
import ChoiceDialogHost from "../components/ChoiceDialogHost.vue";

const shell = provideAppShell();
const loading = ref(true);
const loadError = ref("");

const activeTab = computed(() => shell.activeTab());

const shellLayout = computed(() => shell.shellLayout.value);
const rightWidth = computed(() =>
  shellLayout.value.right_panel_open ? `${shellLayout.value.right_panel_width_px}px` : "0px",
);

const PAGE_COMPONENTS: Record<string, Component> = {
  home: HomePage,
  bom_apply: BomApplyPage,
  file_rename: FileRenamePage,
  rename_analysis: FileRenamePage,
  fcstd_map: FcstdMapPage,
  part_catalog: PartCatalogPage,
  part_key_detail: PartKeyDetailPage,
  xlink_fix: XlinkFixPage,
  part_dedup: PartDedupPage,
  step_batch: StepBatchPage,
  sw_step_export: SwStepExportPage,
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

onMounted(async () => {
  try {
    await shell.init();
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
    <AppToolbar />
    <div class="shell-body">
      <NavSidebar />
      <main class="shell-main" :style="{ marginRight: rightWidth }">
        <WorkbenchTabBar v-if="shell.showTabBar.value" />
        <div class="shell-pages">
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
