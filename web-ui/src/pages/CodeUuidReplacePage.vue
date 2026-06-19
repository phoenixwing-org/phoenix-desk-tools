<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import {
  applyCodeUuids,
  fetchCodeIgnorePrefs,
  scanCodeUuids,
  type CodeUuidHit,
  type UuidApplyStrategy,
} from "../api";
import PageHelpButton from "../components/PageHelpButton.vue";
import { useAppShell } from "../composables/useAppShell";

const shell = useAppShell();

const scope = ref("");
const strategy = ref<UuidApplyStrategy>("map_per_value");
const hits = ref<CodeUuidHit[]>([]);
const selected = ref<Set<string>>(new Set());
const engineMessage = ref("");
const ignoreSummary = ref("");

const scanning = ref(false);
const applying = ref(false);

const selectedCount = computed(() => selected.value.size);
const allChecked = computed(
  () => hits.value.length > 0 && hits.value.every((h) => selected.value.has(h.hit_id)),
);
const uniqueUuidCount = computed(() => new Set(hits.value.map((h) => h.uuid_normalized)).size);

function toggleHit(id: string, checked: boolean) {
  const next = new Set(selected.value);
  if (checked) next.add(id);
  else next.delete(id);
  selected.value = next;
}

function toggleAll(checked: boolean) {
  selected.value = checked ? new Set(hits.value.map((h) => h.hit_id)) : new Set();
}

function selectSameUuid(hit: CodeUuidHit) {
  const norm = hit.uuid_normalized;
  const ids = hits.value.filter((h) => h.uuid_normalized === norm).map((h) => h.hit_id);
  selected.value = new Set([...selected.value, ...ids]);
  shell.setStatus(`已勾选相同 UUID 的 ${ids.length} 条`);
}

async function loadIgnoreSummary() {
  try {
    const ig = await fetchCodeIgnorePrefs();
    ignoreSummary.value = `忽略 ${ig.ignore_patterns.length} 条（文件 ${ig.ignore_file_patterns.length} + 自定义 ${ig.ignore_custom_patterns.length}）`;
  } catch {
    ignoreSummary.value = "";
  }
}

async function onScan() {
  scanning.value = true;
  engineMessage.value = "";
  hits.value = [];
  selected.value = new Set();
  shell.appendLog("[Code UUID] 扫描…", { source: "code_uuid", open: true });
  try {
    const out = await scanCodeUuids({ scope: scope.value.trim() || undefined });
    hits.value = out.hits || [];
    engineMessage.value = out.message || "";
    await loadIgnoreSummary();
    shell.appendLog(out.message || `扫描完成 · 命中 ${hits.value.length}`, { source: "code_uuid" });
    shell.setStatus(out.implemented ? `命中 ${hits.value.length}` : out.message || "引擎尚未接入");
  } catch (e) {
    shell.appendLog(String(e), { source: "code_uuid" });
    shell.setStatus(String(e));
  } finally {
    scanning.value = false;
  }
}

