<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { storeToRefs } from "pinia";
import {
  KT_CODEGEN_BLOCK_PRESENTATIONS,
  KT_CODEGEN_LEGACY_BLOCKS,
  ktCodegenBlockKeysForPreset,
  type KtCodegenBlockKey,
} from "@phoenix-wing/kt-codegen";
import { useAppShell } from "../../composables/useAppShell";
import { useKtCodegenStore } from "../../stores/ktCodegen";
import type { PageSideBlockHostProps } from "../../layout/pageRegistry";
import {
  enterKtCodegenSingleMode,
  toggleKtCodegenBlockSelection,
} from "../../utils/ktCodegenBlockSelection";

const props = defineProps<PageSideBlockHostProps>();

const shell = useAppShell();
const store = useKtCodegenStore(props.workbenchTabId);
const {
  active,
  applying,
  documents,
  discoveryMeta,
  dirty,
  loadingDocuments,
  opening,
  preflight,
  recoveryConflict,
  saving,
  selectedBlockKeys,
  selectedArtifactId,
  selectedRegionId,
  sourcePreview,
  status,
} = storeToRefs(store);

const selectedSet = computed(() => new Set(selectedBlockKeys.value));
const documentQuery = ref("");
const controlQuery = ref("");
const candidateQuery = ref("");
const singleMode = ref(false);
let discoveryPoll: ReturnType<typeof setInterval> | null = null;
const artifactByRegion = computed(() => new Map(
  (preflight.value?.plan.artifacts ?? []).map((artifact) => [artifact.regionId, artifact]),
));
const legacyBlockByKey = new Map(KT_CODEGEN_LEGACY_BLOCKS.map((block) => [block.key, block]));
const controlRows = KT_CODEGEN_BLOCK_PRESENTATIONS.map((presentation) => {
  const legacy = legacyBlockByKey.get(presentation.key);
  return {
    ...presentation,
    platform: legacy?.platform ?? "caa",
    legacyState: legacy?.legacyState ?? "active",
  };
});
const filteredDocuments = computed(() => {
  const query = documentQuery.value.trim().toLocaleLowerCase();
  if (!query) return documents.value;
  return documents.value.filter((document) => [
    document.file_name,
    document.path,
    document.class_name,
    document.format,
  ].some((value) => value.toLocaleLowerCase().includes(query)));
});
const filteredControlRows = computed(() => {
  const query = controlQuery.value.trim().toLocaleLowerCase();
  if (!query) return controlRows;
  return controlRows.filter((block) => [
    block.legacyId,
    block.key,
    block.title,
    block.controlWords,
    block.notes,
    block.platform,
    block.legacyState,
  ].some((value) => String(value).toLocaleLowerCase().includes(query)));
});
const filteredSourceCandidates = computed(() => {
  const candidates = preflight.value?.source_candidates ?? [];
  const query = candidateQuery.value.trim().toLocaleLowerCase();
  if (!query) return candidates;
  return candidates.filter((candidate) => candidate.path.toLocaleLowerCase().includes(query));
});

function isSelected(key: KtCodegenBlockKey): boolean {
  return selectedSet.value.has(key);
}

function toggleBlock(key: KtCodegenBlockKey, checked: boolean): void {
  store.setSelectedBlocks(toggleKtCodegenBlockSelection(
    selectedBlockKeys.value,
    key,
    checked,
    singleMode.value,
  ));
}

function applyPreset(preset: "all" | "none" | "cpp-only" | "field-code"): void {
  singleMode.value = false;
  store.setSelectedBlocks(ktCodegenBlockKeysForPreset(preset));
}

function toggleSingleMode(): void {
  singleMode.value = !singleMode.value;
  if (singleMode.value) {
    store.setSelectedBlocks(enterKtCodegenSingleMode(selectedBlockKeys.value));
  }
}

function markMetadataDirty(): void {
  store.markDirty();
  shell.scheduleWorkbenchSave();
}

function openDocument(path: string): void {
  const tabId = shell.openKtCodegenDocument(path);
  if (tabId) shell.setStatus(`已在独立 View 打开 ${path}`);
}

