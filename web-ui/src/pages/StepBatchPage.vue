<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import {
  fetchStepBatchPrefs,
  previewStepBatch,
  runStepBatch,
  saveStepBatchPrefs,
  type StepBatchPreview,
} from "../api";
import OnboardingBanner from "../components/OnboardingBanner.vue";
import PageHeader from "phoenix-wing/layout/PnwPageHeader.vue";
import { useAppShell } from "../composables/useAppShell";
import { useFreecadTaskGate } from "../composables/useFreecadTaskGate";
import {
  STEP_VIEW_FIT_OPTIONS,
  useStepBatchPropertySheet,
} from "../composables/useStepBatchPropertySheet";
import {
  usePagePrimaryContribution,
  type PagePrimarySection,
} from "../composables/usePagePrimaryContribution";

const props = defineProps<{
  workbenchTabId?: string;
}>();

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

usePagePrimaryContribution("step_batch", props.workbenchTabId, {
  summary: computed(() => {
    if (freecadBlocked.value) return freecadHint;
    if (!preview.value) return "尚未预览 STEP 批处理范围";
    return `待转换 ${preview.value.batch_count} 个 STEP · 深层 ${preview.value.deep_total}`;
  }),
  sections: computed<PagePrimarySection[]>(() => [
    {
      id: "paths",
      title: "转换范围",
      description: "通过 FreeCAD 将 STEP 批量转换为 FCStd。目录相对当前工作空间。",
      controls: [
        {
          id: "source",
          kind: "text",
          label: "STEP 目录",
          modelValue: stepDir,
          placeholder: "相对工作空间",
          mono: true,
          onUpdate: (value) => {
            stepDir.value = value;
            schedulePrefsSave();
          },
        },
        {
          id: "output",
          kind: "text",
          label: "FCStd 输出",
          modelValue: outDir,
          placeholder: "相对工作空间",
          mono: true,
          onUpdate: (value) => {
            outDir.value = value;
            schedulePrefsSave();
          },
        },
        {
          id: "recursive",
          kind: "boolean",
          label: "递归子目录",
          modelValue: stepRecursive,
          onUpdate: (checked) => {
            stepRecursive.value = checked;
            schedulePrefsSave();
          },
        },
        {
          id: "skip",
          kind: "boolean",
          label: "跳过已存在 FCStd",
          modelValue: skipExisting,
          onUpdate: (checked) => {
            skipExisting.value = checked;
            schedulePrefsSave();
          },
        },
        {
          id: "view-fit",
          kind: "select",
          label: "视图适应",
          modelValue: viewFit,
          options: STEP_VIEW_FIT_OPTIONS,
          onUpdate: (value) => {
            viewFit.value = STEP_VIEW_FIT_OPTIONS.some((option) => option.value === value) ? value : "none";
            schedulePrefsSave();
          },
        },
        { id: "batch", kind: "readonly", label: "待转换", value: computed(() => preview.value?.batch_count ?? "—") },
      ],
      actions: [
        { id: "save", label: "保存偏好", loading: saving, run: onSave },
        { id: "preview", label: "预览数量", loading: previewing, run: onPreview },
        {
          id: "run",
          label: "开始转换",
          tone: "primary",
          loading: running,
          disabled: freecadBlocked,
          run: onRun,
        },
        ...(freecadBlocked.value ? [{
          id: "config",
          label: "打开配置",
          run: () => shell.goToPage("config"),
        }] : []),
      ],
    },
  ]),
});

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
          <el-button size="small" :loading="previewing" @click="onPreview">预览数量</el-button>
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
