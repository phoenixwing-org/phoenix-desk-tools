<script setup lang="ts">
import { computed } from "vue";
import WingBlock from "phoenix-wing/layout/PnwSidebarBlock.vue";
import PrimaryTaskProgress from "../../components/primary/PrimaryTaskProgress.vue";
import type { PagePrimaryProgress } from "../../composables/usePagePrimaryContribution";
import type { BatchTask } from "../../../../shared/batch-tasks/contracts";

type NavigationStep = { id: string; title: string; description: string; state: "current" | "ready" | "pending" | "done" };
const props = defineProps<{
  tasks: readonly BatchTask[];
  selectedTaskId: string;
  busy: boolean;
  showArchived: boolean;
  onShowArchived: (value: boolean) => void;
  onSelectTask: (task: BatchTask) => void | Promise<void>;
  onNew: () => void | Promise<void>;
  onDuplicate: () => void;
  steps: readonly NavigationStep[];
  onNavigate: (id: string) => void;
  onRefresh: () => void | Promise<void>;
  onBackup: () => void | Promise<void>;
  progress?: PagePrimaryProgress;
  onOpenMonitor?: () => void;
}>();
const visibleTasks = computed(() => props.tasks.filter(task => props.showArchived || !task.archived));
const stepStateLabel = { current: "当前", ready: "可查看", pending: "待准备", done: "已完成" } as const;
</script>

<template>
  <div class="batch-primary-content">
    <WingBlock title="已保存任务" variant="strip" class="batch-primary-block" :style="{ height: 'auto', flex: 'none' }" aria-label="已保存批量任务">
      <template #suffix><span class="count">{{ visibleTasks.length }}</span></template>
      <template #actions><button type="button" :disabled="busy" @click="onNew()">新建</button><button type="button" :disabled="busy || !selectedTaskId" @click="onDuplicate()">复制</button></template>
      <div class="task-tools"><label><input type="checkbox" :checked="showArchived" @change="onShowArchived(($event.target as HTMLInputElement).checked)" />含归档</label><div><button type="button" :disabled="busy" @click="onRefresh()">刷新</button><button type="button" :disabled="busy" @click="onBackup()">备份</button></div></div>
      <p v-if="!visibleTasks.length" class="empty">还没有已保存任务。可先加入文件，再保存任务定义。</p>
      <ul v-else class="task-list" aria-label="已保存任务列表">
        <li v-for="task in visibleTasks" :key="task.id">
          <button type="button" class="task-card" :class="{ selected: task.id === selectedTaskId }" :aria-current="task.id === selectedTaskId ? 'true' : undefined" :disabled="busy" @click="onSelectTask(task)">
            <span class="task-name">{{ task.name }}</span>
            <span class="task-meta">{{ task.subjects.length }} 个文件 · {{ task.actions.length }} 个动作 · r{{ task.revision }}<span v-if="task.archived"> · 已归档</span></span>
          </button>
        </li>
      </ul>
    </WingBlock>
    <WingBlock title="流程导航" variant="strip" class="batch-primary-block" :style="{ height: 'auto', flex: 'none' }" aria-label="批量任务流程导航">
      <p class="navigation-note">点击步骤定位主区域；仅导航，不保存或执行任务。</p>
      <nav aria-label="批量任务步骤"><ol class="step-list">
        <li v-for="(step, index) in steps" :key="step.id">
          <button type="button" class="step-link" :class="`step-${step.state}`" :aria-current="step.state === 'current' ? 'step' : undefined" :title="step.description" @click="onNavigate(step.id)">
            <span class="step-number" aria-hidden="true">{{ index + 1 }}</span>
            <span class="step-copy"><span class="step-title">{{ step.title }}</span><span class="step-description">{{ step.description }}</span></span>
            <span class="step-state">{{ stepStateLabel[step.state] }}</span>
          </button>
        </li>
      </ol></nav>
    </WingBlock>
    <div v-if="progress || onOpenMonitor" class="primary-monitor">
      <PrimaryTaskProgress v-if="progress" :progress="progress" />
      <button v-if="onOpenMonitor" type="button" @click="onOpenMonitor()">任务监控</button>
    </div>
  </div>
</template>

<style scoped>
.batch-primary-content{height:100%;min-height:0;min-width:0;overflow:auto;color:var(--text);font-size:12px}
.batch-primary-content>.batch-primary-block{height:auto;flex:none;overflow:visible;min-height:0}
.batch-primary-block :deep(.pnw-sidebar-block-body){height:auto!important;flex:none!important;overflow:visible!important;min-height:0}
.count,.task-meta,.step-description,.navigation-note,.empty{color:var(--muted)}
button{font:inherit;color:inherit;background:var(--panel-bg);border:1px solid var(--border);border-radius:4px;padding:4px 7px;cursor:pointer}button:disabled{opacity:.5;cursor:default}button:focus-visible{outline:2px solid var(--phoenix-accent);outline-offset:2px}
.task-tools,.task-tools>div{display:flex;align-items:center;justify-content:space-between;gap:6px;flex-wrap:wrap}.task-tools label{display:inline-flex;align-items:center;gap:4px}.task-tools input{margin:0}
.task-list,.step-list{padding:0;margin:8px 0 0;list-style:none;display:grid;gap:6px}.task-card{width:100%;display:grid;gap:4px;text-align:left;padding:8px;overflow-wrap:anywhere}.task-card.selected{border-color:var(--phoenix-accent);background:var(--phoenix-accent-soft)}.task-name{font-weight:600}.task-meta{font-size:11px;line-height:1.4}.empty,.navigation-note{margin:6px 0;font-size:11px;line-height:1.5}
.step-link{display:flex;align-items:flex-start;gap:7px;width:100%;text-align:left;padding:8px 6px}.step-number{width:18px;height:18px;flex:0 0 18px;display:flex;align-items:center;justify-content:center;border-radius:50%;background:var(--panel-head-bg);font-size:11px}.step-copy{display:grid;gap:4px;min-width:0;flex:1}.step-title{font-weight:600}.step-description{font-size:11px;line-height:1.4;overflow-wrap:anywhere}.step-state{flex-shrink:0;font-size:10px;color:var(--muted);line-height:18px}.step-current{border-color:var(--phoenix-accent);background:var(--phoenix-accent-soft)}.step-current .step-number{background:var(--phoenix-accent);color:white}.step-current .step-state{color:var(--phoenix-accent)}.primary-monitor{padding:10px;display:grid;gap:8px;border-top:1px solid var(--border)}
</style>
