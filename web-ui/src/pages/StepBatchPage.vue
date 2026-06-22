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
import PageHeader from "../components/PageHeader.vue";
import { useAppShell } from "../composables/useAppShell";
import { useFreecadTaskGate } from "../composables/useFreecadTaskGate";
import { useStepBatchPropertySheet } from "../composables/useStepBatchPropertySheet";

const shell = useAppShell();
const { blocked: freecadBlocked, assertFreecadForTask, hint: freecadHint } = useFreecadTaskGate();

const stepDir = ref("");
const outDir = ref("");
const skipExisting = ref(true);
const viewFit = ref("none");
const stepRecursive = ref(false);

let prefsSaveTimer: ReturnType<typeof setTimeout> | null = null;
function schedulePrefsSave() {
  if (prefsSaveTimer) clearTimeout(prefsSaveTimer);
  prefsSaveTimer = setTimeout(() => {
    prefsSaveTimer = null;
    void onSave();
  }, 400);
}

useStepBatchPropertySheet("step_batch", {
  stepDir,
  outDir,
  skipExisting,
  viewFit,
  stepRecursive,
  onPersist: schedulePrefsSave,
});

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
    <PageHeader title="STEP 批量" page-id="step_batch">
      <template #actions>
        <div data-tour-page-step-run class="head-actions-inner">
          <el-button size="small" :loading="saving" @click="onSave">保存偏好</el-button>
          <el-button size="small" :loading="previewing" :disabled="freecadBlocked" @click="onPreview">预览数量</el-button>
          <el-button type="primary" size="small" :loading="running" :disabled="freecadBlocked" @click="onRun">
            开始转换
          </el-button>
        </div>
      </template>
    </PageHeader>

    <OnboardingBanner
      v-if="freecadBlocked"
      :message="freecadHint"
      action-label="打开配置"
      @action="shell.goToPage('config')"
    />

    <section v-if="preview" class="controls card" data-tour-page-step-form>
      <p class="meta-line">
        {{ preview.step_dir_display }} · 批处理 {{ preview.batch_count }} 个
        {{ preview.recursive ? "（含子目录）" : "" }}
      </p>
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
