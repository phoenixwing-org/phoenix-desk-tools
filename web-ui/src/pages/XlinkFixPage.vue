<script setup lang="ts">
import { onMounted, ref } from "vue";
import {
  fetchXlinkPrefs,
  runXlinkFix,
  saveXlinkPrefs,
  type XlinkFixResult,
} from "../api";
import { useAppShell } from "../composables/useAppShell";

const shell = useAppShell();

const batchDir = ref(".");
const dryRun = ref(true);
const allInDir = ref(true);
const saving = ref(false);
const running = ref(false);
const result = ref<XlinkFixResult | null>(null);

function prefsPayload() {
  return {
    batch_dir: batchDir.value.trim(),
    dry_run: dryRun.value,
    all_in_dir: allInDir.value,
  };
}

async function loadPrefs() {
  const prefs = await fetchXlinkPrefs();
  batchDir.value = prefs.batch_dir || ".";
  dryRun.value = prefs.dry_run;
  allInDir.value = prefs.all_in_dir;
}

async function onSave() {
  saving.value = true;
  try {
    const prefs = await saveXlinkPrefs(prefsPayload());
    batchDir.value = prefs.batch_dir || ".";
    shell.setStatus("已保存 xlink 偏好");
  } catch (e) {
    shell.setStatus(String(e));
  } finally {
    saving.value = false;
  }
}

async function onRun() {
  running.value = true;
  result.value = null;
  shell.appendLog("XLink 路径修正…", { source: "xlink_fix" });
  try {
    const data = await runXlinkFix(prefsPayload());
    result.value = data;
    shell.appendLog(data.log || "", { source: "xlink_fix" });
    const changes = data.total_changes ?? "—";
    shell.setStatus(
      data.exit_code === 0
        ? `完成（exit ${data.exit_code}）· 变更 ${changes}${data.dry_run ? " · dry-run" : ""}`
        : `脚本退出码 ${data.exit_code}`,
    );
  } catch (e) {
    shell.appendLog(String(e), { source: "xlink_fix" });
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
      <h1 class="page-title">链接路径修正</h1>
      <p class="page-desc">
        读取工作空间 <code>.phoenix/cad-database.sqlite</code>（由「CAD 索引」页扫描写入）。选择修正目录后运行
        <code>fix_fcstd_xlink_paths.py</code>。
      </p>
    </header>

    <section class="controls">
      <label class="field-label" for="batch-dir">修正目录</label>
      <div class="row">
        <input id="batch-dir" v-model="batchDir" class="path-input" spellcheck="false" placeholder="." />
        <button type="button" class="btn" :disabled="saving" @click="onSave">
          {{ saving ? "…" : "保存偏好" }}
        </button>
        <button type="button" class="btn primary" :disabled="running" @click="onRun">
          {{ running ? "运行中…" : "运行" }}
        </button>
      </div>
      <div class="checks">
        <label><input v-model="dryRun" type="checkbox" /> dry-run（只报告不写入）</label>
        <label><input v-model="allInDir" type="checkbox" /> all-in-dir（目录内全部 Document.xml）</label>
      </div>
      <p v-if="result?.map_path_display" class="meta-line">映射：{{ result.map_path_display }}</p>
      <p v-if="result?.batch_dir_display" class="meta-line">修正目录：{{ result.batch_dir_display }}</p>
      <p v-if="result?.report_path" class="meta-line">报告：{{ result.report_path }}</p>
    </section>
  </div>
</template>

<style scoped>
@import "./page-shared.css";
</style>
