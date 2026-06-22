<script setup lang="ts">
import { computed } from "vue";
import { moduleScopeLabel } from "../constants/moduleScope";
import { useAppShell } from "../composables/useAppShell";
import { DEFAULT_APP_TITLE } from "../types/config";

const shell = useAppShell();

const appTitle = computed(() => shell.appConfig.value?.title ?? DEFAULT_APP_TITLE);
const workspacePath = computed(() => shell.workspacePath.value);
const moduleLabel = computed(() => moduleScopeLabel(shell.workbenchFocusScope.value));
</script>

<template>
  <div class="workbench-idle">
    <div class="idle-card">
      <h1 class="idle-title">欢迎使用 Phoenix</h1>
      <p class="idle-lead">
        {{ appTitle }} 已连接到当前工作空间。请从上方 Ribbon 选择工具开始；左侧可浏览工程文件。
      </p>
      <p v-if="workspacePath" class="idle-workspace muted small">
        工作空间：
        <span class="mono" :title="workspacePath">{{ workspacePath }}</span>
      </p>
      <p class="idle-hint muted small">
        当前模块：<strong>{{ moduleLabel }}</strong>。关闭全部页面 Tab 后将回到此处。
      </p>
    </div>
  </div>
</template>

<style scoped>
.workbench-idle {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100%;
  padding: 32px 24px;
  box-sizing: border-box;
}

.idle-card {
  max-width: 520px;
  text-align: center;
}

.idle-title {
  margin: 0 0 12px;
  font-size: 1.35rem;
  font-weight: 600;
  color: var(--text);
}

.idle-lead {
  margin: 0 0 14px;
  font-size: 0.92rem;
  line-height: 1.55;
  color: var(--phoenix-text-secondary, var(--text));
}

.idle-workspace {
  margin: 0 0 10px;
  line-height: 1.45;
  word-break: break-all;
}

.idle-hint {
  margin: 0;
  line-height: 1.45;
}

.idle-hint strong {
  font-weight: 600;
  color: var(--text);
}
</style>
