<script setup lang="ts">
import { computed } from "vue";
import { useAppShell } from "../composables/useAppShell";
import { useWorksetPageScope } from "../composables/useWorksetPageScope";
import { useFileWorksetsStore, type WorksetScopeMode } from "../stores/fileWorksets";

const props = withDefaults(
  defineProps<{
    pageId: string;
    /** Code 模块页可显示「Code 索引 present」 */
    showIndexScope?: boolean;
  }>(),
  {
    showIndexScope: true,
  },
);

const store = useFileWorksetsStore();
const shell = useAppShell();
const pageScope = useWorksetPageScope(props.pageId);

const scopeMode = computed({
  get: () => pageScope.scopeMode.value,
  set: (v: WorksetScopeMode) => {
    pageScope.scopeMode.value = v;
  },
});

const worksetId = computed({
  get: () => pageScope.worksetId.value,
  set: (v: string | null) => {
    pageScope.worksetId.value = v;
  },
});

const worksetIdSelect = computed({
  get: () => worksetId.value ?? "",
  set: (v: string) => {
    worksetId.value = v || null;
  },
});

const scope = computed({
  get: () => pageScope.scope.value,
  set: (v: string) => {
    pageScope.scope.value = v;
  },
});

function onScopeModeChange(mode: WorksetScopeMode) {
  scopeMode.value = mode;
  if (mode === "workset" && !worksetId.value && store.activeId) {
    worksetId.value = store.activeId;
  }
}

function syncActiveWorkset() {
  if (!store.activeId) {
    void openWorksetSidebar();
    return;
  }
  worksetId.value = store.activeId;
  scopeMode.value = "workset";
}

async function openWorksetSidebar() {
  await shell.openWorksetSidebar();
}
</script>

<template>
  <div class="workset-scope-picker">
    <span class="picker-label">扫描范围</span>
    <div class="mode-group" role="radiogroup" aria-label="扫描范围">
      <label class="mode-opt">
        <input
          type="radio"
          :name="`${pageId}-scope-mode`"
          value="all"
          :checked="scopeMode === 'all'"
          @change="onScopeModeChange('all')"
        />
        全工作空间
      </label>
      <label class="mode-opt">
        <input
          type="radio"
          :name="`${pageId}-scope-mode`"
          value="scope"
          :checked="scopeMode === 'scope'"
          @change="onScopeModeChange('scope')"
        />
        子目录
      </label>
      <label v-if="showIndexScope" class="mode-opt">
        <input
          type="radio"
          :name="`${pageId}-scope-mode`"
          value="index"
          :checked="scopeMode === 'index'"
          @change="onScopeModeChange('index')"
        />
        Code 索引 present
      </label>
      <label class="mode-opt">
        <input
          type="radio"
          :name="`${pageId}-scope-mode`"
          value="workset"
          :checked="scopeMode === 'workset'"
          @change="onScopeModeChange('workset')"
        />
        工作集
      </label>
    </div>
    <div v-if="scopeMode === 'scope'" class="scope-extra">
      <input
        v-model="scope"
        class="input mono scope-input"
        type="text"
        spellcheck="false"
        placeholder="相对子目录"
      />
    </div>
    <div v-else-if="scopeMode === 'workset'" class="scope-extra workset-row">
      <select v-model="worksetIdSelect" class="input workset-select">
        <option value="">（侧栏当前工作集）</option>
        <option v-for="opt in store.worksetOptions" :key="opt.id" :value="opt.id">
          {{ opt.label }}（{{ opt.count }}）
        </option>
      </select>
      <button
        v-if="store.activeWorkset"
        type="button"
        class="btn btn-quiet btn-sm"
        title="与侧栏活动工作集同步"
        @click="syncActiveWorkset"
      >
        当前：{{ store.activeWorkset.name }}
      </button>
      <button type="button" class="btn btn-quiet btn-sm" @click="openWorksetSidebar">侧栏 · 工作集</button>
    </div>
  </div>
</template>

<style scoped>
.workset-scope-picker {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 12px;
  min-width: 0;
}

.picker-label {
  font-size: 0.82rem;
  font-weight: 600;
  color: var(--muted);
}

.mode-group {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 14px;
}

.mode-opt {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 0.82rem;
  cursor: pointer;
}

.scope-extra {
  flex: 1 1 180px;
  min-width: 140px;
}

.scope-input {
  width: 100%;
  max-width: 280px;
}

.workset-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.workset-select {
  min-width: 160px;
  max-width: 320px;
}
</style>
