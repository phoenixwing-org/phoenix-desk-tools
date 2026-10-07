<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from "vue";
import PageHeader from "phoenix-wing/layout/PnwPageHeader.vue";
import PageLayout from "phoenix-wing/layout/PnwPageLayout.vue";
import PageMainBlock from "phoenix-wing/layout/PnwPageMainBlock.vue";
import SidebarBlock from "phoenix-wing/layout/PnwSidebarBlock.vue";
import { pnwPromptChoice } from "phoenix-wing";
import { cancelCadIndexScan, fetchCadIndexDiagnostics, fetchCadIndexScan, previewCadIndexReset, resetCadIndex, startCadIndexScan, type CadIndexDiagnostics, type CadIndexScanJob } from "../api";
import { useAppShell } from "../composables/useAppShell";
import { usePageSession } from "../composables/usePageSession";
import { usePagePrimaryContribution } from "../composables/usePagePrimaryContribution";
import { cadIndexProgress } from "../models/cadIndexProgress";

const props = defineProps<{ workbenchTabId?: string }>();
const shell = useAppShell();
const data = ref<CadIndexDiagnostics | null>(null);
const loading = ref(false);
const error = ref("");
const job = ref<CadIndexScanJob | null>(null);
const confirming = ref(false);
const cleanupMessage = ref("");
const scanning = computed(() => confirming.value || job.value?.state === "running");
const canScan = computed(() => data.value?.scanSupported === true && !scanning.value && !loading.value);
const scanStateLabel = computed(() => {
  if (!job.value) return "尚未开始";
  if (job.value.state !== "running") return { done: "已完成", failed: "失败（未提交）", cancelled: "已取消" }[job.value.state];
  return { reading: "正在读取", checking: "核对快照", committing: "正在提交" }[job.value.phase] || "正在扫描";
});
const scanDescription = computed(() => job.value?.state === "running"
  ? "每 10 个文件更新进度；完整扫描成功后才提交索引。"
  : cleanupMessage.value || job.value?.message || "手动更新完整工作空间索引，不修改 FCStd 文件。");
