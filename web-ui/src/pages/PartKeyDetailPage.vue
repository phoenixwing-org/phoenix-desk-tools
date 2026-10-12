<script setup lang="ts">
import { computed, onActivated, onMounted, onUnmounted, ref, watch } from "vue";
import {
  fetchPartKeyDetail,
  inferPartKeyFromPath,
  patchPartKey,
  type PartKeyDetail,
  type PartKeyFile,
} from "../api";
import ResizableDataTable from "../components/ResizableDataTable.vue";
import { pnwPromptChoice } from "phoenix-wing";
import ComboTextInput from "phoenix-wing/components/PnwComboTextInput.vue";
import { BOM_FIELD_LABELS as L, PART_KEY_META_FIELDS } from "../utils/bomFieldLabels";
import { TYPE_CODE_OPTIONS } from "../utils/typeCodeOptions";
import { parsePartKeyText } from "../utils/partNaming";
import PageHeader from "phoenix-wing/layout/PnwPageHeader.vue";
import PageLayout from "phoenix-wing/layout/PnwPageLayout.vue";
import PageMainBlock from "phoenix-wing/layout/PnwPageMainBlock.vue";
import { useAppShell } from "../composables/useAppShell";
import { isDrawingFcstdFile } from "../composables/useDrawingBomReadonly";
import { usePageSession } from "../composables/usePageSession";
import type { PnwTableColumnDef } from "phoenix-wing";
import {
  usePagePrimaryContribution,
  type PagePrimarySection,
} from "../composables/usePagePrimaryContribution";

const props = defineProps<{
  workbenchTabId?: string;
}>();

const SESSION_V = 1;

const shell = useAppShell();

const fileColumns: PnwTableColumnDef[] = [
  { key: "disk", label: "磁盘", width: 56, minWidth: 48 },
  { key: "assetKind", label: "格式", width: 72, minWidth: 56 },
  { key: "filename", label: "文件名", width: 200, minWidth: 120 },
  { key: "role", label: "类型", width: 96, minWidth: 80 },
  { key: "linkStatus", label: "关联状态", width: 96, minWidth: 80 },
  { key: "notes", label: "备注", width: 160, minWidth: 100 },
  { key: "dir", label: "相对目录", width: 140, minWidth: 80 },
  { key: "actions", label: "操作", width: 148, minWidth: 120 },
];

const partNumber = ref("");
const partVersion = ref("");
const partKeyInput = ref("");
const loading = ref(false);
const saving = ref(false);
watch(saving, busy => { if (busy && props.workbenchTabId) shell.keepTab(props.workbenchTabId); }, { flush: "sync" });
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

const baselineForm = ref({ ...editForm.value });

const currentPartKey = computed(() => {
  const pn = partNumber.value.trim();
  const pv = partVersion.value.trim();
  return pn && pv ? `${pn}.${pv}` : "";
});

function isAssemblyFile(file: PartKeyFile): boolean {
  return file.file_role === "assembly" || /\.assy\.fcstd$/i.test(file.filename);
}

function resolvePartKeyFromTab(): boolean {
  if (!props.workbenchTabId) return false;
  const payload = shell.consumeTabPayload(props.workbenchTabId);
  const pk = payload?.partKey;
  if (!pk?.partNumber || !pk?.partVersion) return false;
  partNumber.value = pk.partNumber;
  partVersion.value = pk.partVersion;
  return true;
}

function syncBaselineFromEdit() {
  baselineForm.value = { ...editForm.value };
}

function hasAttributeEdits(): boolean {
  const keys = ["TypeCode", "ModelSeries", "PartName", "label", "notes", "status"] as const;
  for (const k of keys) {
    if (String(editForm.value[k] ?? "").trim() !== String(baselineForm.value[k] ?? "").trim()) {
      return true;
    }
  }
  return false;
}

function hasUnsavedEdits(): boolean {
  return hasAttributeEdits();
}

