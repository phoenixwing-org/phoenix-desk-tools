<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted } from "vue";
import PageHeader from "phoenix-wing/layout/PnwPageHeader.vue";
import { useWorkspaceFileQuery } from "../composables/useWorkspaceFileQuery";
import { useAppShell } from "../composables/useAppShell";

const props = defineProps<{ workbenchTabId?: string }>();
const shell = useAppShell();
const { pickedRel } = useWorkspaceFileQuery(props.workbenchTabId);

// ── state ─────────────────────────────────────────────
const filePath = ref(""); const loading = ref(false); const error = ref("");
const native = ref("");

interface FileInfo { filename?: string; assetKind?: string; partNumber?: string; partVersion?: string; partName?: string; label?: string; }
interface XrefRow { host_repo_rel_path?: string; host_filename?: string; target_repo_rel_path?: string; target_filename?: string; link_label?: string | null; target_part_number?: string | null; }
interface XrefCounts { incoming: number; outgoing: number; flat_lines: number; }
interface BomTreeNode { depth: number; part_rel: string; part_key: string; quantity: number; bom_path: string; }

const info = ref<FileInfo>({});
const counts = ref<XrefCounts>({ incoming: 0, outgoing: 0, flat_lines: 0 });
const incoming = ref<XrefRow[]>([]);
const outgoing = ref<XrefRow[]>([]);
const bomTree = ref<BomTreeNode[]>([]);
const activeTab = ref<"outgoing" | "incoming" | "tree" | "info">("tree");

// ── tree selection ────────────────────────────────────
watch(pickedRel, (rel) => { if (rel && /\.FCStd$/i.test(rel)) { filePath.value = rel; loadFile(); } });
onMounted(() => {
  shell.treeSelectHandler.value = async (repoRel: string) => {
    if (/\.FCStd$/i.test(repoRel)) { filePath.value = repoRel; loadFile(); return true; }
    return false;
  };
});
onUnmounted(() => { if (shell.treeSelectHandler.value) shell.treeSelectHandler.value = null; });

