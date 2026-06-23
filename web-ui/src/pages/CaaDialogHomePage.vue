<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { fetchCodeIndexCatDlg, scanCodeIndex } from "../api";
import PageHeader from "../components/PageHeader.vue";
import CaaDialogHomeView from "../components/caa/CaaDialogHomeView.vue";
import { fetchCaaHealth } from "../api/caaDialog";
import { CAA_HOME_PAGE_ID } from "../constants/caaPages";
import { useAppShell } from "../composables/useAppShell";
import { useCaaDialogHomePropertySheet } from "../composables/useCaaDialogHomePropertySheet";
import { usePageSummary } from "../composables/usePageSummary";
import { useCaaDialogPageStore } from "../stores/caaDialogPage";
import type { CaaDialogListGroup, CaaDialogListItem } from "../types/caaDialogList";
import { buildCatDlgGroupsFromIndex } from "../utils/caaDialogListFromIndex";

const PAGE_ID = CAA_HOME_PAGE_ID;
const shell = useAppShell();
const store = useCaaDialogPageStore();

const workspacePath = computed(() => shell.workspacePath.value.trim());
const workspaceReady = computed(() => workspacePath.value.length > 0);

const dialogGroups = ref<CaaDialogListGroup[]>([]);
const dialogCount = ref(0);
const moduleCount = ref(0);
const listLoading = ref(false);
const scanning = ref(false);
const listErrorText = ref("");
const hasScan = ref(false);
const indexed = ref(false);
const lastScanAt = ref<string | null>(null);
const lastLoadedAt = ref<string | null>(null);

useCaaDialogHomePropertySheet(PAGE_ID, {
  dialogCount,
  moduleCount,
  lastScanAt,
  indexed,
  lastLoadedAt,
  listLoading,
});

async function checkHealth() {
  try {
    store.setCaaHealth(await fetchCaaHealth(), true);
  } catch {
    store.setCaaHealth(null, false);
  }
}

async function loadFromIndex() {
  if (!workspaceReady.value) {
    dialogGroups.value = [];
    dialogCount.value = 0;
    moduleCount.value = 0;
    hasScan.value = false;
    indexed.value = false;
    lastScanAt.value = null;
    return;
  }

  listLoading.value = true;
  listErrorText.value = "";
  try {
    const data = await fetchCodeIndexCatDlg();
    indexed.value = data.indexed;
    lastScanAt.value = data.last_scan_at ?? null;
    dialogCount.value = data.count;
    dialogGroups.value = buildCatDlgGroupsFromIndex(data.entries);
    moduleCount.value = dialogGroups.value.length;
    hasScan.value = true;
    lastLoadedAt.value = new Date().toISOString();
  } catch (e) {
    listErrorText.value = e instanceof Error ? e.message : String(e);
    dialogGroups.value = [];
    dialogCount.value = 0;
    moduleCount.value = 0;
    hasScan.value = false;
  } finally {
    listLoading.value = false;
  }
}

async function onRescan() {
  if (!workspaceReady.value) {
    shell.setStatus("请先选择工作空间");
    shell.openConfig();
    return;
  }
  scanning.value = true;
  listErrorText.value = "";
  shell.appendLog("[CAA 对话框] 更新 Code 索引…", { source: PAGE_ID, open: true });
  try {
    const out = await scanCodeIndex();
    if (out.summary) {
      shell.appendLog(out.summary, { source: PAGE_ID });
    }
    await loadFromIndex();
    shell.appendLog(`[CAA 对话框] 已从索引加载 ${dialogCount.value} 个 .CATDlg`, { source: PAGE_ID });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    listErrorText.value = msg;
    shell.appendLog(msg, { source: PAGE_ID });
  } finally {
    scanning.value = false;
  }
}

async function onRefresh() {
  await loadFromIndex();
}

function onOpen(item: CaaDialogListItem) {
  shell.openCaaDialogForRel({
    catDlgRel: item.catDlgRel,
    dialogName: item.dialogName,
    isDemo: item.isDemo,
  });
}

const headSummary = computed(() => {
  if (!hasScan.value) return "";
  if (!indexed.value) return "Code 索引尚未建立";
  return `共 ${dialogCount.value} 个 .CATDlg（Code 索引）`;
});

usePageSummary(headSummary);

onMounted(() => {
  store.clearEditor();
  void checkHealth();
  if (workspaceReady.value) void loadFromIndex();
});

watch(workspacePath, () => {
  lastLoadedAt.value = null;
  void loadFromIndex();
});
</script>

<template>
  <div class="page tool-page caa-dialog-home-page">
    <PageHeader title="CAA 对话框" :page-id="PAGE_ID">
      <template #actions>
        <div class="head-actions-inner">
          <el-button type="primary" size="small" :loading="scanning" :disabled="!workspaceReady" @click="onRescan">
            重新检索
          </el-button>
          <el-button size="small" :loading="listLoading && !scanning" :disabled="!workspaceReady" @click="onRefresh">
            刷新
          </el-button>
        </div>
      </template>
    </PageHeader>

    <p v-if="store.caaOnline === false" class="banner banner-warn">
      CAA 服务离线。侧栏「属性 → CAA 服务」查看端口与启动说明。
    </p>

    <CaaDialogHomeView
      :groups="dialogGroups"
      :count="dialogCount"
      :loading="listLoading || scanning"
      :error-text="listErrorText"
      :workspace-ready="workspaceReady"
      :has-scan="hasScan"
      :indexed="indexed"
      @open="onOpen"
    />
  </div>
</template>

<style scoped>
@import "./page-shared.css";

.caa-dialog-home-page {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding: 16px 20px;
  height: 100%;
  box-sizing: border-box;
}

.banner {
  margin: 0 0 10px;
  padding: 8px 12px;
  border-radius: 6px;
  font-size: 0.85rem;
  flex-shrink: 0;
}

.banner-warn {
  background: #fffbeb;
  border: 1px solid #fcd34d;
}
</style>