async function confirmSwitchPartKey(targetKey: string): Promise<boolean> {
  if (!currentPartKey.value || !hasUnsavedEdits()) return true;
  await pnwPromptChoice({
    title: "无法切换零件",
    message: `当前零件 ${currentPartKey.value} 有尚未保存的属性修改。\n\n请先保存后再切换到 ${targetKey}。`,
    choices: [{ id: "ok", label: "确定" }],
  });
  return false;
}

function parsePartKeyInput(raw: string): { pn: string; pv: string; partKey: string } | null {
  const parsed = parsePartKeyText(raw);
  if (!parsed) return null;
  return { pn: parsed.part_number, pv: parsed.part_version, partKey: parsed.part_key };
}

function syncPartKeyInput() {
  partKeyInput.value = currentPartKey.value;
}

async function switchToPartKey(
  pn: string,
  pv: string,
  opts?: { source?: string; filename?: string; in_catalog?: boolean },
) {
  const targetKey = `${pn}.${pv}`;
  if (pn === partNumber.value.trim() && pv === partVersion.value.trim()) {
    shell.appendLog(`[零件] 已是当前 PartKey ${targetKey}，无需切换`, { source: "part_key" });
    syncPartKeyInput();
    return;
  }

  if (!(await confirmSwitchPartKey(targetKey))) {
    shell.appendLog(`[零件] 取消切换（未保存修改）：${currentPartKey.value} → ${targetKey}`, {
      source: "part_key",
    });
    syncPartKeyInput();
    return;
  }

  const src = opts?.source ?? "manual";
  const srcLabel =
    src === "index"
      ? "CAD 文件索引"
      : src === "filename+index"
        ? "文件名+索引"
        : src === "filename"
          ? "文件名"
          : "检索";
  const viaFile = opts?.filename ? `（${opts.filename}）` : "";
  shell.appendLog(
    `[零件] ${srcLabel} · 切换 ${currentPartKey.value || "—"} → ${targetKey}${viaFile}`,
    { source: "part_key", open: true },
  );

  partNumber.value = pn;
  partVersion.value = pv;
  partKeyInput.value = targetKey;
  pageError.value = "";
  await loadDetail();
  if (!detail.value) {
    shell.appendLog(
      `[零件] 未找到 ${targetKey}；请确认 CAD 索引已更新且 Part Key 正确。`,
      { source: "part_key" },
    );
  } else if (opts?.in_catalog === false) {
    shell.appendLog(
      `[零件] 已解析 ${targetKey}，但零件目录中尚无该键；请在「CAD 索引」更新工作空间。`,
      { source: "part_key" },
    );
  }
}

async function onSearchPartKey() {
  const parsed = parsePartKeyInput(partKeyInput.value);
  if (!parsed) {
    pageError.value = "零件标识格式：零件号.版本，例如 8001.001";
    shell.appendLog(`[零件] 无效的零件标识：${partKeyInput.value.trim() || "(空)"}`, {
      source: "part_key",
      open: true,
    });
    return;
  }
  await switchToPartKey(parsed.pn, parsed.pv, { source: "manual" });
}

async function onTreeSelect(targetRel: string): Promise<boolean> {
  const relNorm = targetRel.replace(/\\/g, "/").trim();
  if (!relNorm.toLowerCase().endsWith(".fcstd")) {
    shell.appendLog(`[零件] 跳过非 FCStd：${relNorm}`, { source: "part_key" });
    return false;
  }

  let inferred;
  try {
    inferred = await inferPartKeyFromPath(relNorm);
  } catch (e) {
    const name = relNorm.split("/").pop() ?? relNorm;
    shell.appendLog(`[零件] 无法从文件名解析 PartKey：${name} — ${e}`, {
      source: "part_key",
      open: true,
    });
    return false;
  }

  const { part_number: pn, part_version: pv, source, in_catalog, filename } = inferred;
  await switchToPartKey(pn, pv, { source, filename, in_catalog });
  return true;
}

function registerTreeHandler() {
  if (!props.workbenchTabId) return;
  shell.registerPageMessages(props.workbenchTabId, (msg) => {
    if (msg.type === "tree:select-file") return onTreeSelect(msg.path);
  });
}

