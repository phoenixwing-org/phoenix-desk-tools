<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import {
  fetchReorderMembersPrefs,
  fetchReorderMembersTopLevel,
  runReorderMembers,
  runReorderMembersSelfTest,
  saveReorderMembersPrefs,
  type ReorderMembersEntry,
} from "../api";
import PageHelpButton from "../components/PageHelpButton.vue";
import AppModalOverlay from "../components/AppModalOverlay.vue";
import { useAppShell } from "../composables/useAppShell";
import { useReorderMembersPageStore } from "../stores/reorderMembersPage";

const shell = useAppShell();
const pageStore = useReorderMembersPageStore();

const CHANGED_PAGE_SIZE = 20;

const includeCpp = computed(() => pageStore.includeCpp);
const includeHeader = computed(() => pageStore.includeHeader);
const verbose = computed({
  get: () => pageStore.verbose,
  set: (value: boolean) => pageStore.setVerbose(value),
});
const selected = computed(() => pageStore.selectedSet);
const entriesExpanded = computed({
  get: () => pageStore.entriesExpanded,
  set: (value: boolean) => pageStore.setEntriesExpanded(value),
});

const ignoreFileDisplay = ref("");
const ignoreFileExists = ref(false);
const ignoredEntries = ref<Array<{ name: string; kind: string; reason: string }>>([]);
const entries = ref<ReorderMembersEntry[]>([]);
const ignoredCount = ref(0);

const changedFiles = ref<string[]>([]);
const lastRunDryRun = ref(false);
const lastRunSummary = ref("");
const changedPage = ref(0);
const rulesModalOpen = ref(false);

const loading = ref(false);
const saving = ref(false);
const running = ref(false);
const selfTesting = ref(false);
const loadError = ref("");

const selectedCount = computed(() => pageStore.selectedCount);
const allChecked = computed(
  () => entries.value.length > 0 && entries.value.every((e) => selected.value.has(e.name)),
);
const dirCount = computed(() => entries.value.filter((e) => e.kind === "dir").length);
const fileCount = computed(() => entries.value.filter((e) => e.kind === "file").length);
const changedTotal = computed(() => changedFiles.value.length);
const changedPageCount = computed(() => Math.max(1, Math.ceil(changedTotal.value / CHANGED_PAGE_SIZE)));
const changedPageSafe = computed(() =>
  Math.min(changedPage.value, Math.max(0, changedPageCount.value - 1)),
);
const pagedChangedFiles = computed(() => {
  const start = changedPageSafe.value * CHANGED_PAGE_SIZE;
  return changedFiles.value.slice(start, start + CHANGED_PAGE_SIZE);
});

function fileKindLabel(path: string): string {
  const lower = path.toLowerCase();
  if (lower.endsWith(".cpp") || lower.endsWith(".cc") || lower.endsWith(".cxx")) return ".cpp";
  if (lower.endsWith(".hpp") || lower.endsWith(".hh")) return ".hpp";
  if (lower.endsWith(".h")) return ".h";
  return "源文件";
}

function prefsPayload() {
  return pageStore.prefsPayload;
}

function kindLabel(kind: string) {
  return kind === "file" ? "文件" : "目录";
}

async function loadPrefsFromApi() {
  const prefs = await fetchReorderMembersPrefs();
  ignoreFileDisplay.value = prefs.ignore_file_display || prefs.ignore_file;
  ignoreFileExists.value = prefs.ignore_file_exists;
  pageStore.applyFromApi(prefs);
}

async function refreshList() {
  loading.value = true;
  loadError.value = "";
  try {
    const data = await fetchReorderMembersTopLevel();
    ignoreFileDisplay.value = data.ignore_file_display || data.ignore_file;
    ignoreFileExists.value = data.ignore_file_exists;
    entries.value = data.entries;
    ignoredEntries.value = data.ignored ?? [];
    ignoredCount.value = data.ignored?.length ?? 0;
    pageStore.filterSelected(new Set(data.entries.map((e) => e.name)));
  } catch (e) {
    loadError.value = String(e);
    entries.value = [];
  } finally {
    loading.value = false;
  }
}

