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
    <el-select
      :model-value="scopeMode"
      size="small"
      class="mode-select"
      @update:model-value="onScopeModeChange($event as WorksetScopeMode)"
    >
      <el-option v-if="showIndexScope" value="index" label="Code 索引 present" />
      <el-option value="all" label="全工作空间" />
      <el-option value="scope" label="子目录" />
      <el-option value="workset" label="工作集" />
    </el-select>
    <div v-if="scopeMode === 'scope'" class="scope-extra">
      <el-input
        v-model="scope"
        size="small"
        class="scope-input mono"
        spellcheck="false"
        placeholder="相对子目录"
      />
    </div>
    <div v-else-if="scopeMode === 'workset'" class="scope-extra workset-row">
      <el-select v-model="worksetIdSelect" size="small" class="workset-select" placeholder="侧栏当前工作集">
        <el-option value="" label="（侧栏当前工作集）" />
        <el-option
          v-for="opt in store.worksetOptions"
          :key="opt.id"
          :value="opt.id"
          :label="`${opt.label}（${opt.count}）`"
        />
      </el-select>
      <el-button
        v-if="store.activeWorkset"
        size="small"
        link
        type="primary"
        title="与侧栏活动工作集同步"
        @click="syncActiveWorkset"
      >
        当前：{{ store.activeWorkset.name }}
      </el-button>
      <el-button size="small" link type="primary" @click="openWorksetSidebar">侧栏 · 工作集</el-button>
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

.mode-select {
  min-width: 140px;
  max-width: 220px;
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
