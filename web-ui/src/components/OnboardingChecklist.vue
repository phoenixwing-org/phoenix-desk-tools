<script setup lang="ts">
import { computed, onMounted } from "vue";
import { useAppShell } from "../composables/useAppShell";
import { useShellTour } from "../composables/useShellTour";
import { useOnboardingStore } from "../stores/onboarding";

const shell = useAppShell();
const store = useOnboardingStore();
const { startShellTour } = useShellTour(shell);

const steps = computed(() => [
  {
    id: "workspace",
    label: "配置工作空间根",
    hint: "保存一个有效的工程根目录",
    done: store.workspaceOk,
    action: () => shell.goToPage("config"),
    actionLabel: "去配置",
    required: true,
  },
  {
    id: "freecad",
    label: "填写 FreeCAD 目录",
    hint: "推荐；STEP 批量等任务必需",
    done: store.freecadOk,
    action: () => shell.goToPage("config"),
    actionLabel: "去配置",
    required: false,
  },
  {
    id: "index",
    label: "CAD 索引扫描至少一次",
    hint: "BOM 与文件详情属性才完整",
    done: store.indexScanned,
    action: () => shell.goToPage("fcstd_map"),
    actionLabel: "去 CAD 索引",
    required: true,
  },
  {
    id: "file_detail",
    label: "打开一个文件详情",
    hint: "右侧树点击 FCStd，或从 BOM 点链接标签",
    done: store.openedFileDetail,
    action: async () => {
      await shell.persistShellLayout({ right_panel_open: true });
      shell.setStatus("请在右侧工作空间树中点击一个 .FCStd 文件");
    },
    actionLabel: "展开工作区树",
    required: true,
  },
]);

onMounted(() => {
  void store.refreshStatus();
});

async function onStartTour() {
  await startShellTour(store.shellTourDone);
}
</script>

<template>
  <section id="onboarding-guide" class="onboarding-checklist">
    <div class="checklist-head">
      <h2 class="section-title">新手指南</h2>
      <span v-if="store.readyToWork" class="badge-ready">已可开工</span>
    </div>
    <ol class="steps">
      <li
        v-for="(step, i) in steps"
        :key="step.id"
        class="step"
        :class="{ done: step.done }"
      >
        <span class="step-mark" aria-hidden="true">{{ step.done ? "✓" : i + 1 }}</span>
        <div class="step-body">
          <div class="step-title">
            {{ step.label }}
            <span v-if="!step.required" class="tag-optional">推荐</span>
          </div>
          <p class="step-hint">{{ step.hint }}</p>
          <button
            v-if="!step.done"
            type="button"
            class="btn-step"
            @click="step.action()"
          >
            {{ step.actionLabel }}
          </button>
        </div>
      </li>
    </ol>
    <div class="checklist-foot">
      <button
        v-if="store.workspaceOk"
        type="button"
        class="btn"
        @click="onStartTour"
      >
        {{ store.shellTourDone ? "重新观看界面巡游" : "开始界面巡游" }}
      </button>
      <span class="doc-hint muted">详细说明见仓库 <code>doc/新手指引.md</code></span>
    </div>
  </section>
</template>

<style scoped>
.onboarding-checklist {
  margin-bottom: 28px;
  padding: 16px 18px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: #fff;
}

.checklist-head {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 14px;
}

.section-title {
  margin: 0;
  font-size: 1rem;
}

.badge-ready {
  font-size: 0.75rem;
  padding: 2px 8px;
  border-radius: 999px;
  background: #dcfce7;
  color: #166534;
  font-weight: 600;
}

.steps {
  margin: 0;
  padding: 0;
  list-style: none;
}

.step {
  display: flex;
  gap: 12px;
  padding: 10px 0;
  border-bottom: 1px solid #eef2f7;
}

.step:last-child {
  border-bottom: none;
}

.step.done .step-title {
  color: var(--muted);
}

.step-mark {
  flex-shrink: 0;
  width: 26px;
  height: 26px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  font-size: 0.82rem;
  font-weight: 600;
  background: #e2e8f0;
  color: #475569;
}

.step.done .step-mark {
  background: #22c55e;
  color: #fff;
}

.step-title {
  font-weight: 600;
  font-size: 0.9rem;
}

.tag-optional {
  margin-left: 6px;
  font-size: 0.72rem;
  font-weight: 500;
  color: #b45309;
}

.step-hint {
  margin: 4px 0 8px;
  font-size: 0.82rem;
  color: var(--muted);
}

.btn-step {
  padding: 4px 12px;
  font-size: 0.82rem;
  border: 1px solid var(--border-strong);
  border-radius: 6px;
  background: var(--btn-bg);
}

.checklist-foot {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 14px;
  margin-top: 14px;
  padding-top: 12px;
  border-top: 1px solid #eef2f7;
}

.btn {
  padding: 8px 16px;
  border: 1px solid var(--border-strong);
  border-radius: 6px;
  background: var(--btn-bg);
}

.doc-hint {
  font-size: 0.82rem;
}

.doc-hint code {
  font-size: 0.78rem;
}

.muted {
  color: var(--muted);
}
</style>
