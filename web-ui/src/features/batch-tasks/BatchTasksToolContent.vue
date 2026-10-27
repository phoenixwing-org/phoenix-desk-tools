<script setup lang="ts">
import { computed } from "vue";
import { isActiveRun } from "../../../../shared/batch-tasks/contracts";
import { useAppShell } from "../../composables/useAppShell";
import PrimaryTaskProgress from "../../components/primary/PrimaryTaskProgress.vue";
import { batchTasksController as controller } from "./application";
import { projectRunProgress, runStatusLabel } from "./projection";
const shell = useAppShell();
const state = controller.state;
const progress = computed(() => projectRunProgress(controller.currentRun.value));
</script>
<template>
  <div class="batch-tool-content">
    <p class="scope-note">当前工作空间 · {{ state.tasks.filter(task => !task.archived).length }} 个已保存任务</p>
    <PrimaryTaskProgress :progress="progress" />
    <p v-if="state.stale" role="alert">连接中断，显示上次后台回执；运行状态尚未重新确认。</p>
    <p v-if="state.error" class="error" role="alert">{{ state.error }}</p>
    <label v-if="state.runs.length">查看运行
      <select :value="controller.currentRun.value?.id || ''" @change="controller.selectRun(($event.target as HTMLSelectElement).value)">
        <option v-for="run in state.runs" :key="run.id" :value="run.id">{{ run.task_name }} · {{ runStatusLabel[run.status] }}</option>
      </select>
    </label>
    <p>排队 {{ controller.activeRuns.value.filter(run => run.status === 'queued').length }} · 活动 {{ controller.activeRuns.value.length }}</p>
    <div class="tool-actions">
      <button type="button" @click="shell.goToPage('batch_tasks')">打开完整管理页</button>
      <button v-if="controller.currentRun.value && isActiveRun(controller.currentRun.value.status)" type="button" :disabled="controller.busy.value || controller.currentRun.value.cancel_requested" @click="controller.cancel(controller.currentRun.value!.id)">{{ controller.currentRun.value.cancel_requested ? '等待取消确认' : '请求取消此运行' }}</button>
      <button type="button" :disabled="state.loading" @click="controller.refresh()">刷新回执</button>
    </div>
    <p class="scope-note">关闭或停靠只改变显示，不取消任务。源文件只读；缓存只读可创建/释放自有临时锁，新鲜度未验证；观察结果写入任务库。不递归、不启动 Native、不写 CAD。</p>
  </div>
</template>
<style scoped>
.batch-tool-content { display: grid; gap: 8px; padding: 10px; min-width: 0; font-size: 12px; color: var(--text); }
p { margin: 0; overflow-wrap: anywhere; } label { display: grid; gap: 5px; } select { width: 100%; min-width: 0; color: inherit; background: var(--panel-bg); border: 1px solid var(--border); padding: 5px; }
.tool-actions { display: flex; gap: 6px; flex-wrap: wrap; } button { font: inherit; color: inherit; background: var(--panel-bg); border: 1px solid var(--border); border-radius: 4px; padding: 5px 8px; cursor: pointer; } button:disabled { opacity: .5; cursor: default; } .scope-note { color: var(--muted); font-size: 11px; } .error { color: var(--phoenix-danger-text, #b42318); }
</style>
