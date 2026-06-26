<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { fetchCaaDrafts, deleteCaaDraft } from "../../api/caaDialog";
import { useAppShell } from "../../composables/useAppShell";
import type { CaaDialogDraft } from "../../types/caaDialogDraft";

const shell = useAppShell();
const drafts = ref<CaaDialogDraft[]>([]);
const loading = ref(false);
const errorText = ref("");

const workspacePath = computed(() => shell.workspacePath.value.trim());

async function loadDrafts() {
  if (!workspacePath.value) { drafts.value = []; return; }
  loading.value = true;
  try {
    const { drafts: list } = await fetchCaaDrafts(workspacePath.value);
    drafts.value = (list as unknown as CaaDialogDraft[]).sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    );
  } catch {
    drafts.value = [];
  } finally {
    loading.value = false;
  }
}

function openDraft(draft: CaaDialogDraft) {
  shell.openCaaDialogForDraft({ draftId: draft.id, dialogName: draft.dialogName });
}

async function removeDraft(draft: CaaDialogDraft, event: MouseEvent) {
  event.stopPropagation();
  if (!workspacePath.value) return;
  try {
    await deleteCaaDraft(workspacePath.value, draft.id);
    drafts.value = drafts.value.filter((d) => d.id !== draft.id);
  } catch (e) {
    errorText.value = e instanceof Error ? e.message : String(e);
  }
}

function timeAgo(iso: string): string {
  const minutes = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  return `${days} 天前`;
}

onMounted(() => { void loadDrafts(); });
</script>

<template>
  <section v-if="drafts.length" class="recent-section caa-drafts-section">
    <h2 class="recent-heading">未保存的对话框 ({{ drafts.length }})</h2>
    <p v-if="errorText" class="banner banner-err">{{ errorText }}</p>
    <ul class="recent-list">
      <li v-for="draft in drafts" :key="draft.id" class="recent-item">
        <el-button class="recent-open" @click="openDraft(draft)">
          <span class="recent-open-body">
            <span class="recent-name-row">
              <span class="recent-name">{{ draft.dialogName }}</span>
              <el-tag size="small" type="warning" effect="light">未保存</el-tag>
            </span>
            <span class="recent-path">上次编辑: {{ timeAgo(draft.updatedAt) }}</span>
          </span>
        </el-button>
        <el-button class="recent-remove" text title="删除草稿" @click="removeDraft(draft, $event)">
          ×
        </el-button>
      </li>
    </ul>
  </section>
</template>

<style scoped>
@import "../../pages/page-shared.css";

.recent-section { margin-bottom: 32px; }
.recent-heading { margin: 0 0 16px; font-size: 1rem; font-weight: 600; color: #334155; }
.recent-list { margin: 0; padding: 0; list-style: none; display: grid; gap: 8px; max-width: 720px; }
.recent-item { display: flex; align-items: stretch; gap: 4px; }

.recent-open {
  flex: 1; height: auto; min-height: 56px; padding: 12px 16px; margin: 0;
  border: 1px solid #fcd34d; border-radius: 8px; background: #fffbeb;
  text-align: left; justify-content: flex-start; white-space: normal;
}
.recent-open:hover:not(:disabled) { border-color: #f59e0b; background: #fef3c7; }

.recent-open-body { display: flex; flex-direction: column; align-items: flex-start; gap: 4px; width: 100%; }
.recent-name-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; width: 100%; }
.recent-name { font-weight: 600; font-size: 0.95rem; color: #0f172a; }
.recent-path { font-size: 0.78rem; color: #64748b; word-break: break-all; text-align: left; }

.recent-remove {
  flex-shrink: 0; width: 36px; min-width: 36px; height: auto; margin: 0;
  border: 1px solid #e2e8f0; border-radius: 8px; font-size: 1.1rem; color: #94a3b8;
}
.recent-remove:hover { border-color: #fecaca; color: #b91c1c; background: #fef2f2; }

.banner { margin: 0 0 10px; padding: 8px 12px; border-radius: 6px; font-size: 0.85rem; }
.banner-err { background: #fef2f2; border: 1px solid #fca5a5; }
</style>
