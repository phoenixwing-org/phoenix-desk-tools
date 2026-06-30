<script setup lang="ts">
import { computed, ref, watch } from "vue";
import {
  applyCodeUuids,
  scanCodeUuids,
  type CodeUuidHit,
  type UuidApplyStrategy,
} from "../api";
import PageHeader from "../components/PageHeader.vue";
import GitDiffPreviewButton from "../components/git/GitDiffPreviewButton.vue";
import { useAppShell } from "../composables/useAppShell";
import { useCodeUuidPropertySheet } from "../composables/useCodeUuidPropertySheet";
import { promptChoice } from "../composables/choiceDialog";
import { useWorksetPageScope } from "../composables/useWorksetPageScope";
import { useFileWorksetsStore } from "../stores/fileWorksets";
import { useResizableTable, type TableColumnDef } from "../composables/useResizableTable";
import { basenameFromRel, repoDirFromRel } from "../utils/workspaceFileQuery";

const hitColumns: TableColumnDef[] = [
  { key: "check", label: "", width: 40, minWidth: 40 },
  { key: "filename", label: "文件名", width: 200, minWidth: 120 },
  { key: "line", label: "行", width: 52, minWidth: 44 },
  { key: "new_text", label: "替换后", width: 240, minWidth: 120 },
  { key: "text", label: "原文", width: 240, minWidth: 120 },
  { key: "dir", label: "目录", width: 320, minWidth: 160 },
];

const showReplacementColumn = ref(false);
const replacementsWritten = ref(false);

const visibleHitColumns = computed(() =>
  showReplacementColumn.value ? hitColumns : hitColumns.filter((c) => c.key !== "new_text"),
);

const { widths, onResizeStart } = useResizableTable(() => visibleHitColumns.value);

const visibleTableWidth = computed(() =>
  visibleHitColumns.value.reduce(
    (sum, col) => sum + (widths.value[col.key] ?? col.width ?? 120),
    0,
  ),
);

const shell = useAppShell();
const worksetStore = useFileWorksetsStore();
const worksetScope = useWorksetPageScope("code_uuid");

const strategy = ref<UuidApplyStrategy>("map_per_value");

useCodeUuidPropertySheet("code_uuid", strategy);
const hits = ref<CodeUuidHit[]>([]);
const selected = ref<Set<string>>(new Set());
const replacementByHitId = ref<Record<string, string>>({});
const engineMessage = ref("");

const scanning = ref(false);
const applying = ref(false);

const selectedCount = computed(() => selected.value.size);
const allChecked = computed(
  () => hits.value.length > 0 && hits.value.every((h) => selected.value.has(h.hit_id)),
);
const uniqueUuidCount = computed(() => new Set(hits.value.map((h) => h.uuid_normalized)).size);

type UuidHitGroup = {
  uuid_normalized: string;
  hits: CodeUuidHit[];
};

const hitGroups = computed<UuidHitGroup[]>(() => {
  const map = new Map<string, CodeUuidHit[]>();
  for (const h of hits.value) {
    const key = h.uuid_normalized || h.matched_text;
    const list = map.get(key) ?? [];
    list.push(h);
    map.set(key, list);
  }
  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([uuid_normalized, groupHits]) => ({
      uuid_normalized,
      hits: groupHits.sort((a, b) =>
        a.repo_rel_path.localeCompare(b.repo_rel_path) || a.line - b.line,
      ),
    }));
});

const selectedNormCount = computed(() => {
  const norms = new Set<string>();
  for (const id of selected.value) {
    const h = hits.value.find((x) => x.hit_id === id);
    if (h) norms.add(h.uuid_normalized);
  }
  return norms.size;
});

const pathsFromSelectedHits = computed(() => {
  const out = new Set<string>();
  for (const id of selected.value) {
    const h = hits.value.find((x) => x.hit_id === id);
    if (h?.repo_rel_path) out.add(h.repo_rel_path);
  }
  return [...out];
});

const pathsFromAllHits = computed(() => [...new Set(hits.value.map((h) => h.repo_rel_path).filter(Boolean))]);

const activeWorksetLabel = computed(() => worksetStore.activeWorkset?.name ?? "当前工作集");
const wsPathCount = computed(() => (worksetStore.activeWorkset?.entries ?? worksetStore.activeWorkset?.paths)?.length ?? 0);

