<script setup lang="ts">
import { computed, onActivated, onDeactivated, onMounted, reactive, ref, watch } from "vue";
import { pnwPromptChoice } from "phoenix-wing";
import PageHeader from "phoenix-wing/layout/PnwPageHeader.vue";
import PageLayout from "phoenix-wing/layout/PnwPageLayout.vue";
import WingBlock from "phoenix-wing/layout/PnwSidebarBlock.vue";
import { useAppShell } from "../../composables/useAppShell";
import { usePageSession } from "../../composables/usePageSession";
import { usePagePrimaryContribution, type PagePrimaryProgress } from "../../composables/usePagePrimaryContribution";
import { useWorkspaceRecovery } from "./useWorkspaceRecovery";

const props = defineProps<{ workbenchTabId?: string }>();
const shell = useAppShell(), activated = ref(true);
const active = computed(() => activated.value && (!props.workbenchTabId || shell.activeTabId.value === props.workbenchTabId));
onActivated(() => { activated.value = true; });
onDeactivated(() => { activated.value = false; });
const recovery = reactive(useWorkspaceRecovery(shell.workspacePath, {
  appendLog: shell.appendLog,
  confirm: async (operation, message) => (await pnwPromptChoice({ title: operation === "backup" ? "确认当前库备份" : "确认新目录隔离恢复", message, defaultChoiceId: "cancel", choices: [{ id: operation, label: operation === "backup" ? "确认备份（新目录）" : "确认恢复（不激活）", variant: "primary" }, { id: "cancel", label: "取消" }] })).choiceId === operation,
}, active));
const expanded = reactive({ backup: true, restore: true, results: true });
const backupName = ref("workspace-backup"), restoreName = ref("workspace-recovered");
watch(() => [recovery.status, recovery.outcome], () => {
  if (recovery.status === "failed" || recovery.status === "unconfirmed" || recovery.status === "expired" || recovery.outcome?.receipt.warnings.length) expanded.results = true;
});
const collapseByWorkspace = new Map<string, typeof expanded>();
watch(shell.workspacePath, (workspace, previous) => {
  collapseByWorkspace.set(previous, { ...expanded });
  Object.assign(expanded, collapseByWorkspace.get(workspace) ?? { backup: true, restore: true, results: true });
  backupName.value = "workspace-backup"; restoreName.value = "workspace-recovered";
}, { flush: "sync" });
const stateLabel = computed(() => ({ idle: "待操作", checked: "检查通过", expired: "检查失效", "backup-complete": "备份完成", "restore-complete": "隔离恢复完成（未激活）", failed: "需处理", cancelled: "已取消", unconfirmed: "结果未确认" })[recovery.status]);
const outcomeTarget = computed(() => !recovery.outcome ? "" : recovery.outcome.operation === "backup" ? recovery.outcome.receipt.backupDirectory : recovery.outcome.receipt.workspace);
const progress = computed<PagePrimaryProgress>(() => ({ label: "备份与恢复", state: recovery.busy ? "running" : recovery.status === "backup-complete" || recovery.status === "restore-complete" ? recovery.outcome?.receipt.warnings.length ? "warning" : "done" : recovery.status === "failed" ? "failed" : recovery.status === "cancelled" ? "cancelled" : recovery.status === "expired" || recovery.status === "unconfirmed" ? "warning" : "idle", detail: recovery.error || stateLabel.value, stages: ["选择 / 检查", "确认", "写入新目录"], activeStage: recovery.phase === "backing-up" || recovery.phase === "restoring" ? 2 : recovery.phase.startsWith("confirming") ? 1 : 0 }));
usePagePrimaryContribution("workspace_recovery", props.workbenchTabId, {
  title: "备份与恢复", showContext: false, summary: computed(() => recovery.error || "只手动备份或恢复到新隔离目录；不覆盖、不激活"),
  sections: [{ id: "recovery", title: "备份与恢复", progress, controls: [
    { id: "workspace", kind: "readonly", label: "当前空间", value: shell.workspacePath, mono: true },
    { id: "state", kind: "readonly", label: "状态", value: stateLabel },
    { id: "inspection", kind: "readonly", label: "检查", value: computed(() => recovery.inspection ? `${recovery.inspection.file_count} 文件 · ${recovery.inspection.total_bytes} bytes` : "尚无有效检查") },
  ], actions: [
    { id: "backup", label: "确认备份", disabled: computed(() => !recovery.canBackup), loading: computed(() => recovery.phase === "backing-up"), run: recovery.runBackup },
    { id: "inspect", label: "检查备份", disabled: computed(() => !recovery.canInspect), loading: computed(() => recovery.phase === "inspecting"), run: recovery.runInspect },
    { id: "restore", label: "确认隔离恢复", tone: "primary", disabled: computed(() => !recovery.canRestore), loading: computed(() => recovery.phase === "restoring"), run: recovery.runRestore },
    { id: "cancel", label: "取消 / 释放检查", disabled: computed(() => !recovery.busy && !recovery.inspection), run: recovery.cancel },
  ] }, { id: "help", title: "安全范围", description: "仅当前数据库原始字节与 opaque outbox，不是整工程归档。包可能含私人内容，请保留在本地受保护位置。\n新目录恢复不激活、不切换空间、不重建索引；原位重建仍禁用。检查句柄到期、服务重启或恢复尝试后需重新检查。\n写入取消或失联可能已有内容，需核对目标；不会自动重试。" }],
});
function hydrateSettings(snapshot: Record<string, unknown>): boolean {
  if (!recovery.hydrate(snapshot)) return false;
  const saved = snapshot.expanded && typeof snapshot.expanded === "object" ? snapshot.expanded as Record<string, unknown> : {};
  for (const key of ["backup", "restore", "results"] as const) expanded[key] = typeof saved[key] === "boolean" ? saved[key] : true;
  return true;
}
usePageSession(props.workbenchTabId, {
  serialize: () => ({ ...recovery.serialize(), expanded: { ...expanded } }), hydrate: hydrateSettings,
  isDirty: () => false, isBusy: () => recovery.busy, refresh: recovery.cancel,
});
onMounted(() => {
  if (!props.workbenchTabId) return;
  const settings = shell.consumeTabPageState(props.workbenchTabId);
  if (settings) hydrateSettings(settings);
});
watch(() => [recovery.backupTarget, recovery.backupDirectory, recovery.restoreTarget, ...Object.values(expanded)], () => shell.scheduleWorkbenchSave());
</script>
<template>
  <PageLayout title="备份与恢复" class="desk-page-layout workspace-recovery-page">
    <template #header><PageHeader title="备份与恢复"><template #right>
      <el-button size="small" :disabled="!recovery.canBackup" :loading="recovery.phase === 'backing-up'" @click="recovery.runBackup">确认备份</el-button>
      <el-button size="small" :disabled="!recovery.canInspect" :loading="recovery.phase === 'inspecting'" @click="recovery.runInspect">检查备份</el-button>
      <el-button size="small" type="primary" :disabled="!recovery.canRestore" :loading="recovery.phase === 'restoring'" @click="recovery.runRestore">确认隔离恢复</el-button>
      <el-button size="small" :disabled="!recovery.busy && !recovery.inspection" @click="recovery.cancel">取消</el-button>
    </template></PageHeader></template>
    <WingBlock v-model:expanded="expanded.backup" title="1. 当前库备份" variant="card" class="recovery-block">
      <template #actions><el-button size="small" :disabled="!recovery.canBackup" :loading="recovery.phase === 'backing-up'" @click="recovery.runBackup">确认备份</el-button><el-button size="small" :disabled="!recovery.busy" @click="recovery.cancel">取消</el-button></template>
      <p>当前工作空间：<code>{{ shell.workspacePath.value }}</code></p>
      <p class="muted">仅当前数据库原始全字节与 opaque outbox（含隐藏文件、空目录）；不包含工作空间 CAD 模型/缩略图目录、其他偏好或遗留数据库，不是整工程归档。包可能含私人内容，仅在本地受保护位置保存，不上传。</p>
      <div class="path-row"><label for="recovery-backup-target">新备份目录</label><input id="recovery-backup-target" v-model="recovery.backupTarget" :disabled="recovery.busy" placeholder="完整绝对路径；父目录已存在，目标尚不存在" /></div>
      <div class="path-row"><label for="recovery-backup-name">新目录名</label><input id="recovery-backup-name" v-model="backupName" :disabled="recovery.busy" /><el-button size="small" :disabled="!recovery.canInteract" @click="recovery.chooseDirectory('backup', backupName)">选择父目录…</el-button></div>
      <small>选择父目录只拼接上面的新目录名，不会把已有父目录直接作为写入目标，也不会创建目录。可以直接修改完整绝对路径。</small>
      <p v-if="recovery.backupTarget && !recovery.backupTargetValid" role="alert" class="notice error">目标必须为规范绝对路径，不能含 . / .. 路径段或控制字符。</p>
      <el-button size="small" type="primary" :disabled="!recovery.canBackup" :loading="recovery.phase === 'backing-up'" @click="recovery.runBackup">确认备份到新目录</el-button>
    </WingBlock>
    <WingBlock v-model:expanded="expanded.restore" title="2. 检查与新目录恢复" variant="card" class="recovery-block">
      <template #suffix>{{ recovery.inspection && !recovery.expired ? '检查通过' : '需检查' }}</template>
      <template #actions><el-button size="small" :disabled="!recovery.canInspect" :loading="recovery.phase === 'inspecting'" @click="recovery.runInspect">检查备份</el-button><el-button size="small" type="primary" :disabled="!recovery.canRestore" :loading="recovery.phase === 'restoring'" @click="recovery.runRestore">确认隔离恢复</el-button><el-button size="small" :disabled="!recovery.busy && !recovery.inspection" @click="recovery.cancel">释放 / 取消</el-button></template>
      <div class="path-row"><label for="recovery-inspection-directory">已有备份目录</label><input id="recovery-inspection-directory" v-model="recovery.backupDirectory" :disabled="recovery.busy" placeholder="含完整 manifest 的现有备份目录" /><el-button size="small" :disabled="!recovery.canInteract" @click="recovery.chooseDirectory('inspect')">选择已有目录…</el-button></div>
      <div class="path-row"><label for="recovery-restore-target">新隔离目录</label><input id="recovery-restore-target" v-model="recovery.restoreTarget" :disabled="recovery.busy" placeholder="完整绝对路径；父目录已存在，目标尚不存在" /></div>
      <div class="path-row"><label for="recovery-restore-name">新目录名</label><input id="recovery-restore-name" v-model="restoreName" :disabled="recovery.busy" /><el-button size="small" :disabled="!recovery.canInteract" @click="recovery.chooseDirectory('restore', restoreName)">选择父目录…</el-button></div>
      <small>先选定新目标，再手动检查备份。路径改变、标签失活、工作空间改变或检查到期后需重新检查；服务重启及一次恢复尝试也会消耗检查句柄。</small>
      <p v-if="recovery.backupDirectory && !recovery.backupDirectoryValid || recovery.restoreTarget && !recovery.restoreTargetValid" role="alert" class="notice error">备份和新目标均须为规范绝对路径，不能含 . / .. 路径段或控制字符。</p>
      <dl v-if="recovery.inspection" class="metadata"><dt>备份</dt><dd>{{ recovery.inspection.backup_directory }}</dd><dt>manifest SHA-256</dt><dd>{{ recovery.inspection.manifest_sha256 }}</dd><dt>范围</dt><dd>{{ recovery.inspection.file_count }} 文件 · {{ recovery.inspection.directory_count }} 目录 · {{ recovery.inspection.total_bytes }} bytes</dd><dt>数据库 schema</dt><dd>{{ recovery.inspection.database_schema_version ?? '未知（原样保留）' }}</dd><dt>检查到期</dt><dd>{{ recovery.inspection.expires_at }}</dd></dl>
      <p v-else class="muted">尚无有效检查。这里只手动检查，不在打开页面时读取、备份或恢复。</p>
      <div class="actions"><el-button size="small" :disabled="!recovery.canInspect" @click="recovery.runInspect">检查 / 重新检查</el-button><el-button size="small" type="primary" :disabled="!recovery.canRestore" @click="recovery.runRestore">确认恢复到新隔离目录</el-button></div>
    </WingBlock>
    <WingBlock v-model:expanded="expanded.results" title="3. 结果与说明" variant="card" class="recovery-block">
      <template #suffix>{{ stateLabel }}</template>
      <template #actions><el-button size="small" :disabled="!recovery.busy && !recovery.inspection" @click="recovery.cancel">取消 / 释放检查</el-button></template>
      <p role="status">{{ stateLabel }}</p>
      <p v-if="recovery.error" role="alert" class="notice error">{{ recovery.error }}</p>
      <p v-if="recovery.incompleteDirectory" class="notice">未完成目录：<code>{{ recovery.incompleteDirectory }}</code>；保留供核对，缺少完成 marker 不算成功。</p>
      <section v-if="recovery.outcome" class="receipt"><h3>最近已确认回执：{{ recovery.outcome.operation === 'backup' ? '备份完成' : '隔离恢复完成（未激活）' }}</h3><p><code>{{ outcomeTarget }}</code></p><p>{{ recovery.outcome.receipt.fileCount }} 文件 · {{ recovery.outcome.receipt.totalBytes }} bytes</p><p v-for="(warning, index) in recovery.outcome.receipt.warnings" :key="index" class="notice">{{ warning }}</p></section>
      <p class="muted">恢复仅写新隔离目录，不激活、不切换工作空间、不重建索引；原位重建仍禁用。manifest/hash 仅证明包自洽，不是来源签名。目标已存在时拒绝，不覆盖、不递归清理竞争目标。</p>
      <p class="muted">outbox 没有共同写锁，不承诺跨资源原子快照。发布后 warnings 仍是已确认内容，需检查警告；写入取消或网络失联则结果未确认，请核对目标，不会自动重试。legacy/WAL 受控迁移、跨 OS/崩溃恢复和安装旅程不在本页能力内。</p>
    </WingBlock>
  </PageLayout>
</template>
<style scoped>
.recovery-block { margin: 10px 0; } p, small, code { overflow-wrap: anywhere; } .muted, small { color: var(--muted); font-size: .8rem; } small { display: block; margin: 6px 0; } .path-row, .actions { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin: 10px 0; } .path-row label { font-size: .82rem; min-width: 100px; } .path-row input { flex: 1; min-width: 180px; padding: 6px; border: 1px solid var(--border); border-radius: 4px; background: var(--panel-bg); color: inherit; } .metadata { display: grid; grid-template-columns: 140px 1fr; gap: 5px 10px; font-size: .8rem; } .metadata dt { color: var(--muted); } .metadata dd { margin: 0; overflow-wrap: anywhere; } .notice { padding: 8px; white-space: pre-wrap; background: var(--phoenix-warning-bg); color: var(--phoenix-warning-text); } .notice.error { background: var(--phoenix-danger-bg); color: var(--phoenix-danger-text); } .receipt { border-top: 1px solid var(--border); margin-top: 12px; padding-top: 8px; font-size: .82rem; } .receipt h3 { font-size: .92rem; margin: 4px 0; }
</style>