function unregisterTreeHandler() {
  if (!props.workbenchTabId) return;
  shell.registerPageMessages(props.workbenchTabId, null);
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

function fileRoleLabel(role: string | undefined) {
  const map: Record<string, string> = {
    part: "零件",
    drawing: "工程图",
    assembly: "装配",
  };
  return map[role || ""] ?? role ?? "—";
}

function linkStatusLabel(status: string | undefined) {
  if (status === "obsolete") return "失效";
  if (status === "active") return "有效";
  return status ?? "—";
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
    syncBaselineFromEdit();
    syncPartKeyInput();
    if (props.workbenchTabId) {
      shell.updateTab(props.workbenchTabId, {
        title: detail.value.part_key,
        subtitle: detail.value.PartName || detail.value.label || undefined,
      });
    }
    setStatus(`零件 ${detail.value.part_key} · ${detail.value.file_count} 个关联文件`);
  } catch (e) {
    pageError.value = String(e);
    detail.value = null;
  } finally {
    loading.value = false;
  }
}

async function savePartMeta() {
  const pn = partNumber.value.trim();
  const pv = partVersion.value.trim();
  if (!pn || !pv) return;
  saving.value = true;
  shell.appendLog(`[零件] 保存属性 ${pn}.${pv}…`, { source: "part_key", open: true });
  try {
    detail.value = await patchPartKey(pn, pv, { ...editForm.value });
    syncBaselineFromEdit();
    if (props.workbenchTabId) {
      shell.updateTab(props.workbenchTabId, {
        subtitle: detail.value.PartName || detail.value.label || undefined,
      });
    }
    const msg = `已保存零件 ${detail.value.part_key}`;
    shell.appendLog(msg, { source: "part_key" });
    setStatus(msg);
  } catch (e) {
    shell.appendLog(String(e), { source: "part_key" });
    setStatus(String(e));
  } finally {
    saving.value = false;
  }
}

function openFileDetail(file: PartKeyFile, subTab?: "overview" | "edit") {
  if (file.file_status !== "present") return;
  shell.openFileDetailForRel(file.repo_rel_path, subTab ? { subTab } : undefined);
}

function openDrawingAttributes(file: PartKeyFile) {
  openFileDetail(file, "edit");
}

function openAssemblyStructure(file: PartKeyFile) {
  if (file.file_status !== "present" || !isAssemblyFile(file)) return;
  shell.openFileDetailForRel(file.repo_rel_path, { subTab: "assembly" });
}

function initPage() {
  if (resolvePartKeyFromTab()) {
    syncPartKeyInput();
    void loadDetail();
  }
}

function hydratePageSession(snap: Record<string, unknown>): Promise<boolean> {
  if (snap.v !== SESSION_V) return Promise.resolve(false);
  return Promise.resolve(true);
}

usePageSession(props.workbenchTabId, {
  serialize: () => ({ v: SESSION_V }),
  hydrate: hydratePageSession,
  isDirty: hasUnsavedEdits,
  isBusy: () => saving.value,
});

watch(
  () => hasUnsavedEdits(),
  (dirty) => {
    if (props.workbenchTabId) shell.setTabDirty(props.workbenchTabId, dirty);
  },
  { immediate: true },
);