function setIncludeCpp(checked: boolean) {
  if (!pageStore.setIncludeCpp(checked)) {
    shell.setStatus("至少勾选一种源文件类型");
  }
}

function setIncludeHeader(checked: boolean) {
  if (!pageStore.setIncludeHeader(checked)) {
    shell.setStatus("至少勾选一种源文件类型");
  }
}

async function onSave() {
  saving.value = true;
  try {
    pageStore.syncFromServer(await saveReorderMembersPrefs(prefsPayload()));
    shell.setStatus("已保存成员排序偏好");
  } catch (e) {
    shell.setStatus(String(e));
  } finally {
    saving.value = false;
  }
}

async function onSelfTest() {
  selfTesting.value = true;
  shell.appendLog("[C++ 成员排序] 锁定段回归自检…", { source: "reorder_members", open: true });
  try {
    const out = await runReorderMembersSelfTest();
    shell.appendLog(out.summary, { source: "reorder_members" });
    for (const c of out.cases) {
      if (!c.pass) {
        shell.appendLog(`  ✗ ${c.id}: ${c.message}`, { source: "reorder_members" });
      } else if (c.skipped) {
        shell.appendLog(`  ○ ${c.id}: ${c.message}`, { source: "reorder_members" });
      }
    }
    shell.setStatus(out.summary);
  } catch (e) {
    shell.appendLog(String(e), { source: "reorder_members" });
    shell.setStatus(String(e));
  } finally {
    selfTesting.value = false;
  }
}

function toggleEntry(name: string, checked: boolean) {
  pageStore.toggleSelected(name, checked);
}

function toggleAll(checked: boolean) {
  pageStore.toggleAll(
    entries.value.map((e) => e.name),
    checked,
  );
}

async function onRun(dryRun: boolean) {
  if (!selectedCount.value) {
    shell.setStatus("请至少勾选一项");
    return;
  }
  if (!dryRun) {
    const ok = window.confirm(
      "将直接写回选中的 .h / .cpp 文件。\n建议先点「预检」确认变更范围。\n\n确定执行排序？",
    );
    if (!ok) return;
  }
  running.value = true;
  const mode = dryRun ? "预检" : "写盘";
  shell.appendLog(`[C++ 成员排序] ${mode} · ${selectedCount.value} 项…`, {
    source: "reorder_members",
    open: true,
  });
  try {
    const out = await runReorderMembers({
      ...prefsPayload(),
      targets: [...selected.value],
      dry_run: dryRun,
    });
    changedFiles.value = out.changed_files ?? [];
    changedPage.value = 0;
    lastRunDryRun.value = dryRun;
    lastRunSummary.value = out.summary || "";
    const logText = verbose.value ? out.log || out.summary : out.summary || out.log;
    shell.appendLog(logText || "完成", { source: "reorder_members" });
    shell.setStatus(out.summary || (out.ok ? "完成" : "失败"));
  } catch (e) {
    shell.appendLog(String(e), { source: "reorder_members" });
    shell.setStatus(String(e));
  } finally {
    running.value = false;
  }
}

onMounted(async () => {
  pageStore.hydrate(shell.workspacePath.value);
  try {
    await loadPrefsFromApi();
    await refreshList();
  } catch (e) {
    shell.setStatus(String(e));
  }
});

watch(
  () => shell.workspacePath.value,
  async (ws) => {
    pageStore.hydrate(ws);
    try {
      await loadPrefsFromApi();
      await refreshList();
    } catch (e) {
      shell.setStatus(String(e));
    }
  },
);
</script>