async function refresh(): Promise<void> {
  try {
    await store.discover();
    shell.setStatus(status.value);
  } catch (error) {
    shell.setStatus(String(error));
  }
}

function refreshOrCancel(): void {
  if (loadingDocuments.value) {
    store.cancelDiscovery();
    shell.setStatus(status.value);
  } else void refresh();
}

function selectRegion(regionId: string): void {
  const artifact = artifactByRegion.value.get(regionId);
  if (artifact) store.selectArtifact(artifact.id);
  else void store.previewRegion(regionId);
}

function selectCandidate(candidate: (typeof filteredSourceCandidates.value)[number]): void {
  void store.previewCandidate(candidate);
}

onMounted(() => {
  if (!documents.value.length) void refresh();
  discoveryPoll = setInterval(() => {
    void store.discover().catch(() => undefined);
  }, 15_000);
});

onUnmounted(() => {
  if (discoveryPoll) clearInterval(discoveryPoll);
  discoveryPoll = null;
  store.cancelDiscovery();
});
</script>

<template>
  <section class="codegen-sidebar" aria-label="KT Codegen Primary">
    <header class="block-head">
      <div>
        <strong>KT Codegen</strong>
        <span>Primary</span>
      </div>
      <button
        type="button"
        :disabled="applying"
        :title="loadingDocuments ? '取消配置发现' : '重新发现配置'"
        @click="refreshOrCancel"
      >
        {{ loadingDocuments ? "取消" : "刷新" }}
      </button>
    </header>

    <div class="sidebar-scroll" :inert="applying || undefined" :aria-busy="applying">
      <section class="sidebar-section">
        <div class="section-title">
          <span>配置文档</span>
          <small>{{ documents.length }}</small>
        </div>
        <label class="filter-row">
          <span class="sr-only">过滤配置文档</span>
          <input v-model="documentQuery" type="search" placeholder="过滤文件、类名或路径" spellcheck="false" />
        </label>
        <div class="document-list" aria-label="配置文档列表">
          <button
            v-for="document in filteredDocuments"
            :key="document.path"
            type="button"
            class="document-row"
            :class="{ active: active?.path === document.path }"
            :aria-current="active?.path === document.path ? 'true' : undefined"
            :disabled="opening || saving || applying"
            :title="document.path"
            @click="openDocument(document.path)"
          >
            <span class="document-name">
              {{ document.file_name }}<span v-if="active?.path === document.path && (dirty || recoveryConflict)"> *</span>
            </span>
            <span class="document-meta">
              {{ document.class_name || "未命名" }} · {{ document.item_count }} 行
              <span v-if="document.diagnostic_count" class="diagnostic-count">
                · {{ document.diagnostic_count }} 诊断
              </span>
            </span>
          </button>
          <p v-if="!documents.length && !loadingDocuments" class="empty">
            未发现配置。也可在本页激活时点击工作空间树中的 JSON/CSV。
          </p>
          <p v-else-if="!filteredDocuments.length" class="empty">没有匹配的配置文档。</p>
        </div>
        <p v-if="discoveryMeta.byteLimitReached" class="hint">
          本轮配置冷解析已到 64 MiB 上限；后续热缓存刷新会继续补齐。
        </p>
        <p v-else-if="discoveryMeta.truncated" class="hint">
          发现扫描已到 {{ discoveryMeta.scanned }} 个文件上限。
        </p>
        <p v-else-if="discoveryMeta.cacheHits" class="hint">
          本次复用 {{ discoveryMeta.cacheHits }} 个文件识别结果，读取 {{ discoveryMeta.filesRead }} 个。
        </p>
      </section>

      <section v-if="active" class="sidebar-section">
        <div class="section-title">
          <span>活动文档属性</span>
          <small>{{ dirty ? "未保存" : recoveryConflict ? "冲突" : "已同步" }}</small>
        </div>
        <div class="active-document" :title="active.path">
          <strong>{{ active.file_name }}</strong>
          <span>{{ active.class_name || "未命名" }} · {{ active.item_count }} 行</span>
        </div>
        <div class="metadata-fields" :inert="opening || saving || applying || Boolean(recoveryConflict) || undefined">
          <label>
            <span>Prefix</span>
            <input v-model="active.param.namePrefix" type="text" spellcheck="false" :disabled="opening || saving || applying || Boolean(recoveryConflict)" @input="markMetadataDirty" />
          </label>
          <label>
            <span>Middle</span>
            <input v-model="active.param.nameMiddle" type="text" spellcheck="false" :disabled="opening || saving || applying || Boolean(recoveryConflict)" @input="markMetadataDirty" />
          </label>
          <label>
            <span>Namespace</span>
            <input v-model="active.param.nameSpace" type="text" spellcheck="false" :disabled="opening || saving || applying || Boolean(recoveryConflict)" @input="markMetadataDirty" />
          </label>
          <label>
            <span>Append</span>
            <input v-model="active.param.appendFunction" type="text" spellcheck="false" :disabled="opening || saving || applying || Boolean(recoveryConflict)" @input="markMetadataDirty" />
          </label>
        </div>
      </section>

      <section class="sidebar-section">
        <div class="section-title">
          <span>控制符</span>
          <small>{{ selectedBlockKeys.length }} / {{ controlRows.length }}</small>
        </div>
        <div class="preset-row">
          <button type="button" @click="applyPreset('all')">全选</button>
          <button type="button" @click="applyPreset('none')">清空</button>
          <button type="button" @click="applyPreset('cpp-only')">C++</button>
          <button type="button" @click="applyPreset('field-code')">Field</button>
          <button
            type="button"
            :class="{ active: singleMode }"
            :aria-pressed="singleMode"
            @click="toggleSingleMode"
          >单选</button>
        </div>
        <label class="filter-row">
          <span class="sr-only">过滤控制符</span>
          <input v-model="controlQuery" type="search" placeholder="过滤 ID、控制符或平台" spellcheck="false" />
        </label>
        <div class="section-item-list control-list" aria-label="控制符目录">
          <label v-for="block in filteredControlRows" :key="block.key" class="control-row">
            <input
              type="checkbox"
              :checked="isSelected(block.key)"
              @change="toggleBlock(block.key, ($event.target as HTMLInputElement).checked)"
            />
            <span class="control-id">{{ block.legacyId }}</span>
            <span class="control-name" :title="`${block.title} · ${block.notes}`">{{ block.controlWords }}</span>
            <span class="control-tags">
              <span class="platform-tag" :class="block.platform">{{ block.platform }}</span>
              <span v-if="block.legacyState === 'legacy-deprecated'" class="deprecated-tag">deprecated</span>
            </span>
          </label>
          <p v-if="!filteredControlRows.length" class="empty">没有匹配的控制符。</p>
        </div>
      </section>

      <section v-if="preflight" class="sidebar-section">
        <div class="section-title">
          <span>候选源码</span>
          <small>{{ preflight.candidate_file_count }}</small>
        </div>
        <label class="filter-row">
          <span class="sr-only">过滤候选源码</span>
          <input v-model="candidateQuery" type="search" placeholder="过滤候选源码路径" spellcheck="false" />
        </label>
        <div class="section-item-list candidate-list" aria-label="候选源码列表">
          <button
            v-for="candidate in filteredSourceCandidates"
            :key="candidate.path"
            type="button"
            class="candidate-row"
            :class="{ active: !selectedRegionId && sourcePreview?.path === candidate.path }"
            :aria-pressed="!selectedRegionId && sourcePreview?.path === candidate.path"
            :title="candidate.path"
            @click="selectCandidate(candidate)"
          >
            <span>{{ candidate.path }}</span>
            <small>
              标记行 {{ candidate.marker_line + 1 }} · {{ candidate.encoding.toUpperCase() }} · {{ candidate.eol.toUpperCase() }}
            </small>
          </button>
          <p v-if="!filteredSourceCandidates.length" class="empty">没有匹配的候选源码。</p>
        </div>
        <p v-if="preflight.source_candidates_truncated" class="hint">
          候选列表仅展示前 {{ preflight.source_candidates.length }} 个，预检仍覆盖全部候选。
        </p>
      </section>

      <section v-if="preflight" class="sidebar-section">
        <div class="section-title">
          <span>预检命中</span>
          <small>{{ preflight.plan.markerRegions.length }}</small>
        </div>
        <div class="plan-summary">
          {{ preflight.candidate_file_count }} 候选 ·
          {{ preflight.plan.artifacts.length }} 产物 ·
          {{ preflight.plan.diagnostics.length }} 诊断
          <span v-if="preflight.reused"> · 缓存</span>
          <span v-if="preflight.source_cache_hits"> · 源文件缓存 {{ preflight.source_cache_hits }}</span>
          <span v-if="preflight.source_scan_byte_limit_reached"> · 快照达 64 MiB</span>
          <span v-else-if="preflight.source_scan_truncated"> · 扫描达 5000 文件</span>
          <span v-if="!preflight.safe_to_apply"> · 安全门禁未通过</span>
        </div>
        <p v-if="preflight.source_scan_truncated" class="apply-gate-warning" role="alert">
          源码扫描不完整，Apply 已关闭。请在 Code Ignore 中排除无关目录后重新预检。
        </p>
        <p v-else-if="!preflight.plan.canApply" class="apply-gate-warning" role="alert">
          Wing 计划未通过 Apply 校验；请先处理预检诊断。
        </p>
        <div class="section-item-list region-list" aria-label="预检命中列表">
          <button
            v-for="region in preflight.plan.markerRegions"
            :key="region.id"
            type="button"
            class="region-row"
            :class="{ active: region.id === selectedRegionId || artifactByRegion.get(region.id)?.id === selectedArtifactId }"
            :aria-pressed="region.id === selectedRegionId || artifactByRegion.get(region.id)?.id === selectedArtifactId"
            @click="selectRegion(region.id)"
          >
            <span>{{ region.blockKey }}</span>
            <small>{{ region.path }}:{{ region.start.line + 1 }} · {{ region.classId }}</small>
          </button>
        </div>
      </section>
    </div>

    <footer class="block-status" role="status" aria-live="polite" :title="status">{{ status }}</footer>
  </section>