function formatNormDisplay(norm: string): string {
  const s = norm.replace(/[^0-9a-fA-F]/g, "").toLowerCase();
  if (s.length !== 32) return norm;
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
}

function groupAllChecked(group: UuidHitGroup): boolean {
  return group.hits.length > 0 && group.hits.every((h) => selected.value.has(h.hit_id));
}

function groupSomeChecked(group: UuidHitGroup): boolean {
  return group.hits.some((h) => selected.value.has(h.hit_id));
}

function toggleGroup(group: UuidHitGroup, checked: boolean) {
  const next = new Set(selected.value);
  for (const h of group.hits) {
    if (checked) next.add(h.hit_id);
    else next.delete(h.hit_id);
  }
  selected.value = next;
}

const hitsTableStyle = computed(() => ({
  width: `${visibleTableWidth.value}px`,
  minWidth: "100%",
  "--sticky-check-w": `${widths.value.check ?? 40}px`,
}));

function toggleHit(id: string, checked: boolean) {
  const next = new Set(selected.value);
  if (checked) next.add(id);
  else next.delete(id);
  selected.value = next;
}

function toggleAll(checked: boolean) {
  selected.value = checked ? new Set(hits.value.map((h) => h.hit_id)) : new Set();
}

function replacementText(hitId: string): string {
  return replacementByHitId.value[hitId] ?? "";
}

watch(strategy, () => {
  replacementByHitId.value = {};
  showReplacementColumn.value = false;
  replacementsWritten.value = false;
});

async function onScan() {
  scanning.value = true;
  engineMessage.value = "";
  hits.value = [];
  selected.value = new Set();
  replacementByHitId.value = {};
  showReplacementColumn.value = false;
  replacementsWritten.value = false;
  shell.appendLog("[Code UUID] 扫描…", { source: "code_uuid", open: true });
  try {
    const out = await scanCodeUuids({
      ...worksetScope.buildScanBody(),
    });
    hits.value = out.hits || [];
    engineMessage.value = out.message || "";
    shell.appendLog(out.message || `扫描完成 · 命中 ${hits.value.length}`, { source: "code_uuid" });
    shell.setStatus(out.implemented ? `命中 ${hits.value.length}` : out.message || "引擎尚未接入");
  } catch (e) {
    const msg = String(e);
    shell.appendLog(msg, { source: "code_uuid" });
    shell.setStatus(msg);
  } finally {
    scanning.value = false;
  }
}

async function scanFromActiveWorkset() {
  const ws = worksetStore.activeWorkset;
  const wsPaths = (ws?.entries ?? ws?.paths ?? []).map((e: any) => (typeof e === "string" ? e : e.path));
  if (!wsPaths.length) {
    shell.setStatus("侧栏当前工作集为空，请先加入文件");
    await shell.openWorksetSidebar();
    return;
  }
  worksetScope.scopeMode.value = "workset";
  worksetScope.worksetId.value = ws.id;
  await onScan();
}

function addHitsToWorkset(paths: string[], label: string) {
  if (!paths.length) {
    shell.setStatus(`没有可加入的${label}文件`);
    return;
  }
  worksetStore.addPathsToActive(paths, "code_uuid:hits");
  shell.setStatus(worksetStore.lastMessage);
}

async function addSelectedHitsToWorkset() {
  addHitsToWorkset(pathsFromSelectedHits.value, "选中");
  await shell.openWorksetSidebar();
}

async function addAllHitsToWorkset() {
  addHitsToWorkset(pathsFromAllHits.value, "命中");
  await shell.openWorksetSidebar();
}

async function onApply(dryRun: boolean) {
  if (!selectedCount.value) {
    shell.setStatus("请至少勾选一条命中");
    return;
  }
  if (!dryRun) {
    const choice = await promptChoice({
      title: "执行 UUID 替换",
      message: `将替换 ${selectedCount.value} 条 UUID 命中。\n建议先预检。\n\n确定写盘？`,
      defaultChoiceId: "cancel",
      choices: [
        { id: "cancel", label: "取消" },
        { id: "confirm", label: "写盘", variant: "danger" },
      ],
    });
    if (choice.choiceId !== "confirm") return;
  }
  applying.value = true;
  const mode = dryRun ? "预检" : "写盘";
  shell.appendLog(`[Code UUID] ${mode} · ${selectedCount.value} 条…`, { source: "code_uuid", open: true });
  try {
    const out = await applyCodeUuids({
      hit_ids: [...selected.value],
      strategy: strategy.value,
      dry_run: dryRun,
    });
    engineMessage.value = out.message || "";
    const next: Record<string, string> = {};
    for (const m of out.mappings || []) {
      if (m.hit_id && m.new) next[m.hit_id] = m.new;
    }
    replacementByHitId.value = next;
    if (Object.keys(next).length > 0) {
      showReplacementColumn.value = true;
    }
    replacementsWritten.value = !dryRun && Object.keys(next).length > 0;
    const logText = out.lines?.join("\n") || out.log || out.message || "完成";
    shell.appendLog(logText, { source: "code_uuid" });
    shell.setStatus(out.implemented ? "完成" : out.message || "引擎尚未接入");
  } catch (e) {
    shell.appendLog(String(e), { source: "code_uuid" });
    shell.setStatus(String(e));
  } finally {
    applying.value = false;
  }
}