<template>
  <div class="page tool-page reorder-page">
    <header class="page-head">
      <div class="head-row">
        <h1 class="page-title">C++ 成员排序</h1>
        <p class="page-desc">
          按 cxx-code-style 重排工作空间一级目录下的 .h / .cpp；可先预检，变更文件列在下方表格
        </p>
        <div class="head-help">
          <PageHelpButton page-id="reorder_members" />
        </div>
      </div>
    </header>

    <section class="card settings-card">
      <div class="settings-form">
        <div class="form-row form-foot">
          <div class="option-chips">
            <label class="opt-chip">
              <input
                type="checkbox"
                :checked="includeCpp"
                @change="setIncludeCpp(($event.target as HTMLInputElement).checked)"
              />
              <span>.cpp</span>
            </label>
            <label class="opt-chip">
              <input
                type="checkbox"
                :checked="includeHeader"
                @change="setIncludeHeader(($event.target as HTMLInputElement).checked)"
              />
              <span>头文件（含 .h .hpp）</span>
            </label>
            <label
              class="opt-chip disabled"
              title="规划中：Doxygen 序号重编、.h/.cpp 构造析构序号一致等，见 doc/code/成员变量字母序-规则与待实现.md"
            >
              <input type="checkbox" disabled />
              <span>成员变量字母序</span>
            </label>
            <label class="opt-chip">
              <input v-model="verbose" type="checkbox" />
              <span>详细日志</span>
            </label>
          </div>
          <div class="settings-actions">
            <button
              type="button"
              class="btn btn-quiet btn-sm"
              :disabled="selfTesting"
              title="跑内置 fixture 锁定段用例，不扫描工作空间"
              @click="onSelfTest"
            >
              {{ selfTesting ? "…" : "回归自检" }}
            </button>
            <button type="button" class="btn btn-quiet btn-sm" :disabled="saving" @click="onSave">
              {{ saving ? "…" : "保存偏好" }}
            </button>
            <button
              type="button"
              class="btn btn-sm"
              :disabled="running || !selectedCount"
              @click="onRun(true)"
            >
              {{ running ? "…" : "预检" }}
            </button>
            <button
              type="button"
              class="btn primary btn-sm"
              :disabled="running || !selectedCount"
              @click="onRun(false)"
            >
              {{ running ? "…" : "执行排序" }}
            </button>
          </div>
        </div>
      </div>
    </section>

    <section class="card results-card" :class="{ collapsed: !entriesExpanded }">
      <div class="results-head-row">
        <button
          type="button"
          class="collapse-trigger"
          :aria-expanded="entriesExpanded"
          @click="entriesExpanded = !entriesExpanded"
        >
          <span class="collapse-chevron" :class="{ open: entriesExpanded }" aria-hidden="true">▶</span>
          <span class="section-label">一级条目</span>
        </button>
        <span v-if="entries.length" class="head-meta muted small">
          已选 {{ selectedCount }}/{{ entries.length }}
          · 目录 {{ dirCount }}
          · 源文件 {{ fileCount }}
          <template v-if="ignoredCount"> · 已忽略 {{ ignoredCount }}</template>
        </span>
        <span v-else-if="loading" class="head-meta muted small">加载中…</span>
        <div class="results-head-actions">
          <button
            type="button"
            class="btn btn-sm"
            :disabled="loading"
            @click="refreshList"
          >
            {{ loading ? "…" : "刷新列表" }}
          </button>
          <button type="button" class="btn btn-sm" @click="rulesModalOpen = true">
            忽略与规则
          </button>
        </div>
      </div>

      <div v-show="entriesExpanded" class="results-body">
        <p v-if="loadError" class="err-msg">{{ loadError }}</p>

        <div class="table-wrap">
        <table v-if="entries.length" class="entry-table">
          <thead>
            <tr>
              <th class="col-check">
                <input
                  type="checkbox"
                  :checked="allChecked"
                  aria-label="全选"
                  @change="toggleAll(($event.target as HTMLInputElement).checked)"
                />
              </th>
              <th>名称</th>
              <th class="col-kind">类型</th>
              <th class="col-num">源文件</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(e, i) in entries" :key="e.name" :class="{ 'row-alt': i % 2 === 1 }">
              <td class="col-check">
                <input
                  type="checkbox"
                  :checked="selected.has(e.name)"
                  @change="toggleEntry(e.name, ($event.target as HTMLInputElement).checked)"
                />
              </td>
              <td class="mono entry-name">{{ e.name }}</td>
              <td class="col-kind">
                <span class="kind-badge" :data-kind="e.kind">{{ kindLabel(e.kind) }}</span>
              </td>
              <td class="col-num">
                <span class="count-badge">{{ e.source_file_count }}</span>
              </td>
            </tr>
          </tbody>
        </table>
        <p v-else class="empty">
          {{ loading ? "加载中…" : loadError ? "加载失败" : "没有可列出的目录或源文件" }}
        </p>
        </div>
      </div>
    </section>

    <section v-if="changedFiles.length || lastRunSummary" class="card changed-card">
      <header class="results-head">
        <div class="results-head-row">
          <span class="section-label">变更文件</span>
          <span v-if="changedFiles.length" class="muted small">
            {{ lastRunDryRun ? "预检" : "已写盘" }} · 共 {{ changedTotal }} 个
          </span>
          <span v-else-if="lastRunSummary" class="muted small">本次无变更</span>
        </div>
        <p v-if="lastRunSummary && !changedFiles.length" class="run-summary muted">{{ lastRunSummary.split("\n")[0] }}</p>
      </header>

      <div v-if="changedFiles.length" class="table-wrap changed-table-wrap">
        <table class="entry-table">
          <thead>
            <tr>
              <th class="col-num">#</th>
              <th>路径</th>
              <th class="col-kind">类型</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="(path, i) in pagedChangedFiles"
              :key="path"
              :class="{ 'row-alt': i % 2 === 1 }"
            >
              <td class="col-num">{{ changedPageSafe * CHANGED_PAGE_SIZE + i + 1 }}</td>
              <td class="mono entry-name">{{ path }}</td>
              <td class="col-kind">
                <span class="kind-badge" :data-kind="fileKindLabel(path) === '.cpp' ? 'file' : 'dir'">
                  {{ fileKindLabel(path) }}
                </span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div v-if="changedPageCount > 1" class="pager">
        <button
          type="button"
          class="btn btn-sm"
          :disabled="changedPageSafe <= 0"
          @click="changedPage = Math.max(0, changedPageSafe - 1)"
        >
          上一页
        </button>
        <span class="pager-meta">
          第 {{ changedPageSafe + 1 }} / {{ changedPageCount }} 页
        </span>
        <button
          type="button"
          class="btn btn-sm"
          :disabled="changedPageSafe >= changedPageCount - 1"
          @click="changedPage = Math.min(changedPageCount - 1, changedPageSafe + 1)"
        >
          下一页
        </button>
      </div>
    </section>

    <AppModalOverlay
      :open="rulesModalOpen"
      aria-label="忽略规则与排序说明"
      panel-class="reorder-rules-modal"
      @close="rulesModalOpen = false"
    >
      <div class="rules-modal-inner">
        <header class="rules-modal-head">
          <h2 class="rules-modal-title">忽略规则与排序说明</h2>
          <button type="button" class="btn btn-sm" @click="rulesModalOpen = false">关闭</button>
        </header>

        <h3 class="help-sub">忽略列表</h3>
        <ul class="help-list">
          <li>
            内置忽略：<code>.phoenix</code>、<code>web-ui</code>、<code>build</code>、<code>node_modules</code> 等；以
            <code>.</code> 开头的隐藏项始终忽略。
          </li>
          <li>
            可选文件
            <span class="mono">{{ ignoreFileDisplay || ".phoenix/code.ignore" }}</span>
            <span v-if="ignoreFileExists">（已加载）</span>
            <span v-else>（未建则仅内置；可复制 code.ignore.example）</span>。
          </li>
          <li>
            CAA 等工程差异在
            <button type="button" class="link-btn" @click="shell.openCodeIgnoreSidebar(); rulesModalOpen = false">
              右侧栏 · 忽略
            </button>
            自定义区配置。
          </li>
        </ul>

        <div v-if="ignoredEntries.length" class="ignored-table-wrap">
          <p class="help-sub">当前已忽略（{{ ignoredEntries.length }}）</p>
          <table class="entry-table compact">
            <thead>
              <tr>
                <th>名称</th>
                <th class="col-kind">类型</th>
                <th>原因</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in ignoredEntries" :key="row.name">
                <td class="mono">{{ row.name }}</td>
                <td class="col-kind">{{ kindLabel(row.kind) }}</td>
                <td>{{ row.reason === "内置" ? "内置" : "ignore 规则" }}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <h3 class="help-sub">锁定段（P0）</h3>
        <ul class="help-list">
          <li>带成对标记的 <strong>locked region</strong>：排序时整段锁定，成员、空行、相对位置均不变。</li>
          <li>例如 <code>// clang-format off/on</code>、Kevin/CAA2 Wizard 段、<code>#pragma region</code>。</li>
          <li>详见 <code>doc/code/成员排序-锁定段与回归用例.md</code>。</li>
        </ul>

        <h3 class="help-sub">排序规则（摘要）</h3>
        <ul class="help-list">
          <li>
            <strong>.cpp</strong>：特殊成员（默认构造 → 其它构造 → 析构 → 拷贝/移动 → <code>operator=</code>）优先，其余按函数名字母序；补全
            <code>//---</code> 分隔符。
          </li>
          <li>
            <strong>.h</strong>：各访问段内同样优先特殊成员，再按字母序；成员变量字母序 Web 暂未开放。
          </li>
          <li>完整规则见 <code>doc/code/成员函数排序-reorder_members.md</code>。</li>
        </ul>
      </div>
    </AppModalOverlay>
  </div>