</template>

<style scoped>
.codegen-sidebar {
  display: flex;
  flex: 1 1 auto;
  min-height: 0;
  flex-direction: column;
  color: var(--text);
  background: var(--sidebar-bg);
}

.block-head,
.section-title,
.preset-row,
.block-status {
  flex: 0 0 auto;
}

.block-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-height: 42px;
  padding: 7px 9px;
  border-bottom: 1px solid var(--border);
  background: var(--panel-head-bg);
}

.block-head div { min-width: 0; }
.block-head strong { display: block; font-size: 0.83rem; }
.block-head span { color: var(--muted); font-size: 0.68rem; }

button {
  color: inherit;
  background: var(--btn-bg);
  border: 1px solid var(--border-strong);
  border-radius: 4px;
  cursor: pointer;
}

button:disabled { opacity: 0.5; cursor: default; }
.preset-row button.active {
  color: var(--accent);
  background: color-mix(in srgb, var(--accent) 12%, var(--btn-bg));
  border-color: var(--accent);
}
.sidebar-scroll { flex: 1 1 auto; min-height: 0; overflow: auto; }
.sidebar-section { border-bottom: 1px solid var(--border); }

.document-list {
  --document-row-height: 44px;
  max-height: calc(var(--document-row-height) * 6);
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior: contain;
}

