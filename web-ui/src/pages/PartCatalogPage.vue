<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import {
  fetchPartKeyDetail,
  fetchPartKeys,
  patchPartFileLink,
  patchPartKey,
  type PartKeyDetail,
  type PartKeyEntry,
  type PartKeyFile,
  type PartKeysPayload,
} from "../api";
import { useAppShell } from "../composables/useAppShell";
import ResizableDataTable from "../components/ResizableDataTable.vue";
import type { TableColumnDef } from "../composables/useResizableTable";

const shell = useAppShell();

const catalogColumns: TableColumnDef[] = [
  { key: "partKey", label: "PartKey", width: 108, minWidth: 80 },
  { key: "typeCode", label: "类型", width: 56, minWidth: 48 },
  { key: "modelSeries", label: "型号", width: 96, minWidth: 72 },
  { key: "partName", label: "PartName", width: 140, minWidth: 80 },
  { key: "label", label: "label", width: 140, minWidth: 80 },
  { key: "status", label: "状态", width: 56, minWidth: 48 },
  { key: "files", label: "文件", width: 56, minWidth: 48 },
  { key: "counts", label: "存在/缺失", width: 88, minWidth: 72 },
];

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

const loading = ref(false);
const saving = ref(false);
const listData = ref<PartKeysPayload | null>(null);
const detail = ref<PartKeyDetail | null>(null);
const statusFilter = ref<"all" | "active" | "obsolete">("all");
const search = ref("");

const editForm = ref({
  TypeCode: "",
  ModelSeries: "",
  PartName: "",
  label: "",
  notes: "",
  status: "active",
});

const showDetail = computed(() => shell.partKeyDetail.value !== null);

const filteredEntries = computed(() => {
  const rows = listData.value?.entries ?? [];
  const q = search.value.trim().toLowerCase();
  return rows.filter((row) => {
    if (statusFilter.value !== "all" && row.status !== statusFilter.value) return false;
    if (!q) return true;
    const hay = [
      row.part_key,
      row.PartName,
      row.label,
      row.TypeCode,
      row.ModelSeries,
      row.notes,
    ]
      .join(" ")
      .toLowerCase();
    return hay.includes(q);
  });
});

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

function roleLabel(role: string) {
  const map: Record<string, string> = {
    part: "零件",
    drawing: "工程图",
    assembly: "装配",
  };
  return map[role] ?? role;
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

async function refreshList() {
  loading.value = true;
  try {
    listData.value = await fetchPartKeys();
    setStatus(
      listData.value.exists
        ? `零件目录 ${listData.value.stats.total_keys} 键 · ${listData.value.stats.total_files} 文件`
        : "尚无零件目录，请先执行 CAD 索引扫描",
    );
  } catch (e) {
    setStatus(String(e));
  } finally {
    loading.value = false;
  }
}

async function loadDetail(pn: string, pv: string) {
  loading.value = true;
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
    setStatus(`零件 ${detail.value.part_key} · ${detail.value.file_count} 个关联文件`);
  } catch (e) {
    setStatus(String(e));
    detail.value = null;
  } finally {
    loading.value = false;
  }
}

function openDetail(row: PartKeyEntry) {
  shell.openPartKeyDetail(row.part_number, row.part_version);
}

function backToList() {
  shell.closePartKeyDetail();
  detail.value = null;
}

async function savePartMeta() {
  const nav = shell.partKeyDetail.value;
  if (!nav) return;
  saving.value = true;
  try {
    detail.value = await patchPartKey(nav.partNumber, nav.partVersion, { ...editForm.value });
    await refreshList();
    setStatus(`已保存零件 ${detail.value.part_key}`);
  } catch (e) {
    setStatus(String(e));
  } finally {
    saving.value = false;
  }
}

