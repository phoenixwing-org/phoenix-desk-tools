<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { addRecentWorkspace, pickWorkspaceDirectory, pruneRecentWorkspaces, removeRecentWorkspace, saveLauncherFreecad, shutdownWebServer } from "../api";
import { useAppShell } from "../composables/useAppShell";
import PageHelpButton from "../components/PageHelpButton.vue";
import { useShellTour } from "../composables/useShellTour";
import { useOnboardingStore } from "../stores/onboarding";
import { useUiPrefsStore } from "../stores/uiPrefs";

import SideDockPrefsPanel from "../components/SideDockPrefsPanel.vue";
import {
  EXPAND_ICON_SIZE_MAX,
  EXPAND_ICON_SIZE_MIN,
  expandGlyphSizePx,
} from "../utils/expandIconTheme";

const uiPrefs = useUiPrefsStore();
const onboarding = useOnboardingStore();
const shell = useAppShell();
const { startShellTour } = useShellTour(shell);

const repoInput = ref("");
const fcInput = ref("");
const pickingWorkspace = ref(false);
const workspaceSwitchHint = ref("");

const workspacePath = computed(() => shell.workspacePath.value);
const launcher = computed(() => shell.launcher.value);
const appConfig = computed(() => shell.appConfig.value);
const recentWorkspaces = computed(() => launcher.value?.recent_workspaces ?? []);
const recentEntries = computed(
  () =>
    launcher.value?.recent_workspace_entries ??
    recentWorkspaces.value.map((path) => ({ path, exists: true })),
);
const webRunning = ref(false);
const webUrl = ref("http://127.0.0.1:5173");
const defaultFreecadDir = computed(() => launcher.value?.default_freecad_dir ?? "");

const nonHomeTabCount = computed(
  () => shell.tabs.value.filter((t) => t.pageId !== "home").length,
);

function normalizePath(p: string) {
  return p.trim().replace(/\\/g, "/");
}

function isSameWorkspacePath(a: string, b: string) {
  const x = normalizePath(a);
  const y = normalizePath(b);
  return Boolean(x && y && x === y);
}

function workspaceSwitchBlocked(targetPath: string) {
  return (
    nonHomeTabCount.value > 0 &&
    !isSameWorkspacePath(targetPath, workspacePath.value)
  );
}

function setWorkspaceSwitchHint(targetPath: string) {
  if (!workspaceSwitchBlocked(targetPath)) {
    workspaceSwitchHint.value = "";
    return;
  }
  workspaceSwitchHint.value = `已选路径与当前工作空间不同。请先关闭除「主页」外的 ${nonHomeTabCount.value} 个 Tab，再点「保存偏好」切换。`;
}

function fillDefaultFreecad() {
  const p = defaultFreecadDir.value.trim();
  if (p) fcInput.value = p;
}

onMounted(async () => {
  repoInput.value = workspacePath.value;
  fcInput.value = launcher.value?.freecad_dir ?? "";
  await refreshWebStatus();
  await onboarding.refreshStatus();
  window.addEventListener("keydown", onConfigKeydown);
});

function openCadIndex() {
  shell.goToPage("fcstd_map");
  shell.closeConfig();
}

onUnmounted(() => {
  window.removeEventListener("keydown", onConfigKeydown);
});

function onConfigKeydown(e: KeyboardEvent) {
  if (e.key === "Escape" && shell.configOverlayOpen.value) {
    shell.closeConfig();
  }
}

watch(workspacePath, (v) => {
  repoInput.value = v;
});

watch(launcher, (v) => {
  fcInput.value = v?.freecad_dir ?? "";
});

watch(repoInput, (v) => {
  setWorkspaceSwitchHint(v);
});

async function refreshFields() {
  repoInput.value = shell.workspacePath.value;
  await shell.reloadLauncher();
  fcInput.value = shell.launcher.value?.freecad_dir ?? "";
}

