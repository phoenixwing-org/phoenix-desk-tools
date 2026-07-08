<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted } from "vue";
import PageHeader from "phoenix-wing/layout/PnwPageHeader.vue";
import { useWorkspaceFileQuery } from "../composables/useWorkspaceFileQuery";
import { useAppShell } from "../composables/useAppShell";

const props = defineProps<{ workbenchTabId?: string }>();
const shell = useAppShell();
const { pickedRel } = useWorkspaceFileQuery(props.workbenchTabId);

const filePath = ref(""); const loading = ref(false); const error = ref(""); const native = ref("");

interface FileInfo { filename?: string; assetKind?: string; partNumber?: string; partVersion?: string; partName?: string; label?: string; file_status?: string; }
interface XrefCounts { incoming: number; outgoing: number; flat_lines: number; }
interface FieldRow { key: string; value: string; }

const info = ref<FileInfo>({});
const counts = ref<XrefCounts>({ incoming: 0, outgoing: 0, flat_lines: 0 });
const fields = ref<FieldRow[]>([]);

watch(pickedRel, (rel) => { if (rel && /\.FCStd$/i.test(rel)) { filePath.value = rel; loadDetail(); } });
onMounted(() => {
  shell.treeSelectHandler.value = async (repoRel: string) => {
    if (/\.FCStd$/i.test(repoRel)) { filePath.value = repoRel; loadDetail(); return true; }
    return false;
  };
});
onUnmounted(() => { if (shell.treeSelectHandler.value) shell.treeSelectHandler.value = null; });

async function loadDetail() {
  const fp = filePath.value.trim().replace(/^\.\//, "");
  if (!fp) return;
  const ws = shell.workspacePath.value;
  if (!ws) { error.value = "未设置工作空间"; return; }
  loading.value = true; error.value = "";

  try {
    const params = new URLSearchParams({ workspace: ws, rel: fp });
    const [resInfo, resCounts] = await Promise.all([
      fetch(`/api/cad/bom/file?${params}`),
      fetch(`/api/cad/bom/xref/counts?${params}`),
    ]);

    if (resInfo.ok) { const d = await resInfo.json(); info.value = d; native.value = d._native || ""; }
    else { const e = await resInfo.json(); throw new Error(e.error); }
    if (resCounts.ok) counts.value = await resCounts.json();

    // build field list
    const f: FieldRow[] = [];
    const d = info.value;
    if (d.partNumber) f.push({ key: "零件号", value: d.partNumber });
    if (d.partVersion) f.push({ key: "版本", value: d.partVersion });
    if (d.partName) f.push({ key: "名称", value: d.partName });
    if (d.label) f.push({ key: "Label", value: d.label });
    if (d.assetKind) f.push({ key: "类型", value: d.assetKind });
    if (d.filename) f.push({ key: "文件名", value: d.filename });
    fields.value = f;
  } catch (e: any) { error.value = e.message; }
  finally { loading.value = false; }
}

function openBomViewer() {
  shell.goToPage("cad_bom_viewer");
  setTimeout(() => shell.dispatchTreeSelect(filePath.value), 150);
}
</script>

<template>
  <PageHeader title="CR 文件详情">
    <template #subtitle>
      <el-tag size="small" :type="native === 'rust' ? 'success' : 'warning'" effect="plain">
        {{ native === 'rust' ? '原生 Rust' : '代理模式' }}
      </el-tag>
    </template>
  </PageHeader>

  <div style="display:flex;gap:8px;margin:8px 0;align-items:flex-start">
    <div style="flex:1;max-width:560px">
      <el-input v-model="filePath" placeholder="输入路径或从右侧树选择…" clearable @keyup.enter="loadDetail" />
      <div v-if="pickedRel" style="font-size:11px;color:var(--el-text-color-secondary);margin-top:2px">📌 {{ pickedRel }}</div>
    </div>
    <el-button type="primary" :loading="loading" @click="loadDetail">加载</el-button>
  </div>

  <div v-if="error" style="color:var(--el-color-danger);margin:8px 0;font-size:13px">⚠️ {{ error }}</div>

  <div v-if="info.filename">
    <!-- info card -->
    <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:center;margin:8px 0;padding:10px 14px;background:var(--el-fill-color-light);border-radius:8px;font-size:13px">
      <b>{{ info.filename }}</b>
      <el-tag size="small" type="warning">出 {{ counts.outgoing }}</el-tag>
      <el-tag size="small" type="info">入 {{ counts.incoming }}</el-tag>
      <el-tag size="small" v-if="counts.flat_lines" type="success">展 {{ counts.flat_lines }}</el-tag>
      <el-button size="small" style="margin-left:auto" @click="openBomViewer" :disabled="!counts.outgoing && !counts.flat_lines">
        BOM 查看 →
      </el-button>
    </div>

    <!-- properties table -->
    <el-descriptions :column="2" border size="small" style="margin-top:8px">
      <el-descriptions-item v-for="f in fields" :key="f.key" :label="f.key">
        {{ f.value || '-' }}
      </el-descriptions-item>
    </el-descriptions>
  </div>

  <div v-else-if="!loading && !error" style="text-align:center;padding:60px 20px;color:var(--el-text-color-secondary)">
    📂 输入 FCStd 文件路径后点击「加载」<br>
    <span style="font-size:12px">或从右侧工作空间树选择文件自动加载</span>
  </div>
</template>
