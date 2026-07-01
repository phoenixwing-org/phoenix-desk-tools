<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { ElMessage } from "element-plus";
import { pnwPromptChoice } from "phoenix-wing";
import { pruneRecentWorkspaces, removeRecentWorkspace, saveLauncherFreecad, shutdownWebServer } from "../api";
import { useAppShell } from "../composables/useAppShell";
import { useWorkspaceDirectoryPicker } from "../composables/useWorkspaceDirectoryPicker";
import PageHeader from "phoenix-wing/layout/PnwPageHeader.vue";
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
const { picking: pickingWorkspace, pickAndOpenWorkspace, workspaceSwitchBlocked } =
  useWorkspaceDirectoryPicker();
const { startShellTour } = useShellTour(shell);

const repoInput = ref("");
const fcInput = ref("");
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

function workspaceSwitchBlockedForInput(targetPath: string) {
  return workspaceSwitchBlocked(targetPath);
}

function setWorkspaceSwitchHint(targetPath: string) {
  if (!workspaceSwitchBlockedForInput(targetPath)) {
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
    ElMessage.warning("请先填写工作空间根目录。");
    return;
  }
  if (workspaceSwitchBlockedForInput(repo)) {
    ElMessage.warning(
      `当前仍有 ${nonHomeTabCount.value} 个工具 Tab 打开。请先全部关闭（可保留「主页」），再保存并切换工作空间。`,
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
    ElMessage.success("已保存启动器偏好。");
  } catch (e) {
    ElMessage.error(String(e));
  }
}

async function switchRecent(path: string) {
  if (isSameWorkspacePath(path, workspacePath.value)) {
    ElMessage.info("当前已是该工作空间。");
    return;
  }
  if (workspaceSwitchBlockedForInput(path)) {
    ElMessage.warning(
      `当前仍有 ${nonHomeTabCount.value} 个工具 Tab 打开。请先全部关闭（可保留「主页」），再从最近列表切换工作空间。`,
    );
    return;
  }
  const result = await pnwPromptChoice({
    title: "切换工作空间",
    message: `切换到以下工作空间？\n\n${path}`,
    choices: [
      { id: "switch", label: "切换", variant: "primary" },
      { id: "cancel", label: "取消" },
    ],
  });
  if (result.choiceId !== "switch") return;
  shell.appendLog(`切换工作空间：${path}`, { source: "config", open: true });
  try {
    await shell.switchWorkspace(path);
    await refreshFields();
    shell.appendLog(`已切换到 ${path}`, { source: "config" });
  } catch (e) {
    shell.appendLog(String(e), { source: "config" });
    ElMessage.error(String(e));
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
  const result = await pnwPromptChoice({
    title: "关闭 Web 服务",
    message: `停止本地 Web 服务并释放端口？\n\n${webUrl.value}`,
    choices: [
      { id: "stop", label: "关闭", variant: "danger" },
      { id: "cancel", label: "取消" },
    ],
  });
  if (result.choiceId !== "stop") return;
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
    ElMessage.error(msg);
  }
}

async function removeRecent(path: string, event: MouseEvent) {
  event.stopPropagation();
  const result = await pnwPromptChoice({
    title: "移除记录",
    message: `从最近列表中移除？\n\n${path}`,
    choices: [
      { id: "remove", label: "移除", variant: "danger" },
      { id: "cancel", label: "取消" },
    ],
  });
  if (result.choiceId !== "remove") return;
  try {
    await removeRecentWorkspace(path);
    await shell.reloadLauncher();
    shell.setStatus("已从最近列表移除");
  } catch (e) {
    ElMessage.error(String(e));
  }
}

async function onBrowseWorkspace() {
  workspaceSwitchHint.value = "";
  const result = await pickAndOpenWorkspace({
    pathHint: repoInput.value.trim() || workspacePath.value,
    onPicked: (picked) => {
      repoInput.value = picked;
    },
    logSource: "config",
  });
  if (result.ok) {
    workspaceSwitchHint.value = "";
    await refreshFields();
    return;
  }
  if (result.reason === "tabs_blocked" && result.path) {
    setWorkspaceSwitchHint(result.path);
  }
}

async function closeWorkspaceAction() {
  if (!workspacePath.value) {
    ElMessage.info("当前未打开工作空间");
    return;
  }
  try {
    const ok = await shell.requestCloseWorkspace();
    if (!ok) return;
    repoInput.value = "";
    await refreshFields();
    ElMessage.success("已关闭工作空间");
  } catch (e) {
    ElMessage.error(String(e));
  }
}

async function resetFactory() {
  const n = nonHomeTabCount.value;
  if (n > 0) {
    ElMessage.warning(`请先关闭 ${n} 个工具 Tab（可保留「主页」），再恢复初始状态。`);
    return;
  }
  const result = await pnwPromptChoice({
    title: "恢复初始状态",
    message: "将清除本机 launcher 中的最近工作空间、FreeCAD 路径、壳层布局，以及浏览器内的新手指引与 Tab 缓存。\n\n"
      + "不会删除 CAD 项目磁盘上的文件或各项目下的 .phoenix 数据。\n\n"
      + "效果等同于初次安装，请慎用。是否继续？",
    choices: [
      { id: "reset", label: "恢复", variant: "danger" },
      { id: "cancel", label: "取消" },
    ],
  });
  if (result.choiceId !== "reset") return;
  shell.appendLog("恢复初始安装状态…", { source: "config", open: true });
  try {
    await shell.resetToFactorySettings();
    repoInput.value = "";
    fcInput.value = "";
    await refreshFields();
    ElMessage.success("已恢复初始状态");
    shell.appendLog("已恢复初始状态", { source: "config" });
  } catch (e) {
    const msg = String(e);
    shell.appendLog(msg, { source: "config" });
    ElMessage.error(msg);
  }
}

async function pruneRecentList() {
  const result = await pnwPromptChoice({
    title: "清理最近列表",
    message: "清理最近列表中的临时目录与无效路径？",
    choices: [
      { id: "clean", label: "清理", variant: "primary" },
      { id: "cancel", label: "取消" },
    ],
  });
  if (result.choiceId !== "clean") return;
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
    ElMessage.error(String(e));
  }
}

