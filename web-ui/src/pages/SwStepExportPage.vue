<script setup lang="ts">
import { onMounted, ref } from "vue";
import {
  fetchSwStepPrefs,
  previewSwStepExport,
  runSwStepExport,
  saveSwStepPrefs,
  type SwStepPrefs,
} from "../api";
import PageHelpButton from "../components/PageHelpButton.vue";
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
  shell.appendLog("SW→STEP 预览模型数量…", { source: "sw_step_export", open: true });
  try {
    const data = await previewSwStepExport(prefsPayload());
    modelCount.value = data.model_count;
    const msg = `${data.source_display} · ${data.model_count} 个模型`;
    shell.appendLog(msg, { source: "sw_step_export" });
    shell.setStatus(msg);
  } catch (e) {
    shell.appendLog(String(e), { source: "sw_step_export" });
    shell.setStatus(String(e));
  } finally {
    previewing.value = false;
  }
}

async function onRun() {
  running.value = true;
  shell.appendLog("SolidWorks COM 导出…", { source: "sw_step_export", open: true });
  try {
    const data = await runSwStepExport(prefsPayload());
    shell.appendLog(data.log, { source: "sw_step_export" });
    shell.setStatus(`成功 ${data.ok_count} · 失败 ${data.failed_count} · 输出 ${data.out_display}`);
  } catch (e) {
    shell.appendLog(String(e), { source: "sw_step_export" });
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
      <div class="head-row">
        <h1 class="page-title">SW→STEP</h1>
        <p class="page-desc">
          SolidWorks 三维模型批量导出 STEP（Windows COM）。非 Windows 可保存偏好与预览模型数量。
        </p>
        <div class="head-help">
          <PageHelpButton page-id="sw_step_export" />
        </div>
      </div>
    </header>

    <el-alert
      v-if="prefsMeta && !prefsMeta.com_available"
      class="platform-alert"
      type="warning"
      :closable="false"
      show-icon
      :title="`当前平台 ${prefsMeta.platform} 不支持 COM 批量导出；预览与保存偏好仍可用。`"
    />

    <section class="controls card" data-tour-page-sw-form>
      <el-form label-width="11rem" class="sw-form" @submit.prevent>
        <el-form-item label="SolidWorks 模型目录">
          <el-input id="src-dir" v-model="sourceDir" spellcheck="false" />
        </el-form-item>
        <el-form-item label="STEP 输出目录">
          <el-input id="out-dir" v-model="outStepDir" spellcheck="false" />
        </el-form-item>
        <el-form-item label="选项">
          <el-checkbox v-model="recursiveScan">递归扫描子目录</el-checkbox>
        </el-form-item>
        <el-form-item label="操作">
          <div class="row" data-tour-page-sw-run>
            <el-button :loading="saving" @click="onSave">保存偏好</el-button>
            <el-button :loading="previewing" @click="onPreview">预览数量</el-button>
            <el-button
              type="primary"
              :loading="running"
              :disabled="!prefsMeta?.com_available"
              @click="onRun"
            >
              开始导出
            </el-button>
          </div>
        </el-form-item>
        <el-form-item v-if="modelCount !== null" label="预览结果">
          <p class="meta-line">发现 {{ modelCount }} 个 .sldprt / .sldasm</p>
        </el-form-item>
      </el-form>
    </section>
  </div>
</template>

<style scoped>
@import "./page-shared.css";

.card {
  padding: 14px 16px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: #fff;
}

.platform-alert {
  margin-bottom: 12px;
}

.sw-form {
  max-width: 720px;
}

.sw-form :deep(.el-form-item__label) {
  color: var(--muted);
}

.row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.meta-line {
  margin: 0;
  font-size: 0.88rem;
}
</style>
