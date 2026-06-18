<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import {
  fetchReorderMembersPrefs,
  fetchReorderMembersTopLevel,
  runReorderMembers,
  saveReorderMembersPrefs,
  type ReorderMembersEntry,
} from "../api";
import PageHelpButton from "../components/PageHelpButton.vue";
import { useAppShell } from "../composables/useAppShell";

const shell = useAppShell();

const includeCpp = ref(true);
const includeHeader = ref(true);
const verbose = ref(false);

const ignoreFileDisplay = ref("");
const ignoreFileExists = ref(false);
const entries = ref<ReorderMembersEntry[]>([]);
const ignoredCount = ref(0);
const selected = ref<Set<string>>(new Set());

const loading = ref(false);
const saving = ref(false);
const running = ref(false);
const loadError = ref("");

const selectedCount = computed(() => selected.value.size);
const allChecked = computed(
  () => entries.value.length > 0 && entries.value.every((e) => selected.value.has(e.name)),
);
const dirCount = computed(() => entries.value.filter((e) => e.kind === "dir").length);
const fileCount = computed(() => entries.value.filter((e) => e.kind === "file").length);

function prefsPayload() {
  return {
    include_cpp: includeCpp.value,
    include_header: includeHeader.value,
    sort_members: false,
    verbose: verbose.value,
    last_selected: [...selected.value],
  };
}

function kindLabel(kind: string) {
  return kind === "file" ? "文件" : "目录";
}

async function loadPrefs() {
  const prefs = await fetchReorderMembersPrefs();
  ignoreFileDisplay.value = prefs.ignore_file_display || prefs.ignore_file;
  ignoreFileExists.value = prefs.ignore_file_exists;
  includeCpp.value = prefs.include_cpp ?? true;
  includeHeader.value = prefs.include_header ?? true;
  verbose.value = prefs.verbose;
  selected.value = new Set(prefs.last_selected || []);
}

async function refreshList() {
  loading.value = true;
  loadError.value = "";
  try {
    const data = await fetchReorderMembersTopLevel();
    ignoreFileDisplay.value = data.ignore_file_display || data.ignore_file;
    ignoreFileExists.value = data.ignore_file_exists;
    entries.value = data.entries;
    ignoredCount.value = data.ignored?.length ?? 0;
    const names = new Set(data.entries.map((e) => e.name));
    selected.value = new Set([...selected.value].filter((n) => names.has(n)));
  } catch (e) {
    loadError.value = String(e);
    entries.value = [];
  } finally {
    loading.value = false;
  }
}

function setIncludeCpp(checked: boolean) {
  if (!checked && !includeHeader.value) {
    shell.setStatus("至少勾选一种源文件类型");
    return;
  }
  includeCpp.value = checked;
}

function setIncludeHeader(checked: boolean) {
  if (!checked && !includeCpp.value) {
    shell.setStatus("至少勾选一种源文件类型");
    return;
  }
  includeHeader.value = checked;
}

async function onSave() {
  saving.value = true;
  try {
    await saveReorderMembersPrefs(prefsPayload());
    shell.setStatus("已保存成员排序偏好");
  } catch (e) {
    shell.setStatus(String(e));
  } finally {
    saving.value = false;
  }
}

function toggleEntry(name: string, checked: boolean) {
  const next = new Set(selected.value);
  if (checked) next.add(name);
  else next.delete(name);
  selected.value = next;
}

function toggleAll(checked: boolean) {
  selected.value = checked ? new Set(entries.value.map((e) => e.name)) : new Set();
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
  try {
    await loadPrefs();
    await refreshList();
  } catch (e) {
    shell.setStatus(String(e));
  }
});
</script>

<template>
  <div class="page tool-page reorder-page">
    <header class="page-head">
      <div class="head-row">
        <h1 class="page-title">C++ 成员排序</h1>
        <p class="page-desc">
          按 cxx-code-style 重排工作空间一级目录下的 .h / .cpp；可先预检，结果见底部运行日志
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
              title="规划中：Doxygen 序号重编、.h/.cpp 构造析构序号一致等，见 doc/成员变量字母序-规则与待实现.md"
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

    <section class="card results-card">
      <header class="results-head">
        <div class="results-head-row">
          <span class="section-label">一级条目</span>
          <span v-if="entries.length" class="muted small">
            已选 {{ selectedCount }} / {{ entries.length }}
          </span>
          <button type="button" class="btn btn-sm refresh-btn" :disabled="loading" @click="refreshList">
            {{ loading ? "刷新中…" : "刷新列表" }}
          </button>
        </div>
        <p v-if="entries.length" class="list-summary">
          <span>目录 <strong>{{ dirCount }}</strong></span>
          <span class="sep">·</span>
          <span>源文件 <strong>{{ fileCount }}</strong></span>
          <span v-if="ignoredCount" class="sep">·</span>
          <span v-if="ignoredCount" class="muted">已忽略 <strong>{{ ignoredCount }}</strong></span>
        </p>
      </header>

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
    </section>

    <details class="help-panel">
      <summary class="help-summary">忽略规则与排序说明</summary>
      <div class="help-body">
        <h3 class="help-sub">忽略列表</h3>
        <ul class="help-list">
          <li>
            内置忽略：<code>.phoenix</code>、<code>web-ui</code>、<code>build</code>、<code>node_modules</code> 等；以
            <code>.</code> 开头的隐藏项始终忽略。
          </li>
          <li>
            可选文件
            <span class="mono">{{ ignoreFileDisplay || ".phoenix/reorder-members.ignore" }}</span>
            <span v-if="ignoreFileExists">（已加载）</span>
            <span v-else>（未建则仅内置；可复制 reorder-members.ignore.example）</span>。
          </li>
          <li v-if="ignoredCount">当前列表已隐藏 {{ ignoredCount }} 项。</li>
        </ul>

        <h3 class="help-sub">排序规则（摘要）</h3>
        <ul class="help-list">
          <li>
            <strong>.cpp</strong>：特殊成员（默认构造 → 其它构造 → 析构 → 拷贝/移动 → <code>operator=</code>）优先，其余按函数名字母序；补全
            <code>//---</code> 分隔符；初始化列表用 <code>()</code> 而非 <code>{}</code>。
          </li>
          <li>
            <strong>.h</strong>：各访问段内同样优先特殊成员，再按字母序；成员变量字母序 Web 暂未开放（见
            <code>doc/成员变量字母序-规则与待实现.md</code>）。
          </li>
          <li>完整规则见页内 ? 帮助或 <code>doc/成员函数排序-reorder_members.md</code>。</li>
        </ul>
      </div>
    </details>
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

.results-head {
  margin-bottom: 8px;
}

.results-head-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 10px;
  align-items: center;
  justify-content: space-between;
}

.refresh-btn {
  margin-left: auto;
}

.list-summary {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 0;
  margin: 8px 0 0;
  font-size: 0.78rem;
  color: var(--muted);
}

.list-summary .sep {
  margin: 0 6px;
  color: #cbd5e1;
}

.list-summary strong {
  font-weight: 600;
  color: var(--text);
}

.reorder-page .table-wrap {
  max-height: calc(100vh - 380px);
  padding: 0;
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

.help-panel {
  margin-top: 4px;
  padding: 10px 14px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: #fafafa;
}

.help-summary {
  font-size: 0.82rem;
  font-weight: 600;
  cursor: pointer;
  color: var(--muted);
  user-select: none;
}

.help-body {
  margin-top: 10px;
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
