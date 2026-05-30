<script setup lang="ts">
import { onMounted, ref } from "vue";
import {
  fetchSwStepPrefs,
  previewSwStepExport,
  runSwStepExport,
  saveSwStepPrefs,
  type SwStepPrefs,
} from "../api";
import { useAppShell } from "../composables/useAppShell";

const shell = useAppShell();

const sourceDir = ref("");
const outStepDir = ref("");
const recursiveScan = ref(false);
const prefsMeta = ref<Pick<SwStepPrefs, "com_available" | "platform"> | null>(null);

const saving = ref(false);
const previewing = ref(false);
const running = ref(false);
const modelCount = ref<number | null>(null);
const logText = ref("");

function prefsPayload() {
  return {
    source_dir: sourceDir.value.trim(),
    out_step_dir: outStepDir.value.trim(),
    recursive_scan: recursiveScan.value,
  };
}

async function loadPrefs() {
  const prefs = await fetchSwStepPrefs();
  sourceDir.value = prefs.source_dir;
  outStepDir.value = prefs.out_step_dir;
  recursiveScan.value = prefs.recursive_scan;
  prefsMeta.value = { com_available: prefs.com_available, platform: prefs.platform };
}

async function onSave() {
  saving.value = true;
  try {
    const prefs = await saveSwStepPrefs(prefsPayload());
    sourceDir.value = prefs.source_dir;
    outStepDir.value = prefs.out_step_dir;
    shell.setStatus("已保存 SW→STEP 偏好");
  } catch (e) {
    shell.setStatus(String(e));
  } finally {
    saving.value = false;
  }
}

async function onPreview() {
  previewing.value = true;
  try {
    const data = await previewSwStepExport(prefsPayload());
    modelCount.value = data.model_count;
    shell.setStatus(`${data.source_display} · ${data.model_count} 个模型`);
  } catch (e) {
    shell.setStatus(String(e));
  } finally {
    previewing.value = false;
  }
}

async function onRun() {
  running.value = true;
  logText.value = "";
  try {
    const data = await runSwStepExport(prefsPayload());
    logText.value = data.log;
    shell.setStatus(`成功 ${data.ok_count} · 失败 ${data.failed_count} · 输出 ${data.out_display}`);
  } catch (e) {
    shell.setStatus(String(e));
  } finally {
    running.value = false;
  }
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
      <h1 class="page-title">SW→STEP</h1>
      <p class="page-desc">
        SolidWorks 三维模型批量导出 STEP（Windows COM）。非 Windows 可保存偏好与预览模型数量。
      </p>
    </header>

    <div v-if="prefsMeta && !prefsMeta.com_available" class="banner warn">
      当前平台 {{ prefsMeta.platform }} 不支持 COM 批量导出；预览与保存偏好仍可用。
    </div>

    <section class="controls">
      <label class="field-label" for="src-dir">SolidWorks 模型目录</label>
      <input id="src-dir" v-model="sourceDir" class="path-input full block" spellcheck="false" />

      <label class="field-label" for="out-dir">STEP 输出目录</label>
      <input id="out-dir" v-model="outStepDir" class="path-input full block" spellcheck="false" />

      <div class="checks">
        <label><input v-model="recursiveScan" type="checkbox" /> 递归扫描子目录</label>
      </div>

      <div class="row">
        <button type="button" class="btn" :disabled="saving" @click="onSave">{{ saving ? "…" : "保存偏好" }}</button>
        <button type="button" class="btn" :disabled="previewing" @click="onPreview">
          {{ previewing ? "…" : "预览数量" }}
        </button>
        <button
          type="button"
          class="btn primary"
          :disabled="running || !prefsMeta?.com_available"
          @click="onRun"
        >
          {{ running ? "导出中…" : "开始导出" }}
        </button>
      </div>

      <p v-if="modelCount !== null" class="meta-line">发现 {{ modelCount }} 个 .sldprt / .sldasm</p>
    </section>

    <pre v-if="logText" class="log">{{ logText }}</pre>
  </div>
</template>

<style scoped>
@import "./page-shared.css";

.full.block {
  display: block;
  width: 100%;
  max-width: 640px;
  margin-bottom: 10px;
}

.banner.warn {
  padding: 10px 12px;
  margin-bottom: 12px;
  background: #fff7ed;
  border: 1px solid #fed7aa;
  border-radius: 8px;
  color: #9a3412;
  font-size: 0.85rem;
  max-width: 640px;
}
</style>
