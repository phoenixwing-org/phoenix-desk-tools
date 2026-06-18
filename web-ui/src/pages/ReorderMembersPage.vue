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

const cppOnly = ref(false);
const headerOnly = ref(false);
const sortMembers = ref(false);
const verbose = ref(false);

const workspaceDisplay = ref("");
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

function prefsPayload() {
  return {
    cpp_only: cppOnly.value,
    header_only: headerOnly.value,
    sort_members: sortMembers.value,
    verbose: verbose.value,
    last_selected: [...selected.value],
  };
}

function kindLabel(kind: string) {
  return kind === "file" ? "文件" : "目录";
}

async function loadPrefs() {
  const prefs = await fetchReorderMembersPrefs();
  workspaceDisplay.value = prefs.workspace_path_display || shell.workspacePath.value;
  ignoreFileDisplay.value = prefs.ignore_file_display || prefs.ignore_file;
  ignoreFileExists.value = prefs.ignore_file_exists;
  cppOnly.value = prefs.cpp_only;
  headerOnly.value = prefs.header_only;
  sortMembers.value = prefs.sort_members;
  verbose.value = prefs.verbose;
  selected.value = new Set(prefs.last_selected || []);
}

async function refreshList() {
  loading.value = true;
  loadError.value = "";
  try {
    const data = await fetchReorderMembersTopLevel();
    workspaceDisplay.value = data.workspace_path_display || workspaceDisplay.value;
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
          列出<strong>工作空间一级</strong>目录与 .h/.cpp 文件，勾选后可直接执行或先预检（日志见底部运行窗口）
        </p>
        <div class="head-help">
          <PageHelpButton page-id="reorder_members" />
        </div>
      </div>
    </header>

    <section class="card settings-card">
      <div class="settings-form">
        <div class="form-row">
          <span class="section-label">工作空间</span>
          <span class="mono workspace-path">{{ workspaceDisplay || shell.workspacePath }}</span>
          <button type="button" class="btn btn-sm" :disabled="loading" @click="refreshList">
            {{ loading ? "刷新中…" : "刷新列表" }}
          </button>
        </div>
        <p class="ignore-hint muted small">
          忽略规则：内置 + <span class="mono">{{ ignoreFileDisplay || ".phoenix/reorder-members.ignore" }}</span>
          <span v-if="ignoreFileExists">（已加载）</span>
          <span v-else>（未建文件则仅内置；可复制 reorder-members.ignore.example）</span>
          <span v-if="ignoredCount"> · 已隐藏 {{ ignoredCount }} 项</span>
        </p>

        <div class="form-row form-foot">
          <div class="option-chips">
            <label class="opt-chip">
              <input
                v-model="cppOnly"
                type="checkbox"
                @change="cppOnly && (headerOnly = false)"
              />
              <span>仅 .cpp</span>
            </label>
            <label class="opt-chip">
              <input
                v-model="headerOnly"
                type="checkbox"
                @change="headerOnly && (cppOnly = false)"
              />
              <span>仅头文件</span>
            </label>
            <label class="opt-chip">
              <input v-model="sortMembers" type="checkbox" />
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
        </div>
      </header>

      <p v-if="loadError" class="err-msg">{{ loadError }}</p>
      <p v-else-if="!loading && !entries.length" class="muted hint">
        没有可列出的目录或源文件（其余项已被忽略规则隐藏）。
      </p>

      <div v-if="entries.length" class="dir-table-wrap">
        <table class="dir-table">
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
            <tr v-for="e in entries" :key="e.name">
              <td class="col-check">
                <input
                  type="checkbox"
                  :checked="selected.has(e.name)"
                  @change="toggleEntry(e.name, ($event.target as HTMLInputElement).checked)"
                />
              </td>
              <td class="mono">{{ e.name }}</td>
              <td class="col-kind">
                <span class="kind-badge" :data-kind="e.kind">{{ kindLabel(e.kind) }}</span>
              </td>
              <td class="col-num muted">{{ e.source_file_count }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  </div>
</template>

<style scoped>
.reorder-page .form-row {
  flex-wrap: wrap;
  gap: 0.5rem 0.75rem;
  align-items: center;
}

.workspace-path {
  flex: 1;
  min-width: 12rem;
  font-size: 0.875rem;
  opacity: 0.9;
  word-break: break-all;
}

.ignore-hint {
  margin: 0.25rem 0 0.5rem;
  line-height: 1.45;
}

.dir-table-wrap {
  overflow: auto;
  max-height: min(420px, 50vh);
}

.dir-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.875rem;
}

.dir-table th,
.dir-table td {
  padding: 0.35rem 0.5rem;
  text-align: left;
  border-bottom: 1px solid var(--border-subtle, rgba(127, 127, 127, 0.25));
}

.col-check {
  width: 2.5rem;
  text-align: center;
}

.col-kind {
  width: 4.5rem;
}

.col-num {
  width: 5rem;
  text-align: right;
}

.kind-badge {
  font-size: 0.75rem;
  padding: 0.1rem 0.4rem;
  border-radius: 4px;
  background: rgba(127, 127, 127, 0.15);
}

.kind-badge[data-kind="file"] {
  background: rgba(80, 120, 200, 0.15);
}

.err-msg {
  color: var(--danger, #c0392b);
  margin: 0.5rem 0;
}

.hint {
  margin: 0.5rem 0;
}
</style>
