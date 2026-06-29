<script setup lang="ts">
/** 异步任务进度浮层 — 纯视图。 */

import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { useAsyncTaskStore } from "../stores/asyncTasks";
import { averageFileDuration, fastestFileDuration, slowestFileDuration, formatDuration } from "../utils/asyncProgress";

const store = useAsyncTaskStore();
const expandedTaskId = ref<string | null>(null);
const showTiming = ref(true);
const userCollapsed = new Set<string>();
const timingScrollRef = ref<HTMLElement | null>(null);

watch(
  () => store.taskList.flatMap((t) => t.fileTimings),
  () => {
    nextTick(() => {
      const el = timingScrollRef.value;
      if (el && showTiming.value) el.scrollTop = el.scrollHeight;
    });
  },
);

// 自动展开 running 任务
watch(
  () => store.taskList.map((t) => t.taskId + ":" + t.status),
  (_, old) => {
    if (!old) return;
    for (const t of store.taskList) {
      if (t.status === "running" && !userCollapsed.has(t.taskId)) {
        expandedTaskId.value = t.taskId;
        nextTick(scrollLog);
        return;
      }
    }
  },
);

// 任务完成且最小化 → 弹出完成提示
const toast = ref<{ taskName: string; status: string } | null>(null);
const toastTimer = ref<ReturnType<typeof setTimeout> | null>(null);
watch(() => store.hasRunning, (running, old) => {
  if (old && !running && store.taskList.length > 0 && store.overlayMinimized) {
    const last = store.taskList[store.taskList.length - 1];
    if (last) {
      toast.value = { taskName: last.taskName, status: last.status };
      toastTimer.value = setTimeout(() => { toast.value = null; }, 5000);
    }
  }
});
function dismissToast() { toast.value = null; if (toastTimer.value) clearTimeout(toastTimer.value); }
onBeforeUnmount(() => { if (toastTimer.value) clearTimeout(toastTimer.value); });

function scrollLog() {
  nextTick(() => {
    document.querySelectorAll(".async-logs").forEach((el) => { el.scrollTop = el.scrollHeight; });
  });
}

function toggleExpand(id: string) {
  if (expandedTaskId.value === id) { expandedTaskId.value = null; userCollapsed.add(id); }
  else { expandedTaskId.value = id; userCollapsed.delete(id); scrollLog(); }
}

function openFullscreen(id: string) { expandedTaskId.value = id; store.setFullscreen(true); scrollLog(); }
function minimizeFromFullscreen() { store.setMinimized(true); }

const visible = computed(() => store.taskList.length > 0);

function label(k: string) { return k === "fcstd-scan" ? "扫描" : "测试"; }
function statusTxt(s: string) {
  const m: Record<string, string> = { running: "进行中", done: "完成", error: "失败", cancelled: "已取消", orphaned: "已中断" };
  return m[s] || s;
}
function subLine(t: any) {
  if (t.status !== "running") return null;
  const s = t.steps?.[t.currentStep ?? -1];
  if (!s) return null;
  const p = [s.label];
  if (s.total > 0) p.push(`${s.processed}/${s.total}`);
  if (s.currentFile) p.push(s.currentFile);

  // 所有步骤 100% 但仍 running → 后端在跑重活，给用户信心
  if (t.steps?.every((st: any) => st.percent >= 100) && t.steps?.length > 0) {
    p.push(elapsed(t));
  }
  return p.join(" · ");
}

/** 从 startedAt 计算已耗时，返回如 "已耗时 2m30s" */
function elapsed(t: any): string {
  if (!t.startedAt) return "";
  const ms = Date.now() - new Date(t.startedAt).getTime();
  if (ms < 1000) return "刚刚开始";
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `已耗时 ${sec}s`;
  const min = Math.floor(sec / 60);
  const s = sec % 60;
  return `已耗时 ${min}m${s}s`;
}
</script>

