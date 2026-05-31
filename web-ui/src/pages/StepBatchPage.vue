<script setup lang="ts">
import { onMounted, ref } from "vue";
import {
  fetchStepBatchPrefs,
  previewStepBatch,
  runStepBatch,
  saveStepBatchPrefs,
  type StepBatchPreview,
} from "../api";
import { useAppShell } from "../composables/useAppShell";

const shell = useAppShell();

const stepDir = ref("");
const outDir = ref("");
const skipExisting = ref(true);
const viewFit = ref("none");
const useInboxBridge = ref(false);
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
    use_inbox_bridge: useInboxBridge.value,
    step_recursive: stepRecursive.value,
  };
}

async function loadPrefs() {
  const prefs = await fetchStepBatchPrefs();
  stepDir.value = prefs.step_dir;
  outDir.value = prefs.out_dir;
  skipExisting.value = prefs.skip_existing;
  viewFit.value = prefs.view_fit || "none";
  useInboxBridge.value = prefs.use_inbox_bridge;
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
  previewing.value = true;
  try {
    preview.value = await previewStepBatch(prefsPayload());
    shell.setStatus(
      `待转换 ${preview.value.batch_count} 个 STEP（顶层 ${preview.value.top_level} · 深层 ${preview.value.deep_total}）`,
    );
  } catch (e) {
    shell.setStatus(String(e));
  } finally {
    previewing.value = false;
  }
}

async function onRun() {
  running.value = true;
  shell.appendLog("freecadcmd 批量转换…（可能需要数分钟）", { source: "step_batch" });
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
      <h1 class="page-title">STEP 批量</h1>
      <p class="page-desc">
        使用 <code>freecadcmd</code> 批量将 STEP 转为 FCStd。请在「配置」页设置 FreeCAD 安装目录。
      </p>
    </header>

    <section class="controls">
      <label class="field-label" for="step-dir">STEP 目录</label>
      <input id="step-dir" v-model="stepDir" class="path-input full block" spellcheck="false" />

      <label class="field-label" for="out-dir">FCStd 输出目录</label>
      <input id="out-dir" v-model="outDir" class="path-input full block" spellcheck="false" />

      <div class="checks">
        <label><input v-model="skipExisting" type="checkbox" /> 跳过已存在 FCStd</label>
        <label><input v-model="stepRecursive" type="checkbox" /> 递归子目录</label>
        <label class="warn-label">
          <input v-model="useInboxBridge" type="checkbox" /> FreeCAD 收件箱桥接（Web 暂不支持）
        </label>
      </div>

      <label class="field-label" for="view-fit">视图适应</label>
      <select id="view-fit" v-model="viewFit" class="path-input fit-select">
        <option value="none">不调整</option>
        <option value="last">最后一个</option>
        <option value="all">全部</option>
      </select>

      <div class="row">
        <button type="button" class="btn" :disabled="saving" @click="onSave">{{ saving ? "…" : "保存偏好" }}</button>
        <button type="button" class="btn" :disabled="previewing" @click="onPreview">
          {{ previewing ? "…" : "预览数量" }}
        </button>
        <button type="button" class="btn primary" :disabled="running || useInboxBridge" @click="onRun">
          {{ running ? "转换中…" : "开始转换" }}
        </button>
      </div>

      <p v-if="preview" class="meta-line">
        {{ preview.step_dir_display }} · 批处理 {{ preview.batch_count }} 个
        {{ preview.recursive ? "（含子目录）" : "" }}
      </p>
    </section>
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

.fit-select {
  max-width: 200px;
  margin-bottom: 10px;
}

.warn-label {
  color: #b45309;
}
</style>
