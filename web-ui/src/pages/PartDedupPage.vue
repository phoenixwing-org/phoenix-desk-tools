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
  try {
    scanResult.value = await scanPartDedup(prefsPayload());
    shell.setStatus(scanResult.value.summary);
  } catch (e) {
    shell.setStatus(String(e));
  } finally {
    scanning.value = false;
  }
}

async function onExport() {
  exporting.value = true;
  try {
    const data = await exportPartDedupCsv(scanResult.value?.results);
    shell.setStatus(`已导出 ${data.path_display}`);
  } catch (e) {
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
  <div class="page tool-page">
    <header class="page-head">
      <h1 class="page-title">编号查重</h1>
      <p class="page-desc">按扩展名扫描目录，检查文件名重复、编号重复、编号+版本重复。</p>
    </header>

    <section class="controls">
      <div class="grid2">
        <div>
          <label class="field-label" for="scan-dir">扫描目录</label>
          <input id="scan-dir" v-model="scanDir" class="path-input full" spellcheck="false" />
        </div>
        <div>
          <label class="field-label" for="ext">扩展名</label>
          <select id="ext" v-model="extension" class="path-input full">
            <option v-for="opt in EXT_OPTIONS" :key="opt" :value="opt">{{ opt }}</option>
          </select>
        </div>
      </div>
      <div class="grid3">
        <label class="inline">编号位数 <input v-model.number="codeLen" type="number" min="1" max="20" class="num" /></label>
        <label class="inline">版本位数 <input v-model.number="verLen" type="number" min="1" max="10" class="num" /></label>
        <div class="checks inline-checks">
          <label><input v-model="checkCode" type="checkbox" /> 查编号</label>
          <label><input v-model="checkVersion" type="checkbox" /> 查版本</label>
          <label><input v-model="codeMustBeDigit" type="checkbox" /> 编号须数字</label>
        </div>
      </div>
      <div class="row">
        <button type="button" class="btn" :disabled="saving" @click="onSave">{{ saving ? "…" : "保存偏好" }}</button>
        <button type="button" class="btn primary" :disabled="scanning" @click="onScan">
          {{ scanning ? "扫描中…" : "开始扫描" }}
        </button>
        <button type="button" class="btn" :disabled="exporting || !scanResult" @click="onExport">
          {{ exporting ? "…" : "导出 CSV" }}
        </button>
      </div>
    </section>

    <section v-if="stats" class="stats">
      <span>文件 {{ scanResult?.file_count }}</span>
      <span>文件名重复 {{ stats.name_dup }}</span>
      <span>编号重复 {{ stats.code_dup }}</span>
      <span>编号+版本 {{ stats.ver_dup }}</span>
    </section>

    <section class="tabs">
      <button type="button" class="tab" :class="{ active: tab === 'name_dup' }" @click="tab = 'name_dup'">
        文件名 ({{ stats?.name_dup ?? 0 }})
      </button>
      <button type="button" class="tab" :class="{ active: tab === 'code_dup' }" @click="tab = 'code_dup'">
        编号 ({{ stats?.code_dup ?? 0 }})
      </button>
      <button type="button" class="tab" :class="{ active: tab === 'ver_dup' }" @click="tab = 'ver_dup'">
        编号+版本 ({{ stats?.ver_dup ?? 0 }})
      </button>
    </section>

    <div class="table-wrap">
      <div v-if="activeGroups.length" class="dup-list">
        <article v-for="(group, i) in activeGroups" :key="group.label + i" class="dup-group">
          <h3 class="dup-title">{{ group.label }}</h3>
          <ul>
            <li v-for="(p, j) in pathsOf(group)" :key="p + j" class="mono">{{ p }}</li>
          </ul>
        </article>
      </div>
      <p v-else class="empty">{{ scanResult ? "当前类别无重复" : "设置参数后点击「开始扫描」" }}</p>
    </div>
  </div>
</template>

<style scoped>
@import "./page-shared.css";

.grid2 {
  display: grid;
  grid-template-columns: 1fr 160px;
  gap: 12px;
  margin-bottom: 10px;
}

.grid3 {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  align-items: center;
  margin-bottom: 10px;
  font-size: 0.85rem;
}

.full {
  width: 100%;
}

.num {
  width: 56px;
  margin-left: 6px;
  padding: 4px 6px;
  border: 1px solid var(--border-strong);
  border-radius: 4px;
}

.inline-checks {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}

.tabs {
  display: flex;
  gap: 6px;
  margin-bottom: 8px;
}

.tab {
  padding: 6px 12px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: #fff;
  font-size: 0.82rem;
}

.tab.active {
  background: var(--accent);
  color: #fff;
  border-color: var(--accent);
}

.dup-list {
  padding: 8px 12px;
}

.dup-group {
  margin-bottom: 14px;
}

.dup-title {
  margin: 0 0 6px;
  font-size: 0.88rem;
}

.dup-group ul {
  margin: 0;
  padding-left: 18px;
}

.dup-group li {
  margin: 2px 0;
  font-size: 0.78rem;
}
</style>