function openIgnorePanel() {
  void shell.openCodeIgnoreSidebar();
}

function hitFilename(rel: string) {
  return basenameFromRel(rel);
}

function hitDir(rel: string) {
  return repoDirFromRel(rel);
}

function thClass(key: string) {
  if (key === "check") return "col-check sticky-col-left sticky-col-check";
  if (key === "filename") return "sticky-col-left sticky-col-filename filename-cell";
  return "";
}
</script>

<template>
  <div class="page tool-page code-uuid-page">
    <PageHeader title="Code UUID 替换" page-id="code_uuid">
      <template #actions>
        <el-select
          :model-value="worksetScope.worksetId.value ?? ''"
          size="small"
          placeholder="全工作空间"
          clearable
          style="width: 160px"
          @update:model-value="
            worksetScope.worksetId.value = $event || null;
            worksetScope.scopeMode.value = $event ? 'workset' : 'all';
          "
        >
          <el-option label="全工作空间" value="" />
          <el-option
            v-for="w in worksetStore.worksetOptions"
            :key="w.id"
            :label="`${w.label}（${w.count}）`"
            :value="w.id"
          />
        </el-select>
        <div class="toolbar-group">
          <el-button size="small" plain @click="openIgnorePanel">忽略设定</el-button>
        </div>
        <span class="toolbar-divider" aria-hidden="true" />
        <div class="toolbar-group">
          <el-button size="small" :loading="scanning" @click="onScan">扫描 UUID</el-button>
          <el-button
            size="small"
            :loading="scanning"
            :disabled="!wsPathCount"
            :title="
              wsPathCount
                ? `仅扫描侧栏「${activeWorksetLabel}」内 ${wsPathCount} 个文件`
                : '侧栏当前工作集为空'
            "
            @click="scanFromActiveWorkset"
          >
            当前工作集扫描
          </el-button>
          <el-button size="small" :loading="applying" :disabled="!selectedCount" @click="onApply(true)">
            预检
          </el-button>
        </div>
        <span class="toolbar-divider" aria-hidden="true" />
        <div class="toolbar-group">
          <el-button
            type="primary"
            size="small"
            :loading="applying"
            :disabled="!selectedCount"
            @click="onApply(false)"
          >
            执行替换
          </el-button>
        </div>
      </template>
    </PageHeader>

    <section class="card results-card">
      <header class="results-head">
        <div class="results-head-row">
          <span class="section-label">扫描结果</span>
          <span v-if="hits.length" class="muted small">
            已选 {{ selectedCount }} / {{ hits.length }} 条 ·
            {{ selectedNormCount }} / {{ uniqueUuidCount }} 组 UUID
          </span>
          <div v-if="hits.length" class="results-workset-actions">
            <el-button
              size="small"
              :disabled="!pathsFromSelectedHits.length"
              :title="`去重 ${pathsFromSelectedHits.length} 个文件，加入「${activeWorksetLabel}」`"
              @click="addSelectedHitsToWorkset"
            >
              <span class="ws-action-label">
                选中
                <span class="ws-action-arrow" aria-hidden="true">→</span>
                <el-tag size="small" effect="plain" round class="ws-action-tag">{{ activeWorksetLabel }}</el-tag>
              </span>
            </el-button>
            <el-button
              size="small"
              :title="`去重 ${pathsFromAllHits.length} 个文件，加入「${activeWorksetLabel}」`"
              @click="addAllHitsToWorkset"
            >
              <span class="ws-action-label">
                全部命中
                <span class="ws-action-arrow" aria-hidden="true">→</span>
                <el-tag size="small" effect="plain" round class="ws-action-tag">{{ activeWorksetLabel }}</el-tag>
              </span>
            </el-button>
          </div>
        </div>
        <p v-if="engineMessage" class="engine-msg">{{ engineMessage }}</p>
      </header>

      <div class="hits-table-wrap">
        <table
          v-if="hits.length"
          class="entry-table resizable-hits-table"
          :style="hitsTableStyle"
        >
          <colgroup>
            <col
              v-for="col in visibleHitColumns"
              :key="col.key"
              :style="{ width: `${widths[col.key]}px` }"
            />
          </colgroup>
          <thead>
            <tr>
              <th v-for="col in visibleHitColumns" :key="col.key" :class="thClass(col.key)">
                <input
                  v-if="col.key === 'check'"
                  type="checkbox"
                  :checked="allChecked"
                  aria-label="全选"
                  @change="toggleAll(($event.target as HTMLInputElement).checked)"
                />
                <span v-else class="th-label">{{ col.label }}</span>
                <span
                  class="col-resizer"
                  title="拖拽调节列宽"
                  @mousedown="onResizeStart(col.key, $event)"
                />
              </th>
            </tr>
          </thead>
          <tbody>
            <template v-for="(group, gi) in hitGroups" :key="group.uuid_normalized">
              <tr class="uuid-group-head">
                <td class="col-check sticky-col-left sticky-col-check">
                  <input
                    type="checkbox"
                    :checked="groupAllChecked(group)"
                    :indeterminate="groupSomeChecked(group) && !groupAllChecked(group)"
                    :aria-label="`全选 ${formatNormDisplay(group.uuid_normalized)}`"
                    @change="toggleGroup(group, ($event.target as HTMLInputElement).checked)"
                  />
                </td>
                <td :colspan="visibleHitColumns.length - 1" class="uuid-group-label">
                  <span class="uuid-group-title">同值组 {{ gi + 1 }}</span>
                  <code class="uuid-group-norm">{{ formatNormDisplay(group.uuid_normalized) }}</code>
                  <span class="muted small">{{ group.hits.length }} 处</span>
                </td>
              </tr>
              <tr
                v-for="(h, hi) in group.hits"
                :key="h.hit_id"
                class="uuid-group-row"
                :class="{ 'row-alt': hi % 2 === 1 }"
              >
                <td class="col-check sticky-col-left sticky-col-check">
                  <input
                    type="checkbox"
                    :checked="selected.has(h.hit_id)"
                    @change="toggleHit(h.hit_id, ($event.target as HTMLInputElement).checked)"
                  />
                </td>
                <td class="mono filename-cell sticky-col-left sticky-col-filename" :title="h.repo_rel_path">
                  {{ hitFilename(h.repo_rel_path) }}
                </td>
                <td class="col-line mono">{{ h.line }}</td>
                <td
                  v-if="showReplacementColumn"
                  class="mono uuid-cell uuid-new-cell"
                  :class="{ 'uuid-new-filled': replacementText(h.hit_id) }"
                  :title="replacementText(h.hit_id)"
                >
                  <div class="uuid-new-cell-inner">
                    <span class="uuid-new-text">{{ replacementText(h.hit_id) || "—" }}</span>
                    <GitDiffPreviewButton
                      v-if="replacementText(h.hit_id) && replacementsWritten"
                      :path="h.repo_rel_path"
                    />
                  </div>
                </td>
                <td class="mono uuid-cell" :title="h.matched_text">{{ h.matched_text }}</td>
                <td class="mono dir-cell" :title="h.repo_rel_path">
                  {{ hitDir(h.repo_rel_path) }}
                </td>
              </tr>
            </template>
          </tbody>
        </table>
        <el-empty v-else description="点击「扫描 UUID」；引擎接入前表格为空" :image-size="64" />
      </div>
    </section>
  </div>
