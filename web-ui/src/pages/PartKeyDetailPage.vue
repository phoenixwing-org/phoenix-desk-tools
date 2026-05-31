<script setup lang="ts">
import { computed, onActivated, onMounted, ref, watch } from "vue";
import {
  fetchPartAssemblyTree,
  fetchPartKeyDetail,
  patchPartFileLink,
  patchPartKey,
  type AssemblyTreeNode,
  type PartKeyDetail,
  type PartKeyFile,
} from "../api";
import AssemblyTreeTable from "../components/AssemblyTreeTable.vue";
import ResizableDataTable from "../components/ResizableDataTable.vue";
import { useAppShell } from "../composables/useAppShell";
import type { TableColumnDef } from "../composables/useResizableTable";

const props = defineProps<{
  workbenchTabId?: string;
}>();

const shell = useAppShell();

const fileColumns: TableColumnDef[] = [
  { key: "disk", label: "磁盘", width: 56, minWidth: 48 },
  { key: "assetKind", label: "格式", width: 72, minWidth: 56 },
  { key: "filename", label: "文件名", width: 200, minWidth: 120 },
  { key: "role", label: "类型", width: 96, minWidth: 80 },
  { key: "linkStatus", label: "关联状态", width: 96, minWidth: 80 },
  { key: "notes", label: "备注", width: 160, minWidth: 100 },
  { key: "dir", label: "相对目录", width: 140, minWidth: 80 },
  { key: "actions", label: "操作", width: 96, minWidth: 88 },
];

const partNumber = ref("");
const partVersion = ref("");
const loading = ref(false);
const saving = ref(false);
const detail = ref<PartKeyDetail | null>(null);
const pageError = ref("");

const editForm = ref({
  TypeCode: "",
  ModelSeries: "",
  PartName: "",
  label: "",
  notes: "",
  status: "active",
});

const treeMode = ref<"first" | "full">("first");
const selectedAssemblyRel = ref("");
const treeLoading = ref(false);
const treeNodes = ref<AssemblyTreeNode[]>([]);

const assemblyFiles = computed(() =>
  (detail.value?.files ?? []).filter(
    (f) =>
      f.file_status === "present" &&
      (f.file_role === "assembly" || /\.assy\.fcstd$/i.test(f.filename)),
  ),
);

const showAssemblySection = computed(() => assemblyFiles.value.length > 0);

function resolvePartKeyFromTab(): boolean {
  if (!props.workbenchTabId) return false;
  const payload = shell.consumeTabPayload(props.workbenchTabId);
  const pk = payload?.partKey;
  if (!pk?.partNumber || !pk?.partVersion) return false;
  partNumber.value = pk.partNumber;
  partVersion.value = pk.partVersion;
  return true;
}

function setStatus(msg: string) {
  shell.setStatus(msg);
}

function assetKindLabel(kind: string | undefined) {
  const map: Record<string, string> = {
    fcstd: "FCStd",
    markdown: "MD",
    pdf: "PDF",
    cad_exchange: "DXF/DWG",
    image: "图片",
  };
  return map[kind || ""] ?? kind ?? "—";
}

function fileStatusLabel(row: PartKeyFile) {
  if (row.file_status === "missing") return "缺失";
  if (row.link_status === "obsolete") return "失效";
  return "存在";
}