</template>

<style scoped>
@import "./page-shared.css";

.reorder-page strong {
  font-weight: 600;
}

.card {
  padding: 10px 14px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: #fff;
  margin-bottom: 10px;
}

.section-label {
  flex-shrink: 0;
  margin: 0;
  padding-right: 10px;
  border-right: 2px solid var(--accent);
  font-size: 0.72rem;
  font-weight: 600;
  letter-spacing: 0.03em;
  color: var(--muted);
  white-space: nowrap;
  line-height: 1.2;
}

.settings-form {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.form-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 12px;
}

.form-foot {
  justify-content: space-between;
}

.option-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.opt-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: #f8fafc;
  font-size: 0.76rem;
  cursor: pointer;
  user-select: none;
}

.opt-chip:has(input:checked) {
  background: #eff6ff;
  border-color: #93c5fd;
  color: #1d4ed8;
}

.opt-chip.disabled {
  opacity: 0.48;
  cursor: not-allowed;
  background: #f1f5f9;
  color: var(--muted);
}

.opt-chip.disabled:has(input:checked) {
  background: #f1f5f9;
  border-color: var(--border);
  color: var(--muted);
}

.settings-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-left: auto;
}

.btn-sm {
  padding: 5px 11px;
  font-size: 0.78rem;
}