let pollTimer: ReturnType<typeof setTimeout> | undefined;
let scanEpoch = 0;
let requestId = 0;
const stateLabels = { missing: "尚未建立", incompatible: "Schema 不兼容", unreadable: "读取失败", empty: "尚未完成扫描", attention: "需要检查", ready: "可读取" };
const stateLabel = computed(() => data.value ? stateLabels[data.value.state] : "尚未读取");
const latestScanLabel = computed(() => {
  const status = data.value?.latestScan?.status;
  if (!status) return "暂无";
  const labels: Record<string, string> = { done: "已完成", cleared: "已清理，待重建", running: "进行中", failed: "失败", cancelled: "已取消" };
  return labels[status] || status;
});
const lastScanTime = computed(() => {
  const value = data.value?.lastScanAt;
  if (!value) return "暂无";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN", { hour12: false });
});
async function refresh() {
  const id = ++requestId;
  data.value = null; error.value = ""; loading.value = true;
  const workspace = shell.workspacePath.value;
  try {
    if (!workspace) throw new Error("请先打开工作空间");
    const next = await fetchCadIndexDiagnostics(workspace);
    if (id === requestId) data.value = next;
  } catch (e) {
    if (id === requestId) error.value = String(e);
  } finally { if (id === requestId) loading.value = false; }
}
function open(pageId: string) { shell.openTab({ pageId }); }
usePageSession(props.workbenchTabId, {
  serialize: () => ({}), hydrate: () => false, isDirty: () => false,
  isBusy: () => scanning.value || loading.value, refresh,
});
async function pollScan(workspace: string, id: string, epoch: number) {
  try {
    const next = await fetchCadIndexScan(workspace, id);
    if (epoch !== scanEpoch) return;
    job.value = next;
    if (next.state === "running") pollTimer = setTimeout(() => { void pollScan(workspace, id, epoch); }, 500);
    else await refresh();
  } catch (e) {
    if (epoch !== scanEpoch) return;
    error.value = `读取扫描状态失败：${String(e)}。可以取消后重试。`;
    if (job.value?.state === "running") pollTimer = setTimeout(() => { void pollScan(workspace, id, epoch); }, 1500);
  }
}
async function scan() {
  if (!canScan.value) return;
  const workspace = shell.workspacePath.value;
  const epoch = ++scanEpoch;
  confirming.value = true;
  try {
    const answer = await pnwPromptChoice({ title: "更新 CAD 索引", message: `扫描整个工作空间：${workspace}。更新文件、引用和基础 BOM 索引，不修改 FCStd；人工零件字段与关联保留。解析失败或范围不完整时保留旧索引。`,
      choices: [{ id: "scan", label: "开始扫描", variant: "primary" }, { id: "cancel", label: "取消" }] });
    if (answer.choiceId !== "scan" || workspace !== shell.workspacePath.value || epoch !== scanEpoch) return;
    error.value = ""; cleanupMessage.value = "";
    const started = await startCadIndexScan(workspace);
    if (epoch !== scanEpoch) { if (started.state === "running") await cancelCadIndexScan(workspace, started.id); return; }
    job.value = started;
    await pollScan(workspace, started.id, epoch);
  } catch (e) { if (epoch === scanEpoch) error.value = String(e); }
  finally { if (epoch === scanEpoch) confirming.value = false; }
}
async function clearIndex() {
  if (!canScan.value) return;
  const workspace = shell.workspacePath.value;
  const epoch = ++scanEpoch;
  confirming.value = true;
  try {
    const preview = await previewCadIndexReset(workspace);
    const answer = await pnwPromptChoice({ title: "清理旧 CAD 索引", defaultChoiceId: "cancel",
      message: `将清空 ${preview.files} 个 CAD 文件索引、${preview.references} 条引用、${preview.bomLines} 行基础 BOM 和扫描历史。${preview.fileLinks} 条文件关联也会删除（包括人工关联），重新扫描会按文件属性重新关联。\n\n保留磁盘文件、零件资料/备注、工作集、偏好和审计日志。清理前自动保存数据库备份。是否继续？`,
      choices: [{ id: "clear", label: "确认清理", variant: "danger" }, { id: "cancel", label: "取消" }] });
    if (answer.choiceId !== "clear" || workspace !== shell.workspacePath.value || epoch !== scanEpoch) return;
    const result = await resetCadIndex(workspace, preview);
    if (epoch !== scanEpoch) return;
    job.value = null; error.value = "";
    cleanupMessage.value = `${result.message}备份：${result.backup}`;
    await refresh();
  } catch (e) { if (epoch === scanEpoch) error.value = String(e); }
  finally { if (epoch === scanEpoch) confirming.value = false; }
}
async function cancel() {
  if (!job.value || job.value.state !== "running") return;
  try { await cancelCadIndexScan(job.value.workspace, job.value.id); }
  catch (e) { error.value = String(e); }
}
function invalidateScan() {
  scanEpoch++; clearTimeout(pollTimer); confirming.value = false; cleanupMessage.value = "";
  const previous = job.value; job.value = null;
  if (previous?.state === "running") void cancelCadIndexScan(previous.workspace, previous.id).catch(() => {});
}
usePagePrimaryContribution("cad_index", props.workbenchTabId, {
  showContext: false,
  summary: computed(() => error.value || stateLabel.value),
  sections: [{ id: "scope", title: "索引维护", progress: computed(() => cadIndexProgress(job.value)), description: scanDescription, readonlyLayout: "properties", controls: [
    { id: "workspace", kind: "readonly", label: "工作空间", value: shell.workspacePath },
    { id: "owner", kind: "readonly", label: "扫描核心", value: "Wing 共享索引 · 完整工作空间" },
    { id: "scan-state", kind: "readonly", label: "本次扫描", value: scanStateLabel },
    { id: "scan-progress", kind: "readonly", label: "已处理文件", value: computed(() => job.value ? `${job.value.scanned} 个` : "—") },
    { id: "database", kind: "readonly", label: "数据库位置", value: ".phoenix/phoenix-workspace.sqlite" },
    { id: "schema", kind: "readonly", label: "Schema 实际 / 预期", value: computed(() => data.value ? `${data.value.schemaVersion ?? "未知"} / ${data.value.expectedSchemaVersion}` : "—") },
    { id: "entries", kind: "readonly", label: "条目 / 缺失", value: computed(() => data.value ? `${data.value.totalEntries} / ${data.value.missingEntries}` : "—") },
    { id: "last-scan", kind: "readonly", label: "最后成功扫描", value: lastScanTime },
    { id: "latest-state", kind: "readonly", label: "最近扫描状态", value: latestScanLabel },
    { id: "latest-scope", kind: "readonly", label: "最近扫描范围", value: computed(() => data.value?.latestScan?.root || "暂无") },
  ], actions: [{ id: "scan", label: "更新索引", disabled: computed(() => !canScan.value), run: scan },
    { id: "cancel", label: "取消", disabled: computed(() => job.value?.state !== "running"), run: cancel },
    { id: "clear", label: "清理旧索引", disabled: computed(() => !canScan.value), run: clearIndex },
    { id: "refresh", label: "刷新诊断", loading, run: refresh }] },
  { id: "tools", title: "相关工具", actions: [
    { id: "catalog", label: "零件目录", run: () => open("part_catalog") },
    { id: "repair", label: "错误修正", run: () => open("xlink_fix") },
    { id: "batch", label: "批量工具", run: () => open("cad_batch_tools") },
  ] }],
});
watch(shell.workspacePath, () => { invalidateScan(); void refresh(); }, { immediate: true });
onUnmounted(() => { requestId++; invalidateScan(); });
</script>

