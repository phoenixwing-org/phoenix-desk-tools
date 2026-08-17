<script setup lang="ts">
import { computed, ref, watch } from "vue";
import {
  pnwCodeDefineUuidResultsPanel,
  pnwCodeGroupUuidHits,
  pnwCodeSelectedUuidGroupCount,
  pnwCodeSelectUuidHitIds,
  type PnwCodeUuidResultHit,
  type PnwCodeUuidResultsActionDetail,
  type PnwCodeUuidResultsPanelModel,
} from "@phoenix-wing/code-core/ui";
import {
  applyCodeUuids,
  scanCodeUuids,
  type CodeUuidHit,
  type UuidApplyStrategy,
  type UuidKind,
} from "../api";
import PageHeader from "phoenix-wing/layout/PnwPageHeader.vue";
import { useAppShell } from "../composables/useAppShell";
import { useGitDiffPreview } from "../composables/useGitDiffPreview";
import {
  CODE_UUID_STRATEGY_OPTIONS,
  useCodeUuidPropertySheet,
} from "../composables/useCodeUuidPropertySheet";
import {
  usePagePrimaryContribution,
  type PagePrimarySection,
} from "../composables/usePagePrimaryContribution";
import { pnwPromptChoice } from "phoenix-wing";
import { useWorksetPageScope } from "../composables/useWorksetPageScope";
import { useFileWorksetsStore } from "../stores/fileWorksets";

pnwCodeDefineUuidResultsPanel();

const props = defineProps<{
  workbenchTabId?: string;
}>();

const replacementsWritten = ref(false);

const shell = useAppShell();
const { preview: previewGitDiff } = useGitDiffPreview();
const worksetStore = useFileWorksetsStore();
const worksetScope = useWorksetPageScope("code_uuid");

const strategy = ref<UuidApplyStrategy>("map_per_value");
const includeGuid32 = ref(false);
const scanKinds = computed<UuidKind[]>(() => (
  includeGuid32.value ? ["uuid", "guid32"] : ["uuid"]
));

useCodeUuidPropertySheet("code_uuid", strategy);
const hits = ref<CodeUuidHit[]>([]);
const selected = ref<Set<string>>(new Set());
const replacementByHitId = ref<Record<string, string>>({});
const engineMessage = ref("");

const scanning = ref(false);
const applying = ref(false);
const primaryWorksetOptions = computed(() => [
  { value: "", label: "全工作空间" },
  ...worksetStore.worksetOptions.map((workset) => ({
    value: workset.id,
    label: `${workset.label}（${workset.count}）`,
  })),
]);

const selectedCount = computed(() => selected.value.size);
const allChecked = computed(
  () => hits.value.length > 0 && hits.value.every((h) => selected.value.has(h.hit_id)),
);
const uuidViewHits = computed<PnwCodeUuidResultHit[]>(() => hits.value.map((hit) => ({
  id: hit.hit_id,
  fileId: hit.repo_rel_path,
  relativePath: hit.repo_rel_path,
  line: hit.line,
  column: hit.col,
  from: hit.matched_text,
  normalized: hit.uuid_normalized,
  kind: hit.kind,
  to: replacementByHitId.value[hit.hit_id],
  state: replacementByHitId.value[hit.hit_id] && replacementsWritten.value ? "applied" : "pending",
})));
const uniqueUuidCount = computed(() => pnwCodeGroupUuidHits(uuidViewHits.value).length);

const uuidResultsModel = computed<PnwCodeUuidResultsPanelModel>(() => ({
  presentation: "hits",
  running: scanning.value || applying.value,
  hits: uuidViewHits.value,
  selectedIds: [...selected.value],
  emptyMessage: "点击「扫描 UUID」查看命中",
  capabilities: {
    selection: true,
    gitDiff: replacementsWritten.value,
  },
}));

const selectedNormCount = computed(() =>
  pnwCodeSelectedUuidGroupCount(uuidViewHits.value, [...selected.value]));

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

function toggleAll(checked: boolean) {
  selected.value = new Set(pnwCodeSelectUuidHitIds(
    uuidViewHits.value,
    checked ? hits.value.map((hit) => hit.hit_id) : [],
  ));
}

watch(strategy, () => {
  replacementByHitId.value = {};
  replacementsWritten.value = false;
});

