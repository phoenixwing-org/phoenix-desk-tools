<script setup lang="ts">
import { computed } from "vue";
import { useReferenceLabelSync } from "../composables/useReferenceLabelSync";
import { useAppShell } from "../composables/useAppShell";
import { logReferenceLabelApply } from "../utils/referenceLabelLog";

const props = withDefaults(
  defineProps<{
    targetRepoRel: string;
    /** 入向宿主路径；为空时不显示「入向」按钮 */
    incomingHostPaths?: string[];
    /** 是否显示「本文件内全部」按钮（装配/图纸宿主自身） */
    showHostAll?: boolean;
    /** 是否显示「入向宿主」按钮 */
    showIncoming?: boolean;
    includeTransitive?: boolean;
    compact?: boolean;
  }>(),
  {
    incomingHostPaths: () => [],
    showHostAll: true,
    showIncoming: true,
    includeTransitive: true,
    compact: false,
  },
);

const emit = defineEmits<{
  done: [message: string];
  error: [message: string];
}>();

const shell = useAppShell();
const { syncing, syncIncomingLabels, syncHostAllLabels } = useReferenceLabelSync(
  () => props.targetRepoRel,
);

const canIncoming = computed(
  () =>
    props.showIncoming &&
    Boolean(props.targetRepoRel.trim()) &&
    props.incomingHostPaths.length > 0,
);
const canHostAll = computed(() => props.showHostAll && Boolean(props.targetRepoRel.trim()));

async function onIncoming() {
  try {
    const data = await syncIncomingLabels(props.incomingHostPaths, props.includeTransitive);
    const msg = logReferenceLabelApply(shell.appendLog, data, {
      source: "file_detail",
      title: `已更新勾选装配内对本文件的子件标签 · ${data.applied_hosts?.length ?? 0} 个装配`,
    });
    emit("done", msg);
  } catch (e) {
    emit("error", String(e));
  }
}

async function onHostAll() {
  try {
    const data = await syncHostAllLabels();
    const msg = logReferenceLabelApply(shell.appendLog, data, {
      source: "file_detail",
      title: "按规则名更新树中名称",
    });
    emit("done", msg);
  } catch (e) {
    emit("error", String(e));
  }
}
</script>

<template>
  <div class="label-sync-bar" :class="{ compact }">
    <span v-if="!compact" class="bar-label">装配树子件标签</span>
    <button
      v-if="canIncoming"
      type="button"
      class="btn accent-secondary"
      :disabled="syncing"
      title="在勾选的装配里，只改引用本文件那一项的树节点名"
      @click="onIncoming"
    >
      {{
        syncing
          ? "…"
          : `勾选装配 · 同步对本文件的子件标签（${incomingHostPaths.length}）`
      }}
    </button>
    <button
      v-if="canHostAll"
      type="button"
      class="btn subtle"
      :disabled="syncing"
      title="将本装配文件内全部子件/外链的 Label 同步为各目标规则标签"
      @click="onHostAll"
    >
      {{ syncing ? "…" : "按规则名更新树中名称" }}
    </button>
    <span v-if="!compact" class="bar-hint muted">
      只改装配树 Link.Label，不改路径。「链接标签（子件名）」列应与「规则名」一致。
    </span>
  </div>
</template>

<style scoped>
.label-sync-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
  padding: 10px 12px;
  border: 1px solid #bbf7d0;
  border-radius: 8px;
  background: #f0fdf4;
}
.label-sync-bar.compact {
  padding: 8px 10px;
  margin-bottom: 8px;
}
.bar-label {
  font-size: 0.82rem;
  font-weight: 600;
  color: #047857;
}
.bar-hint {
  flex: 1 1 200px;
  font-size: 0.76rem;
  line-height: 1.4;
}
.btn {
  padding: 6px 12px;
  border-radius: 6px;
  border: 1px solid var(--border-strong);
  background: var(--btn-bg);
  font-size: 0.82rem;
}
.btn.accent-secondary {
  background: #059669;
  color: #fff;
  border-color: #059669;
}
.btn.subtle {
  background: transparent;
  color: var(--muted);
  border-color: var(--border);
  font-size: 0.78rem;
}
.btn:disabled {
  opacity: 0.5;
}
.muted {
  color: var(--muted);
}
</style>
