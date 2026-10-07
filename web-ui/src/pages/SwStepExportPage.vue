<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import {
  fetchSwStepPrefs,
  previewSwStepExport,
  runSwStepExport,
  saveSwStepPrefs,
  type SwStepPrefs,
} from "../api";
import PageHeader from "phoenix-wing/layout/PnwPageHeader.vue";
import PageLayout from "phoenix-wing/layout/PnwPageLayout.vue";
import { useCadBatchDirectory } from "../composables/useCadBatchDirectory";
import { useAppShell } from "../composables/useAppShell";
import { cadBatchToolsSection } from "../composables/cadBatchTools";
import { useSwStepExportPropertySheet } from "../composables/useSwStepExportPropertySheet";
import {
  usePagePrimaryContribution,
  type PagePrimarySection,
} from "../composables/usePagePrimaryContribution";

const props = defineProps<{
  workbenchTabId?: string;
}>();

const shell = useAppShell();
const shared = useCadBatchDirectory(shell.workspacePath);

const sourceDir = shared.directory;
const outStepDir = ref("");
const recursiveScan = ref(false);

let prefsSaveTimer: ReturnType<typeof setTimeout> | null = null;
function schedulePrefsSave() {
  if (prefsSaveTimer) clearTimeout(prefsSaveTimer);
  prefsSaveTimer = setTimeout(() => {
    prefsSaveTimer = null;
    void onSave();
  }, 400);
}

useSwStepExportPropertySheet("sw_step_export", {
  sourceDir,
  outStepDir,
  recursiveScan,
  onPersist: schedulePrefsSave,
});

type SwStepMeta = Pick<
  SwStepPrefs,
  "com_available" | "adapter_available" | "solidworks_registered" | "availability_code" | "platform"
>;

const prefsMeta = ref<SwStepMeta | null>(null);

const saving = ref(false);
const previewing = ref(false);
const running = ref(false);
const modelCount = ref<number | null>(null);
shared.bindBusy(computed(() => saving.value || previewing.value || running.value));
let scopeEpoch = 0;
watch(shared.scopeKey, () => {
  scopeEpoch++;
  modelCount.value = null;
  if (prefsSaveTimer) clearTimeout(prefsSaveTimer);
}, { flush: "sync" });

function prefsPayload() {
  return {
    source_dir: sourceDir.value.trim(),
    out_step_dir: outStepDir.value.trim(),
    recursive_scan: recursiveScan.value,
  };
}

function updatePrefsMeta(prefs: SwStepPrefs) {
  prefsMeta.value = {
    com_available: prefs.com_available,
    adapter_available: prefs.adapter_available,
    solidworks_registered: prefs.solidworks_registered,
    availability_code: prefs.availability_code,
    platform: prefs.platform,
  };
}

function unavailableMessage(meta: SwStepMeta): string {
  if (meta.availability_code === "unsupported_platform") {
    return `当前平台 ${meta.platform} 不支持 SolidWorks COM 批量导出；预览与保存偏好仍可用。`;
  }
  if (meta.availability_code === "solidworks_not_registered") {
    return "未检测到 SldWorks.Application COM 注册；请安装或修复 SolidWorks。预览与保存偏好仍可用。";
  }
  return "未找到 PowerShell COM 适配器；请检查 PowerShell 与导出脚本。预览与保存偏好仍可用。";
}

async function loadPrefs() {
  const epoch = scopeEpoch;
  const prefs = await fetchSwStepPrefs();
  if (epoch !== scopeEpoch) return;
  outStepDir.value = prefs.out_step_dir;
  recursiveScan.value = prefs.recursive_scan;
  updatePrefsMeta(prefs);
}

async function onSave() {
  if (saving.value || previewing.value || running.value || shared.disabled.value) return;
  const epoch = scopeEpoch;
  saving.value = true;
  try {
    const prefs = await saveSwStepPrefs(prefsPayload());
    if (epoch !== scopeEpoch) return;
    outStepDir.value = prefs.out_step_dir;
    updatePrefsMeta(prefs);
    shell.setStatus("已保存 SW→STEP 偏好");
  } catch (e) {
    if (epoch !== scopeEpoch) return;
    shell.setStatus(String(e));
  } finally {
    saving.value = false;
  }
}

async function onPreview() {
  if (!await shared.validate()) return;
  const epoch = scopeEpoch;
  previewing.value = true;
  shell.appendLog("SW→STEP 预览模型数量…", { source: "sw_step_export", open: true });
  try {
    const data = await previewSwStepExport(prefsPayload());
    if (epoch !== scopeEpoch) return;
    updatePrefsMeta(data.prefs);
    modelCount.value = data.model_count;
    const msg = `${data.source_display} · ${data.model_count} 个模型`;
    shell.appendLog(msg, { source: "sw_step_export" });
    shell.setStatus(msg);
  } catch (e) {
    if (epoch !== scopeEpoch) return;
    shell.appendLog(String(e), { source: "sw_step_export" });
    shell.setStatus(String(e));
  } finally {
    previewing.value = false;
  }
}