async function onApply(dryRun: boolean) {
  if (!selectedCount.value) {
    shell.setStatus("请至少勾选一条命中");
    return;
  }
  if (!dryRun) {
    const ok = window.confirm(`将替换 ${selectedCount.value} 条 UUID 命中。\n建议先预检。\n\n确定写盘？`);
    if (!ok) return;
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

onMounted(() => {
  void loadIgnoreSummary();
});
</script>

<template>
  <div class="page tool-page code-uuid-page">
    <header class="page-head">
      <div class="head-row">
        <h1 class="page-title">Code UUID 替换</h1>
        <p class="page-desc">扫描 UUID 形态字符串，勾选后批量替换；忽略规则在「Code 忽略设定」统一配置</p>
        <div class="head-help">
          <PageHelpButton page-id="code_uuid" />
        </div>
      </div>
    </header>

    <section class="card settings-card">
      <div class="form-row">
        <label class="field">
          <span class="field-label">范围（可选）</span>
          <input v-model="scope" class="input mono" type="text" spellcheck="false" placeholder="相对子目录" />
        </label>
        <label class="field">
          <span class="field-label">替换策略</span>
          <select v-model="strategy" class="input">
            <option value="map_per_value">同一旧 UUID → 一个新 UUID</option>
            <option value="fresh_per_hit">每条命中独立新 UUID</option>
          </select>
        </label>
        <div class="actions">
          <button type="button" class="btn btn-sm" :disabled="scanning" @click="onScan">
            {{ scanning ? "…" : "扫描 UUID" }}
          </button>
          <button type="button" class="btn btn-sm" :disabled="applying || !selectedCount" @click="onApply(true)">
            {{ applying ? "…" : "预检" }}
          </button>
          <button type="button" class="btn primary btn-sm" :disabled="applying || !selectedCount" @click="onApply(false)">
            {{ applying ? "…" : "执行替换" }}
          </button>
        </div>
      </div>
    </section>

    <section class="card ignore-banner">
      <span v-if="ignoreSummary" class="muted small">{{ ignoreSummary }}</span>
      <button type="button" class="btn btn-quiet btn-sm" @click="openIgnorePanel">右侧栏 · 忽略</button>
    </section>

    <section class="card results-card">
      <header class="results-head">
        <div class="results-head-row">
          <span class="section-label">扫描结果</span>
          <span v-if="hits.length" class="muted small">
            已选 {{ selectedCount }} / {{ hits.length }} · 去重 UUID {{ uniqueUuidCount }}
          </span>
        </div>
        <p v-if="engineMessage" class="engine-msg">{{ engineMessage }}</p>
      </header>

      <div class="table-wrap">
        <table v-if="hits.length" class="entry-table">
          <thead>
            <tr>
              <th class="col-check">
                <input
                  type="checkbox"
                  :checked="allChecked"
                  aria-label="全选"
                  @change="toggleAll(($event.target as HTMLInputElement).checked)"
                />
              </th>
              <th>文件</th>
              <th class="col-line">行</th>
              <th>原文</th>
              <th class="col-actions">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(h, i) in hits" :key="h.hit_id" :class="{ 'row-alt': i % 2 === 1 }">
              <td class="col-check">
                <input
                  type="checkbox"
                  :checked="selected.has(h.hit_id)"
                  @change="toggleHit(h.hit_id, ($event.target as HTMLInputElement).checked)"
                />
              </td>
              <td class="mono path-cell">{{ h.repo_rel_path }}</td>
              <td class="col-line mono">{{ h.line }}</td>
              <td class="mono uuid-cell">{{ h.matched_text }}</td>
              <td class="col-actions">
                <button type="button" class="link-btn" @click="selectSameUuid(h)">同值全选</button>
              </td>
            </tr>
          </tbody>
        </table>
        <p v-else class="empty">点击「扫描 UUID」；引擎接入前表格为空</p>
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

.field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 160px;
}

.field-label {
  font-size: 0.72rem;
  color: var(--muted);
}

.input {
  padding: 6px 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  font-size: 0.82rem;
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-left: auto;
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

.engine-msg {
  margin: 8px 0 0;
  font-size: 0.78rem;
  color: #b45309;
}

.table-wrap {
  max-height: calc(100vh - 420px);
  overflow: auto;
}

.entry-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.82rem;
}

.entry-table th,
.entry-table td {
  padding: 8px 10px;
  border-bottom: 1px solid var(--border);
  text-align: left;
}

.entry-table th {
  position: sticky;
  top: 0;
  background: #f8fafc;
  font-size: 0.78rem;
  color: var(--muted);
  z-index: 1;
}

.col-check {
  width: 40px;
  text-align: center;
}

.col-line {
  width: 48px;
}

.col-actions {
  width: 72px;
}

.path-cell {
  max-width: 220px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.uuid-cell {
  font-size: 0.76rem;
}

.link-btn {
  border: none;
  background: none;
  color: var(--accent);
  font-size: 0.76rem;
  cursor: pointer;
  padding: 0;
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
