<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import {
  exportPartDedupCsv,
  fetchPartDedupPrefs,
  savePartDedupPrefs,
  scanPartDedup,
  type PartDedupGroup,
  type PartDedupScanResult,
} from "../api";
import { useAppShell } from "../composables/useAppShell";

const shell = useAppShell();

const EXT_OPTIONS = [".FCStd", ".SLDPRT", ".SLDASM", ".SLDDRW", ".step", ".stp"];

const extension = ref(".SLDPRT");
const codeLen = ref(6);
const verLen = ref(3);
const checkCode = ref(true);
const checkVersion = ref(true);
const codeMustBeDigit = ref(true);
const scanDir = ref(".");
const tab = ref<"name_dup" | "code_dup" | "ver_dup">("name_dup");

const saving = ref(false);
const scanning = ref(false);
const exporting = ref(false);
const scanResult = ref<PartDedupScanResult | null>(null);

const activeGroups = computed(() => scanResult.value?.results[tab.value] ?? []);
const stats = computed(() => scanResult.value?.stats);
const tabKeyLabel = computed(() => {
  if (tab.value === "name_dup") return "文件名";
  if (tab.value === "code_dup") return "编号";
  return "编号+版本";
});

function prefsPayload() {
  return {
    extension: extension.value,
    code_len: codeLen.value,
    ver_len: verLen.value,
    check_code: checkCode.value,
    check_version: checkVersion.value,
    code_must_be_digit: codeMustBeDigit.value,
    scan_dir: scanDir.value.trim(),
  };
}

async function loadPrefs() {
  const prefs = await fetchPartDedupPrefs();
  extension.value = prefs.extension;
  codeLen.value = prefs.code_len;
  verLen.value = prefs.ver_len;
  checkCode.value = prefs.check_code;
  checkVersion.value = prefs.check_version;
  codeMustBeDigit.value = prefs.code_must_be_digit;
  scanDir.value = prefs.scan_dir || ".";
}

async function onSave() {
  saving.value = true;
  try {
    const prefs = await savePartDedupPrefs(prefsPayload());
    scanDir.value = prefs.scan_dir || ".";
    shell.setStatus("已保存查重偏好");
  } catch (e) {
    shell.setStatus(String(e));
  } finally {
    saving.value = false;
  }
}

async function onScan() {
  scanning.value = true;
  shell.appendLog(`[零件查重] 扫描 ${scanDir.value.trim()}…`, { source: "part_dedup", open: true });
  try {
    scanResult.value = await scanPartDedup(prefsPayload());
    shell.appendLog(scanResult.value.summary, { source: "part_dedup" });
    shell.setStatus(scanResult.value.summary);
  } catch (e) {
    shell.appendLog(String(e), { source: "part_dedup" });
    shell.setStatus(String(e));
  } finally {
    scanning.value = false;
  }
}

async function onExport() {
  exporting.value = true;
  shell.appendLog("[零件查重] 导出 CSV…", { source: "part_dedup", open: true });
  try {
    const data = await exportPartDedupCsv(scanResult.value?.results);
    shell.appendLog(`已导出 ${data.path_display}`, { source: "part_dedup" });
    shell.setStatus(`已导出 ${data.path_display}`);
  } catch (e) {
    shell.appendLog(String(e), { source: "part_dedup" });
    shell.setStatus(String(e));
  } finally {
    exporting.value = false;
  }
}

function pathsOf(group: PartDedupGroup) {
  return group.paths_display ?? group.paths;
}

onMounted(async () => {
  try {
    await loadPrefs();
  } catch (e) {
    shell.setStatus(String(e));
  }
});
</script>

