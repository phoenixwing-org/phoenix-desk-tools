<script setup lang="ts">
import { computed, onMounted, onScopeDispose, ref, shallowRef, watch } from "vue";
import AppModalOverlay from "phoenix-wing/components/PnwAppModalOverlay.vue";
import { assemblyMaintenanceApi } from "./api";
import { createAssemblyMaintenanceController, type AssemblyMaintenanceState } from "./controller";
import { jointIssueLabel, pathStatusLabel, rigidIntentLabel } from "./viewModel";
import { assemblyUpdateApi } from "./updateApi";
import { createAssemblyUpdateController, normalizeAssemblyUpdateFilePath, type AssemblyUpdateState } from "./updateController";

const props = defineProps<{ open: boolean; workspacePath: string; filePath: string }>();
const emit = defineEmits<{
  close: [];
  "busy-change": [busy: boolean];
  log: [entry: { message: string; problem: boolean }];
  published: [event: { filePath: string; outputRel: string }];
}>();
const state = shallowRef<AssemblyMaintenanceState>({ busy: false, inspection: null, error: "" });
const updateState = shallowRef<AssemblyUpdateState>({ busy: false, publishing: false, cancelling: false, unknown: false, error: "", selectedObjects: [], job: null, history: [], historyLoaded: false, historyTruncated: false, reconciliation: null });
const now = ref(Date.now()), writeBack = ref(false), confirmedClosed = ref(false), confirmedNotReopened = ref(false);
const reconcileId = ref("");
const controller = createAssemblyMaintenanceController(assemblyMaintenanceApi, {
  change: next => { state.value = next; },
  log: entry => emit("log", entry),
});
const updates = createAssemblyUpdateController(assemblyUpdateApi, {
  change: next => { updateState.value = next; }, log: entry => emit("log", entry), published: event => emit("published", event),
}, { now: () => now.value });
const job = computed(() => updateState.value.job);
const wroteSource = computed(() => { try { return job.value?.output_rel === normalizeAssemblyUpdateFilePath(props.filePath); } catch { return false; } });
watch(() => job.value?.id, () => { writeBack.value = false; confirmedClosed.value = false; confirmedNotReopened.value = false; });
const activePreview = computed(() => !!job.value && ["preparing", "ready"].includes(job.value.status));
const selectionLocked = computed(() => state.value.busy || updateState.value.busy || updateState.value.publishing || updateState.value.unknown || activePreview.value);
const canPublish = computed(() => { now.value; return updates.canPublish(); });
const combinedBusy = computed(() => state.value.busy || updateState.value.busy || updateState.value.publishing);
watch(combinedBusy, busy => emit("busy-change", busy), { flush: "sync" });
const phaseLabel = computed(() => ({ capturing: "冻结保存内容与完整依赖", mirroring: "创建私有暂存镜像", native_update: "原生定向更新与保持检查", native_reopen: "独立进程保存重开核验", ready: "预览已就绪", publishing: "发布中；关闭不会取消发布", completed: "本轮已结束" })[job.value?.phase ?? "capturing"]);
watch(() => [props.open, props.workspacePath, props.filePath] as const, ([open, workspacePath, filePath]) => {
  writeBack.value = false; confirmedClosed.value = false; confirmedNotReopened.value = false;
  reconcileId.value = "";
  updates.setContext(open ? { workspacePath, filePath } : null);
  void controller.setContext(open ? { workspacePath, filePath } : null);
}, { immediate: true });
let tick: ReturnType<typeof setInterval> | undefined;
onMounted(() => { tick = setInterval(() => { now.value = Date.now(); }, 1000); });
onScopeDispose(() => { if (tick) clearInterval(tick); controller.close(); updates.close(); });
function close() { controller.close(); updates.close(); emit("close"); }
function select(name: string, checked: boolean) {
  updates.select(checked ? [...updateState.value.selectedObjects, name] : updateState.value.selectedObjects.filter(value => value !== name));
}
function refresh() { if (selectionLocked.value) return; updates.select([]); void controller.refresh(); }
</script>