<template>
  <PageLayout title="CAD 索引" class="desk-page-layout" :body-inset="false">
    <template #header>
      <PageHeader title="CAD 索引">
        <template #right>
          <el-button v-if="job?.state === 'running'" size="small" @click="cancel">取消</el-button>
          <el-button size="small" type="primary" :disabled="!canScan" :loading="scanning" @click="scan">更新索引</el-button>
          <el-button size="small" :disabled="!canScan" @click="clearIndex">清理旧索引</el-button>
          <el-button size="small" :loading="loading" @click="refresh">刷新诊断</el-button>
        </template>
      </PageHeader>
    </template>
    <PageMainBlock class="cad-index-page">
      <section class="index-intro" aria-labelledby="index-purpose">
        <h2 id="index-purpose">让零件与引用信息保持可查询</h2>
        <p>CAD 索引读取当前工作空间中的 FCStd 文件，整理文件属性、引用关系与基础 BOM，供零件目录和相关工具查询。更新索引只写入本地数据库，不修改 CAD 文件。</p>
        <p class="index-layout-hint">左侧查看工作空间、扫描进度与索引属性；页头右侧执行维护操作。下方按使用场景说明操作步骤。</p>
      </section>
      <el-alert v-if="data && !data.scanSupported" title="当前 Wing 尚未提供共享索引接口，请使用本地 Wing 开发模式。正式包发布后再升级依赖。" type="info" :closable="false" />
      <p v-if="job?.result">已索引 {{ job.result.files }} 个文件 · {{ job.result.references }} 条引用 · {{ job.result.bomLines }} 行基础 BOM</p>
      <el-alert v-if="error" :title="error" type="error" :closable="false" />
      <p v-else-if="loading" role="status">正在读取索引状态…</p>
      <el-alert v-else-if="data" :title="stateLabel" :description="data.message" :type="data.state === 'ready' ? 'success' : 'warning'" :closable="false" />
      <div class="index-guide-block">
      <SidebarBlock title="如何维护" variant="card">
        <p>日常只需检查、更新、查询；不必先清理旧索引。</p>
        <ol class="maintenance-steps" role="list">
          <li>
            <span class="step-number" aria-hidden="true">1</span>
            <div><h3>先看当前状态</h3><p>核对左侧工作空间、条目数与最近扫描时间。「刷新诊断」只读取数据库状态，不扫描磁盘；“可读取”不代表文件已同步。</p></div>
            <el-button size="small" :loading="loading" @click="refresh">刷新诊断</el-button>
          </li>
          <li>
            <span class="step-number" aria-hidden="true">2</span>
            <div><h3>新增、改名或删除文件后更新</h3><p>点击「更新索引」，确认后扫描完整工作空间。左侧每 10 个文件更新进度，全部成功后提交；失败或取消保留原索引。</p></div>
            <el-button size="small" type="primary" plain :disabled="!canScan" :loading="scanning" @click="scan">更新索引</el-button>
          </li>
          <li>
            <span class="step-number" aria-hidden="true">3</span>
            <div><h3>完成后查看零件</h3><p>打开「零件目录」查询零件与关联文件。只需更新单个文件引用时，从文件详情的「引用」页局部刷新，无需整库扫描。</p></div>
            <el-button size="small" @click="open('part_catalog')">零件目录</el-button>
          </li>
        </ol>
      </SidebarBlock>
      </div>
      <div class="index-guide-block">
      <SidebarBlock title="遇到问题时" variant="card">
        <div class="recovery-row">
          <div><h3>旧索引路径重复，或决定丢弃旧索引重建</h3><p>点击「清理旧索引」，核对影响范围并确认。清理前自动备份数据库；成功后再手动「更新索引」。</p><p class="cleanup-warning">清理会删除文件索引、全部文件关联（含人工关联）、引用、基础 BOM 和扫描历史。保留磁盘文件、零件资料与备注、工作集、偏好及审计记录。</p></div>
          <el-button size="small" :disabled="!canScan" @click="clearIndex">清理旧索引</el-button>
        </div>
        <div class="recovery-row">
          <div><h3>文件本身的链接路径或属性异常</h3><p>更新索引不会修正源文件。请到「错误修正」先分析、检查候选结果，再确认写回。</p></div>
          <el-button size="small" @click="open('xlink_fix')">错误修正</el-button>
        </div>
      </SidebarBlock>
      </div>
      <div class="index-guide-block index-boundaries">
      <SidebarBlock title="范围与注意事项" variant="card">
        <ul>
          <li><strong>共享算法：</strong>与 KT Auto CAD 共用 Wing 索引核心，无需同时启动 VS Code。另一宿主正在写入或扫描批次已过期时，等待其完成后重新扫描。</li>
          <li><strong>完整范围：</strong>不受批量工具的搜索目录限制，最多处理 5000 个 FCStd；跳过 .git、.phoenix、node_modules、.venv、__pycache__，这些目录中已有记录保持不变。</li>
          <li><strong>安全提交：</strong>超限、符号链接、解析失败或文件在扫描中发生变化，均不提交新索引。普通更新保留人工零件字段与关联；显式清理不保留文件关联。</li>
          <li><strong>结果含义：</strong>基础 BOM 来自 XML 引用关系，不代表几何实例或制造数量。备份为整库快照，恢复前须停止所有写库宿主并核对恢复范围。</li>
        </ul>
      </SidebarBlock>
      </div>
    </PageMainBlock>
  </PageLayout>
