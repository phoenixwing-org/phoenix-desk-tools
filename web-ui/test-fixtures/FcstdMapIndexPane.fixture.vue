<script setup lang="ts">
import { computed, ref } from "vue";
import FcstdMapIndexPane from "../src/components/fcstd-map/FcstdMapIndexPane.vue";
import type {
  FcstdMapEntryViewInput,
  FcstdMapKindFilter,
  FcstdMapPageSize,
  FcstdMapStatusFilter,
} from "../src/models/fcstdMapViewModel";

type Scenario = "loaded" | "loading" | "empty-search" | "empty-filter" | "no-index";

const scenario = ref<Scenario>("loaded");
const searchQuery = ref("");
const statusFilter = ref<FcstdMapStatusFilter>("all");
const kindFilter = ref<FcstdMapKindFilter>("all");
const currentPage = ref(1);
const pageSize = ref<FcstdMapPageSize>(20);
const eventLog = ref(["ready"]);
const narrow = new URLSearchParams(window.location.search).has("narrow");

const loadedEntries: FcstdMapEntryViewInput[] = Array.from({ length: 30 }, (_, index) => {
  const kind = index % 6 === 2 ? "markdown" : index % 6 === 3 ? "pdf" : "fcstd";
  const suffix = kind === "markdown" ? ".md" : kind === "pdf" ? ".pdf" : ".FCStd";
  return {
    repo_rel_path: `parts/Pump-${index + 1}${suffix}`,
    filename: `Pump-${index + 1}${suffix}`,
    asset_kind: kind,
    PartNumber: `PN-${String(index + 1).padStart(2, "0")}`,
    PartVersion: "A",
    TypeCode: "Part",
    ModelSeries: "PUMP",
    PartName: `Pump ${index + 1}`,
    label: `泵 ${index + 1}`,
    file_status: index === 4 ? "missing" : "present",
  };
});

const exists = computed(() => scenario.value !== "no-index");
const loading = computed(() => scenario.value === "loading");
const filteredEntries = computed(() => {
  if (scenario.value === "loading" || scenario.value === "no-index") return [];
  const query = searchQuery.value.trim().toLocaleLowerCase();
  return loadedEntries.filter((entry) => {
    if (statusFilter.value !== "all" && entry.file_status !== statusFilter.value) return false;
    if (kindFilter.value !== "all" && entry.asset_kind !== kindFilter.value) return false;
    if (!query) return true;
    return [
      entry.filename,
      entry.repo_rel_path,
      entry.PartNumber,
      entry.PartName,
      entry.label,
    ].some((value) => value.toLocaleLowerCase().includes(query));
  });
});
const entriesTotal = computed(() => filteredEntries.value.length);
const pageOffset = computed(() => (currentPage.value - 1) * pageSize.value);
const entries = computed(() => filteredEntries.value.slice(
  pageOffset.value,
  pageOffset.value + pageSize.value,
));
const pageEnd = computed(() => Math.min(pageOffset.value + entries.value.length, entriesTotal.value));

function record(event: string): void {
  eventLog.value = [...eventLog.value, event].slice(-8);
}

function setScenario(next: Scenario): void {
  scenario.value = next;
  searchQuery.value = next === "empty-search" ? "不存在的零件" : "";
  statusFilter.value = next === "empty-filter" ? "missing" : "all";
  kindFilter.value = next === "empty-filter" ? "markdown" : "all";
  currentPage.value = 1;
  pageSize.value = 20;
  eventLog.value = [`scenario:${next}`];
}

function updateSearch(value: string): void {
  searchQuery.value = value;
  currentPage.value = 1;
  record(`search:${value}`);
}

function updateStatus(value: FcstdMapStatusFilter): void {
  statusFilter.value = value;
  currentPage.value = 1;
  record(`status:${value}`);
}

function updateKind(value: FcstdMapKindFilter): void {
  kindFilter.value = value;
  currentPage.value = 1;
  record(`kind:${value}`);
}

function changePage(value: number): void {
  currentPage.value = value;
  record(`page:${value}`);
}

function changePageSize(value: number): void {
  if (value === 20 || value === 50 || value === 100) pageSize.value = value;
  currentPage.value = 1;
  record(`page-size:${value}`);
}

function openFile(row: FcstdMapEntryViewInput): void {
  record(`file:${row.repo_rel_path}`);
}

function openPart(row: FcstdMapEntryViewInput): void {
  record(`part:${row.PartNumber}.${row.PartVersion}`);
}
</script>

<template>
  <main class="fixture" :class="{ narrow }">
    <nav class="fixture-actions" aria-label="夹具场景">
      <button type="button" @click="setScenario('loaded')">已加载</button>
      <button type="button" @click="setScenario('loading')">加载中</button>
      <button type="button" @click="setScenario('empty-search')">搜索无匹配</button>
      <button type="button" @click="setScenario('empty-filter')">筛选无条目</button>
      <button type="button" @click="setScenario('no-index')">无索引</button>
    </nav>
    <output data-testid="fcstd-fixture-event">{{ eventLog.join(" | ") }}</output>
    <section class="pane-shell" data-testid="fcstd-pane-shell">
      <FcstdMapIndexPane
        :search-query="searchQuery"
        :status-filter="statusFilter"
        :kind-filter="kindFilter"
        :exists="exists"
        :loading="loading"
        :entries-loading="loading"
        :entries="entries"
        :entries-total="entriesTotal"
        :page-offset="pageOffset"
        :page-end="pageEnd"
        :page-size="pageSize"
        :current-page="currentPage"
        @update:search-query="updateSearch"
        @update:status-filter="updateStatus"
        @update:kind-filter="updateKind"
        @page-change="changePage"
        @page-size-change="changePageSize"
        @open-file-detail="openFile"
        @open-part-key="openPart"
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
}

.pane-shell {
  box-sizing: border-box;
  display: flex;
  width: min(760px, calc(100vw - 32px));
  height: min(440px, calc(100vh - 100px));
  min-height: 280px;
  padding: 8px;
  flex-direction: column;
  overflow: hidden;
  background: #fff;
  border: 1px solid #cbd5e1;
  border-radius: 8px;
}

.fixture.narrow .pane-shell {
  width: min(360px, calc(100vw - 32px));
}
</style>
