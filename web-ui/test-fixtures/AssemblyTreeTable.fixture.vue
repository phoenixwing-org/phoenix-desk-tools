<script setup lang="ts">
import { nextTick, ref } from "vue";
import type { AssemblyTreeNode } from "../src/api";
import AssemblyTreeTable from "../src/components/AssemblyTreeTable.vue";
import { provideAppShell } from "../src/composables/useAppShell";

type Scenario = "loaded" | "loading" | "empty" | "readonly";

const shell = provideAppShell();
const tableRef = ref<InstanceType<typeof AssemblyTreeTable> | null>(null);
const scenario = ref<Scenario>("loaded");
const treeDepth = ref<"first" | "full">("full");
const editable = ref(true);
const labelEdits = ref(false);
const eventLog = ref(["ready"]);
const exposedOutput = ref("尚未读取 expose");
const narrow = new URLSearchParams(window.location.search).has("narrow");

function makeNode(index: number, overrides: Partial<AssemblyTreeNode> = {}): AssemblyTreeNode {
  const id = `node-${index}`;
  const basename = `Pump-${String(index).padStart(2, "0")}.FCStd`;
  const rel = `parts/${basename}`;
  return {
    id,
    host_repo_rel: "assemblies/FixtureRoot.Assy.FCStd",
    repo_rel_path: rel,
    basename,
    resolve_status: "resolved",
    xlink_file_attr: `../${rel}`,
    part_number: `PN-${String(index).padStart(2, "0")}`,
    part_version: "A",
    part_key: `PN-${String(index).padStart(2, "0")}.A`,
    TypeCode: "Part",
    ModelSeries: "PUMP",
    PartName: `泵体 ${index}`,
    label: `Pump ${index}`,
    link_label: `泵体实例 ${index}`,
    link_labels: [`泵体实例 ${index}`],
    xref_instances: [{ xlink_file_attr: `../${rel}`, link_label: `泵体实例 ${index}` }],
    rule_label: `PN-${String(index).padStart(2, "0")}.A-泵体 ${index}`,
    ref_count: 1,
    file_role: "part",
    children: [],
    ...overrides,
  };
}

const nestedChildren = [makeNode(101), makeNode(102), makeNode(103)];
const loadedNodes: AssemblyTreeNode[] = [
  makeNode(1, {
    id: "fixture-root",
    basename: "FixtureRoot.Assy.FCStd",
    repo_rel_path: "assemblies/FixtureRoot.Assy.FCStd",
    file_role: "assembly",
    link_label: "夹具根装配",
    children: nestedChildren,
  }),
  makeNode(2, {
    id: "fixture-multi",
    ref_count: 3,
    link_labels: ["多实例", "多实例.001", "多实例.002"],
    link_label: "多实例",
    xref_instances: [
      { xlink_file_attr: "../parts/Pump-02.FCStd", link_label: "多实例" },
      { xlink_file_attr: "../parts/Pump-02.FCStd#2", link_label: "多实例.001" },
      { xlink_file_attr: "../parts/Pump-02.FCStd#3", link_label: "多实例.002" },
    ],
  }),
  makeNode(3, {
    id: "fixture-missing",
    repo_rel_path: "",
    basename: "Missing.FCStd",
    resolve_status: "missing",
    link_label: "缺失实例",
  }),
  makeNode(4, {
    id: "fixture-ambiguous",
    basename: "Ambiguous.FCStd",
    resolve_status: "ambiguous",
    link_label: "歧义实例",
  }),
  ...Array.from({ length: 22 }, (_, index) => makeNode(index + 10)),
];

const nodes = ref<AssemblyTreeNode[]>(loadedNodes);
const loading = ref(false);

function record(message: string): void {
  eventLog.value = [...eventLog.value, message].slice(-10);
}

shell.openFileDetailForRel = (rel) => {
  record(`open-file:${rel}`);
};
shell.setStatus = (message) => {
  record(`status:${message}`);
};

function setScenario(next: Scenario): void {
  scenario.value = next;
  loading.value = next === "loading";
  nodes.value = next === "empty" ? [] : loadedNodes;
  editable.value = next !== "readonly";
  labelEdits.value = false;
  eventLog.value = [`scenario:${next}`];
  exposedOutput.value = "尚未读取 expose";
}

function onEditsChange(dirty: boolean): void {
  labelEdits.value = dirty;
  record(`edits:${dirty}`);
}

async function onNeedFullDepth(): Promise<void> {
  record("need-full-depth");
  treeDepth.value = "full";
  await nextTick();
}

function discardEdits(): void {
  tableRef.value?.resetEdits();
  labelEdits.value = false;
  record("discard-label-edits");
}

function applyEdits(): void {
  record("apply-label-edits");
  readExpose();
}

function readExpose(): void {
  const patches = tableRef.value?.getPendingPatches() ?? [];
  const changes = tableRef.value?.getPendingLabelChanges() ?? [];
  exposedOutput.value = JSON.stringify({
    hasEdits: tableRef.value?.hasEdits() ?? false,
    patches,
    changes,
  });
  record(`expose:${patches.length}`);
}
</script>

<template>
  <main class="fixture" :class="{ narrow }">
    <nav class="fixture-actions" aria-label="装配树夹具场景">
      <button type="button" @click="setScenario('loaded')">已加载</button>
      <button type="button" @click="setScenario('loading')">加载中</button>
      <button type="button" @click="setScenario('empty')">空树</button>
      <button type="button" @click="setScenario('readonly')">只读</button>
      <button type="button" @click="treeDepth = 'first'">第一级模式</button>
      <button type="button" @click="treeDepth = 'full'">全部层级模式</button>
      <button type="button" @click="readExpose">读取 expose</button>
    </nav>
    <output data-testid="assembly-tree-event">{{ eventLog.join(" | ") }}</output>
    <output data-testid="assembly-tree-expose">{{ exposedOutput }}</output>
    <section class="pane-shell" data-testid="assembly-tree-shell">
      <AssemblyTreeTable
        ref="tableRef"
        :nodes="nodes"
        :loading="loading"
        :editable="editable"
        :tree-depth="treeDepth"
        :label-edits="labelEdits"
        :saving-labels="false"
        @edits-change="onEditsChange"
        @need-full-depth="onNeedFullDepth"
        @xref-replaced="record('xref-replaced')"
        @discard-label-edits="discardEdits"
        @apply-label-edits="applyEdits"
      />
    </section>
  </main>
</template>

<style scoped>
.fixture {
  box-sizing: border-box;
  display: flex;
  min-height: 100vh;
  padding: 16px;
  flex-direction: column;
  gap: 10px;
}

.fixture-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.fixture-actions button {
  padding: 5px 9px;
}

output {
  min-height: 20px;
  color: #475569;
  font-family: var(--font-mono);
  font-size: 0.76rem;
  overflow-wrap: anywhere;
}

.pane-shell {
  box-sizing: border-box;
  display: flex;
  width: min(900px, calc(100vw - 32px));
  height: min(570px, calc(100vh - 128px));
  min-height: 240px;
  flex-direction: column;
  overflow: hidden;
  background: #fff;
}

.fixture.narrow .pane-shell {
  width: min(360px, calc(100vw - 32px));
}

.pane-shell :deep(.asm-tree-wrap) {
  flex: 1;
  min-height: 0;
}
</style>