usePagePrimaryContribution("part_key_detail", props.workbenchTabId, {
  summary: computed(() => detail.value
    ? `${detail.value.part_key} · ${detail.value.file_count} 个关联文件`
    : "输入 PartKey 或从工作空间树选择 FCStd"),
  sections: computed<PagePrimarySection[]>(() => [
    {
      id: "part-key",
      title: "零件上下文",
      controls: [
        {
          id: "part-key-input",
          kind: "text",
          label: "PartKey",
          modelValue: partKeyInput,
          placeholder: "8001.001",
          mono: true,
          disabled: loading,
          onUpdate: (value) => { partKeyInput.value = value; },
        },
        { id: "current", kind: "readonly", label: "当前零件", value: computed(() => currentPartKey.value || "—"), mono: true },
        { id: "files", kind: "readonly", label: "关联文件", value: computed(() => detail.value?.file_count ?? 0) },
        {
          id: "present",
          kind: "readonly",
          label: "磁盘存在",
          value: computed(() => detail.value?.files.filter((file) => file.file_status === "present").length ?? 0),
        },
        {
          id: "missing",
          kind: "readonly",
          label: "磁盘缺失",
          value: computed(() => detail.value?.files.filter((file) => file.file_status === "missing").length ?? 0),
        },
        {
          id: "status",
          kind: "choice",
          label: "零件状态",
          modelValue: computed(() => editForm.value.status),
          disabled: computed(() => !detail.value),
          options: [
            { value: "active", label: "有效" },
            { value: "obsolete", label: "失效" },
          ],
          onUpdate: (value) => {
            editForm.value = { ...editForm.value, status: value === "obsolete" ? "obsolete" : "active" };
          },
        },
        { id: "dirty", kind: "readonly", label: "未保存", value: computed(() => hasUnsavedEdits() ? "是" : "否") },
      ],
      actions: [
        { id: "search", label: "检索", tone: "primary", loading, run: onSearchPartKey },
        {
          id: "refresh",
          label: "刷新",
          loading,
          disabled: computed(() => !currentPartKey.value),
          run: loadDetail,
        },
        {
          id: "save",
          label: "保存属性",
          loading: saving,
          disabled: computed(() => !detail.value || !hasUnsavedEdits()),
          run: savePartMeta,
        },
      ],
    },
  ]),
});

onMounted(() => {
  initPage();
  registerTreeHandler();
});
onActivated(() => {
  initPage();
  registerTreeHandler();
});
onUnmounted(() => {
  unregisterTreeHandler();
  if (props.workbenchTabId) shell.setTabDirty(props.workbenchTabId, false);
});
</script>

<template>
  <PageLayout title="零件详情" class="desk-page-layout" :body-inset="false" :body-scroll="false">
    <template #header>
      <PageHeader title="零件详情">
        <template #center>
          <div class="head-filter-group">
            <label class="pk-label" for="part-key-input">
              <span class="cn">{{ L.partKey }}</span>
              <span class="en">PartKey</span>
            </label>
            <el-input
              id="part-key-input"
              v-model="partKeyInput"
              class="pk-input mono"
              placeholder="8001.001"
              spellcheck="false"
              :disabled="loading"
              @keydown.enter="onSearchPartKey"
            />
          </div>
        </template>
        <template #right>
          <el-button type="primary" size="small" :loading="loading" @click="onSearchPartKey">检索</el-button>
        </template>
      </PageHeader>
    </template>
    <PageMainBlock class="part-detail-page desk-page-body--fill">

      <el-alert v-if="pageError" type="error" :title="pageError" show-icon :closable="false" class="err-alert" />
      <div v-if="loading && !detail" class="empty">载入中…</div>

      <template v-else-if="detail">
        <div class="sub-panel" data-tour-page-partkey-body>
          <section class="detail-meta">
            <div class="meta-grid">
              <label
                v-for="field in PART_KEY_META_FIELDS"
                :key="field.key"
                :class="{ wide: field.wide, full: field.full }"
              >
                <span class="field-label">
                  <span class="cn">{{ field.cn }}</span>
                  <span class="en">{{ field.en }}</span>
                </span>
                <ComboTextInput
                  v-if="field.kind === 'typeCode'"
                  v-model="editForm.TypeCode"
                  :options="TYPE_CODE_OPTIONS"
                />
                <el-input
                  v-else-if="field.kind === 'input'"
                  v-model="editForm[field.key as 'ModelSeries' | 'PartName' | 'label' | 'notes']"
                  spellcheck="false"
                />
                <el-select v-else v-model="editForm.status" class="status-select">
                  <el-option label="有效" value="active" />
                  <el-option label="失效" value="obsolete" />
                </el-select>
              </label>
            </div>
            <el-button type="primary" size="small" :loading="saving" @click="savePartMeta">
              保存零件属性
            </el-button>
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
                  <td class="mono">
                    <button
                      v-if="file.file_status === 'present'"
                      type="button"
                      class="file-link"
                      :title="file.repo_rel_path"
                      @click="openFileDetail(file)"
                    >
                      {{ file.filename }}
                    </button>
                    <span v-else>{{ file.filename }}</span>
                  </td>
                  <td>{{ fileRoleLabel(file.file_role) }}</td>
                  <td>{{ linkStatusLabel(file.link_status) }}</td>
                  <td class="note-cell" :class="{ empty: !file.link_notes?.trim() }">
                    {{ file.link_notes?.trim() || "—" }}
                  </td>
                  <td class="mono">{{ relDir(file.repo_rel_path) }}</td>
                  <td class="actions">
                    <el-button v-if="file.file_status === 'present'" size="small" @click="openFileDetail(file)">
                      详情
                    </el-button>
                    <el-button
                      v-if="file.file_status === 'present' && isDrawingFcstdFile(file.filename, file.file_role)"
                      size="small"
                      @click="openDrawingAttributes(file)"
                    >
                      查看属性
                    </el-button>
                    <el-button
                      v-if="file.file_status === 'present' && isAssemblyFile(file)"
                      size="small"
                      @click="openAssemblyStructure(file)"
                    >
                      装配结构
                    </el-button>
                  </td>
                </tr>
              </tbody>
            </ResizableDataTable>
            <div v-else class="table-wrap empty-wrap">
              <p class="empty">该零件键下暂无关联文件</p>
            </div>
          </section>
        </div>
      </template>

      <p v-else-if="!loading" class="empty">输入标识检索，或点树中 .FCStd</p>
    </PageMainBlock>
  </PageLayout>