async function savePrefs() {
  const repo = repoInput.value.trim();
  const fc = fcInput.value.trim();
  if (!repo) {
    alert("请先填写工作空间根目录。");
    return;
  }
  if (workspaceSwitchBlocked(repo)) {
    alert(
      `当前仍有 ${nonHomeTabCount.value} 个工具 Tab 打开。\n请先全部关闭（可保留「主页」），再保存并切换工作空间。`,
    );
    return;
  }
  try {
    // 先保存 FreeCAD 路径：switchWorkspace 会 reloadLauncher，watch(launcher) 会清空 fcInput
    const fcResult = await saveLauncherFreecad(fc);
    await shell.switchWorkspace(repo);
    fcInput.value = fcResult.freecad_dir || fc;
    workspaceSwitchHint.value = "";
    await onboarding.refreshStatus();
    alert("已保存启动器偏好。");
  } catch (e) {
    alert(String(e));
  }
}

async function switchRecent(path: string) {
  if (isSameWorkspacePath(path, workspacePath.value)) {
    alert("当前已是该工作空间。");
    return;
  }
  if (workspaceSwitchBlocked(path)) {
    alert(
      `当前仍有 ${nonHomeTabCount.value} 个工具 Tab 打开。\n请先全部关闭（可保留「主页」），再从最近列表切换工作空间。`,
    );
    return;
  }
  if (!window.confirm(`切换到以下工作空间？\n\n${path}`)) return;
  shell.appendLog(`切换工作空间：${path}`, { source: "config", open: true });
  try {
    await shell.switchWorkspace(path);
    await refreshFields();
    shell.appendLog(`已切换到 ${path}`, { source: "config" });
  } catch (e) {
    shell.appendLog(String(e), { source: "config" });
    alert(String(e));
  }
}

async function refreshWebStatus() {
  try {
    await fetch("/api/health", { method: "GET" });
    webRunning.value = true;
  } catch {
    webRunning.value = false;
  }
}

async function stopWebServer() {
  if (!window.confirm(`停止本地 Web 服务并释放端口？\n\n${webUrl.value}`)) return;
  shell.appendLog(`请求关闭 Web 服务：${webUrl.value}`, { source: "config", open: true });
  try {
    await shutdownWebServer();
    shell.appendLog("Web 服务正在关闭…", { source: "config", open: true });
    shell.setStatus("Web 服务已关闭");
    webRunning.value = false;
  } catch (e) {
    const msg = String(e);
    shell.appendLog(`关闭 Web 服务失败：${msg}`, { source: "config", open: true });
    shell.setStatus(msg);
    alert(msg);
  }
}

async function removeRecent(path: string, event: MouseEvent) {
  event.stopPropagation();
  if (!window.confirm(`从最近列表中移除？\n\n${path}`)) return;
  try {
    await removeRecentWorkspace(path);
    await shell.reloadLauncher();
    shell.setStatus("已从最近列表移除");
  } catch (e) {
    alert(String(e));
  }
}

async function onBrowseWorkspace() {
  if (pickingWorkspace.value) return;
  pickingWorkspace.value = true;
  workspaceSwitchHint.value = "";
  try {
    const data = await pickWorkspaceDirectory(repoInput.value.trim() || workspacePath.value);
    if (data.cancelled || !data.path?.trim()) {
      shell.setStatus("已取消选择目录");
      return;
    }
    const picked = data.path.trim();
    repoInput.value = picked;
    await addRecentWorkspace(picked);
    await shell.reloadLauncher();
    setWorkspaceSwitchHint(picked);
    if (workspaceSwitchBlocked(picked)) {
      shell.setStatus("已加入最近列表；关闭其它 Tab 后可保存切换");
      shell.appendLog(
        `[配置] 已选工作空间 ${picked}（已加入最近列表，未切换）`,
        { source: "config", open: true },
      );
    } else {
      shell.setStatus(`已选择：${picked}`);
    }
  } catch (e) {
    alert(String(e));
    shell.appendLog(String(e), { source: "config" });
  } finally {
    pickingWorkspace.value = false;
  }
}

async function pruneRecentList() {
  if (!window.confirm("清理最近列表中的临时目录与无效路径？")) return;
  shell.appendLog("清理最近工作空间列表…", { source: "config", open: true });
  try {
    const data = await pruneRecentWorkspaces();
    await shell.reloadLauncher();
    const n = data.pruned_count ?? 0;
    const msg = n > 0 ? `已清理 ${n} 条记录` : "无需清理";
    shell.appendLog(msg, { source: "config" });
    shell.setStatus(msg);
  } catch (e) {
    shell.appendLog(String(e), { source: "config" });
    alert(String(e));
  }
}