<template>
  <Teleport to="body">
    <!-- ====== 全屏 ====== -->
    <Transition name="fade">
      <div v-if="visible && store.fullscreen" class="backdrop" @click.self="minimizeFromFullscreen">
        <div class="fs-panel">
          <div class="fs-head">
            <span class="title">后台任务</span>
            <button class="btn-icon" title="恢复" @click="minimizeFromFullscreen">⤡</button>
          </div>
          <div class="list">
            <div v-for="t in store.taskList" :key="t.taskId" class="card" :class="['card-'+t.status]">
              <div class="row" @click="toggleExpand(t.taskId)">
                <span class="badge">{{ label(t.kind) }}</span>
                <span class="name">{{ t.taskName }}</span>
                <el-progress :percentage="t.progressPercent" :stroke-width="6" :show-text="true" class="bar"
                  :status="t.status==='error'?'exception':t.status==='done'?'success':undefined" />
                <span class="sts" :class="'sts-'+t.status">{{ statusTxt(t.status) }}</span>
                <span class="arrow">{{ expandedTaskId===t.taskId ? '▾' : '▸' }}</span>
              </div>
              <div v-if="subLine(t)" class="sub">{{ subLine(t) }}</div>
              <div v-if="expandedTaskId===t.taskId" class="detail">
                <div v-for="s in t.steps" :key="s.index" class="step">
                  <span class="si">{{ s.status==='done'?'✓':s.status==='active'?'⟳':s.status==='error'?'✗':'○' }}</span>
                  <span class="sl">{{ s.label }}</span>
                  <el-progress :percentage="Math.min(100,Math.max(0,+(s.percent>=100&&t.status==='running'?99:s.percent)||0))" :stroke-width="4" :show-text="false" :striped="s.percent>=100&&t.status==='running'" :striped-flow="s.percent>=100&&t.status==='running'" class="sb" />
                  <span class="sn">{{ s.processed }}/{{ s.total||'-' }}</span>
                </div>
                <div v-if="t.steps.some((s) => s.errors.length)" class="errs">
                  <div v-for="s in t.steps.filter((s:any)=>s.errors.length)" :key="'e'+s.index">
                    <div v-for="(e, i) in s.errors.slice(0, 5)" :key="i" class="err">
                      <span class="ef">{{ e.file }}</span><span class="em">{{ e.error }}</span>
                    </div>
                    <div v-if="s.errors.length>5" class="emore">... 还有 {{ s.errors.length-5 }} 个</div>
                  </div>
                </div>
                <div v-if="t.logs?.length" class="logs">
                  <div v-for="(l,i) in t.logs.slice(-30)" :key="i" class="logln">{{ l }}</div>
                </div>
                <div v-if="store.fullscreen && t.fileTimings?.length" class="timing-block">
                  <div class="timing-head" @click="showTiming = !showTiming">
                    <span>进度条目 ({{ t.fileTimings.length }})</span>
                    <span class="timing-summary">平均 {{ formatDuration(averageFileDuration(t.fileTimings)) }} · 最快 {{ formatDuration(fastestFileDuration(t.fileTimings)) }} · 最慢 {{ formatDuration(slowestFileDuration(t.fileTimings)) }}</span>
                    <span class="arrow">{{ showTiming ? '▾' : '▸' }}</span>
                  </div>
                  <div v-if="showTiming" ref="timingScrollRef" class="timing-table-wrap">
                    <table class="timing-table"><thead><tr><th>文件</th><th>条目</th><th class="r">耗时</th><th>状态</th></tr></thead>
                      <tbody><tr v-for="(r,ri) in t.fileTimings.slice(-100)" :key="ri" :class="r.success?'':'failed'"><td class="mono" :title="r.file">{{ (r.file.split('/').pop()||r.file) }}</td><td>{{ r.phase }}</td><td class="r">{{ formatDuration(r.duration) }}</td><td :class="r.success?'ok':'fail'">{{ r.success?'✓':'✗' }}</td></tr></tbody>
                    </table>
                  </div>
                </div>
                <div class="acts">
                  <button v-if="t.status==='running'" class="abtn pause" @click.stop="store.cancelTask(t.taskId)">⏸ 暂停</button>
                  <button v-if="t.status==='cancelled'" class="abtn resume" @click.stop="$emit('resumeTask', t.taskId)">▶ 继续</button>
                  <button v-if="t.status!=='running' && !t.confirmed" class="abtn confirm" @click.stop="store.confirmTask(t.taskId)">✓ 确认</button>
                  <button v-if="t.status!=='running'" class="abtn dismiss" @click.stop="store.removeTask(t.taskId)">✕ 删除</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Transition>

    <!-- ====== 浮动 ====== -->
    <Transition name="fade">
      <div v-if="visible && !store.overlayMinimized && !store.fullscreen" class="overlay">
        <div class="panel">
          <div class="head">
            <span class="title">后台任务 ({{ store.taskList.length }})</span>
            <div class="btns">
              <button class="btn-icon" title="最小化" @click="store.setMinimized(true)">_</button>
              <button class="btn-icon" title="最大化" @click="openFullscreen(store.taskList[0]?.taskId||'')">□</button>
            </div>
          </div>
          <div class="list">
            <div v-for="t in store.taskList" :key="t.taskId" class="card" :class="['card-'+t.status]">
              <div class="row" @click="toggleExpand(t.taskId)">
                <span class="badge">{{ label(t.kind) }}</span>
                <span class="name">{{ t.taskName }}</span>
                <el-progress :percentage="t.progressPercent" :stroke-width="6" :show-text="true" class="bar"
                  :status="t.status==='error'?'exception':t.status==='done'?'success':undefined" />
                <span class="sts" :class="'sts-'+t.status">{{ statusTxt(t.status) }}</span>
                <span class="arrow">{{ expandedTaskId===t.taskId ? '▾' : '▸' }}</span>
              </div>
              <div v-if="subLine(t)" class="sub">{{ subLine(t) }}</div>
              <div v-if="expandedTaskId===t.taskId" class="detail">
                <div v-for="s in t.steps" :key="s.index" class="step">
                  <span class="si">{{ s.status==='done'?'✓':s.status==='active'?'⟳':s.status==='error'?'✗':'○' }}</span>
                  <span class="sl">{{ s.label }}</span>
                  <el-progress :percentage="Math.min(100,Math.max(0,+(s.percent>=100&&t.status==='running'?99:s.percent)||0))" :stroke-width="4" :show-text="false" :striped="s.percent>=100&&t.status==='running'" :striped-flow="s.percent>=100&&t.status==='running'" class="sb" />
                  <span class="sn">{{ s.processed }}/{{ s.total||'-' }}</span>
                </div>
                <div v-if="t.steps.some((s) => s.errors.length)" class="errs">
                  <div v-for="s in t.steps.filter((s:any)=>s.errors.length)" :key="'e'+s.index">
                    <div v-for="(e, i) in s.errors.slice(0, 5)" :key="i" class="err">
                      <span class="ef">{{ e.file }}</span><span class="em">{{ e.error }}</span>
                    </div>
                    <div v-if="s.errors.length>5" class="emore">... 还有 {{ s.errors.length-5 }} 个</div>
                  </div>
                </div>
                <div v-if="t.logs?.length" class="logs">
                  <div v-for="(l,i) in t.logs.slice(-30)" :key="i" class="logln">{{ l }}</div>
                </div>
                <div v-if="store.fullscreen && t.fileTimings?.length" class="timing-block">
                  <div class="timing-head" @click="showTiming = !showTiming">
                    <span>进度条目 ({{ t.fileTimings.length }})</span>
                    <span class="timing-summary">平均 {{ formatDuration(averageFileDuration(t.fileTimings)) }} · 最快 {{ formatDuration(fastestFileDuration(t.fileTimings)) }} · 最慢 {{ formatDuration(slowestFileDuration(t.fileTimings)) }}</span>
                    <span class="arrow">{{ showTiming ? '▾' : '▸' }}</span>
                  </div>
                  <div v-if="showTiming" ref="timingScrollRef" class="timing-table-wrap">
                    <table class="timing-table"><thead><tr><th>文件</th><th>条目</th><th class="r">耗时</th><th>状态</th></tr></thead>
                      <tbody><tr v-for="(r,ri) in t.fileTimings.slice(-100)" :key="ri" :class="r.success?'':'failed'"><td class="mono" :title="r.file">{{ (r.file.split('/').pop()||r.file) }}</td><td>{{ r.phase }}</td><td class="r">{{ formatDuration(r.duration) }}</td><td :class="r.success?'ok':'fail'">{{ r.success?'✓':'✗' }}</td></tr></tbody>
                    </table>
                  </div>
                </div>
                <div class="acts">
                  <button v-if="t.status==='running'" class="abtn pause" @click.stop="store.cancelTask(t.taskId)">⏸ 暂停</button>
                  <button v-if="t.status==='cancelled'" class="abtn resume" @click.stop="$emit('resumeTask', t.taskId)">▶ 继续</button>
                  <button v-if="t.status!=='running' && !t.confirmed" class="abtn confirm" @click.stop="store.confirmTask(t.taskId)">✓ 确认</button>
                  <button v-if="t.status!=='running'" class="abtn dismiss" @click.stop="store.removeTask(t.taskId)">✕ 删除</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Transition>

    <!-- ====== 最小化 ====== -->
    <Transition name="fade">
      <div v-if="visible && store.overlayMinimized && !store.fullscreen" class="minibar">
        <span class="mi">⏳</span>
        <span class="mt">{{ store.activeTasks.length }} 个任务</span>
        <span v-for="t in store.activeTasks.slice(0,2)" :key="t.taskId" class="mtask">{{ t.progressPercent }}%</span>
        <button class="mbtn" title="最大化查看" @click="openFullscreen(store.activeTasks[0]?.taskId||'')">□</button>
      </div>
    </Transition>

    <!-- ====== 完成 Toast ====== -->
    <Transition name="fade">
      <div v-if="toast" class="toast" @click="dismissToast">
        <span class="toast-icon">{{ toast.status === 'done' ? '✓' : toast.status === 'error' ? '✗' : '⊗' }}</span>
        <span class="toast-msg">{{ toast.taskName }} {{ toast.status === 'done' ? '完成' : toast.status === 'error' ? '失败' : '结束' }}</span>
        <button class="toast-btn" @click.stop="store.setFullscreen(true); dismissToast()">查看</button>
        <button class="toast-close" @click.stop="dismissToast">×</button>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
