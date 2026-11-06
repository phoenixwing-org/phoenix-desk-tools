<script setup lang="ts">
import { computed } from "vue";
import AppModalOverlay from "phoenix-wing/components/PnwAppModalOverlay.vue";
import type { FreecadMcpManager } from "./useFreecadMcpManager";
const props = defineProps<{ manager: FreecadMcpManager }>();
const m = props.manager;
const connectionLabel = computed(() => {
  const item = m.connection.value;
  if (!item) return m.dirty.value ? "设置已修改，保存后重新检查" : "未检查";
  if (item.state === "ready" && item.mcp_verified && item.phase === "mcp") return "上次 MCP 检查通过（非持续连接）";
  if (item.phase === "bridge") return "仅 JSON 桥接已响应，MCP 未验证";
  return ({ not_checked: "未检查", blocked: "尚不可用", failed: "检查失败", ready: "尚未验证" })[item.state];
});
</script>

<template>
  <AppModalOverlay :open="m.opened.value" aria-label="FreeCAD MCP 安装与连接" :close-on-backdrop="!m.writing.value" @close="m.close">
    <div class="mcp-dialog">
      <header class="mcp-head"><h2>FreeCAD · MCP 安装与连接</h2><div class="mcp-actions"><el-button :disabled="m.busy.value || m.configurationLocked.value || !m.dirty.value" @click="m.save">保存设置</el-button><el-button :disabled="m.busy.value || !m.dirty.value" @click="m.resetDraft">恢复已保存</el-button><el-button :loading="m.operation.value === 'inspect'" :disabled="m.busy.value || m.dirty.value" @click="m.refresh">重新检测</el-button><el-button :disabled="m.writing.value" @click="m.close">关闭</el-button></div></header>
      <p class="mcp-hint">Tool 直接连接本机 FreeCAD，不需要 AI 或聊天登录。检测不会下载、安装或启动程序。</p>
      <div class="mcp-status" role="status">
        <div><span>FreeCAD 路径</span><strong>{{ m.status.value?.freecad.state === 'available' ? '可用' : m.status.value ? '不可用' : '未检测' }}</strong></div>
        <div><span>插件文件</span><strong>{{ m.summary.value.split(' · ')[0] }}</strong></div>
        <div><span>运行连接</span><strong>{{ connectionLabel }}</strong></div>
        <div><span>批处理能力</span><strong>尚未开放</strong></div>
      </div>
      <p v-if="m.status.value?.freecad.reason" class="mcp-hint">{{ m.status.value.freecad.reason }}</p>
      <p v-if="m.configurationLocked.value" class="mcp-hint">自有 worker 仍由 manager 负责或结果待核对：请先明确停止并确认退出，再修改配置、安装插件或检查其他实例。</p>
      <fieldset :disabled="m.busy.value || m.configurationLocked.value || !m.status.value" class="mcp-fields">
        <legend>安装位置与连接方式</legend>
        <label class="mcp-field"><span>FreeCAD 用户 Mod 目录</span><input v-model="m.draft.mod_directory" spellcheck="false" placeholder="请在 FreeCAD 中核对用户 Mod 目录" /></label>
        <label class="mcp-check"><input v-model="m.draft.mod_directory_confirmed" type="checkbox" />我已在 FreeCAD 中核对这个 Mod 目录（仅用户确认，不等于运行验证）</label>
        <label class="mcp-radio"><input v-model="m.draft.mode" type="radio" value="owned_batch" />工具专用批处理实例（开发候选；批次未开放）</label>
        <label class="mcp-radio"><input v-model="m.draft.mode" type="radio" value="existing" />明确复用现有实例</label>
        <label v-if="m.draft.mode === 'existing'" class="mcp-field mcp-port"><span>本机 JSON 桥接端口</span><input v-model.number="m.draft.existing_port" type="number" min="1024" max="65535" /></label>
        <p class="mcp-hint">{{ m.draft.mode === 'owned_batch' ? 'Tools 已提供类型化 worker 生命周期；这里只开放显式连接测试，批量队列接线尚未完成，不自动启动。视觉与支持范围仍待验。' : '只检查明确选定的 127.0.0.1 端口，不发现、猜测或接管其他实例。JSON 桥接并非正式 MCP stdio。' }}</p>
        <p v-if="m.draft.mode === 'existing'" class="mcp-hint">Desk 独立保存此端口，不会自动同步 FreeCAD 共享配置的 preferred_port；请人工核对实际运行端口一致。默认值不代表已发现实例。</p>
      </fieldset>
      <section class="mcp-section">
        <header><h3>插件检测与安装 / 更新</h3><el-button :disabled="!m.canPreview.value" :loading="m.operation.value === 'preview'" @click="m.preview">预览安装计划</el-button></header>
        <p class="mcp-hint">{{ m.status.value?.mod_directory.reason || '尚未检测安装目录。' }}</p>
        <p class="mcp-hint">{{ m.status.value?.installation.reason || '尚未检测插件文件。' }}</p>
        <p class="mcp-hint">本地固定资源 {{ m.status.value?.resource.version || '—' }}：{{ m.status.value?.resource.reason || '尚未检测' }}</p>
        <p class="mcp-hint">摘要核验不代表已发布；本地联调候选不因此成为正式发行版。</p>
        <div v-if="m.plan.value" class="mcp-plan">
          <p>{{ m.plan.value.reason }}</p>
          <template v-if="m.plan.value.state === 'ready'">
            <p>版本 {{ m.plan.value.source_version }} · {{ m.plan.value.operation }} · {{ m.plan.value.changes?.length }} 项</p>
            <p class="mcp-mono">{{ m.plan.value.target }}</p><p class="mcp-mono">SHA256 {{ m.plan.value.source_digest }}</p>
            <details><summary>文件变更与备份</summary><p class="mcp-mono">备份父目录：{{ m.plan.value.backup_parent }}</p><ul><li v-for="change in m.plan.value.changes" :key="change.path">{{ change.kind }} · {{ change.path }}</li></ul><p>计划到期：{{ m.plan.value.expires_at }}</p></details>
            <p v-if="m.planExpired.value" role="status">安装计划已过期，请重新预览；不会自动重新生成或执行。</p>
            <el-button type="primary" :disabled="!m.canApply.value" :loading="m.operation.value === 'apply'" @click="m.apply">确认安装 / 更新…</el-button>
          </template>
        </div>
      </section>
      <section class="mcp-section">
        <header><h3>运行连接与批处理</h3><el-button :disabled="m.busy.value || m.configurationLocked.value || !m.status.value || m.dirty.value || m.outcomeUnknown.value" :loading="m.operation.value === 'check'" @click="m.check">检查连接</el-button></header>
        <p class="mcp-hint">{{ m.connection.value?.reason || '安装成功不表示当前 FreeCAD 已加载插件；运行连接需单独检查。' }}</p>
        <p v-if="m.connection.value?.bridge_version" class="mcp-hint">运行插件版本：{{ m.connection.value.bridge_version }}</p>
        <details v-if="m.connection.value?.supported_methods.length"><summary>运行端声明的方法（不等于已通过 MCP 验证）</summary><p class="mcp-mono">{{ m.connection.value.supported_methods.join('、') }}</p></details>
        <p class="mcp-hint">{{ m.status.value?.batch.reason || '批量队列接线尚未完成，常驻批处理暂不开放；连接测试不代表批次可用。' }}</p>
      </section>
      <section class="mcp-section" aria-label="独立 worker 连接测试">
        <header><h3>独立 worker · 连接测试</h3><div class="mcp-actions"><el-button :disabled="m.busy.value || m.dirty.value || !m.status.value" @click="m.refreshWorker">刷新原实例状态</el-button><el-button :disabled="!m.canStartWorker.value" :loading="m.operation.value === 'worker-start'" @click="m.startWorker">启动独立worker（连接测试）</el-button><el-button :disabled="!m.canStopWorker.value" :loading="m.operation.value === 'worker-stop'" @click="m.stopWorker">停止自有worker…</el-button></div></header>
        <p class="mcp-hint" role="status">{{ m.workerLabel.value }}</p>
        <p class="mcp-hint">{{ m.workerReason.value }}</p>
        <p v-if="m.worker.value" class="mcp-hint">{{ m.worker.value.message }}</p>
        <p v-if="m.worker.value?.id" class="mcp-mono">Manager UUID：{{ m.worker.value.id }}</p>
        <p class="mcp-hint">owned 仅表示当前 manager 负责专用进程，并不等于 Native 就绪。只读状态观察不恢复启动权限，批次仍未开放。</p>
        <p v-if="m.workerOutcomeUnknown.value" class="mcp-hint" role="status">操作结果未知：先刷新原实例，不重新启动。没有实际退出观察前，不把停止请求当作已退出。</p>
        <p class="mcp-hint">启动须明确确认，只启动专用进程，不接管或关闭现有 FreeCAD / CAD。关闭面板仅停止 UI 轮询，不停止后台 worker；停止须另外明确确认。</p>
        <p class="mcp-hint">当前范围：不打开、关闭或保存 CAD，不触碰源文件或缓存。未来缩略图使用工作空间 .phoenix/thumbnail-cache；内嵌缩略图写盘另行授权。</p>
      </section>
      <p class="mcp-hint">当前只管理插件与连接；不打开、关闭或保存 CAD 文件。后续自动缩略图使用当前工作空间 .phoenix/thumbnail-cache，不默认写 assets；文档复用需主动导出并另选目录。FCStd 内嵌缩略图写盘须另行明确确认。</p>
      <p v-if="m.message.value" class="mcp-message" role="status">{{ m.message.value }}</p>
      <p v-if="m.error.value" class="mcp-error" role="alert">{{ m.error.value }}</p>
      <p v-if="m.dirty.value" class="mcp-hint">设置未保存；旧安装计划已失效。</p>
    </div>
  </AppModalOverlay>