const navItems = () =>
  (appConfig.value?.navigation ?? []).filter(
    (n) => n.page !== "home" && n.page !== "config",
  );
</script>

<template>
  <div class="page config-page">
    <div class="title-row">
      <h1 class="page-title">配置</h1>
      <div class="head-actions">
        <button
          v-if="shell.configOverlayOpen.value"
          type="button"
          class="btn close-frame"
          title="关闭（Esc）"
          @click="shell.closeConfig()"
        >
          关闭
        </button>
        <PageHelpButton page-id="config" />
      </div>
    </div>

    <section class="section" data-tour-page-config-workspace>
      <label class="field-label">当前工作空间</label>
      <p class="current-path">{{ workspacePath }}</p>

      <label class="field-label" for="repo">工作空间根</label>
      <div class="row">
        <input id="repo" v-model="repoInput" class="path-input" spellcheck="false" />
        <button
          type="button"
          class="btn"
          :disabled="pickingWorkspace"
          title="在本机弹出选文件夹对话框（非浏览器选目录）"
          @click="onBrowseWorkspace"
        >
          {{ pickingWorkspace ? "…" : "浏览…" }}
        </button>
      </div>
      <p v-if="workspaceSwitchHint" class="hint workspace-hint">{{ workspaceSwitchHint }}</p>

      <label class="field-label" for="fc" data-tour-page-config-freecad>FreeCAD 目录</label>
      <div class="row">
        <input id="fc" v-model="fcInput" class="path-input" spellcheck="false" placeholder="可选" />
        <button
          v-if="defaultFreecadDir"
          type="button"
          class="btn"
          title="填入本机常用安装路径"
          @click="fillDefaultFreecad"
        >
          默认位置
        </button>
      </div>

      <div class="btn-row">
        <button type="button" class="btn primary" @click="savePrefs">保存偏好</button>
        <button type="button" class="btn" @click="refreshFields">刷新</button>
      </div>
      <p v-if="onboarding.workspaceOk && !onboarding.indexScanned" class="hint scan-hint">
        该工作空间尚未执行 CAD 索引扫描，BOM/引用功能可能不完整。
        <button type="button" class="link-btn" @click="openCadIndex">打开 CAD 索引</button>
      </p>
    </section>

    <section class="section">
      <h2 class="section-title">界面</h2>
      <SideDockPrefsPanel />
      <p class="hint">
        日志收起后，可点 Ribbon 工具条 **运行日志**、底栏按钮，或顶栏 **侧栏** 重新打开。
      </p>
      <label class="field-label" for="expand-icon-size">
        展开/折叠图标大小（{{ uiPrefs.expandControlSizePx }}px，三角约
        {{ expandGlyphSizePx(uiPrefs.expandControlSizePx) }}px）
      </label>
      <div class="row expand-size-row">
        <input
          id="expand-icon-size"
          v-model.number="uiPrefs.expandControlSizePx"
          type="range"
          :min="EXPAND_ICON_SIZE_MIN"
          :max="EXPAND_ICON_SIZE_MAX"
          step="1"
          @input="uiPrefs.setExpandControlSizePx(uiPrefs.expandControlSizePx)"
        />
        <span class="expand-size-hint muted">{{ EXPAND_ICON_SIZE_MIN }}–{{ EXPAND_ICON_SIZE_MAX }} px</span>
      </div>
      <p class="hint">
        作用于工作区树、BOM 按宿主分组、装配结构树、链接路径修正等展开三角；写入本机浏览器 localStorage。
      </p>
      <div class="btn-row compact">
        <button
          type="button"
          class="btn"
          :disabled="!onboarding.workspaceOk"
          @click="startShellTour(true)"
        >
          重新观看界面巡游
        </button>
      </div>
    </section>

    <section class="section">
      <h2 class="section-title">Web 服务</h2>
      <p class="hint">
        {{ webRunning ? `运行中 · ${webUrl}` : "未检测到本页面对应的服务（可能已在其它端口运行）" }}
      </p>
      <div class="btn-row">
        <button type="button" class="btn danger" :disabled="!webRunning" @click="stopWebServer">
          关闭 Web 服务
        </button>
        <button type="button" class="btn" @click="refreshWebStatus">刷新状态</button>
      </div>
      <p class="hint">关闭后释放 5173 端口；详细步骤见右侧运行日志。</p>
    </section>

    <section class="section">
      <h2 class="section-title">最近打开</h2>
      <p class="hint">
        仅记录你主动切换/保存的工作空间根目录（写入本机 launcher.json）。系统临时目录不会再加入列表。
      </p>
      <div class="btn-row compact">
        <button type="button" class="btn" @click="pruneRecentList">清理临时/无效项</button>
      </div>
      <p class="hint">点击路径可切换；右侧 × 可单条移除（不删除磁盘目录）</p>
      <div class="recent-list">
        <div
          v-for="entry in recentEntries"
          :key="entry.path"
          class="recent-row"
          :class="{ missing: !entry.exists, current: entry.path === workspacePath }"
        >
          <button type="button" class="recent-btn" @click="switchRecent(entry.path)">
            <span v-if="!entry.exists" class="missing-tag">已失效</span>
            {{ entry.path === workspacePath ? "● 当前 · " : "" }}{{ entry.path }}
          </button>
          <button
            type="button"
            class="recent-remove"
            title="从最近列表移除"
            @click="removeRecent(entry.path, $event)"
          >
            ×
          </button>
        </div>
        <p v-if="!recentEntries.length" class="muted">尚无记录</p>
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
@import "./page-shared.css";

