<script setup lang="ts">
import { ref, onMounted } from "vue";
import PageHeader from "phoenix-wing/layout/PnwPageHeader.vue";
import { useAppShell } from "../composables/useAppShell";

defineProps<{ workbenchTabId?: string }>();
const shell = useAppShell();

interface PartKey {
  part_number: string; part_version: string; part_name?: string;
  type_code?: string; model_series?: string; file_count?: number;
}

const parts = ref<PartKey[]>([]);
const loading = ref(false); const error = ref(""); const search = ref("");
const native = ref<string>("");

async function loadParts() {
  loading.value = true; error.value = "";
  try {
    const q = search.value.trim();
    const ws = shell.workspacePath.value || "";
    const params = new URLSearchParams({ workspace: ws });
    if (q) params.set("q", q);
    const res = await fetch(`/api/cad/parts?${params}`);
    if (!res.ok) throw new Error((await res.json()).error || res.statusText);
    const data = await res.json();
    parts.value = data.items || data.part_keys || [];
    native.value = data._native || data._proxy || "";
  } catch (e: any) { error.value = e.message; }
  finally { loading.value = false; }
}

onMounted(loadParts);
</script>

<template>
  <PageHeader title="CR 零件目录">
    <template #subtitle>
      <el-tag size="small" :type="native === 'rust' ? 'success' : 'warning'" effect="plain">
        {{ native === 'rust' ? '原生 Rust' : '代理模式' }}
      </el-tag>
      <span style="margin-left:6px;font-size:12px;color:var(--el-text-color-secondary)">
        {{ native === 'rust' ? '→ Rust SQLite' : '→ Python FastAPI' }}
      </span>
    </template>
  </PageHeader>

  <div style="display:flex;gap:8px;margin:8px 0">
    <el-input v-model="search" placeholder="搜索零件号…" clearable style="width:280px" size="small"
      @keyup.enter="loadParts" />
    <el-button size="small" type="primary" @click="loadParts">搜索</el-button>
  </div>

  <div v-if="error" style="color:var(--el-color-danger);margin:8px 0">{{ error }}</div>

  <el-table :data="parts" v-loading="loading" stripe border size="small" height="calc(100vh - 240px)"
    empty-text="输入搜索词后点击「搜索」">
    <el-table-column prop="part_number" label="零件号" width="130" />
    <el-table-column prop="part_version" label="版本" width="80" />
    <el-table-column prop="part_name" label="名称" min-width="160" />
    <el-table-column prop="type_code" label="类型" width="80" />
    <el-table-column prop="model_series" label="系列" width="100" />
    <el-table-column prop="file_count" label="文件数" width="70" />
  </el-table>

  <div style="margin-top:8px;font-size:12px;color:var(--el-text-color-secondary)">
    {{ parts.length }} 个零件
  </div>
</template>
