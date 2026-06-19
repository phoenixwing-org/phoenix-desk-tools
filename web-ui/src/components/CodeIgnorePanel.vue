<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import {
  fetchCodeIgnorePrefs,
  saveCodeIgnorePrefs,
  type CodeIgnorePrefs,
} from "../api";
import { useAppShell } from "../composables/useAppShell";

const props = withDefaults(
  defineProps<{
    /** page：独立页宽布局；sidebar：右侧栏紧凑布局 */
    layout?: "page" | "sidebar";
  }>(),
  { layout: "page" },
);

const emit = defineEmits<{
  saved: [prefs: CodeIgnorePrefs];
}>();

const shell = useAppShell();
const compact = computed(() => props.layout === "sidebar");

const CONSUMER_LABELS: Record<string, string> = {
  code_index: "Code 索引",
  reorder_members: "C++ 成员排序",
  code_rename: "批量改名",
  code_uuid: "UUID 替换",
};

const loading = ref(false);
const saving = ref(false);

const ignoreFileDisplay = ref("");
const ignoreFileExists = ref(false);
const ignoreFilePatterns = ref<string[]>([]);
const ignoreBuiltinCount = ref(0);
const legacySources = ref<Array<{ filename: string; patterns: string[] }>>([]);
const customIgnoreText = ref("");
const ignorePreset = ref("");
const ignorePresets = ref<Array<{ id: string; label: string; patterns: string[] }>>([]);
const consumers = ref<string[]>([]);
const processDirSuggestions = ref<
  Array<{
    name: string;
    kind: string;
    reason: string;
    repo_rel_path: string;
    suggested_pattern: string;
  }>
>([]);
const processDirsAutoSeeded = ref<string[]>([]);

const hasProcessSuggestions = computed(() => processDirSuggestions.value.length > 0);
const autoSeedNotice = computed(() => {
  const seeded = processDirsAutoSeeded.value;
  if (!seeded.length) return "";
  return `首次打开已自动加入忽略：${seeded.join("、")}`;
});

const customLineCount = computed(() =>
  customIgnoreText.value
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#")).length,
);
const mergedIgnoreCount = computed(
  () => ignoreBuiltinCount.value + ignoreFilePatterns.value.length + customLineCount.value,
);

function parseCustomLines(text: string): string[] {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));
}

function applyPrefs(data: CodeIgnorePrefs) {
  ignoreFileDisplay.value = data.ignore_file_display || data.ignore_file;
  ignoreFileExists.value = data.ignore_file_exists;
  ignoreFilePatterns.value = data.ignore_file_patterns || [];
  ignoreBuiltinCount.value = data.ignore_builtin?.length ?? 0;
  legacySources.value = data.legacy_ignore_sources || [];
  customIgnoreText.value = (data.custom_ignore || []).join("\n");
  ignorePreset.value = data.ignore_preset || "";
  ignorePresets.value = data.ignore_presets || [];
  consumers.value = data.consumers || [];
  processDirSuggestions.value = data.process_dir_suggestions || [];
  processDirsAutoSeeded.value = data.process_dirs_auto_seeded || [];
  if (processDirsAutoSeeded.value.length) {
    shell.setStatus(autoSeedNotice.value);
  }
}

async function loadPrefs() {
  loading.value = true;
  try {
    applyPrefs(await fetchCodeIgnorePrefs());
  } catch (e) {
    shell.setStatus(String(e));
  } finally {
    loading.value = false;
  }
}

function onApplySuggestions() {
  const lines = parseCustomLines(customIgnoreText.value);
  const seen = new Set(lines.map((l) => l.toLowerCase()));
  let added = 0;
  for (const item of processDirSuggestions.value) {
    const pat = item.suggested_pattern || item.name;
    if (!pat || seen.has(pat.toLowerCase())) continue;
    lines.push(pat);
    seen.add(pat.toLowerCase());
    added += 1;
  }
  if (!added) {
    shell.setStatus("推荐项已在自定义列表中");
    return;
  }
  customIgnoreText.value = lines.join("\n");
  shell.setStatus(`已填入 ${added} 条过程目录推荐，保存后生效`);
}

async function onSave() {
  saving.value = true;
  try {
    const out = await saveCodeIgnorePrefs({
      custom_ignore: parseCustomLines(customIgnoreText.value),
      ignore_preset: ignorePreset.value,
    });
    applyPrefs(out);
    shell.setStatus("已保存 Code 忽略配置");
    emit("saved", out);
  } catch (e) {
    shell.setStatus(String(e));
  } finally {
    saving.value = false;
  }
}

function onApplyPreset() {
  if (!ignorePreset.value) return;
  const preset = ignorePresets.value.find((p) => p.id === ignorePreset.value);
  if (preset?.patterns?.length) {
    customIgnoreText.value = preset.patterns.join("\n");
    shell.setStatus(`已填入 ${preset.label} 预设，保存后生效`);
  }
}