/* 全屏 */
.backdrop { position:fixed; inset:0; z-index:10000; background:rgba(0,0,0,.5); display:flex; align-items:center; justify-content:center; }
.fs-panel { width:720px; max-width:95vw; max-height:85vh; background:var(--page-bg,#fff); border-radius:10px; box-shadow:0 8px 48px rgba(0,0,0,.25); display:flex; flex-direction:column; overflow:hidden; }
.fs-head { display:flex; align-items:center; justify-content:space-between; padding:12px 18px; border-bottom:1px solid var(--border,#ebeef5); flex-shrink:0; }

/* 浮动 */
.overlay { position:fixed; right:24px; top:80px; z-index:9998; max-height:70vh; }
.panel { width:420px; max-height:70vh; background:var(--page-bg,#fff); border:1px solid var(--border,#dcdfe6); border-radius:8px; box-shadow:0 4px 24px rgba(0,0,0,.12); display:flex; flex-direction:column; overflow:hidden; }

.head { display:flex; align-items:center; justify-content:space-between; padding:10px 14px; border-bottom:1px solid var(--border,#ebeef5); flex-shrink:0; }
.title { font-size:14px; font-weight:600; color:var(--text,#303133); }
.btns { display:flex; gap:4px; }
.btn-icon { width:28px; height:24px; border:none; background:none; font-size:15px; cursor:pointer; color:var(--muted,#909399); border-radius:4px; display:flex; align-items:center; justify-content:center; line-height:1; }
.btn-icon:hover { background:var(--hover-bg,#f5f7fa); color:var(--text,#303133); }

/* 列表 */
.list { overflow-y:auto; flex:1; padding:8px; }
.card { border:1px solid var(--border,#ebeef5); border-radius:6px; margin-bottom:8px; overflow:hidden; border-left:3px solid transparent; }
.card-running { border-left-color:var(--accent,#409eff); background:var(--accent-soft,#ecf5ff); }
.card-done { border-left-color:#67c23a; }
.card-error { border-left-color:#f56c6c; }
.card-cancelled, .card-orphaned { opacity:.7; }

/* 摘要 */
.row { display:flex; align-items:center; gap:8px; padding:8px 12px; cursor:pointer; user-select:none; }
.row:hover { background:var(--hover-bg,#f5f7fa); }
.badge { font-size:11px; padding:1px 6px; border-radius:3px; background:var(--accent-soft,#ecf5ff); color:var(--accent,#409eff); flex-shrink:0; }
.name { font-size:13px; font-weight:500; color:var(--text,#303133); flex-shrink:0; max-width:120px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.bar { flex:1; min-width:60px; }
.sts { font-size:12px; flex-shrink:0; }
.sts-running { color:var(--accent,#409eff); } .sts-done { color:#67c23a; } .sts-error { color:#f56c6c; } .sts-cancelled,.sts-orphaned { color:var(--muted,#909399); }
.arrow { font-size:12px; color:var(--muted,#909399); flex-shrink:0; }
.sub { font-size:11px; font-family:monospace; color:var(--muted,#909399); padding:0 12px 6px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }

/* 详情 */
.detail { border-top:1px solid var(--border,#ebeef5); padding:8px 12px; }
.step { display:flex; align-items:center; gap:6px; padding:3px 0; }
.si { width:16px; font-size:12px; text-align:center; flex-shrink:0; }
.sl { font-size:12px; color:var(--text,#303133); width:80px; flex-shrink:0; }
.sb { flex:1; min-width:40px; }
.sn { font-size:11px; color:var(--muted,#909399); flex-shrink:0; }

/* 错误 */
.errs { margin-top:6px; font-size:11px; }
.err { display:flex; gap:6px; padding:2px 0; }
.ef { color:var(--text,#303133); font-family:monospace; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:180px; }
.em { color:#f56c6c; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.emore { color:var(--muted,#909399); padding-top:2px; }

/* 日志 */
.logs { margin-top:8px; max-height:140px; overflow-y:auto; background:#1e1e1e; border-radius:4px; padding:6px 8px; font-family:monospace; font-size:11px; line-height:1.5; }
.logln { color:#d4d4d4; white-space:pre-wrap; word-break:break-all; }

/* 耗时表格 */
.timing-block { margin-top:8px; border-top:1px solid var(--border,#ebeef5); padding-top:6px; }
.timing-head { display:flex; align-items:center; gap:8px; font-size:11px; color:var(--muted,#909399); cursor:pointer; user-select:none; }
.timing-head:hover { color:var(--text,#303133); }
.timing-summary { font-family:monospace; font-size:10px; opacity:.8; }
.timing-table-wrap { max-height:200px; overflow-y:auto; margin-top:4px; }
.timing-table { width:100%; border-collapse:collapse; font-size:11px; }
.timing-table th { text-align:left; padding:3px 6px; border-bottom:1px solid var(--border,#ebeef5); color:var(--muted,#909399); font-weight:500; position:sticky; top:0; background:var(--page-bg,#fff); }
.timing-table td { padding:2px 6px; border-bottom:1px solid var(--border,#ebeef5); }
.timing-table .r { text-align:right; font-family:monospace; }
.timing-table .mono { font-family:monospace; max-width:200px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.timing-table .ok { color:#67c23a; } .timing-table .fail { color:#f56c6c; }
.timing-table .failed { background:#fef2f2; }

/* 操作 */
.acts { margin-top:8px; display:flex; gap:6px; justify-content:flex-end; }
.abtn { font-size:11px; padding:2px 10px; border:1px solid var(--border,#dcdfe6); border-radius:3px; background:none; cursor:pointer; color:var(--muted,#909399); }
.abtn:hover { background:var(--hover-bg,#f5f7fa); color:var(--text,#303133); }
.abtn.pause { border-color:#e6a23c; color:#e6a23c; }
.abtn.pause:hover { background:#fdf6ec; }
.abtn.resume { border-color:var(--accent,#409eff); color:var(--accent,#409eff); }
.abtn.resume:hover { background:var(--accent-soft,#ecf5ff); }
.abtn.confirm { border-color:#67c23a; color:#67c23a; }
.abtn.confirm:hover { background:#f0f9eb; }
.abtn.dismiss:hover { border-color:#f56c6c; color:#f56c6c; }

/* 最小化 */
.minibar { position:fixed; bottom:12px; right:12px; height:34px; z-index:9999; display:flex; align-items:center; gap:8px; padding:0 10px 0 14px; background:#303133; color:#fff; font-size:12px; border-radius:8px; box-shadow:0 2px 12px rgba(0,0,0,.3); user-select:none; }
.mi { font-size:14px; } .mt { font-weight:500; } .mtask { opacity:.8; font-size:11px; }
.mbtn { width:22px; height:22px; border:none; background:rgba(255,255,255,.15); color:#fff; font-size:13px; border-radius:3px; cursor:pointer; display:flex; align-items:center; justify-content:center; margin-left:4px; }
.mbtn:hover { background:rgba(255,255,255,.25); }

/* Toast */
.toast { position:fixed; bottom:60px; right:16px; z-index:10001; display:flex; align-items:center; gap:8px; padding:10px 14px; background:#fff; border-radius:8px; box-shadow:0 4px 20px rgba(0,0,0,.15); font-size:13px; cursor:pointer; max-width:360px; }
.toast-icon { font-size:16px; } .toast-icon:first-child { color:#67c23a; }
.toast-msg { color:var(--text,#303133); flex:1; }
.toast-btn { font-size:11px; padding:2px 8px; border:1px solid var(--accent,#409eff); border-radius:3px; background:none; color:var(--accent,#409eff); cursor:pointer; }
.toast-btn:hover { background:var(--accent-soft,#ecf5ff); }
.toast-close { border:none; background:none; font-size:14px; cursor:pointer; color:var(--muted,#909399); }

/* 过渡 */
.fade-enter-active,.fade-leave-active { transition:opacity .2s ease; }
.fade-enter-from,.fade-leave-to { opacity:0; }
</style>