</template>

<style scoped>
@import "./page-shared.css";
.cad-index-page { display: flex; flex-direction: column; gap: 20px; }
.cad-index-page p, .cad-index-page li { color: var(--muted); line-height: 1.65; font-size: 0.85rem; }
.cad-index-page p { margin: 6px 0 0; }
.cad-index-page h2 { margin: 0 0 8px; font-size: 1rem; color: var(--text); }
.cad-index-page h3 { margin: 0; font-size: 0.88rem; font-weight: 600; color: var(--text); }
.index-intro .index-layout-hint { font-size: 0.78rem; }
.maintenance-steps { margin: 12px 0 0; padding: 0; list-style: none; }
.maintenance-steps > li { display: grid; grid-template-columns: 26px minmax(0, 1fr) auto; align-items: start; gap: 12px; padding: 16px 0; border-top: 1px solid var(--border); }
.step-number { display: grid; place-items: center; width: 26px; height: 26px; border-radius: 50%; background: var(--panel-head-bg); color: var(--text); font-weight: 600; }
.recovery-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: start; gap: 12px; padding: 14px 0; border-top: 1px solid var(--border); }
.cad-index-page .cleanup-warning { color: var(--phoenix-warning-text, var(--el-color-warning-dark-2)); font-size: 0.78rem; }
.index-boundaries ul { margin: 0; padding-left: 20px; }
.index-boundaries li + li { margin-top: 8px; }
.cad-index-page strong { color: var(--text); }
.index-guide-block { min-width: 0; }
.recovery-row:first-child { border-top: 0; padding-top: 0; }
@media (max-width: 760px) {
  .maintenance-steps > li { grid-template-columns: 26px minmax(0, 1fr); }
  .maintenance-steps .el-button { grid-column: 2; justify-self: start; }
  .recovery-row { grid-template-columns: minmax(0, 1fr); }
  .recovery-row .el-button { justify-self: start; }
}
</style>