.btn-quiet {
  color: var(--muted);
  border-color: transparent;
  background: transparent;
}

.btn-quiet:hover:not(:disabled) {
  background: #f1f5f9;
  border-color: var(--border);
}

.results-head-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 10px;
  align-items: center;
}

.results-card.collapsed {
  padding: 6px 12px;
}

.results-card.collapsed .results-head-row {
  flex-wrap: nowrap;
  gap: 8px;
}

.collapse-trigger {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
  margin: 0;
  padding: 0;
  border: none;
  background: transparent;
  cursor: pointer;
  text-align: left;
  color: inherit;
  font: inherit;
}

.collapse-trigger:hover .section-label {
  color: var(--text);
}

.collapse-chevron {
  display: inline-block;
  font-size: 0.62rem;
  color: var(--muted);
  transition: transform 0.15s ease;
}

.collapse-chevron.open {
  transform: rotate(90deg);
}

.head-meta {
  flex: 1 1 auto;
  min-width: 0;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.results-card:not(.collapsed) .head-meta {
  white-space: normal;
}

.results-head-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
  margin-left: auto;
}

.results-body {
  margin-top: 8px;
}

.reorder-page .table-wrap {
  max-height: calc(100vh - 380px);
  padding: 0;
}

.changed-table-wrap {
  max-height: min(360px, calc(100vh - 420px));
}