function relDir(path: string): string {
  const p = path.replace(/\\/g, "/").replace(/^\.\//, "");
  const i = p.lastIndexOf("/");
  if (i < 0) return ".";
  const dir = p.slice(0, i);
  return dir || ".";
}

async function loadDetail() {
  const pn = partNumber.value.trim();
  const pv = partVersion.value.trim();
  if (!pn || !pv) return;

  loading.value = true;
  pageError.value = "";
  try {
    detail.value = await fetchPartKeyDetail(pn, pv);
    editForm.value = {
      TypeCode: detail.value.TypeCode,
      ModelSeries: detail.value.ModelSeries,
      PartName: detail.value.PartName,
      label: detail.value.label,
      notes: detail.value.notes,
      status: detail.value.status || "active",
    };
    if (props.workbenchTabId) {
      shell.updateTab(props.workbenchTabId, {
        title: detail.value.part_key,
        subtitle: detail.value.PartName || detail.value.label || undefined,
      });
    }
    if (!selectedAssemblyRel.value || !assemblyFiles.value.some((f) => f.repo_rel_path === selectedAssemblyRel.value)) {
      selectedAssemblyRel.value = assemblyFiles.value[0]?.repo_rel_path ?? "";
    }
    setStatus(`零件 ${detail.value.part_key} · ${detail.value.file_count} 个关联文件`);
    await loadAssemblyTree();
  } catch (e) {
    pageError.value = String(e);
    detail.value = null;
  } finally {
    loading.value = false;
  }
}

async function loadAssemblyTree() {
  const pn = partNumber.value.trim();
  const pv = partVersion.value.trim();
  const host = selectedAssemblyRel.value.trim();
  if (!pn || !pv || !host) {
    treeNodes.value = [];
    return;
  }

  treeLoading.value = true;
  try {
    const data = await fetchPartAssemblyTree(pn, pv, host, treeMode.value === "full");
    treeNodes.value = data.nodes;
  } catch (e) {
    treeNodes.value = [];
    setStatus(String(e));
  } finally {
    treeLoading.value = false;
  }
}

async function savePartMeta() {
  const pn = partNumber.value.trim();
  const pv = partVersion.value.trim();
  if (!pn || !pv) return;
  saving.value = true;
  try {
    detail.value = await patchPartKey(pn, pv, { ...editForm.value });
    if (props.workbenchTabId) {
      shell.updateTab(props.workbenchTabId, {
        subtitle: detail.value.PartName || detail.value.label || undefined,
      });
    }
    setStatus(`已保存零件 ${detail.value.part_key}`);
  } catch (e) {
    setStatus(String(e));
  } finally {
    saving.value = false;
  }
}

async function onFileLinkPatch(file: PartKeyFile, patch: Partial<PartKeyFile>) {
  const pn = partNumber.value.trim();
  const pv = partVersion.value.trim();
  if (!pn || !pv) return;
  saving.value = true;
  try {
    detail.value = await patchPartFileLink(pn, pv, file.id, patch);
    setStatus(`已更新文件 ${file.filename}`);
  } catch (e) {
    setStatus(String(e));
  } finally {
    saving.value = false;
  }
}

function openBom(file: PartKeyFile) {
  shell.openBomApplyForRel(file.repo_rel_path);
}

function initPage() {
  if (resolvePartKeyFromTab()) {
    void loadDetail();
  }
}

watch(treeMode, () => {
  void loadAssemblyTree();
});

watch(selectedAssemblyRel, () => {
  void loadAssemblyTree();
});

onMounted(initPage);
onActivated(initPage);
</script>

<template>
  <div class="page part-detail-page">
    <header class="page-head">
      <h1 class="page-title">
        零件 <span class="mono">{{ detail?.part_key ?? `${partNumber}.${partVersion}` }}</span>
      </h1>
      <p v-if="detail?.PartName" class="page-sub">{{ detail.PartName }}</p>
      <p class="page-desc">维护 PartKey 属性、关联文件；装配体可查看 BOM 下级树（可折叠）。</p>
    </header>

    <div v-if="pageError" class="banner err">{{ pageError }}</div>
    <div v-if="loading && !detail" class="empty">载入中…</div>

    <template v-else-if="detail">
      <section class="detail-meta">
        <div class="meta-grid">
          <label>
            <span>TypeCode</span>
            <input v-model="editForm.TypeCode" spellcheck="false" />
          </label>
          <label>
            <span>ModelSeries</span>
            <input v-model="editForm.ModelSeries" spellcheck="false" />
          </label>
          <label>
            <span>PartName</span>
            <input v-model="editForm.PartName" spellcheck="false" />
          </label>
          <label>
            <span>label</span>
            <input v-model="editForm.label" spellcheck="false" />
          </label>
          <label class="wide">
            <span>备注</span>
            <input v-model="editForm.notes" spellcheck="false" />
          </label>
          <label>
            <span>零件状态</span>
            <select v-model="editForm.status">
              <option value="active">有效</option>
              <option value="obsolete">失效</option>
            </select>
          </label>
        </div>
        <button type="button" class="btn primary" :disabled="saving" @click="savePartMeta">
          {{ saving ? "保存中…" : "保存零件属性" }}
        </button>
      </section>

      <section v-if="showAssemblySection" class="assembly-block">
        <div class="section-head">
          <h2 class="section-title">装配结构</h2>
          <div class="section-controls">
            <label v-if="assemblyFiles.length > 1" class="ctl">
              <span>装配文件</span>
              <select v-model="selectedAssemblyRel">
                <option v-for="file in assemblyFiles" :key="file.id" :value="file.repo_rel_path">
                  {{ file.filename }}
                </option>
              </select>
            </label>
            <label class="mode-opt">
              <input v-model="treeMode" type="radio" value="first" />
              第一级
            </label>
            <label class="mode-opt">
              <input v-model="treeMode" type="radio" value="full" />
              全部层级
            </label>
          </div>
        </div>
        <AssemblyTreeTable :nodes="treeNodes" :loading="treeLoading" />
      </section>

      <section class="files-block">
        <h2 class="section-title">关联文件</h2>
        <ResizableDataTable
          v-if="detail.files.length"
          :columns="fileColumns"
          table-class="files-table"
          wrap-class="table-grow"
        >
          <tbody>
            <tr
              v-for="file in detail.files"
              :key="file.id"
              :class="[file.file_status, file.link_status]"
            >
              <td>{{ fileStatusLabel(file) }}</td>
              <td>{{ assetKindLabel(file.asset_kind) }}</td>
              <td class="mono">{{ file.filename }}</td>
              <td>
                <select
                  :value="file.file_role"
                  @change="
                    onFileLinkPatch(file, {
                      file_role: ($event.target as HTMLSelectElement).value,
                    })
                  "
                >
                  <option value="part">零件</option>
                  <option value="drawing">工程图</option>
                  <option value="assembly">装配</option>
                </select>
              </td>
              <td>
                <select
                  :value="file.link_status"
                  @change="
                    onFileLinkPatch(file, {
                      link_status: ($event.target as HTMLSelectElement).value,
                    })
                  "
                >
                  <option value="active">有效</option>
                  <option value="obsolete">失效</option>
                </select>
              </td>
              <td>
                <input
                  class="note-input"
                  :value="file.link_notes"
                  placeholder="备注"
                  spellcheck="false"
                  @change="
                    onFileLinkPatch(file, {
                      link_notes: ($event.target as HTMLInputElement).value,
                    })
                  "
                />
              </td>
              <td class="mono">{{ relDir(file.repo_rel_path) }}</td>
              <td class="actions">
                <button type="button" class="btn mini" @click="openBom(file)">属性回写</button>
              </td>
            </tr>
          </tbody>
        </ResizableDataTable>
        <div v-else class="table-wrap empty-wrap">
          <p class="empty">该零件键下暂无关联文件</p>
        </div>
      </section>
    </template>
  </div>
</template>

<style scoped>
.part-detail-page {
  display: flex;
  flex-direction: column;
  overflow: auto;
  padding: 20px 22px 16px;
  height: 100%;
  box-sizing: border-box;
}

.page-head {
  flex-shrink: 0;
  margin-bottom: 12px;
}

.page-title {
  margin: 0 0 4px;
  font-size: 1.15rem;
}

.page-sub {
  margin: 0 0 4px;
  color: var(--muted);
  font-size: 0.88rem;
}

.page-desc {
  margin: 0;
  font-size: 0.85rem;
  color: var(--muted);
  line-height: 1.55;
}

.banner {
  padding: 8px 12px;
  border-radius: 6px;
  font-size: 0.85rem;
  margin-bottom: 10px;
}

.banner.err {
  background: #fef2f2;
  color: #b91c1c;
}

.detail-meta {
  flex-shrink: 0;
  margin-bottom: 12px;
  padding: 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: #fff;
}

.meta-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
  margin-bottom: 10px;
}

