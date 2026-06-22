<script setup lang="ts">
import { computed, inject, onMounted, watch } from "vue";
import { codeIgnoreFormKey } from "../composables/codeIgnoreFormKey";
import { useCodeIgnoreForm } from "../composables/useCodeIgnoreForm";
import { useAppShell } from "../composables/useAppShell";

const props = withDefaults(
  defineProps<{
    /** page：独立页宽布局；sidebar：右侧栏紧凑布局 */
    layout?: "page" | "sidebar";
  }>(),
  { layout: "page" },
);

const emit = defineEmits<{
  saved: [prefs: import("../api").CodeIgnorePrefs];
}>();

const shell = useAppShell();
const compact = computed(() => props.layout === "sidebar");
const injectedForm = inject(codeIgnoreFormKey, null);
const localForm = injectedForm ? null : useCodeIgnoreForm();
const form = injectedForm ?? localForm!;

const {
  loading,
  saving,
  ignoreFileDisplay,
  ignoreFileExists,
  ignoreFilePatterns,
  legacySources,
  customIgnoreText,
  ignorePreset,
  ignorePresets,
  customLineCount,
  mergedIgnoreCount,
  hasProcessSuggestions,
  processDirSuggestions,
  loadPrefs,
  onApplySuggestions,
  onSave,
  onApplyPreset,
} = form;

async function handleSave() {
  const out = await onSave();
  if (out) emit("saved", out);
}

onMounted(() => {
  if (!injectedForm) void loadPrefs();
});

watch(
  () => shell.workspacePath.value,
  () => {
    void loadPrefs();
  },
  { flush: "post" },
);

defineExpose({ reload: loadPrefs });
</script>

<template>
  <div class="code-ignore-panel" :class="{ compact }">
    <header v-if="compact" class="sidebar-head">
      <span class="sidebar-summary muted small"> 合并 {{ mergedIgnoreCount }} 条 </span>
      <div class="sidebar-actions">
        <el-button size="small" :loading="loading" title="重新读取 code.ignore" @click="loadPrefs">
          刷新
        </el-button>
        <el-button type="primary" size="small" :loading="saving" @click="handleSave">保存</el-button>
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
            <el-button size="small" @click="onApplySuggestions">填入自定义</el-button>
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
              <el-select
                v-model="ignorePreset"
                size="small"
                class="preset-select"
                placeholder="（无）"
                @change="onApplyPreset"
              >
                <el-option value="" label="（无）" />
                <el-option v-for="p in ignorePresets" :key="p.id" :value="p.id" :label="p.label" />
              </el-select>
            </label>
          </div>
          <el-input
            v-model="customIgnoreText"
            type="textarea"
            class="custom-ignore-input mono"
            :rows="compact ? 8 : 10"
            spellcheck="false"
            placeholder="# 每行一条&#10;ImportedInterfaces"
          />
          <div v-if="!compact" class="panel-actions">
            <el-button type="primary" size="small" :loading="saving" @click="handleSave">保存配置</el-button>
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
  width: 160px;
}

.custom-ignore-input :deep(textarea) {
  font-family: var(--mono-font, ui-monospace, monospace);
  font-size: 0.72rem;
  line-height: 1.35;
}

.panel-actions {
  margin-top: 8px;
  display: flex;
  justify-content: flex-end;
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
