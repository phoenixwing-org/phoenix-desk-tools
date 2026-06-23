<script setup lang="ts">
import { onMounted } from "vue";
import PageHeader from "../components/PageHeader.vue";
import CaaDialogCanvas from "../components/caa/CaaDialogCanvas.vue";
import { fetchCaaHealth, parseCaaDialogDemo } from "../api/caaDialog";
import { useCaaDialogPropertySheet } from "../composables/useCaaDialogPropertySheet";
import { useCaaDialogPageStore } from "../stores/caaDialogPage";

const PAGE_ID = "caa_dialog";
const store = useCaaDialogPageStore();

useCaaDialogPropertySheet(PAGE_ID);

async function checkHealth() {
  try {
    await fetchCaaHealth();
    store.caaOnline = true;
  } catch {
    store.caaOnline = false;
  }
}

async function loadDemo() {
  store.loading = true;
  store.errorText = "";
  try {
    const ir = await parseCaaDialogDemo();
    store.setIr(ir);
    store.setSelectedId(ir.dialogName);
  } catch (e) {
    store.errorText = e instanceof Error ? e.message : String(e);
    store.setIr(null);
  } finally {
    store.loading = false;
  }
}

onMounted(() => {
  void checkHealth();
  void loadDemo();
});
</script>

<template>
  <div class="page tool-page caa-dialog-page">
    <PageHeader title="CAA 对话框" :page-id="PAGE_ID">
      <template #actions>
        <div class="toolbar-group">
          <el-tag v-if="store.caaOnline === true" type="success" size="small">CAA 服务在线</el-tag>
          <el-tag v-else-if="store.caaOnline === false" type="danger" size="small">CAA 服务离线</el-tag>
          <el-button
            type="primary"
            size="small"
            :loading="store.loading"
            @click="loadDemo"
          >
            加载 PNXBomAnalysis 样例
          </el-button>
        </div>
      </template>
    </PageHeader>

    <p v-if="store.caaOnline === false" class="banner banner-warn">
      请先启动 CAA Node 服务：<code>pnpm dev:caa</code>（端口 5180），并保持
      <code>python -m phoenix.web --dev</code> 运行。
    </p>
    <p v-if="store.errorText" class="banner banner-err">{{ store.errorText }}</p>

    <CaaDialogCanvas
      class="caa-main"
      :ir="store.ir"
    />
  </div>
</template>

<style scoped>
@import "./page-shared.css";

.caa-dialog-page {
  display: flex;
  flex-direction: column;
  height: 100%;
  box-sizing: border-box;
  padding: 0 16px 16px;
}

.banner {
  margin: 0 0 10px;
  padding: 8px 12px;
  border-radius: 6px;
  font-size: 0.85rem;
}

.banner-warn {
  background: #fffbeb;
  border: 1px solid #fcd34d;
}

.banner-err {
  background: #fef2f2;
  border: 1px solid #fca5a5;
}

.caa-main {
  flex: 1;
  min-height: 360px;
  min-width: 0;
}
</style>
