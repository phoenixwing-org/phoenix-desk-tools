<script setup lang="ts">
import { ref } from "vue";
import PageHeader from "phoenix-wing/layout/PnwPageHeader.vue";
import { useAppShell } from "../composables/useAppShell";

defineProps<{ workbenchTabId?: string }>();
const shell = useAppShell();

interface FcstdEntry {
  repo_rel_path: string;
  filename: string;
  asset_kind?: string;
  part_number?: string;
  part_version?: string;
  part_name?: string;
  label?: string;
  file_status?: string;
}

const entries = ref<FcstdEntry[]>([]);
const loading = ref(false); const error = ref(""); const search = ref(""); const kind = ref("");
const native = ref("");

async function loadEntries() {
  loading.value = true; error.value = "";
  try {
    const ws = shell.workspacePath.value || "";
    const params = new URLSearchParams({ workspace: ws, limit: "100" });
    if (search.value) params.set("search", search.value);
    if (kind.value) params.set("kind", kind.value);
    const res = await fetch(`/api/cad/fcstd-map/entries?${params}`);
    if (!res.ok) throw new Error((await res.json()).error || res.statusText);
    const data = await res.json();
    entries.value = data.items || data.entries || [];
    native.value = data._native || data._proxy || "";
  } catch (e: any) { error.value = e.message; }
  finally { loading.value = false; }
}

const KIND_OPTIONS = [
  { value: "", label: "全部" },
  { value: "fcstd", label: "FCStd" },
  { value: "markdown", label: "MD" },
  { value: "pdf", label: "PDF" },
];

function openBom(rel: string) {
  // trigger tree select to fill cad_bom_viewer
  const shell = (window as any).__appShell;
  if (shell) shell.goToPage("cad_bom_viewer");
}
</script>

<template>
  <PageHeader title="CR CAD 索引">
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
    <el-input v-model="search" placeholder="搜索文件名/零件号…" clearable style="width:280px" size="small"
      @keyup.enter="loadEntries" />
    <el-select v-model="kind" size="small" style="width:100px" @change="loadEntries">
      <el-option v-for="o in KIND_OPTIONS" :key="o.value" :label="o.label" :value="o.value" />
    </el-select>
    <el-button size="small" type="primary" @click="loadEntries">搜索</el-button>
  </div>

  <div v-if="error" style="color:var(--el-color-danger);margin:8px 0">{{ error }}</div>

  <el-table :data="entries" v-loading="loading" stripe border size="small" height="calc(100vh - 240px)"
    empty-text="点击「搜索」加载索引">
    <el-table-column prop="repo_rel_path" label="路径" min-width="240" />
    <el-table-column prop="asset_kind" label="类型" width="80" />
    <el-table-column prop="part_number" label="零件号" width="110" />
    <el-table-column prop="part_version" label="版本" width="80" />
    <el-table-column prop="part_name" label="名称" min-width="140" />
    <el-table-column prop="file_status" label="状态" width="70" />
  </el-table>

  <div style="margin-top:8px;font-size:12px;color:var(--el-text-color-secondary)">
    {{ entries.length }} 条 · 需要先通过 Python「CAD 索引」扫描
  </div>
</template>
