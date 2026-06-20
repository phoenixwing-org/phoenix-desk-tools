<script setup lang="ts">
import { onMounted, ref } from "vue";
import {
  fetchStepBatchPrefs,
  previewStepBatch,
  runStepBatch,
  saveStepBatchPrefs,
  type StepBatchPreview,
} from "../api";
import OnboardingBanner from "../components/OnboardingBanner.vue";
import PageHelpButton from "../components/PageHelpButton.vue";
import { useAppShell } from "../composables/useAppShell";
import { useFreecadTaskGate } from "../composables/useFreecadTaskGate";

const shell = useAppShell();
const { blocked: freecadBlocked, assertFreecadForTask, hint: freecadHint } = useFreecadTaskGate();

const stepDir = ref("");
const outDir = ref("");
const skipExisting = ref(true);
const viewFit = ref("none");
const stepRecursive = ref(false);

const saving = ref(false);
const previewing = ref(false);
const running = ref(false);
const preview = ref<StepBatchPreview | null>(null);

function prefsPayload() {
  return {
    step_dir: stepDir.value.trim(),
    out_dir: outDir.value.trim(),
    skip_existing: skipExisting.value,
    view_fit: viewFit.value,
    use_inbox_bridge: false,
    step_recursive: stepRecursive.value,
  };
}

async function loadPrefs() {
  const prefs = await fetchStepBatchPrefs();
  stepDir.value = prefs.step_dir;
  outDir.value = prefs.out_dir;
  skipExisting.value = prefs.skip_existing;
  viewFit.value = prefs.view_fit || "none";
  stepRecursive.value = prefs.step_recursive;
}

async function onSave() {
  saving.value = true;
  try {
    const prefs = await saveStepBatchPrefs(prefsPayload());
    stepDir.value = prefs.step_dir;
    outDir.value = prefs.out_dir;
    shell.setStatus("已保存 STEP 批量偏好");
  } catch (e) {
    shell.setStatus(String(e));
  } finally {
    saving.value = false;
  }
}

async function onPreview() {
  if (!assertFreecadForTask()) return;
  previewing.value = true;
  shell.appendLog("STEP 批量转换预览…", { source: "step_batch", open: true });
  try {
    preview.value = await previewStepBatch(prefsPayload());
    const msg = `待转换 ${preview.value.batch_count} 个 STEP（顶层 ${preview.value.top_level} · 深层 ${preview.value.deep_total}）`;
    shell.appendLog(msg, { source: "step_batch" });
    shell.setStatus(msg);
  } catch (e) {
    shell.appendLog(String(e), { source: "step_batch" });
    shell.setStatus(String(e));
  } finally {
    previewing.value = false;
  }
}

async function onRun() {
  if (!assertFreecadForTask()) return;
  running.value = true;
  shell.appendLog("freecadcmd 批量转换…（可能需要数分钟）", { source: "step_batch", open: true });
  try {
    const data = await runStepBatch(prefsPayload());
    shell.appendLog(data.log, { source: "step_batch" });
    if (data.exit_code === 0 && data.ok_count != null) {
      shell.setStatus(
        `成功 ${data.ok_count} · 跳过 ${data.skip_count ?? 0} · 失败 ${data.fail_count ?? 0} · 输出 ${data.out_dir_display}`,
      );
    } else if (data.exit_code === 0) {
      shell.setStatus(`转换完成 · 输出 ${data.out_dir_display}`);
    } else {
      shell.setStatus(`freecadcmd 退出码 ${data.exit_code} · 详见运行日志`);
    }
  } catch (e) {
    shell.appendLog(String(e), { source: "step_batch" });
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
        <h1 class="page-title">STEP 批量</h1>
        <p class="page-desc">
          使用 <code>freecadcmd</code> 批量将 STEP 转为 FCStd。请在「配置」页设置 FreeCAD 安装目录。
        </p>
        <div class="head-help">
          <PageHelpButton page-id="step_batch" />
        </div>
      </div>
    </header>

    <OnboardingBanner
      v-if="freecadBlocked"
      :message="freecadHint"
      action-label="打开配置"
      @action="shell.goToPage('config')"
    />

    <section class="controls card" data-tour-page-step-form>
      <el-form label-width="11rem" class="step-form" @submit.prevent>
        <el-form-item label="STEP 目录">
          <el-input id="step-dir" v-model="stepDir" spellcheck="false" />
        </el-form-item>
        <el-form-item label="FCStd 输出目录">
          <el-input id="out-dir" v-model="outDir" spellcheck="false" />
        </el-form-item>
        <el-form-item label="选项">
          <div class="checks">
            <el-checkbox v-model="skipExisting">跳过已存在 FCStd</el-checkbox>
            <el-checkbox v-model="stepRecursive">递归子目录</el-checkbox>
          </div>
        </el-form-item>
        <el-form-item label="视图适应">
          <el-select v-model="viewFit" class="fit-select">
            <el-option value="none" label="不调整" />
            <el-option value="last" label="最后一个" />
            <el-option value="all" label="全部" />
          </el-select>
        </el-form-item>
        <el-form-item label="操作">
          <div class="row" data-tour-page-step-run>
            <el-button :loading="saving" @click="onSave">保存偏好</el-button>
            <el-button :loading="previewing" :disabled="freecadBlocked" @click="onPreview">预览数量</el-button>
            <el-button type="primary" :loading="running" :disabled="freecadBlocked" @click="onRun">
              开始转换
            </el-button>
          </div>
        </el-form-item>
        <el-form-item v-if="preview" label="预览结果">
          <p class="meta-line">
            {{ preview.step_dir_display }} · 批处理 {{ preview.batch_count }} 个
            {{ preview.recursive ? "（含子目录）" : "" }}
          </p>
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

.step-form {
  max-width: 720px;
}

.step-form :deep(.el-form-item__label) {
  color: var(--muted);
}

.checks {
  display: flex;
  flex-wrap: wrap;
  gap: 12px 16px;
}

.row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.meta-line {
  margin: 0;
  font-size: 0.88rem;
  color: var(--text);
}

.fit-select {
  width: min(240px, 100%);
}
</style>