</template>

<style scoped>
@import "./page-shared.css";

.card {
  padding: 10px 14px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: #fff;
  margin-bottom: 10px;
}

.section-label {
  margin: 0;
  padding-right: 10px;
  border-right: 2px solid var(--accent);
  font-size: 0.72rem;
  font-weight: 600;
  color: var(--muted);
}

.form-row {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: flex-end;
}

.field-inline {
  flex-direction: row;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.field.field-inline {
  flex-direction: row;
  align-items: center;
}

.strategy-field {
  flex: 1 1 320px;
  margin-bottom: 0;
}

.strategy-field :deep(.el-form-item__label) {
  font-size: 0.72rem;
  color: var(--muted);
}

.strategy-select {
  width: 100%;
  min-width: 180px;
  max-width: 420px;
}

.btn-sm {
  padding: 5px 11px;
  font-size: 0.78rem;
}

.ignore-banner {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  justify-content: space-between;
}

.results-head-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}

.results-workset-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-left: auto;
}

.results-workset-actions :deep(.el-button) {
  margin: 0;
}

.ws-action-label {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  max-width: 100%;
}

.ws-action-arrow {
  flex-shrink: 0;
  color: var(--muted);
  font-size: 0.9em;
  line-height: 1;
}

.ws-action-tag {
  max-width: min(160px, 28vw);
  overflow: hidden;
  text-overflow: ellipsis;
  vertical-align: middle;
}