<template>
  <AppModalOverlay :open="open" aria-label="装配检查与修正" @close="close">
    <div class="assembly-maintenance">
      <header class="assembly-head">
        <h2>装配检查与修正</h2>
        <div class="assembly-actions">
          <button type="button" :disabled="selectionLocked" @click="refresh">{{ state.busy ? '检查中…' : '重新检查' }}</button>
          <button type="button" :disabled="selectionLocked || !updateState.selectedObjects.length" @click="updates.start">生成更新预览</button>
          <button type="button" :disabled="!canPublish" @click="updates.publish('verified_copy')">生成验证副本（默认）</button>
          <button type="button" :disabled="!canPublish || !writeBack || !confirmedClosed || !confirmedNotReopened" @click="updates.publish('replace_source', confirmedClosed, confirmedNotReopened)">写回原文件</button>
          <button type="button" @click="close">关闭</button>
        </div>
      </header>
      <p class="assembly-file">{{ filePath }}</p>
      <p class="assembly-note">重新检查仅只读磁盘中的当前文件，不读取目标文件内容，不打开 FreeCAD、不重算或保存。未保存的编辑不包含在本次检查中。</p>
      <p class="assembly-note">请明确勾选要更新的实例。生成预览会冻结完整依赖并启动独立自有 FreeCAD，只更新暂存副本；未经独立重开验证和明确发布，不改写原件。</p>
      <p v-if="updateState.error" role="alert" class="assembly-error">{{ updateState.error }}</p>
      <section v-if="job || updateState.unknown" class="assembly-section" aria-label="更新预览与发布">
        <p v-if="updateState.publishing" role="status">发布中。关闭对话框不会取消或重放发布；结果未确认时只核对记录。</p>
        <p v-else-if="job?.status === 'preparing'" role="status">正在{{ phaseLabel }}；每秒读取一次进度。</p>
        <p v-if="updateState.unknown" role="alert" class="assembly-error">结果未知：禁止重试或再次发布，只能核对记录。历史记录不会恢复写入权限。</p>
        <button v-if="activePreview && !updateState.publishing && !updateState.unknown" type="button" :disabled="updateState.cancelling" @click="updates.cancel">{{ updateState.cancelling ? '取消中…' : '取消自有预览' }}</button>
        <button v-if="updateState.unknown" type="button" :disabled="updateState.busy" @click="updates.reconcile()">核对记录</button>
        <template v-if="job?.preview">
          <h3>实际暂存差异 · 新增 {{ job.preview.added.length }} · 移除 {{ job.preview.removed.length }}</h3>
          <p class="assembly-note">存续实例 {{ job.preview.preserved_instance_count }}；保留关节 {{ job.preview.preserved_joint_count }}。已独立重开核验 Rigid、位姿、关节实际 Frame 与依赖字节保持。</p>
          <div class="assembly-table-wrap"><table><thead><tr><th>变化</th><th>对象 / 内部名</th><th>所属实例</th></tr></thead><tbody>
            <tr v-for="row in job.preview.added" :key="`added:${row.object_name}`"><td>新增</td><td>{{ row.label || row.object_name }}<small>{{ row.object_name }} · {{ row.type_id }}</small></td><td>{{ row.parent_object }}</td></tr>
            <tr v-for="row in job.preview.removed" :key="`removed:${row.object_name}`"><td>移除</td><td>{{ row.label || row.object_name }}<small>{{ row.object_name }} · {{ row.type_id }}</small></td><td>{{ row.parent_object }}</td></tr>
          </tbody></table></div>
        </template>
        <p v-if="job?.status === 'ready'" class="assembly-note">暂存预览尚未发布，最多有效 10 分钟；截止 {{ job.expires_at ? new Date(job.expires_at).toLocaleString() : '未知' }}。{{ canPublish ? '请核对实际增删后选择发布方式。' : '当前不能发布；过期预览不能重放。' }}</p>
        <p v-if="job?.status === 'unchanged'" class="assembly-note">本轮没有实际增删差异；不宣称已修复或已同步，不发布原件。</p>
        <p v-if="job && ['blocked', 'failed', 'cancelled'].includes(job.status)" class="assembly-note">{{ job.status === 'cancelled' ? '自有预览已取消。' : '安全验证未通过，未获发布许可；详细原因请核对本地记录。' }}</p>
        <p v-if="job?.status === 'published'" class="assembly-note">{{ wroteSource ? '已发布当前宿主更新' : '已生成验证副本，原宿主未改写' }}：{{ job.output_rel }}</p>
        <label v-if="job?.status === 'ready'" class="assembly-choice"><input v-model="writeBack" type="checkbox" :disabled="!canPublish">显式选择写回原文件（默认仅生成验证副本）</label>
        <div v-if="writeBack && job?.status === 'ready'" class="assembly-confirmations">
          <label><input v-model="confirmedClosed" type="checkbox" :disabled="!canPublish">我已保存相关文档并退出 FreeCAD（磁盘写回不附着当前 GUI）</label>
          <label><input v-model="confirmedNotReopened" type="checkbox" :disabled="!canPublish">发布期间不会重新打开这些文档</label>
          <p class="assembly-note">当前写回模式检测到任何 FreeCAD 进程都会阻止发布；无需退出时可先生成验证副本。占用检查只是当前主机的进程快照，不是万能锁。写回会保存持久备份并复核源/依赖；不宣称跨文件原子事务。</p>
        </div>
        <p v-if="job" class="assembly-note">任务编号：{{ job.id }}。关闭只取消尚未发布的自有预览，不取消已发布或发布中的任务。</p>
      </section>
      <section class="assembly-section" aria-label="更新历史与只读核对">
        <h3>更新历史与只读核对</h3>
        <p class="assembly-note">关闭或重载后仍可查询当前工作空间的有限记录；这些记录不恢复旧预览或发布权限。</p>
        <div class="assembly-record-actions">
          <button type="button" :disabled="updateState.busy || updateState.publishing" @click="updates.loadHistory">查看有限历史（只读）</button>
          <label>任务编号 <input v-model="reconcileId" type="text" aria-label="只读核对的任务 UUID" maxlength="36" autocomplete="off" spellcheck="false" :disabled="updateState.busy || updateState.publishing" placeholder="完整任务 UUID"></label>
          <button type="button" :disabled="updateState.busy || updateState.publishing || !reconcileId.trim()" @click="updates.reconcile(reconcileId)">按编号只读核对</button>
        </div>
        <p v-if="updateState.historyTruncated" role="status" class="assembly-note">历史已截断，不是完整列表，也不保证包含最新任务。未找到记录不证明从未执行；请用已知任务编号核对。</p>
        <p v-if="updateState.historyLoaded && !updateState.history.length" class="assembly-note">本批有限记录中未找到当前文件的可识别记录；这不证明任务不存在或从未写入。</p>
        <p class="assembly-note">若开始请求的回执丢失且列表未包含该任务，可从当前工作空间本地 .phoenix/assembly-maintenance/ 下的 operation.json 核对当前文件对应的任务 UUID，再在此输入；不要重复生成或发布来试探结果。</p>
        <ul v-if="updateState.history.length" class="assembly-issues"><li v-for="record in updateState.history" :key="record.id">{{ record.id }} · {{ record.operation?.file_path || '文件记录未知' }} · {{ record.operation?.status || '记录状态未知' }} <button type="button" :disabled="updateState.busy || updateState.publishing" @click="updates.reconcile(record.id)">只读核对此记录</button></li></ul>
        <p v-if="updateState.reconciliation" class="assembly-note">只读观察：发布 {{ updateState.reconciliation.observed_publication }}；回执 {{ updateState.reconciliation.receipt_state }}；源 {{ updateState.reconciliation.source_state }}；目标 {{ updateState.reconciliation.target_state }}；备份 {{ updateState.reconciliation.backup_state }}；依赖 {{ updateState.reconciliation.dependencies_state }}。{{ updateState.reconciliation.requires_manual_review ? '需要人工核对。' : '' }}观察不证明从未写入，不恢复发布权限。</p>
      </section>
      <p v-if="state.error" role="alert" class="assembly-error">{{ state.error }}。详细原因已写入底部运行日志。</p>
      <p v-else-if="state.busy" role="status" class="assembly-note">正在读取已保存的子装配链接及关节端点…</p>
      <template v-else-if="state.inspection">
        <section class="assembly-section">
          <h3>子装配链接 · {{ state.inspection.links.length }}</h3>
          <p class="assembly-note">Rigid 是已保存的刚性/柔性意图，不是同步状态；路径存在也不表示子装配已同步。当前同步状态：未验证。</p>
          <div v-if="state.inspection.links.length" class="assembly-table-wrap">
            <table><thead><tr><th>明确选择 / 子装配内部名</th><th>Rigid 意图</th><th>目标及路径观察</th></tr></thead>
              <tbody><tr v-for="link in state.inspection.links" :key="link.object_name">
                <td><label><input type="checkbox" :aria-label="`选择实例 ${link.object_name}`" :checked="updateState.selectedObjects.includes(link.object_name)" :disabled="selectionLocked" @change="select(link.object_name, ($event.target as HTMLInputElement).checked)">{{ link.label || link.object_name }}</label><small>{{ link.object_name }}</small></td>
                <td>{{ rigidIntentLabel(link.rigid) }}</td>
                <td><span :class="{ 'assembly-error': link.path_status === 'missing' }">{{ pathStatusLabel(link.path_status) }}</span><small>{{ link.target_rel || link.target_file || '未保存目标路径' }} · {{ link.target_object_name || '目标对象未知' }}</small></td>
              </tr></tbody>
            </table>
          </div>
          <p v-else class="assembly-note">当前文件未读到 AssemblyLink。此清单不是所有 App::Link 的完整检查，也不代表装配健康。</p>
        </section>
        <section class="assembly-section">
          <h3>关节端点待核对 · {{ state.inspection.joint_issues.length }}</h3>
          <p class="assembly-note">不自动删除、重建或猜测重连 Joint；更新装配时必须保留已有约束与放置。</p>
          <ul v-if="state.inspection.joint_issues.length" class="assembly-issues"><li v-for="issue in state.inspection.joint_issues" :key="`${issue.object_name}:${issue.reference}`">{{ issue.label || issue.object_name }}（{{ issue.object_name }}）· {{ issue.reference }}：{{ jointIssueLabel(issue) }}</li></ul>
          <p v-else class="assembly-note">未发现已保存的空端点或缺失本地对象；不代表关节求解正常或子装配已更新。</p>
        </section>
        <p v-if="state.inspection.warnings.length" class="assembly-note">有 {{ state.inspection.warnings.length }} 条检查范围提示，详见底部运行日志。</p>
        <p class="assembly-note">上方保存态检查只读，不修改 CAD、数据库索引或 BOM。更新预览是独立步骤；局部刷新不等于完整递归 BOM 已重建。</p>
      </template>
    </div>
  </AppModalOverlay>
