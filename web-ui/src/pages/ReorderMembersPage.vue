<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import {
  fetchReorderMembersPrefs,
  fetchReorderMembersTopDirs,
  runReorderMembers,
  saveReorderMembersPrefs,
  type ReorderMembersTopDir,
} from "../api";
import PageHelpButton from "../components/PageHelpButton.vue";
import { useAppShell } from "../composables/useAppShell";

const shell = useAppShell();

const dryRun = ref(true);
const cppOnly = ref(false);
const headerOnly = ref(false);
const sortMembers = ref(false);
const verbose = ref(true);

const workspaceDisplay = ref("");
const dirs = ref<ReorderMembersTopDir[]>([]);
const selected = ref<Set<string>>(new Set());

const loadingDirs = ref(false);
const saving = ref(false);
const running = ref(false);
const loadError = ref("");

const selectedCount = computed(() => selected.value.size);
const allChecked = computed(
  () => dirs.value.length > 0 && dirs.value.every((d) => selected.value.has(d.name)),
);

function prefsPayload() {
  return {
    dry_run: dryRun.value,
    cpp_only: cppOnly.value,
    header_only: headerOnly.value,
    sort_members: sortMembers.value,
    verbose: verbose.value,
    last_selected: [...selected.value],
  };
}

async function loadPrefs() {
  const prefs = await fetchReorderMembersPrefs();
  workspaceDisplay.value = prefs.workspace_path_display || shell.workspacePath.value;
  dryRun.value = prefs.dry_run;
  cppOnly.value = prefs.cpp_only;
  headerOnly.value = prefs.header_only;
  sortMembers.value = prefs.sort_members;
  verbose.value = prefs.verbose;
  selected.value = new Set(prefs.last_selected || []);
}

async function refreshDirs() {
  loadingDirs.value = true;
  loadError.value = "";
  try {
    const data = await fetchReorderMembersTopDirs();
    workspaceDisplay.value = data.workspace_path_display || workspaceDisplay.value;
    dirs.value = data.dirs;
    const names = new Set(data.dirs.map((d) => d.name));
    selected.value = new Set([...selected.value].filter((n) => names.has(n)));
  } catch (e) {
    loadError.value = String(e);
    dirs.value = [];
  } finally {
    loadingDirs.value = false;
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

function toggleDir(name: string, checked: boolean) {
  const next = new Set(selected.value);
  if (checked) next.add(name);
  else next.delete(name);
  selected.value = next;
}

function toggleAll(checked: boolean) {
  selected.value = checked ? new Set(dirs.value.map((d) => d.name)) : new Set();
}

async function onRun() {
  if (!selectedCount.value) {
    shell.setStatus("请至少勾选一个一级子目录");
    return;
  }
  running.value = true;
  const mode = dryRun.value ? "预检（dry-run）" : "写盘排序";
  shell.appendLog(`[C++ 成员排序] ${mode} · ${selectedCount.value} 个目录…`, {
    source: "reorder_members",
    open: true,
  });
  try {
    const out = await runReorderMembers({
      ...prefsPayload(),
      top_dirs: [...selected.value],
    });
    shell.appendLog(out.log, { source: "reorder_members" });
    shell.setStatus(out.summary || (out.ok ? "排序完成" : "排序失败"));
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
    await refreshDirs();
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
          扫描<strong>当前工作空间</strong>下的一级子目录，勾选模块后按 cxx-code-style 重排 .h / .cpp（结果见运行日志）
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
          <button type="button" class="btn btn-sm" :disabled="loadingDirs" @click="refreshDirs">
            {{ loadingDirs ? "刷新中…" : "刷新子目录" }}
          </button>
        </div>

        <div class="form-row form-foot">
          <div class="option-chips">
            <label class="opt-chip">
              <input v-model="dryRun" type="checkbox" />
              <span>预检（不写盘）</span>
            </label>
            <label class="opt-chip">
              <input v-model="cppOnly" type="checkbox" />
              <span>仅 .cpp</span>
            </label>
            <label class="opt-chip">
              <input v-model="headerOnly" type="checkbox" />
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
              class="btn primary btn-sm"
              :disabled="running || !selectedCount"
              @click="onRun"
            >
              {{ running ? "处理中…" : dryRun ? "预检排序" : "执行排序" }}
            </button>
          </div>
        </div>
      </div>
    </section>

    <section class="card results-card">
      <header class="results-head">
        <div class="results-head-row">
          <span class="section-label">一级子目录</span>
          <span v-if="dirs.length" class="muted small">
            已选 {{ selectedCount }} / {{ dirs.length }}
          </span>
        </div>
      </header>

      <p v-if="loadError" class="err-msg">{{ loadError }}</p>
      <p v-else-if="!loadingDirs && !dirs.length" class="muted hint">
        工作空间下没有可处理的一级子文件夹（已跳过 .phoenix、web-ui 等）。
      </p>

      <div v-if="dirs.length" class="dir-table-wrap">
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
              <th>目录名</th>
              <th class="col-num">.h/.cpp 约</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="d in dirs" :key="d.name">
              <td class="col-check">
                <input
                  type="checkbox"
                  :checked="selected.has(d.name)"
                  @change="toggleDir(d.name, ($event.target as HTMLInputElement).checked)"
                />
              </td>
              <td class="mono">{{ d.name }}</td>
              <td class="col-num muted">{{ d.source_file_count }}</td>
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

.col-num {
  width: 6rem;
  text-align: right;
}

.err-msg {
  color: var(--danger, #c0392b);
  margin: 0.5rem 0;
}

.hint {
  margin: 0.5rem 0;
}
</style>
