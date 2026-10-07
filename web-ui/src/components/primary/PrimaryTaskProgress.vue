<script setup lang="ts">
import { computed } from "vue";
import type { PagePrimaryProgress } from "../../composables/usePagePrimaryContribution";
const props = defineProps<{ progress: PagePrimaryProgress }>();
const percent = computed(() => {
  if (props.progress.state === "done") return 100;
  if (props.progress.state === "idle") return 0;
  if (props.progress.total && props.progress.total > 0) return Math.min(100, Math.max(0, Math.floor((props.progress.completed || 0) * 100 / props.progress.total)));
  return undefined;
});
const stateText = computed(() => ({ idle: "待开始", running: "进行中", done: "已完成", warning: "需确认", failed: "未完成", cancelled: "已取消" })[props.progress.state]);
</script>
<template>
  <div class="task-progress" :data-state="progress.state">
    <div class="progress-heading"><strong>{{ progress.label }}</strong><span>{{ stateText }}</span></div>
    <progress :value="percent ?? (progress.state === 'running' ? undefined : 0)" max="100" :aria-label="progress.label" :aria-valuetext="percent === undefined ? `${stateText}，已处理 ${progress.completed || 0} 个` : `${percent}%`" />
    <div class="progress-count" aria-live="polite">
      <span v-if="progress.total !== undefined">{{ progress.completed || 0 }} / {{ progress.total }} 项</span>
      <span v-else-if="progress.completed !== undefined">已处理 {{ progress.completed }} 个文件</span>
      <span v-else>{{ stateText }}</span>
      <strong v-if="percent !== undefined">{{ percent }}%</strong><span v-else-if="progress.state === 'running'">总量统计中</span>
    </div>
    <ol v-if="progress.stages?.length" class="progress-stages" aria-label="处理阶段">
      <li v-for="(stage, index) in progress.stages" :key="stage" :data-passed="progress.state === 'done' || index < (progress.activeStage || 0)" :aria-current="index === progress.activeStage && progress.state === 'running' ? 'step' : undefined">{{ stage }}</li>
    </ol>
    <p v-if="progress.detail" :title="progress.detail">{{ progress.detail }}</p>
  </div>
</template>
<style scoped>
.task-progress { display: grid; gap: 8px; padding: 10px; margin-bottom: 8px; border: 1px solid var(--border); border-radius: 7px; background: var(--panel-head-bg); color: var(--text); --progress-color: var(--el-color-primary); }
.progress-heading, .progress-count { display: flex; align-items: center; justify-content: space-between; gap: 6px; font-size: 0.68rem; }
.progress-heading > span, .progress-count { color: var(--muted); }
progress { width: 100%; height: 8px; border: none; border-radius: 5px; overflow: hidden; accent-color: var(--progress-color); background: var(--border); }
progress::-webkit-progress-bar { background: var(--border); border-radius: 5px; }
progress::-webkit-progress-value { background: var(--progress-color); border-radius: 5px; transition: width 180ms ease-out; }
progress::-moz-progress-bar { background: var(--progress-color); }
progress:indeterminate { background: linear-gradient(90deg, var(--border) 20%, var(--progress-color) 50%, var(--border) 80%); background-size: 200% 100%; animation: progress-flow 1.6s linear infinite; }
progress:indeterminate::-webkit-progress-bar { background: transparent; }
.task-progress[data-state='done'] { --progress-color: var(--el-color-success); }
.task-progress[data-state='failed'], .task-progress[data-state='warning'] { --progress-color: var(--el-color-warning); }
.task-progress[data-state='cancelled'] { --progress-color: var(--muted); }
.progress-stages { display: flex; gap: 5px; padding: 0; margin: 0; list-style: none; font-size: 0.6rem; }
.progress-stages li { flex: 1; padding-top: 4px; border-top: 2px solid var(--border); color: var(--muted); }
.progress-stages li[data-passed='true'], .progress-stages li[aria-current='step'] { border-color: var(--progress-color); color: var(--text); }
.task-progress p { margin: 0; font-size: 0.62rem; color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
@keyframes progress-flow { to { background-position: -200% 0; } }
@media (prefers-reduced-motion: reduce) { progress:indeterminate { animation: none; } progress::-webkit-progress-value { transition: none; } }
</style>