<template>
  <div class="page tool-page dedup-page">
    <header class="page-head">
      <div class="head-row">
        <h1 class="page-title">编号查重</h1>
        <p class="page-desc">按扩展名扫描目录，检测文件名、编号、编号+版本三类重复</p>
      </div>
    </header>

    <section class="card settings-card">
      <div class="settings-form">
        <div class="form-row">
          <span class="section-label">扫描设置</span>
          <label class="inline-field grow" for="scan-dir">
            <span class="inline-label">目录</span>
            <input
              id="scan-dir"
              v-model="scanDir"
              class="compact-input mono"
              spellcheck="false"
              placeholder="相对工作空间，如 ."
            />
          </label>
          <label class="inline-field" for="ext">
            <span class="inline-label">扩展名</span>
            <select id="ext" v-model="extension" class="compact-input compact-select">
              <option v-for="opt in EXT_OPTIONS" :key="opt" :value="opt">{{ opt }}</option>
            </select>
          </label>
          <label class="inline-field tiny">
            <span class="inline-label">编号</span>
            <input v-model.number="codeLen" type="number" min="1" max="20" class="compact-input num" />
          </label>
          <label class="inline-field tiny">
            <span class="inline-label">版本</span>
            <input v-model.number="verLen" type="number" min="1" max="10" class="compact-input num" />
          </label>
        </div>

        <div class="form-row form-foot">
          <div class="option-chips">
            <label class="opt-chip">
              <input v-model="checkCode" type="checkbox" />
              <span>查编号</span>
            </label>
            <label class="opt-chip">
              <input v-model="checkVersion" type="checkbox" />
              <span>查版本</span>
            </label>
            <label class="opt-chip">
              <input v-model="codeMustBeDigit" type="checkbox" />
              <span>编号须数字</span>
            </label>
          </div>
          <div class="settings-actions">
            <button type="button" class="btn btn-quiet btn-sm" :disabled="saving" @click="onSave">
              {{ saving ? "…" : "保存偏好" }}
            </button>
            <button type="button" class="btn primary btn-sm" :disabled="scanning" @click="onScan">
              {{ scanning ? "扫描中…" : "开始扫描" }}
            </button>
            <button type="button" class="btn btn-sm" :disabled="exporting || !scanResult" @click="onExport">
              {{ exporting ? "…" : "导出 CSV" }}
            </button>
          </div>
        </div>
      </div>
    </section>

    <section class="card results-card">
      <header class="results-head">
        <div class="results-head-row">
          <span class="section-label">查重结果</span>
          <div class="filter-tabs">
            <button
              type="button"
              class="tab"
              :class="{ active: tab === 'name_dup' }"
              @click="tab = 'name_dup'"
            >
              文件名 {{ stats?.name_dup ?? 0 }}
            </button>
            <button
              type="button"
              class="tab"
              :class="{ active: tab === 'code_dup' }"
              @click="tab = 'code_dup'"
            >
              编号 {{ stats?.code_dup ?? 0 }}
            </button>
            <button
              type="button"
              class="tab"
              :class="{ active: tab === 'ver_dup' }"
              @click="tab = 'ver_dup'"
            >
              编号+版本 {{ stats?.ver_dup ?? 0 }}
            </button>
          </div>
        </div>
        <p v-if="stats" class="scan-summary">
          <span>文件 <strong>{{ scanResult?.file_count }}</strong></span>
          <span class="sep">·</span>
          <span :class="{ warn: stats.name_dup > 0 }">
            文件名重复 <strong>{{ stats.name_dup }}</strong>
          </span>
          <span class="sep">·</span>
          <span :class="{ warn: stats.code_dup > 0 }">
            编号重复 <strong>{{ stats.code_dup }}</strong>
          </span>
          <span class="sep">·</span>
          <span :class="{ warn: stats.ver_dup > 0 }">
            编号+版本 <strong>{{ stats.ver_dup }}</strong>
          </span>
        </p>
      </header>

      <div class="table-wrap">
        <table v-if="activeGroups.length" class="dup-table">
          <thead>
            <tr>
              <th class="col-idx">#</th>
              <th class="col-label">{{ tabKeyLabel }}</th>
              <th class="col-count">副本</th>
              <th>路径</th>
            </tr>
          </thead>
          <tbody>
            <template v-for="(group, i) in activeGroups" :key="group.label + i">
              <tr
                v-for="(p, j) in pathsOf(group)"
                :key="p + j"
                class="dup-row"
                :class="{ 'group-start': j === 0, 'group-alt': i % 2 === 1 }"
              >
                <td v-if="j === 0" :rowspan="pathsOf(group).length" class="col-idx">{{ i + 1 }}</td>
                <td v-if="j === 0" :rowspan="pathsOf(group).length" class="col-label">
                  <span class="mono dup-key">{{ group.label }}</span>
                </td>
                <td v-if="j === 0" :rowspan="pathsOf(group).length" class="col-count">
                  <span class="dup-badge">{{ pathsOf(group).length }}</span>
                </td>
                <td class="path-cell mono">{{ p }}</td>
              </tr>
            </template>
          </tbody>
        </table>
        <p v-else class="empty">{{ scanning ? "扫描中…" : scanResult ? "当前类别无重复" : "设置参数后点击「开始扫描」" }}</p>
      </div>
    </section>
  </div>
</template>

<style scoped>
@import "./page-shared.css";

.dedup-page .page-head {
  margin-bottom: 10px;
}

.dedup-page .head-row {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 6px 10px;
}

.dedup-page .page-title {
  margin: 0;
}

.dedup-page .page-desc {
  max-width: none;
}

.dedup-page strong {
  font-weight: 600;
}