.meta-grid label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 0.78rem;
  color: var(--muted);
}

.meta-grid label.wide {
  grid-column: span 2;
}

.meta-grid input,
.meta-grid select {
  padding: 6px 8px;
  border: 1px solid var(--border-strong);
  border-radius: 6px;
  font-size: 0.82rem;
  color: inherit;
}

.assembly-block,
.files-block {
  margin-bottom: 16px;
}

.section-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
  margin-bottom: 8px;
}

.section-title {
  margin: 0;
  font-size: 0.95rem;
}

.section-controls {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
  margin-left: auto;
}

.ctl {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.82rem;
}

.ctl select {
  min-width: 180px;
  padding: 4px 6px;
  border: 1px solid var(--border-strong);
  border-radius: 6px;
}

.mode-opt {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 0.82rem;
}

.btn {
  padding: 8px 14px;
  border: 1px solid var(--border-strong);
  border-radius: 6px;
  background: var(--btn-bg);
  font-size: 0.85rem;
  cursor: pointer;
}

.btn.primary {
  background: var(--accent);
  color: #fff;
  border-color: var(--accent);
}

.btn.mini {
  padding: 4px 8px;
  font-size: 0.76rem;
}

.btn:disabled {
  opacity: 0.55;
}

.note-input {
  width: 100%;
  min-width: 120px;
  box-sizing: border-box;
  padding: 4px 6px;
  border: 1px solid var(--border-strong);
  border-radius: 4px;
  font-size: 0.78rem;
}

.table-grow {
  min-height: 120px;
}

.empty-wrap {
  border: 1px solid var(--border);
  border-radius: 8px;
  background: #fff;
}

:deep(.resizable-data-table tr.missing) {
  background: #fff7ed;
}

:deep(.resizable-data-table tr.obsolete td) {
  color: #94a3b8;
}

.mono {
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
  font-feature-settings: "tnum" 1;
  font-size: 0.76rem;
}

.actions {
  white-space: nowrap;
}

.empty {
  padding: 28px;
  color: var(--muted);
  text-align: center;
}
</style>