// ── API ───────────────────────────────────────────────
async function loadFile() {
  const fp = filePath.value.trim().replace(/^\.\//, "");
  if (!fp) return;
  const ws = shell.workspacePath.value;
  if (!ws) { error.value = "未设置工作空间"; return; }
  loading.value = true; error.value = "";

  try {
    const params = new URLSearchParams({ workspace: ws, rel: fp });
    // 并行查询：文件信息 + xref counts + incoming + outgoing
    const [resInfo, resCounts, resIn, resOut, resTree] = await Promise.all([
      fetch(`/api/cad/bom/file?${params}`),
      fetch(`/api/cad/bom/xref/counts?${params}`),
      fetch(`/api/cad/bom/xref/outgoing?${params}`),
      fetch(`/api/cad/bom/xref/incoming?${params}`),
      fetch(`/api/cad/bom/tree?${params}`),
    ]);

    // info
    if (resInfo.ok) { const d = await resInfo.json(); info.value = d; native.value = d._native || ""; }
    else { const e = await resInfo.json(); throw new Error(e.error); }

    // counts
    if (resCounts.ok) counts.value = await resCounts.json();
    // outgoing
    if (resOut.ok) { const d = await resOut.json(); outgoing.value = d.items || []; }
    // incoming
    if (resIn.ok) { const d = await resIn.json(); incoming.value = d.items || []; }
    if (resTree.ok) { const d = await resTree.json(); bomTree.value = d.items || []; }
  } catch (e: any) { error.value = e.message; }
  finally { loading.value = false; }
}

function exportCSV() {
  const rows = activeTab.value === "outgoing" ? outgoing.value : activeTab.value === "incoming" ? incoming.value : [];
  const h = "rel_path,filename,link_label"; const body = rows.map(r => `${r.target_repo_rel_path || r.host_repo_rel_path || ""},${r.target_filename || r.host_filename || ""},${r.link_label || ""}`).join("\n");
  const blob = new Blob(["﻿" + h + "\n" + body], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "xref.csv"; a.click();
}
</script>

<template>
  <PageHeader title="CR BOM 查看器">
    <template #subtitle>
      <el-tag size="small" :type="native === 'rust' ? 'success' : 'warning'" effect="plain">
        {{ native === 'rust' ? '原生 Rust' : '代理模式' }}
      </el-tag>
    </template>
  </PageHeader>

  <div style="display:flex;gap:8px;margin:8px 0;align-items:flex-start">
    <div style="flex:1;max-width:560px">
      <el-input v-model="filePath" placeholder="输入路径或从右侧树选择…" clearable @keyup.enter="loadFile" />
      <div v-if="pickedRel" style="font-size:11px;color:var(--el-text-color-secondary);margin-top:2px">📌 {{ pickedRel }}</div>
    </div>
    <el-button type="primary" :loading="loading" @click="loadFile">读取</el-button>
  </div>

  <div v-if="error" style="color:var(--el-color-danger);margin:8px 0;font-size:13px">⚠️ {{ error }}</div>

  <!-- info card -->
  <div v-if="info.filename" style="display:flex;gap:12px;flex-wrap:wrap;margin:8px 0;padding:10px 14px;background:var(--el-fill-color-light);border-radius:8px;font-size:13px">
    <span><b>{{ info.filename }}</b></span>
    <span v-if="info.partNumber">🔑 {{ info.partNumber }}<span v-if="info.partVersion">.{{ info.partVersion }}</span></span>
    <span v-if="info.assetKind">📦 {{ info.assetKind }}</span>
    <span v-if="info.label">🏷️ {{ info.label }}</span>
    <span style="margin-left:auto;display:flex;gap:8px">
      <el-tag size="small" type="warning">出 {{ counts.outgoing }}</el-tag>
      <el-tag size="small" type="info">入 {{ counts.incoming }}</el-tag>
      <el-tag size="small" v-if="counts.flat_lines">展 {{ counts.flat_lines }}</el-tag>
    </span>
  </div>

  <!-- tabs -->
  <el-tabs v-model="activeTab" v-if="info.filename" size="small" style="margin-top:4px">
    <el-tab-pane label="引用出 (outgoing)" name="outgoing">
      <div style="display:flex;justify-content:flex-end;margin-bottom:4px">
        <el-button size="small" @click="exportCSV" :disabled="!outgoing.length">导出 CSV</el-button>
      </div>
      <el-table :data="outgoing" stripe border size="small" max-height="calc(100vh - 300px)"
        empty-text="无引用（该文件不是装配体或未扫描 xref）">
        <el-table-column prop="target_repo_rel_path" label="引用文件" min-width="260" />
        <el-table-column prop="target_filename" label="文件名" min-width="180" />
        <el-table-column prop="link_label" label="实例标签" width="140" />
        <el-table-column prop="target_part_number" label="零件号" width="110" />
      </el-table>
    </el-tab-pane>
    <el-tab-pane label="被引用 (incoming)" name="incoming">
      <div style="display:flex;justify-content:flex-end;margin-bottom:4px">
        <el-button size="small" @click="exportCSV" :disabled="!incoming.length">导出 CSV</el-button>
      </div>
      <el-table :data="incoming" stripe border size="small" max-height="calc(100vh - 300px)"
        empty-text="无被引用（没有其他装配引用此文件）">
        <el-table-column prop="host_repo_rel_path" label="宿主文件" min-width="260" />
        <el-table-column prop="host_filename" label="文件名" min-width="180" />
        <el-table-column prop="link_label" label="实例标签" width="140" />
      </el-table>
    </el-tab-pane>
    <el-tab-pane label="BOM 树" name="tree">
      <el-table :data="bomTree" stripe border size="small" max-height="calc(100vh - 300px)"
        empty-text="无 BOM 展开数据（该文件可能不是装配体）">
        <el-table-column prop="depth" label="层" width="50" />
        <el-table-column prop="part_key" label="零件号" width="130" />
        <el-table-column prop="part_rel" label="文件" min-width="260" />
        <el-table-column prop="quantity" label="数量" width="60" />
        <el-table-column prop="bom_path" label="BOM路径" min-width="200" />
      </el-table>
    </el-tab-pane>
    <el-tab-pane label="信息" name="info">
      <div style="font-size:13px;color:var(--el-text-color-secondary)">
        <p>文件：{{ info.filename }}</p>
        <p>类型：{{ info.assetKind || '未知' }}</p>
        <p>零件号：{{ info.partNumber || '-' }} / {{ info.partVersion || '-' }}</p>
        <p>名称：{{ info.partName || info.label || '-' }}</p>
        <p>引用出：{{ counts.outgoing }} | 被引用：{{ counts.incoming }} | 展开行：{{ counts.flat_lines }}</p>
      </div>
    </el-tab-pane>
  </el-tabs>

  <div v-else-if="!loading && !error" style="text-align:center;padding:60px 20px;color:var(--el-text-color-secondary)">
    📂 输入 FCStd 文件路径后点击「读取」<br>
    <span style="font-size:12px">或从右侧工作空间树选择文件自动加载</span>
  </div>
</template>