</template>

<style scoped>
@import "./page-shared.css";

.pk-input {
  width: 148px;
}

.pk-input.mono :deep(.el-input__inner) {
  font-family: ui-monospace, monospace;
}

.err-alert {
  margin-bottom: 10px;
}

.status-select {
  width: 100%;
}

.sub-panel {
  flex: 1;
  min-height: 0;
  overflow: auto;
  display: flex;
  flex-direction: column;
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
}

.field-label {
  display: flex;
  flex-direction: row;
  align-items: baseline;
  gap: 6px;
  white-space: nowrap;
}

.field-label .cn {
  font-size: 0.8rem;
  font-weight: 500;
  color: var(--text);
}

.field-label .en {
  font-size: 0.72rem;
  color: var(--muted);
}

.pk-label {
  display: flex;
  flex-direction: row;
  align-items: baseline;
  gap: 6px;
  font-size: 0.82rem;
  white-space: nowrap;
}

.pk-label .cn {
  font-weight: 500;
  color: var(--text);
}

.pk-label .en {
  font-size: 0.72rem;
  color: var(--muted);
}

.meta-grid label.wide {
  grid-column: span 2;
}

.meta-grid label.full {
  grid-column: 1 / -1;
}

.meta-grid input,
.meta-grid select {
  padding: 6px 8px;
  border: 1px solid var(--border-strong);
  border-radius: 6px;
  font-size: 0.82rem;
  color: inherit;
}

.files-block {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  margin-top: 4px;
}

.section-title {
  margin: 0;
  font-size: 0.95rem;
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

.note-cell {
  font-size: 0.78rem;
  word-break: break-word;
}

.note-cell.empty {
  color: var(--muted);
}

.table-grow {
  flex: 1;
  min-height: 160px;
}

.empty-wrap.table-grow {
  display: flex;
  align-items: center;
  justify-content: center;
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

.file-link {
  padding: 0;
  border: none;
  background: none;
  color: var(--accent, #2563eb);
  cursor: pointer;
  text-align: left;
  font: inherit;
  font-family: var(--font-mono);
  font-size: 0.76rem;
}

.file-link:hover {
  text-decoration: underline;
}

.actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
  white-space: normal;
}

.actions .btn.mini {
  padding: 3px 7px;
  font-size: 0.72rem;
  line-height: 1.25;
}

.empty {
  padding: 28px;
  color: var(--muted);
  text-align: center;
}
</style>