const navItems = () =>
  (appConfig.value?.navigation ?? []).filter(
    (n) => n.page !== "home" && n.page !== "config",
  );
</script>

<template>
  <div class="page config-page">
    <PageHeader title="配置" page-id="config">
      <template v-if="shell.configOverlayOpen.value" #actions>
        <el-button size="small" @click="shell.closeConfig()">
          关闭
        </el-button>
      </template>
    </PageHeader>

    <section class="section" data-tour-page-config-workspace>
      <label class="field-label">当前工作空间</label>
      <p class="current-path">{{ workspacePath || "（未打开）" }}</p>

      <div class="btn-row compact">
        <el-button :disabled="!workspacePath" @click="closeWorkspaceAction">关闭工作空间</el-button>
      </div>

      <label class="field-label" for="repo">工作空间根</label>
      <div class="row">
        <el-input id="repo" v-model="repoInput" spellcheck="false" />
        <el-button :loading="pickingWorkspace" title="在本机弹出选文件夹对话框" @click="onBrowseWorkspace">
          浏览…
        </el-button>
      </div>
      <el-alert
        v-if="workspaceSwitchHint"
        class="hint-alert"
        type="warning"
        :closable="false"
        show-icon
        :title="workspaceSwitchHint"
      />

      <label class="field-label" for="fc" data-tour-page-config-freecad>FreeCAD 目录</label>
      <div class="row">
        <el-input id="fc" v-model="fcInput" spellcheck="false" placeholder="可选" />
        <el-button v-if="defaultFreecadDir" title="填入本机常用安装路径" @click="fillDefaultFreecad">
          默认位置
        </el-button>
      </div>

      <div class="btn-row">
        <el-button type="primary" @click="savePrefs">保存偏好</el-button>
        <el-button @click="refreshFields">刷新</el-button>
      </div>
      <el-alert
        v-if="onboarding.workspaceOk && !onboarding.indexScanned"
        class="hint-alert"
        type="info"
        :closable="false"
        show-icon
      >
        <template #title>
          该工作空间尚未执行 CAD 索引扫描，BOM/引用功能可能不完整。
          <el-button link type="primary" @click="openCadIndex">打开 CAD 索引</el-button>
        </template>
      </el-alert>
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
        <el-slider
          id="expand-icon-size"
          v-model="uiPrefs.expandControlSizePx"
          :min="EXPAND_ICON_SIZE_MIN"
          :max="EXPAND_ICON_SIZE_MAX"
          :step="1"
          show-stops
          @change="uiPrefs.setExpandControlSizePx(uiPrefs.expandControlSizePx)"
        />
        <span class="expand-size-hint muted">{{ EXPAND_ICON_SIZE_MIN }}–{{ EXPAND_ICON_SIZE_MAX }} px</span>
      </div>
      <p class="hint">
        作用于工作区树、BOM 按宿主分组、装配结构树、链接路径修正等展开三角；写入本机浏览器 localStorage。
      </p>
      <div class="btn-row compact">
        <el-button :disabled="!onboarding.workspaceOk" @click="startShellTour(true)">重新观看界面巡游</el-button>
      </div>
    </section>

    <section class="section">
      <h2 class="section-title">Web 服务</h2>
      <p class="hint">
        {{ webRunning ? `运行中 · ${webUrl}` : "未检测到本页面对应的服务（可能已在其它端口运行）" }}
      </p>
      <div class="btn-row">
        <el-button type="danger" plain :disabled="!webRunning" @click="stopWebServer">关闭 Web 服务</el-button>
        <el-button @click="refreshWebStatus">刷新状态</el-button>
      </div>
      <p class="hint">关闭后释放 5173 端口；详细步骤见右侧运行日志。</p>
    </section>

    <section class="section">
      <h2 class="section-title">最近打开</h2>
      <p class="hint">
        仅记录你主动切换/保存的工作空间根目录（写入本机 launcher.json）。系统临时目录不会再加入列表。
      </p>
      <div class="btn-row compact">
        <el-button @click="pruneRecentList">清理临时/无效项</el-button>
      </div>
      <p class="hint">点击路径可切换；右侧 × 可单条移除（不删除磁盘目录）</p>
      <div v-if="recentEntries.length" class="recent-list">
        <div
          v-for="entry in recentEntries"
          :key="entry.path"
          class="recent-row"
          :class="{ missing: !entry.exists, current: entry.path === workspacePath }"
        >
          <el-button
            class="recent-btn"
            :type="entry.path === workspacePath ? 'primary' : 'default'"
            text
            @click="switchRecent(entry.path)"
          >
            <el-tag v-if="!entry.exists" size="small" type="warning" effect="plain" class="missing-tag">已失效</el-tag>
            {{ entry.path === workspacePath ? "● 当前 · " : "" }}{{ entry.path }}
          </el-button>
          <el-button
            type="danger"
            link
            class="recent-remove"
            title="从最近列表移除"
            @click="removeRecent(entry.path, $event)"
          >
            ×
          </el-button>
        </div>
      </div>
      <el-empty v-else description="尚无记录" :image-size="64" />
    </section>

    <section class="section">
      <h2 class="section-title">高级</h2>
      <p class="hint">
        恢复初始状态会清空本机 launcher（最近工作空间、FreeCAD、壳层布局）与浏览器缓存（新手指引、Tab 等），效果类似初次安装。
        <strong>不会删除</strong> CAD 项目目录或其中的 <code>.phoenix</code> 数据。操作前请先关闭工作空间与所有工具 Tab。
      </p>
      <div class="btn-row">
        <el-button type="danger" plain @click="resetFactory">恢复初始状态…</el-button>
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
  align-items: center;
}

.row :deep(.el-input) {
  flex: 1;
}

.btn-row {
  display: flex;
  gap: 10px;
  margin-top: 14px;
  flex-wrap: wrap;
}

.btn-row.compact {
  margin-top: 8px;
  margin-bottom: 8px;
}

.hint-alert {
  margin: 8px 0 10px;
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

.recent-row {
  display: flex;
  align-items: stretch;
  gap: 6px;
}

.recent-row.missing .recent-btn {
  opacity: 0.85;
}

.recent-btn {
  flex: 1;
  justify-content: flex-start;
  height: auto;
  padding: 8px 12px;
  white-space: normal;
  word-break: break-all;
  text-align: left;
}

.recent-btn :deep(span) {
  white-space: normal;
  word-break: break-all;
}

.missing-tag {
  margin-right: 6px;
  vertical-align: middle;
}

.recent-remove {
  flex-shrink: 0;
  font-size: 1.1rem;
  padding: 0 8px;
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

.expand-size-row :deep(.el-slider) {
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
