<script setup lang="ts">
import { computed } from "vue";
import { commitGitRepo } from "../../api";
import SidebarBlock from "./SidebarBlock.vue";
import { useAppShell } from "../../composables/useAppShell";
import { useGitPageState } from "../../composables/useGitPageState";

const shell = useAppShell();
const { stagedCount, gitReady, commitMessage, commitPending, requestGitRefresh } = useGitPageState();

const expanded = defineModel<boolean>("expanded", { default: true });

const canCommit = computed(
  () => gitReady.value && stagedCount.value > 0 && commitMessage.value.trim().length > 0,
);

async function onCommit() {
  const message = commitMessage.value.trim();
  if (!canCommit.value || commitPending.value) return;

  commitPending.value = true;
  try {
    const out = await commitGitRepo(message);
    const sha = out.commit_sha ? `${out.commit_sha}` : "—";
    shell.setStatus(`已提交 ${sha}：${out.message}`);
    commitMessage.value = "";
    await requestGitRefresh();
  } catch (e) {
    shell.setStatus(String(e));
  } finally {
    commitPending.value = false;
  }
}
</script>

<template>
  <SidebarBlock
    v-model:expanded="expanded"
    class="git-commit-panel"
    title="Git 提交"
    variant="strip"
    aria-label="Git 提交"
  >
    <template #default>
      <el-input
        v-model="commitMessage"
        class="git-commit-input"
        type="textarea"
        :rows="1"
        :disabled="!gitReady || commitPending"
        placeholder="提交说明"
        resize="none"
        @keydown.ctrl.enter.prevent="onCommit"
        @keydown.meta.enter.prevent="onCommit"
      />
    </template>
    <template #footer>
      <div class="git-commit-foot">
        <span class="git-commit-hint muted small">
          {{ gitReady ? (stagedCount > 0 ? `已暂存 ${stagedCount} 项` : "请先 + 暂存") : "仓库未就绪" }}
        </span>
        <el-button
          type="primary"
          size="small"
          :disabled="!canCommit || commitPending"
          :loading="commitPending"
          @click="onCommit"
        >
          提交 Commit
        </el-button>
      </div>
    </template>
  </SidebarBlock>
</template>

<style scoped>
.git-commit-panel:not(.sidebar-block--collapsed) {
  flex: 1 1 auto;
  min-height: 0;
  width: 100%;
  max-width: 100%;
}

.git-commit-input {
  flex: 1 1 auto;
  align-self: stretch;
  min-height: 0;
  width: 100%;
  max-width: 100%;
  display: flex;
  flex-direction: column;
}

.git-commit-input :deep(.el-textarea__inner) {
  flex: 1 1 auto;
  width: 100%;
  min-height: 3.5em;
  height: 100% !important;
  resize: none;
  box-sizing: border-box;
}

.git-commit-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.git-commit-hint {
  min-width: 0;
}

.muted {
  color: var(--el-text-color-secondary);
}

.small {
  font-size: 12px;
}
</style>