async function onRun() {
  if (!prefsMeta.value?.com_available || !await shared.validate()) return;
  const epoch = scopeEpoch;
  running.value = true;
  shell.appendLog("SolidWorks COM 导出…", { source: "sw_step_export", open: true });
  try {
    const data = await runSwStepExport(prefsPayload());
    if (epoch !== scopeEpoch) return;
    updatePrefsMeta(data.prefs);
    shell.appendLog(data.log, { source: "sw_step_export" });
    shell.setStatus(`成功 ${data.ok_count} · 失败 ${data.failed_count} · 输出 ${data.out_display}`);
  } catch (e) {
    if (epoch !== scopeEpoch) return;
    shell.appendLog(String(e), { source: "sw_step_export" });
    shell.setStatus(String(e));
  } finally {
    running.value = false;
  }
}

usePagePrimaryContribution("sw_step_export", props.workbenchTabId, {
  title: "批量工具",
  summary: computed(() => {
    if (prefsMeta.value && !prefsMeta.value.com_available) return unavailableMessage(prefsMeta.value);
    if (modelCount.value == null) return "尚未预览 SolidWorks 模型";
    return `发现 ${modelCount.value} 个 SolidWorks 模型`;
  }),
  sections: computed<PagePrimarySection[]>(() => [
    cadBatchToolsSection(shell, "sw_step_export"),
    shared.section,
    {
      id: "export",
      title: "导出范围",
      description: "通过 Windows SolidWorks COM 将三维模型批量导出为 STEP。",
      controls: [
        {
          id: "output",
          kind: "text",
          label: "STEP 输出",
          modelValue: outStepDir,
          placeholder: "相对工作空间",
          mono: true,
          onUpdate: (value) => {
            outStepDir.value = value;
            schedulePrefsSave();
          },
        },
        {
          id: "recursive",
          kind: "boolean",
          label: "递归扫描子目录",
          modelValue: recursiveScan,
          onUpdate: (checked) => {
            recursiveScan.value = checked;
            schedulePrefsSave();
          },
        },
        { id: "platform", kind: "readonly", label: "平台", value: computed(() => prefsMeta.value?.platform || "—") },
        {
          id: "availability",
          kind: "readonly",
          label: "COM 状态",
          value: computed(() => prefsMeta.value?.com_available ? "可用" : "不可用"),
        },
        { id: "models", kind: "readonly", label: "模型数量", value: computed(() => modelCount.value ?? "—") },
      ],
      actions: [
        { id: "save", label: "保存偏好", loading: saving, run: onSave },
        { id: "preview", label: "预览数量", loading: previewing, run: onPreview },
        {
          id: "run",
          label: "开始导出",
          tone: "primary",
          loading: running,
          disabled: computed(() => !prefsMeta.value?.com_available),
          run: onRun,
        },
      ],
    },
  ]),
});

onUnmounted(() => {
  scopeEpoch++;
  if (prefsSaveTimer) clearTimeout(prefsSaveTimer);
});

onMounted(async () => {
  const epoch = scopeEpoch;
  try {
    await loadPrefs();
  } catch (e) {
    if (epoch === scopeEpoch) shell.setStatus(String(e));
  }
});
</script>

<template>
  <PageLayout class="desk-page-layout" title="SW→STEP">
    <template #header>
      <PageHeader title="SW→STEP">
        <template #right>
          <div data-tour-page-sw-run class="head-actions-inner">
            <el-button size="small" :loading="saving" @click="onSave">保存偏好</el-button>
            <el-button size="small" :loading="previewing" @click="onPreview">预览数量</el-button>
            <el-button
              type="primary"
              size="small"
              :loading="running"
              :disabled="!prefsMeta?.com_available"
              @click="onRun"
            >
              开始导出
            </el-button>
          </div>
        </template>
      </PageHeader>
    </template>

    <el-alert
      v-if="prefsMeta && !prefsMeta.com_available"
      class="platform-alert"
      type="warning"
      :closable="false"
      show-icon
      :title="unavailableMessage(prefsMeta)"
    />

    <section v-if="modelCount !== null" class="controls card" data-tour-page-sw-form>
      <p class="meta-line">发现 {{ modelCount }} 个 .sldprt / .sldasm</p>
    </section>
  </PageLayout>
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
