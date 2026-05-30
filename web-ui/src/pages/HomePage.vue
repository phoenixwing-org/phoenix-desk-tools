<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { saveLauncherFreecad, syncLauncherFromLegacy } from "../api";
import { useAppShell } from "../composables/useAppShell";

const shell = useAppShell();

const repoInput = ref("");
const fcInput = ref("");
const syncNote = ref("");

const workspacePath = computed(() => shell.workspacePath.value);
const launcher = computed(() => shell.launcher.value);
const appConfig = computed(() => shell.appConfig.value);
const recentWorkspaces = computed(() => launcher.value?.recent_workspaces ?? []);

async function syncLegacyLauncher() {
  try {
    const data = await syncLauncherFromLegacy();
    await shell.reloadLauncher();
    if (data.migrated_from_legacy) {
      syncNote.value = "已从旧 workspace.custom.json 合并最近工作空间。";
    } else if (data.legacy_launcher_exists) {
      syncNote.value = "旧配置已读取（无新增项需合并）。";
    } else {
      syncNote.value = "";
    }
  } catch (e) {
    syncNote.value = String(e);
  }
}

onMounted(async () => {
  await syncLegacyLauncher();
  repoInput.value = workspacePath.value;
  fcInput.value = launcher.value?.freecad_dir ?? "";
});

watch(workspacePath, (v) => {
  repoInput.value = v;
});

watch(launcher, (v) => {
  fcInput.value = v?.freecad_dir ?? "";
});

async function refreshFields() {
  repoInput.value = shell.workspacePath.value;
  await shell.reloadLauncher();
  fcInput.value = shell.launcher.value?.freecad_dir ?? "";
}

async function savePrefs() {
  const repo = repoInput.value.trim();
  if (!repo) {
    alert("请先填写工作空间根目录。");
    return;
  }
  try {
    await shell.switchWorkspace(repo);
    await saveLauncherFreecad(fcInput.value.trim());
    await shell.reloadLauncher();
    fcInput.value = shell.launcher.value?.freecad_dir ?? "";
    alert("已保存启动器偏好。");
  } catch (e) {
    alert(String(e));
  }
}

async function switchRecent(path: string) {
  if (path === workspacePath.value) {
    alert("当前已是该工作空间。");
    return;
  }
  if (!window.confirm(`切换到以下工作空间？\n\n${path}`)) return;
  try {
    await shell.switchWorkspace(path);
    await refreshFields();
  } catch (e) {
    alert(String(e));
  }
}

const navItems = () => (appConfig.value?.navigation ?? []).filter((n) => n.page !== "home");
</script>

<template>
  <div class="page home-page">
    <h1 class="page-title">配置</h1>

    <section class="section">
      <label class="field-label">当前工作空间</label>
      <p class="current-path">{{ workspacePath }}</p>

      <label class="field-label" for="repo">工作空间根</label>
      <div class="row">
        <input id="repo" v-model="repoInput" class="path-input" spellcheck="false" />
      </div>

      <label class="field-label" for="fc">FreeCAD 目录</label>
      <div class="row">
        <input id="fc" v-model="fcInput" class="path-input" spellcheck="false" placeholder="可选" />
      </div>

      <div class="btn-row">
        <button type="button" class="btn primary" @click="savePrefs">保存偏好</button>
        <button type="button" class="btn" @click="refreshFields">刷新</button>
        <button type="button" class="btn" @click="syncLegacyLauncher">从旧配置合并</button>
      </div>
      <p v-if="syncNote" class="hint sync-note">{{ syncNote }}</p>
      <p v-if="launcher?.legacy_launcher_exists" class="hint">
        检测到旧启动器：
        <code>{{ launcher.legacy_launcher_path }}</code>
      </p>
    </section>

    <section class="section">
      <h2 class="section-title">最近打开</h2>
      <p class="hint">点击路径可切换（将询问确认）</p>
      <div class="recent-list">
        <button
          v-for="p in recentWorkspaces"
          :key="p"
          type="button"
          class="recent-btn"
          :class="{ current: p === workspacePath }"
          @click="switchRecent(p)"
        >
          {{ p === workspacePath ? "● 当前 · " : "" }}{{ p }}
        </button>
        <p v-if="!recentWorkspaces.length" class="muted">尚无记录</p>
      </div>
    </section>

    <section class="section">
      <h2 class="section-title">功能一览</h2>
      <ul class="feature-list">
        <li v-for="item in navItems()" :key="item.page">
          · {{ item.label }} — {{ item.description }}
        </li>
      </ul>
    </section>

    <p class="footer-hint">
      各功能页路径与选项写入当前工作空间根下的
      {{ appConfig?.workspace_dotfile }}；最近打开与 FreeCAD 目录保存在
      {{ launcher?.launcher_config_path ?? appConfig?.launcher_config_path }}。
    </p>
  </div>
</template>

<style scoped>
.home-page {
  padding: 24px 28px 40px;
  max-width: 760px;
}

.page-title {
  margin: 0 0 20px;
  font-size: 1.25rem;
}

.section {
  margin-bottom: 28px;
}

.section-title {
  margin: 0 0 8px;
  font-size: 1rem;
}

.field-label {
  display: block;
  margin: 12px 0 6px;
  font-size: 0.85rem;
  color: var(--muted);
}

.current-path {
  margin: 0 0 8px;
  font-weight: 600;
  word-break: break-all;
}

.row {
  display: flex;
  gap: 8px;
}

.path-input {
  flex: 1;
  padding: 8px 10px;
  border: 1px solid var(--border-strong);
  border-radius: 6px;
}

.btn-row {
  display: flex;
  gap: 10px;
  margin-top: 14px;
}

.btn {
  padding: 8px 16px;
  border: 1px solid var(--border-strong);
  border-radius: 6px;
  background: var(--btn-bg);
}

.btn.primary {
  background: var(--accent);
  color: #fff;
  border-color: var(--accent);
}

.hint {
  margin: 0 0 8px;
  font-size: 0.82rem;
  color: var(--muted);
}

.recent-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.recent-btn {
  text-align: left;
  padding: 8px 12px;
  border: none;
  border-radius: 6px;
  background: #e8eef6;
  font-size: 0.82rem;
  word-break: break-all;
}

.recent-btn.current {
  background: #2563eb;
  color: #fff;
}

.feature-list {
  margin: 0;
  padding-left: 0;
  list-style: none;
  font-size: 0.88rem;
  line-height: 1.7;
}

.sync-note {
  margin-top: 10px;
  color: #15803d;
}

code {
  font-size: 0.78rem;
  word-break: break-all;
}

.footer-hint,
.muted {
  font-size: 0.82rem;
  color: var(--muted);
  line-height: 1.6;
}
</style>