.pager {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 8px;
}

.pager-meta {
  font-size: 0.76rem;
  color: var(--muted);
  font-variant-numeric: tabular-nums;
}

.run-summary {
  margin: 6px 0 0;
  font-size: 0.78rem;
}

.rules-modal-inner {
  padding: 14px 16px 16px;
}

.rules-modal-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 12px;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--border);
}

.rules-modal-title {
  margin: 0;
  font-size: 0.95rem;
  font-weight: 600;
}

.ignored-table-wrap {
  margin-bottom: 12px;
  max-height: 200px;
  overflow: auto;
}

.entry-table.compact th,
.entry-table.compact td {
  padding: 5px 8px;
  font-size: 0.76rem;
}

:global(.reorder-rules-modal) {
  width: min(640px, 100%);
}

.entry-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.82rem;
}

.entry-table th,
.entry-table td {
  padding: 8px 12px;
  border-bottom: 1px solid var(--border);
  text-align: left;
  vertical-align: middle;
}

.entry-table th {
  position: sticky;
  top: 0;
  background: #f8fafc;
  font-weight: 600;
  font-size: 0.78rem;
  color: var(--muted);
  z-index: 1;
  white-space: nowrap;
}

.col-check {
  width: 40px;
  text-align: center;
}

.col-kind {
  width: 72px;
}

.col-num {
  width: 72px;
  text-align: center;
}

.entry-name {
  font-weight: 600;
  word-break: break-all;
  line-height: 1.45;
}

.kind-badge {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 0.72rem;
  font-weight: 600;
  background: #f1f5f9;
  border: 1px solid var(--border);
  color: var(--muted);
}

.kind-badge[data-kind="file"] {
  background: #eff6ff;
  border-color: #93c5fd;
  color: #1d4ed8;
}

.count-badge {
  display: inline-block;
  min-width: 22px;
  padding: 2px 8px;
  border-radius: 999px;
  background: #f8fafc;
  border: 1px solid var(--border);
  font-size: 0.72rem;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  color: var(--muted);
}

.entry-table tbody tr:hover td {
  background: #f8fafc;
}

.entry-table tbody tr.row-alt td {
  background: #fafbfc;
}

.entry-table tbody tr.row-alt:hover td {
  background: #f1f5f9;
}

.err-msg {
  margin: 0 0 8px;
  padding: 8px 12px;
  border-radius: 6px;
  font-size: 0.82rem;
  background: #fef2f2;
  color: #b91c1c;
}

.help-sub {
  margin: 0 0 6px;
  font-size: 0.78rem;
  font-weight: 600;
  color: var(--text);
}

.help-sub + .help-list {
  margin-top: 0;
}

.help-list {
  margin: 0 0 12px;
  padding-left: 1.1rem;
  font-size: 0.78rem;
  color: var(--muted);
  line-height: 1.55;
}

.help-list:last-child {
  margin-bottom: 0;
}

.help-list li + li {
  margin-top: 4px;
}

.small {
  font-size: 0.78rem;
}

.muted {
  color: var(--muted);
}

.help-list .link-btn {
  border: none;
  background: none;
  color: var(--accent);
  font-size: inherit;
  cursor: pointer;
  padding: 0;
  text-decoration: underline;
}

@media (max-width: 720px) {
  .form-foot {
    flex-direction: column;
    align-items: stretch;
  }

  .settings-actions {
    width: 100%;
    margin-left: 0;
    justify-content: flex-end;
  }
}
</style>