</template>

<style scoped>
.mcp-dialog { padding: 16px; display: grid; gap: 12px; min-width: 0; }
.mcp-head, .mcp-section > header { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; }
h2, h3, p { margin: 0; }
h2 { font-size: 1rem; } h3 { font-size: 0.9rem; }
.mcp-hint, .mcp-status { font-size: 0.8rem; line-height: 1.5; overflow-wrap: anywhere; }
.mcp-hint, .mcp-status span { color: var(--muted, #64748b); }
.mcp-status { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px 14px; }
.mcp-status > div { display: grid; gap: 2px; }
.mcp-fields { margin: 0; padding: 10px; border: 1px solid var(--border, #cbd5e1); border-radius: 6px; display: grid; gap: 8px; }
.mcp-fields legend { font-size: 0.85rem; }
.mcp-field { display: grid; gap: 4px; font-size: 0.8rem; }
.mcp-field input { box-sizing: border-box; padding: 6px 8px; border: 1px solid var(--border, #cbd5e1); border-radius: 4px; background: var(--pnw-workbench-surface, #fff); color: inherit; min-width: 0; width: 100%; }
.mcp-port { max-width: 240px; }
.mcp-check, .mcp-radio { font-size: 0.8rem; line-height: 1.5; }
.mcp-actions { display: flex; flex-wrap: wrap; gap: 8px; }
.mcp-section { border-top: 1px solid var(--border, #cbd5e1); padding-top: 10px; display: grid; gap: 6px; }
.mcp-plan { display: grid; gap: 6px; font-size: 0.8rem; }
.mcp-mono { font-family: monospace; font-size: 0.75rem; overflow-wrap: anywhere; }
.mcp-error { color: var(--el-color-danger, #b91c1c); white-space: pre-wrap; font-size: 0.82rem; overflow-wrap: anywhere; }
.mcp-message { color: var(--el-color-success, #15803d); font-size: 0.82rem; overflow-wrap: anywhere; }
@media (max-width: 480px) { .mcp-dialog { padding: 12px; } .mcp-status { grid-template-columns: minmax(0, 1fr); } }
</style>