.section-item-list {
  max-height: min(34vh, 320px);
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-gutter: stable;
}

.candidate-list,
.region-list { max-height: min(28vh, 260px); }

.section-title {
  position: sticky;
  z-index: 2;
  top: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 30px;
  padding: 5px 9px;
  color: var(--muted);
  background: var(--panel-head-bg);
  border-bottom: 1px solid var(--border);
  font-size: 0.72rem;
  font-weight: 650;
}

.document-row,
.candidate-row,
.region-row {
  display: flex;
  width: 100%;
  min-width: 0;
  flex-direction: column;
  align-items: stretch;
  gap: 2px;
  padding: 7px 9px;
  text-align: left;
  background: transparent;
  border: 0;
  border-bottom: 1px solid var(--border);
  border-radius: 0;
}

.document-row:hover,
.candidate-row:hover,
.region-row:hover,
.document-row.active,
.candidate-row.active,
.region-row.active { background: color-mix(in srgb, var(--accent) 12%, transparent); }

.document-name,
.document-meta,
.candidate-row span,
.candidate-row small,
.region-row span,
.region-row small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.document-name { font-size: 0.77rem; font-weight: 600; }
.document-list .document-row {
  height: var(--document-row-height);
  min-height: var(--document-row-height);
}
.document-meta,
.candidate-row small,
.region-row small { color: var(--muted); font-size: 0.66rem; }
.candidate-row span { font-size: 0.69rem; font-family: ui-monospace, monospace; }
.empty, .hint { margin: 0; padding: 12px 9px; color: var(--muted); font-size: 0.72rem; }
.filter-row { display: block; padding: 6px 7px; border-bottom: 1px solid var(--border); }
.filter-row input {
  width: 100%;
  height: 26px;
  padding: 3px 7px;
  color: var(--text);
  background: var(--input-bg, var(--sidebar-bg));
  border: 1px solid var(--border-strong);
  border-radius: 4px;
  font-size: 0.68rem;
}
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; }
.diagnostic-count { color: #b45309; }

.active-document { display: grid; gap: 2px; padding: 7px 9px 3px; min-width: 0; }
.active-document strong,
.active-document span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.active-document strong { font-size: 0.75rem; }
.active-document span { color: var(--muted); font-size: 0.64rem; }
.metadata-fields { display: grid; gap: 5px; padding: 5px 9px 9px; }
.metadata-fields label { display: grid; grid-template-columns: 68px minmax(0, 1fr); align-items: center; gap: 6px; }
.metadata-fields label > span { color: var(--muted); font-size: 0.64rem; }
.metadata-fields input {
  min-width: 0;
  height: 25px;
  padding: 3px 6px;
  color: var(--text);
  background: var(--input-bg, var(--sidebar-bg));
  border: 1px solid var(--border-strong);
  border-radius: 4px;
  font: 0.68rem ui-monospace, monospace;
}

.preset-row { display: grid; grid-template-columns: repeat(5, 1fr); gap: 4px; padding: 6px; }
.preset-row button { min-height: 24px; padding: 2px 4px; font-size: 0.68rem; }

.control-row {
  display: grid;
  grid-template-columns: 18px 24px minmax(0, 1fr) auto;
  align-items: center;
  gap: 4px;
  min-height: 29px;
  padding: 3px 7px;
  border-top: 1px solid color-mix(in srgb, var(--border) 70%, transparent);
  font-size: 0.69rem;
}

.control-tags { display: inline-flex; align-items: center; justify-content: flex-end; gap: 3px; }
.deprecated-tag {
  padding: 1px 4px;
  color: #b45309;
  border: 1px solid currentColor;
  border-radius: 999px;
  font-size: 0.52rem;
}

.control-row:hover { background: color-mix(in srgb, var(--accent) 8%, transparent); }
.control-id { color: var(--muted); font-variant-numeric: tabular-nums; }
.control-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: ui-monospace, monospace; }
.platform-tag { padding: 0 4px; border: 1px solid var(--border-strong); border-radius: 999px; color: var(--muted); font-size: 0.58rem; }
.platform-tag.caa { color: #2563eb; }
.platform-tag.qt { color: #15803d; }
.platform-tag.cpp { color: #9333ea; }
.plan-summary { padding: 7px 9px; color: var(--muted); font-size: 0.68rem; }
.apply-gate-warning {
  margin: 0;
  padding: 7px 9px;
  color: #b45309;
  background: color-mix(in srgb, #f59e0b 9%, transparent);
  border-top: 1px solid color-mix(in srgb, #f59e0b 30%, var(--border));
  font-size: 0.68rem;
  line-height: 1.4;
}
.region-row span { font-size: 0.7rem; font-family: ui-monospace, monospace; }

.block-status {
  min-height: 30px;
  overflow: hidden;
  padding: 7px 9px;
  color: var(--muted);
  background: var(--panel-head-bg);
  border-top: 1px solid var(--border);
  font-size: 0.67rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