.config-page {
  padding: 0;
}

.title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 20px;
}

.head-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.close-frame {
  padding: 5px 12px;
  font-size: 0.82rem;
}

.page-title {
  margin: 0;
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

.btn-row.compact {
  margin-top: 8px;
  margin-bottom: 8px;
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

.btn.danger {
  background: #fef2f2;
  border-color: #fecaca;
  color: #b91c1c;
}

.btn.danger:disabled {
  opacity: 0.45;
}

.hint {
  margin: 0 0 8px;
  font-size: 0.82rem;
  color: var(--muted);
}

.workspace-hint {
  margin: 6px 0 10px;
  padding: 8px 10px;
  border-radius: 6px;
  border: 1px solid #fcd34d;
  background: #fffbeb;
  color: #92400e;
}

.scan-hint {
  margin-top: 10px;
  padding: 8px 10px;
  border-radius: 6px;
  border: 1px solid #bfdbfe;
  background: #eff6ff;
  color: #1e40af;
}

.link-btn {
  margin-left: 4px;
  padding: 0;
  border: none;
  background: none;
  color: var(--accent, #2563eb);
  font: inherit;
  font-size: 0.82rem;
  cursor: pointer;
  text-decoration: underline;
}

.recent-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.recent-row {
  display: flex;
  align-items: stretch;
  gap: 6px;
}

.recent-row.missing .recent-btn {
  opacity: 0.72;
}

.recent-btn {
  flex: 1;
  text-align: left;
  padding: 8px 12px;
  border: none;
  border-radius: 6px;
  background: #e8eef6;
  font-size: 0.82rem;
  word-break: break-all;
}

.recent-row.current .recent-btn {
  background: #2563eb;
  color: #fff;
}

.missing-tag {
  display: inline-block;
  margin-right: 6px;
  padding: 0 5px;
  border-radius: 4px;
  font-size: 0.72rem;
  background: #fef3c7;
  color: #92400e;
}

.recent-row.current .missing-tag {
  background: rgba(255, 255, 255, 0.2);
  color: #fff;
}

.recent-remove {
  flex-shrink: 0;
  width: 32px;
  border: 1px solid var(--border-strong);
  border-radius: 6px;
  background: var(--btn-bg);
  color: var(--muted);
  font-size: 1.1rem;
  line-height: 1;
}

.recent-remove:hover {
  background: #fee2e2;
  border-color: #fecaca;
  color: #b91c1c;
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

.expand-size-row {
  align-items: center;
}

.expand-size-row input[type="range"] {
  flex: 1;
  max-width: 280px;
}

.expand-size-hint {
  font-size: 0.82rem;
  white-space: nowrap;
}

.footer-hint,
.muted {
  font-size: 0.82rem;
  color: var(--muted);
  line-height: 1.6;
}
</style>