</template>

<style scoped>
.assembly-maintenance { display: grid; gap: 12px; padding: 16px; min-width: 0; }
.assembly-head, .assembly-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.assembly-head { justify-content: space-between; position: sticky; top: -16px; z-index: 1; margin: -16px -16px 0; padding: 16px; border-bottom: 1px solid var(--border, #cbd5e1); background: var(--pnw-workbench-surface, #fff); }
.assembly-actions { margin-left: auto; }
h2, h3, p { margin: 0; }
h2 { font-size: 1rem; } h3 { font-size: .9rem; }
button { border: 1px solid var(--border, #cbd5e1); border-radius: 5px; background: var(--pnw-workbench-surface, #fff); color: inherit; padding: 6px 10px; cursor: pointer; }
button:disabled { opacity: .55; cursor: not-allowed; }
.assembly-file { font-family: monospace; overflow-wrap: anywhere; font-size: .8rem; }
.assembly-note, .assembly-issues { font-size: .8rem; line-height: 1.5; overflow-wrap: anywhere; }
.assembly-note, small { color: var(--muted, #64748b); }
.assembly-error { color: var(--el-color-danger, #b91c1c); font-size: .8rem; overflow-wrap: anywhere; }
.assembly-section { display: grid; gap: 8px; border-top: 1px solid var(--border, #cbd5e1); padding-top: 12px; }
.assembly-table-wrap { overflow: auto; }
table { border-collapse: collapse; width: 100%; font-size: .8rem; }
th, td { border-bottom: 1px solid var(--border, #cbd5e1); padding: 8px 6px; text-align: left; vertical-align: top; overflow-wrap: anywhere; }
th:first-child { width: 30%; } th:nth-child(2) { width: 14%; }
small { display: block; font-size: .72rem; margin-top: 3px; }
.assembly-issues { padding-left: 20px; margin: 0; }
.assembly-choice, .assembly-confirmations { font-size: .8rem; line-height: 1.6; }
.assembly-record-actions { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; font-size: .8rem; }
.assembly-record-actions input { max-width: 100%; min-width: 0; width: 34ch; padding: 5px; font-family: monospace; }
.assembly-confirmations { display: grid; gap: 8px; border: 1px solid var(--border, #cbd5e1); padding: 10px; border-radius: 5px; }
input[type="checkbox"] { margin-right: 6px; }
@media (max-width: 480px) { .assembly-maintenance { padding: 12px; } .assembly-head { top: -12px; margin: -12px -12px 0; padding: 12px; } .assembly-actions { margin-left: 0; } }
</style>