.card {
  padding: 10px 14px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: #fff;
  margin-bottom: 10px;
}

.section-label {
  flex-shrink: 0;
  margin: 0;
  padding-right: 10px;
  border-right: 2px solid var(--accent);
  font-size: 0.72rem;
  font-weight: 600;
  letter-spacing: 0.03em;
  color: var(--muted);
  white-space: nowrap;
  line-height: 1.2;
}

.settings-form {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.form-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 12px;
}

.form-foot {
  justify-content: space-between;
}

.inline-field {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.inline-field.grow {
  flex: 1 1 240px;
}

.inline-field.tiny {
  flex: 0 0 auto;
}

.inline-label {
  font-size: 0.76rem;
  color: var(--muted);
  white-space: nowrap;
}

.compact-input {
  min-width: 0;
  padding: 4px 8px;
  border: 1px solid var(--border-strong);
  border-radius: 5px;
  font-size: 0.82rem;
  box-sizing: border-box;
  background: #fff;
}

.inline-field.grow .compact-input {
  width: 100%;
  max-width: 420px;
}

.compact-select {
  width: 96px;
}

.compact-input.num {
  width: 48px;
  font-variant-numeric: tabular-nums;
}

.option-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.opt-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: #f8fafc;
  font-size: 0.76rem;
  cursor: pointer;
  user-select: none;
}

.opt-chip:has(input:checked) {
  background: #eff6ff;
  border-color: #93c5fd;
  color: #1d4ed8;
}

.settings-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-left: auto;
}

.btn-sm {
  padding: 5px 11px;
  font-size: 0.78rem;
}

.btn-quiet {
  color: var(--muted);
  border-color: transparent;
  background: transparent;
}

.btn-quiet:hover:not(:disabled) {
  background: #f1f5f9;
  border-color: var(--border);
}

.results-head {
  margin-bottom: 8px;
}

.results-head-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 10px;
  align-items: center;
  justify-content: space-between;
}

.scan-summary {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 0;
  margin: 8px 0 0;
  font-size: 0.78rem;
  color: var(--muted);
}

.scan-summary .sep {
  margin: 0 6px;
  color: #cbd5e1;
}

.scan-summary strong {
  font-weight: 600;
  color: var(--text);
}

.scan-summary .warn strong {
  color: #b45309;
}

.filter-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.tab {
  padding: 5px 12px;
  border-radius: 999px;
  border: 1px solid var(--border-strong);
  background: var(--btn-bg);
  font-size: 0.78rem;
}

.tab.active {
  background: var(--accent);
  color: #fff;
  border-color: var(--accent);
}

.dedup-page .table-wrap {
  max-height: calc(100vh - 360px);
  padding: 0;
}

.dup-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.82rem;
}

.dup-table th,
.dup-table td {
  padding: 8px 12px;
  border-bottom: 1px solid var(--border);
  text-align: left;
  vertical-align: top;
}

.dup-table th {
  position: sticky;
  top: 0;
  background: #f8fafc;
  font-weight: 600;
  font-size: 0.78rem;
  color: var(--muted);
  z-index: 1;
  white-space: nowrap;
}

.dup-table .col-idx {
  width: 40px;
  text-align: center;
  color: var(--muted);
  font-variant-numeric: tabular-nums;
}

.dup-table .col-label {
  width: 28%;
  min-width: 160px;
}

.dup-table .col-count {
  width: 56px;
  text-align: center;
}

.dup-key {
  display: inline-block;
  font-weight: 600;
  word-break: break-all;
  line-height: 1.45;
}

.dup-badge {
  display: inline-block;
  min-width: 22px;
  padding: 2px 8px;
  border-radius: 999px;
  background: #fef3c7;
  border: 1px solid #fcd34d;
  color: #92400e;
  font-size: 0.72rem;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.path-cell {
  color: var(--muted);
  word-break: break-all;
  line-height: 1.45;
}

.dup-row:hover .path-cell {
  color: var(--text);
}

.dup-row.group-start td {
  border-top: 2px solid #e2e8f0;
}

.dup-row.group-start:first-child td {
  border-top: none;
}

.dup-row.group-alt td {
  background: #fafbfc;
}

.dup-row.group-alt:hover td {
  background: #f1f5f9;
}

.dup-row:not(.group-alt):hover td {
  background: #f8fafc;
}

@media (max-width: 720px) {
  .form-foot {
    flex-direction: column;
    align-items: stretch;
  }

  .settings-actions {
    width: 100%;
    margin-left: 0;
    justify-content: flex-end;
  }

  .inline-field.grow .compact-input {
    max-width: none;
  }
}
</style>
