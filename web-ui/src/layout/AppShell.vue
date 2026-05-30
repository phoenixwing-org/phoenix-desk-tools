<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import AppToolbar from "./AppToolbar.vue";
import NavSidebar from "./NavSidebar.vue";
import StatusBar from "./StatusBar.vue";
import WorkspaceTreeSidebar from "./WorkspaceTreeSidebar.vue";
import HomePage from "../pages/HomePage.vue";
import BomApplyPage from "../pages/BomApplyPage.vue";
import FcstdMapPage from "../pages/FcstdMapPage.vue";
import XlinkFixPage from "../pages/XlinkFixPage.vue";
import PartDedupPage from "../pages/PartDedupPage.vue";
import StepBatchPage from "../pages/StepBatchPage.vue";
import SwStepExportPage from "../pages/SwStepExportPage.vue";
import PlaceholderPage from "../pages/PlaceholderPage.vue";
import { provideAppShell } from "../composables/useAppShell";

const shell = provideAppShell();
const loading = ref(true);
const loadError = ref("");

const shellLayout = computed(() => shell.shellLayout.value);
const rightWidth = computed(() =>
  shellLayout.value.right_panel_open ? `${shellLayout.value.right_panel_width_px}px` : "0px",
);

const pageComponent = computed(() => {
  switch (shell.currentPage.value) {
    case "home":
      return HomePage;
    case "bom_apply":
      return BomApplyPage;
    case "fcstd_map":
      return FcstdMapPage;
    case "xlink_fix":
      return XlinkFixPage;
    case "part_dedup":
      return PartDedupPage;
    case "step_batch":
      return StepBatchPage;
    case "sw_step_export":
      return SwStepExportPage;
    default:
      return PlaceholderPage;
  }
});

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

watch(
  () => shell.currentPage.value,
  () => {
    shell.registerTreeSelect(null);
  },
);

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
  shell.registerTreeSelect(null);
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
        <component :is="pageComponent" />
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
  </div>
</template>

<style scoped>
.shell {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
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
  overflow: auto;
  background: var(--page-bg);
  transition: margin-right 0.15s ease;
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
