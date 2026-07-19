<script setup lang="ts">
import { computed, ref } from "vue";
import FcstdMapSettingsPane from "../src/components/fcstd-map/FcstdMapSettingsPane.vue";

type Scenario = "ready" | "no-index" | "exporting" | "minimal";

const scenario = ref<Scenario>("ready");
const eventLog = ref(["ready"]);

const workspacePath = computed(() => scenario.value === "minimal" ? "" : "/workspace/Phoenix Demo");
const hasIndex = computed(() => scenario.value !== "no-index");
const exporting = computed(() => scenario.value === "exporting");
const debugSql = computed(() => scenario.value === "minimal"
  ? ""
  : "SELECT repo_rel_path, file_status FROM file_asset ORDER BY repo_rel_path LIMIT 20");

function setScenario(next: Scenario): void {
  scenario.value = next;
  eventLog.value = [`scenario:${next}`];
}

function exportJson(): void {
  eventLog.value = [...eventLog.value, "export-json"].slice(-8);
}
</script>

<template>
  <main class="fixture">
    <nav class="fixture-actions" aria-label="夹具场景">
      <button type="button" @click="setScenario('ready')">已有索引</button>
      <button type="button" @click="setScenario('no-index')">无索引</button>
      <button type="button" @click="setScenario('exporting')">导出中</button>
      <button type="button" @click="setScenario('minimal')">最小信息</button>
    </nav>
    <output data-testid="settings-fixture-event">{{ eventLog.join(" | ") }}</output>
    <section class="pane-shell" data-testid="settings-pane-shell">
      <FcstdMapSettingsPane
        :workspace-path="workspacePath"
        :has-index="hasIndex"
        :exporting="exporting"
        :debug-sql="debugSql"
        @export-json="exportJson"
      />
    </section>
  </main>
</template>

<style scoped>
.fixture {
  box-sizing: border-box;
  min-height: 100vh;
  padding: 16px;
}

.fixture-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 8px;
}

.fixture-actions button {
  padding: 5px 9px;
}

output {
  display: block;
  min-height: 20px;
  margin-bottom: 8px;
  color: #475569;
  font-family: var(--font-mono);
}

.pane-shell {
  box-sizing: border-box;
  width: min(760px, calc(100vw - 32px));
  padding: 12px;
  overflow: auto;
  background: #fff;
  border: 1px solid #cbd5e1;
  border-radius: 8px;
}
</style>