.results-workset-actions :deep(.el-button.is-disabled .ws-action-tag) {
  opacity: 0.65;
}

.engine-msg {
  margin: 8px 0 0;
  font-size: 0.78rem;
  color: #b45309;
}

.hits-table-wrap {
  max-height: calc(100vh - 420px);
  overflow: auto;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: #fff;
}

.resizable-hits-table {
  table-layout: fixed;
  border-collapse: separate;
  border-spacing: 0;
  font-size: 0.82rem;
}

.entry-table th,
.entry-table td {
  padding: 8px 10px;
  border-bottom: 1px solid var(--border);
  text-align: left;
  vertical-align: middle;
}

.entry-table th {
  position: sticky;
  top: 0;
  background: #f8fafc;
  font-size: 0.78rem;
  color: var(--muted);
  z-index: 2;
  height: 34px;
  padding: 0;
  overflow: hidden;
}

.entry-table td {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  background: #fff;
}

.row-alt td {
  background: #fafbfc;
}

.th-label {
  display: block;
  padding: 0 10px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.col-resizer {
  position: absolute;
  top: 0;
  right: 0;
  width: 7px;
  height: 100%;
  cursor: col-resize;
  z-index: 3;
  transform: translateX(50%);
}

.col-resizer:hover,
.col-resizer:active {
  background: rgba(37, 99, 235, 0.22);
}

.col-check {
  width: 40px;
  text-align: center;
}

.col-line {
  width: 48px;
  text-align: right;
}

.sticky-col-left {
  position: sticky;
  z-index: 4;
}

.sticky-col-check {
  left: 0;
  z-index: 5;
  box-shadow: 1px 0 0 #e2e8f0;
}

.sticky-col-filename {
  left: var(--sticky-check-w, 40px);
  box-shadow: 1px 0 0 #e2e8f0;
}

.entry-table thead .sticky-col-check {
  z-index: 8;
}

.entry-table thead .sticky-col-filename {
  z-index: 7;
}

.row-alt .sticky-col-check,
.row-alt .sticky-col-filename {
  background: #fafbfc;
}

.uuid-group-head td {
  background: #eef2ff;
  border-bottom: 1px solid #c7d2fe;
  padding: 6px 10px;
}

.uuid-group-label {
  font-size: 0.78rem;
}

.uuid-group-title {
  font-weight: 600;
  margin-right: 8px;
  color: #4338ca;
}

.uuid-group-norm {
  margin-right: 8px;
  font-size: 0.76rem;
}

.uuid-group-row td {
  background: #fff;
}

.uuid-group-row .sticky-col-check {
  padding-left: 12px;
  text-align: left;
}

.uuid-group-row.row-alt td {
  background: #fafbfc;
}

.filename-cell {
  font-weight: 500;
}

.dir-cell {
  color: var(--muted);
  font-size: 0.78rem;
}

.uuid-cell {
  font-size: 0.76rem;
}

.uuid-new-cell {
  color: var(--muted);
}

.uuid-new-cell.uuid-new-filled {
  color: #047857;
}

.uuid-new-cell-inner {
  display: flex;
  align-items: center;
  gap: 2px;
  min-width: 0;
}

.uuid-new-text {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.uuid-new-cell-inner :deep(.git-row-actions) {
  opacity: 1;
  pointer-events: auto;
}

.row-alt {
  background: #fafbfc;
}

.empty {
  margin: 0;
  padding: 16px;
  text-align: center;
  color: var(--muted);
}
</style>