async function onFileLinkPatch(file: PartKeyFile, patch: Partial<PartKeyFile>) {
  const nav = shell.partKeyDetail.value;
  if (!nav) return;
  saving.value = true;
  try {
    detail.value = await patchPartFileLink(nav.partNumber, nav.partVersion, file.id, patch);
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

watch(
  () => shell.partKeyDetail.value,
  (nav) => {
    if (nav) {
      void loadDetail(nav.partNumber, nav.partVersion);
    }
  },
  { immediate: true },
);

onMounted(() => refreshList());
</script>

<template>
  <div class="page part-catalog-page">
    <header class="page-head">
      <div class="head-row">
        <button v-if="showDetail" type="button" class="btn back" @click="backToList">← 目录</button>
        <h1 class="page-title">
          <template v-if="showDetail">
            零件 <span class="mono">{{ detail?.part_key ?? "" }}</span>
          </template>
          <template v-else>零件目录</template>
        </h1>
      </div>
      <p class="page-desc">
        以 <code>PartNumber.PartVersion</code> 为唯一键聚合关联 FCStd 文件；可在详情页维护备注、失效状态，并跳转属性回写。
      </p>
    </header>

    <template v-if="!showDetail">
      <section class="controls">
        <input v-model="search" class="path-input" placeholder="搜索零件号、名称、备注…" spellcheck="false" />
        <button type="button" class="btn" :disabled="loading" @click="refreshList">刷新</button>
      </section>

      <section class="filters">
        <label class="filter"><input v-model="statusFilter" type="radio" value="all" /> 全部</label>
        <label class="filter"><input v-model="statusFilter" type="radio" value="active" /> 有效</label>
        <label class="filter"><input v-model="statusFilter" type="radio" value="obsolete" /> 失效</label>
        <span class="count">{{ filteredEntries.length }} 键</span>
      </section>

      <ResizableDataTable
        v-if="filteredEntries.length"
        :columns="catalogColumns"
        wrap-class="table-grow"
      >
        <tbody>
          <tr v-for="row in filteredEntries" :key="row.part_key">
            <td class="mono">
              <button type="button" class="link-key" @click="openDetail(row)">{{ row.part_key }}</button>
            </td>
            <td>{{ row.TypeCode }}</td>
            <td>{{ row.ModelSeries }}</td>
            <td>{{ row.PartName }}</td>
            <td>{{ row.label }}</td>
            <td>{{ row.status === "obsolete" ? "失效" : "有效" }}</td>
            <td>{{ row.file_count }}</td>
            <td>{{ row.present_count }}/{{ row.missing_count }}</td>
          </tr>
        </tbody>
      </ResizableDataTable>
      <div v-else-if="!loading" class="table-wrap table-grow empty-wrap">
        <p class="empty">
          {{ listData?.exists ? "当前筛选无条目" : "尚无数据，请先在 CAD 索引页执行工程内搜索" }}
        </p>
      </div>
    </template>

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
      <div v-else class="table-wrap table-grow empty-wrap">
        <p class="empty">该零件键下暂无关联文件</p>
      </div>
    </template>
  </div>
</template>

<style scoped>
.part-catalog-page {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding: 20px 22px 16px;
}

.page-head {
  flex-shrink: 0;
  margin-bottom: 16px;
}

.head-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.page-title {
  margin: 0 0 4px;
  font-size: 1.15rem;
}

.page-desc {
  margin: 0;
  font-size: 0.85rem;
  color: var(--muted);
  line-height: 1.55;
  max-width: 880px;
}

.controls {
  display: flex;
  gap: 8px;
  margin-bottom: 10px;
  flex-shrink: 0;
}

.path-input {
  flex: 1;
  min-width: 180px;
  padding: 8px 10px;
  border: 1px solid var(--border-strong);
  border-radius: 6px;
}

.btn {
  padding: 8px 14px;
  border: 1px solid var(--border-strong);
  border-radius: 6px;
  background: var(--btn-bg);
  font-size: 0.85rem;
}

.btn.primary {
  background: var(--accent);
  color: #fff;
  border-color: var(--accent);
}

.btn.back {
  padding: 6px 10px;
}

.btn.mini {
  padding: 4px 8px;
  font-size: 0.76rem;
}

.btn:disabled {
  opacity: 0.55;
}

.filters {
  display: flex;
  gap: 14px;
  align-items: center;
  margin-bottom: 8px;
  font-size: 0.85rem;
  flex-shrink: 0;
}

.filter {
  display: flex;
  align-items: center;
  gap: 4px;
}

.count {
  color: var(--muted);
  margin-left: auto;
}

.table-grow {
  flex: 1;
  min-height: 0;
}

.empty-wrap {
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: auto;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: #fff;
}

.link-key {
  border: none;
  background: none;
  padding: 0;
  color: var(--accent);
  cursor: pointer;
  font: inherit;
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
  font-feature-settings: "tnum" 1;
  text-decoration: underline;
}

.link-key:hover {
  color: #1d4ed8;
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

.note-input {
  width: 100%;
  min-width: 120px;
  box-sizing: border-box;
  padding: 4px 6px;
  border: 1px solid var(--border-strong);
  border-radius: 4px;
  font-size: 0.78rem;
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

code {
  font-size: 0.9em;
}
</style>