async function onScan() {
  scanning.value = true;
  engineMessage.value = "";
  hits.value = [];
  selected.value = new Set();
  replacementByHitId.value = {};
  replacementsWritten.value = false;
  shell.appendLog("[Code UUID] 扫描…", { source: "code_uuid", open: true });
  try {
    const out = await scanCodeUuids({
      ...worksetScope.buildScanBody(),
      kinds: scanKinds.value,
    });
    hits.value = out.hits || [];
    engineMessage.value = out.message || "";
    shell.appendLog(out.message || `扫描完成 · 命中 ${hits.value.length}`, { source: "code_uuid" });
    shell.setStatus(out.implemented === false ? out.message || "扫描不可用" : `命中 ${hits.value.length}`);
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
  if (!ws || !wsPaths.length) {
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
    const choice = await pnwPromptChoice({
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
    replacementsWritten.value = !dryRun && Object.keys(next).length > 0;
    const logText = out.lines?.join("\n") || out.log || out.message || "完成";
    shell.appendLog(logText, { source: "code_uuid" });
    shell.setStatus(out.implemented === false ? out.message || `${mode}不可用` : `${mode}完成`);
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

async function onUuidResultsAction(event: Event): Promise<void> {
  const detail = (event as CustomEvent<PnwCodeUuidResultsActionDetail>).detail;
  if (detail.scope !== "hit") return;
  if (detail.kind === "selection") {
    selected.value = new Set(pnwCodeSelectUuidHitIds(uuidViewHits.value, detail.ids));
    return;
  }
  if (detail.action !== "gitDiff") return;
  const hit = uuidViewHits.value.find((item) => item.id === detail.ids[0]);
  if (hit) await previewGitDiff(hit.relativePath, "worktree");
}

usePagePrimaryContribution("code_uuid", props.workbenchTabId, {
  summary: computed(() => hits.value.length
    ? `命中 ${hits.value.length} 条 · ${uniqueUuidCount.value} 组 · 已选 ${selectedCount.value}`
    : "尚未扫描 UUID"),
  sections: computed<PagePrimarySection[]>(() => [
    {
      id: "scope",
      title: "扫描范围",
      description: "使用工作集可限制扫描文件；忽略规则与其他 Code 工具共用。",
      controls: [
        {
          id: "workset",
          kind: "select",
          label: "工作集",
          modelValue: computed(() => worksetScope.worksetId.value ?? ""),
          options: primaryWorksetOptions,
          clearable: true,
          onUpdate: (value) => {
            worksetScope.worksetId.value = value || null;
            worksetScope.scopeMode.value = value ? "workset" : "all";
          },
        },
        {
          id: "guid32",
          kind: "boolean",
          label: "包含 32 位 GUID",
          modelValue: includeGuid32,
          onUpdate: (checked) => { includeGuid32.value = checked; },
        },
      ],
      actions: [
        { id: "scan", label: "扫描 UUID", tone: "primary", loading: scanning, run: onScan },
        {
          id: "scan-active",
          label: computed(() => `当前工作集（${wsPathCount.value}）`),
          loading: scanning,
          disabled: computed(() => wsPathCount.value <= 0),
          run: scanFromActiveWorkset,
        },
        { id: "ignore", label: "忽略设定", run: openIgnorePanel },
      ],
    },
    {
      id: "replace",
      title: "替换计划",
      controls: [
        {
          id: "strategy",
          kind: "select",
          label: "替换策略",
          modelValue: strategy,
          options: CODE_UUID_STRATEGY_OPTIONS,
          description: CODE_UUID_STRATEGY_OPTIONS.find((option) => option.value === strategy.value)?.description,
          onUpdate: (value) => {
            strategy.value = value === "fresh_per_hit" ? "fresh_per_hit" : "map_per_value";
          },
        },
        { id: "hits", kind: "readonly", label: "命中", value: computed(() => hits.value.length) },
        { id: "groups", kind: "readonly", label: "UUID 组", value: uniqueUuidCount },
        { id: "selected", kind: "readonly", label: "已选", value: selectedCount },
      ],
      actions: [
        {
          id: "toggle-all",
          label: computed(() => allChecked.value ? "取消全选" : "全选命中"),
          disabled: computed(() => !hits.value.length),
          run: () => toggleAll(!allChecked.value),
        },
        {
          id: "dry-run",
          label: "预检",
          loading: applying,
          disabled: computed(() => !selectedCount.value),
          run: () => onApply(true),
        },
        {
          id: "apply",
          label: "执行替换",
          tone: "danger",
          loading: applying,
          disabled: computed(() => !selectedCount.value),
          run: () => onApply(false),
        },
      ],
    },
  ]),
});
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
        <el-checkbox v-model="includeGuid32" size="small">包含 32 位 GUID</el-checkbox>
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

      <pnw-code-uuid-results-panel
        :model="uuidResultsModel"
        @pnw-code-uuid-results-action="onUuidResultsAction"
      />
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

pnw-code-uuid-results-panel {
  display: block;
  max-height: calc(100vh - 420px);
  min-height: 80px;
  overflow: auto;
}
</style>