onMounted(() => {
  void loadPrefs();
});

watch(
  () => shell.workspacePath.value,
  () => {
    void loadPrefs();
  },
);

defineExpose({ reload: loadPrefs });
</script>

<template>
  <div class="code-ignore-panel" :class="{ compact }">
    <header v-if="!compact" class="meta-card card">
      <p class="meta-line">
        <span class="section-label">生效范围</span>
        <span v-for="(id, i) in consumers" :key="id">
          <span v-if="i"> · </span>{{ CONSUMER_LABELS[id] || id }}
        </span>
      </p>
      <p class="meta-line muted small">
        合并生效 <strong>{{ mergedIgnoreCount }}</strong> 条（内置 {{ ignoreBuiltinCount }} + 文件
        {{ ignoreFilePatterns.length }} + 自定义 {{ customLineCount }}）
        <button type="button" class="btn btn-quiet btn-sm" :disabled="loading" @click="loadPrefs">
          {{ loading ? "…" : "刷新" }}
        </button>
      </p>
    </header>

    <header v-else class="sidebar-head">
      <span class="sidebar-summary muted small">
        合并 {{ mergedIgnoreCount }} 条
      </span>
      <div class="sidebar-actions">
        <button type="button" class="mini" :disabled="loading" title="重新读取 code.ignore" @click="loadPrefs">
          {{ loading ? "…" : "刷新" }}
        </button>
        <button type="button" class="mini primary" :disabled="saving" @click="onSave">
          {{ saving ? "…" : "保存" }}
        </button>
      </div>
    </header>

    <div class="sections" :class="{ 'sections-page': !compact }">
      <details class="ignore-section" :open="compact ? undefined : true">
        <summary class="ignore-summary">
          <span class="ignore-title">来自 .ignore 文件</span>
          <span class="muted small">{{ ignoreFilePatterns.length }} 条</span>
        </summary>
        <div class="ignore-body">
          <p class="ignore-lead">
            <span class="mono">{{ ignoreFileDisplay || ".phoenix/code.ignore" }}</span>
            <span v-if="ignoreFileExists">（已加载）</span>
            <span v-else>（未建则读旧文件或仅内置）</span>
          </p>
          <ul v-if="ignoreFilePatterns.length" class="pattern-list mono">
            <li v-for="p in ignoreFilePatterns" :key="p">{{ p }}</li>
          </ul>
          <p v-else class="muted small">暂无文件条目</p>
          <div v-if="legacySources.length" class="legacy-box">
            <p class="legacy-title">旧文件（建议迁移）</p>
            <div v-for="src in legacySources" :key="src.filename" class="legacy-item">
              <span class="mono">{{ src.filename }}</span>
              <span class="muted">（{{ src.patterns.length }}）</span>
            </div>
          </div>
          <p class="muted small">磁盘编辑后点「刷新」。</p>
        </div>
      </details>

      <details v-if="hasProcessSuggestions" class="ignore-section" open>
        <summary class="ignore-summary">
          <span class="ignore-title">过程目录推荐</span>
          <span class="muted small">{{ processDirSuggestions.length }} 项</span>
        </summary>
        <div class="ignore-body">
          <p class="ignore-lead">
            工作空间一级目录中疑似构建/生成目录，尚未被当前规则覆盖。内置已含
            <span class="mono">build-*</span> 等通配（如 build-ui）。
          </p>
          <ul class="pattern-list mono">
            <li v-for="item in processDirSuggestions" :key="item.name">
              {{ item.name }}
              <span class="muted">→ {{ item.suggested_pattern }}</span>
            </li>
          </ul>
          <div class="panel-actions">
            <button type="button" class="btn btn-quiet btn-sm" @click="onApplySuggestions">
              填入自定义
            </button>
          </div>
        </div>
      </details>

      <details class="ignore-section" open>
        <summary class="ignore-summary">
          <span class="ignore-title">自定义配置</span>
          <span class="muted small">{{ customLineCount }} 条</span>
        </summary>
        <div class="ignore-body">
          <p v-if="!compact" class="ignore-lead">CAA / Qt 等工程差异；与文件规则合并后生效。</p>
          <div class="preset-row">
            <label class="preset-label">
              预设
              <select v-model="ignorePreset" class="preset-select" @change="onApplyPreset">
                <option value="">（无）</option>
                <option v-for="p in ignorePresets" :key="p.id" :value="p.id">{{ p.label }}</option>
              </select>
            </label>
          </div>
          <textarea
            v-model="customIgnoreText"
            class="custom-ignore-input mono"
            :rows="compact ? 8 : 10"
            spellcheck="false"
            placeholder="# 每行一条&#10;ImportedInterfaces"
          />
          <div v-if="!compact" class="panel-actions">
            <button type="button" class="btn primary btn-sm" :disabled="saving" @click="onSave">
              {{ saving ? "…" : "保存配置" }}
            </button>
          </div>
        </div>
      </details>

      <details v-if="compact" class="ignore-section help-section">
        <summary class="ignore-summary">
          <span class="ignore-title">规则说明</span>
        </summary>
        <ul class="help-list">
          <li>隐藏项（<code>.</code> 开头）始终忽略。</li>
          <li>支持 fnmatch 通配；索引 / 排序 / 改名共用。</li>
        </ul>
      </details>
    </div>

    <details v-if="!compact" class="help-panel">
      <summary class="help-summary">规则说明</summary>
      <ul class="help-list">
        <li>以 <code>.</code> 开头的隐藏项始终忽略。</li>
        <li>精确名称匹配 basename；含 <code>*?[]</code> 时按 fnmatch 通配。</li>
        <li>递归扫描在每一级目录 basename 上应用相同规则。</li>
        <li>成员排序仅作用于工作空间一级条目，但使用同一套合并规则。</li>
      </ul>
    </details>
  </div>
