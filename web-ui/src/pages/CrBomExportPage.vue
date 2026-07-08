<script setup lang="ts">
import { ref, onMounted } from "vue";
import PageHeader from "phoenix-wing/layout/PnwPageHeader.vue";
import { useAppShell } from "../composables/useAppShell";

defineProps<{ workbenchTabId?: string }>();
const shell = useAppShell();

interface BomHost {
  host_rel: string;
  host_filename: string;
  direct_children: number;
  total_descendants: number;
  incoming_count: number;
  issues_count: number;
}

const hosts = ref<BomHost[]>([]);
const allHosts = ref<BomHost[]>([]);
const loading = ref(false); const error = ref(""); const native = ref("");
const search = ref("");

async function loadMeta() {
  loading.value = true; error.value = "";
  try {
    const ws = shell.workspacePath.value || "";
    const res = await fetch(`/api/cad/bom/xref/meta?workspace=${encodeURIComponent(ws)}`);
    if (!res.ok) throw new Error((await res.json()).error || res.statusText);
    const data = await res.json();
    allHosts.value = data.items || [];
    native.value = data._native || data._proxy || "";
    applyFilter();
  } catch (e: any) { error.value = e.message; }
  finally { loading.value = false; }
}

function applyFilter() {
  const q = search.value.toLowerCase();
  hosts.value = q ? allHosts.value.filter(h => h.host_rel.toLowerCase().includes(q) || h.host_filename.toLowerCase().includes(q)) : allHosts.value;
}

function openDetail(rel: string) {
  shell.goToPage("cad_bom_viewer");
  setTimeout(() => shell.dispatchTreeSelect(rel), 150);
}

onMounted(loadMeta);
</script>

<template>
  <PageHeader title="CR BOM 列表">
    <template #subtitle>
      <el-tag size="small" :type="native === 'rust' ? 'success' : 'warning'" effect="plain">
        {{ native === 'rust' ? '原生 Rust' : '代理模式' }}
      </el-tag>
      <span style="margin-left:6px;font-size:12px;color:var(--el-text-color-secondary)">
        {{ native === 'rust' ? '→ Rust SQLite' : '→ Python FastAPI' }}
      </span>
    </template>
  </PageHeader>

  <div style="display:flex;gap:8px;margin:8px 0;align-items:center">
    <el-input v-model="search" placeholder="搜索装配…" clearable style="width:280px" size="small" @input="applyFilter" />
    <el-button size="small" @click="loadMeta">刷新</el-button>
  </div>
  <div v-if="error" style="color:var(--el-color-danger);margin:8px 0">{{ error }}</div>

  <el-table :data="hosts" v-loading="loading" stripe border size="small"
    empty-text="点击「刷新」加载装配列表" height="calc(100vh - 250px)"
    @row-click="(row: BomHost) => openDetail(row.host_rel)" highlight-current-row>
    <el-table-column prop="host_rel" label="装配文件" min-width="280" />
    <el-table-column prop="direct_children" label="直接子件" width="90" sortable />
    <el-table-column prop="total_descendants" label="总子件" width="80" sortable />
    <el-table-column prop="incoming_count" label="被引用" width="80" sortable />
  </el-table>

  <div style="margin-top:8px;font-size:12px;color:var(--el-text-color-secondary)">
    {{ hosts.length }}/{{ allHosts.length }} 个装配 · 点击行查看详情
  </div>
</template>