</template>

<style scoped>
.code-ignore-panel.compact {
  display: flex;
  flex-direction: column;
  min-height: 0;
  height: 100%;
  font-size: 0.78rem;
}

.card {
  padding: 10px 14px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: #fff;
  margin-bottom: 10px;
}

.section-label {
  margin-right: 10px;
  padding-right: 10px;
  border-right: 2px solid var(--accent);
  font-size: 0.72rem;
  font-weight: 600;
  color: var(--muted);
}

.meta-line {
  margin: 0 0 6px;
  font-size: 0.82rem;
}

.meta-line:last-child {
  margin-bottom: 0;
}

.sidebar-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 10px;
  border-bottom: 1px solid var(--border);
  background: var(--panel-head-bg);
  flex-shrink: 0;
}

.sidebar-actions {
  display: flex;
  gap: 4px;
}

.mini {
  padding: 2px 8px;
  font-size: 0.72rem;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: #fff;
  cursor: pointer;
}

.mini.primary {
  background: var(--accent);
  border-color: var(--accent);
  color: #fff;
}

.mini:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.sections {
  flex: 1;
  min-height: 0;
  overflow: auto;
}

.sections-page {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.compact .sections {
  padding: 6px 8px 8px;
}

@media (max-width: 860px) {
  .sections-page {
    grid-template-columns: 1fr;
  }
}

.ignore-section {
  border: 1px solid var(--border);
  border-radius: 6px;
  background: #f8fafc;
  margin-bottom: 8px;
}

.compact .ignore-section {
  background: #fff;
}

.ignore-summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 8px;
  cursor: pointer;
  list-style: none;
  user-select: none;
}

.ignore-summary::-webkit-details-marker {
  display: none;
}

.ignore-title {
  font-weight: 600;
  font-size: 0.76rem;
}

.ignore-body {
  padding: 0 8px 8px;
  border-top: 1px solid var(--border);
}

.ignore-lead {
  margin: 8px 0;
  font-size: 0.76rem;
  color: var(--muted);
  line-height: 1.45;
}

.pattern-list {
  margin: 0 0 8px;
  padding-left: 1.2rem;
  font-size: 0.72rem;
  max-height: 120px;
  overflow: auto;
}

.legacy-box {
  margin: 6px 0;
  padding: 6px;
  border-radius: 4px;
  background: #fffbeb;
  border: 1px solid #fde68a;
  font-size: 0.72rem;
}

.legacy-title {
  margin: 0 0 4px;
  font-weight: 600;
  color: #92400e;
}

.legacy-item {
  margin: 2px 0;
}

.preset-row {
  margin: 8px 0;
}

.preset-label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 0.72rem;
}

.preset-select {
  padding: 2px 6px;
  border-radius: 4px;
  border: 1px solid var(--border);
  font-size: inherit;
}

.custom-ignore-input {
  width: 100%;
  box-sizing: border-box;
  padding: 6px;
  border: 1px solid var(--border);
  border-radius: 4px;
  font-size: 0.72rem;
  line-height: 1.35;
  resize: vertical;
  background: #fff;
}

.panel-actions {
  margin-top: 8px;
  display: flex;
  justify-content: flex-end;
}

.btn-sm {
  padding: 5px 11px;
  font-size: 0.78rem;
}

.help-panel {
  margin-top: 4px;
  font-size: 0.78rem;
}

.help-summary {
  cursor: pointer;
  color: var(--muted);
}

.help-list {
  margin: 8px 0 0;
  padding: 0 8px 8px 1.2rem;
  color: var(--muted);
  line-height: 1.45;
  font-size: 0.72rem;
}

.help-section .help-list {
  margin-top: 0;
}
</style>
