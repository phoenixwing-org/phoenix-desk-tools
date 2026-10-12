<script setup lang="ts">
import { computed, ref, toRef, watch } from "vue";
import { useAppShell } from "../../composables/useAppShell";
import { useCadLightInfo } from "../cad-light-info/useCadLightInfo";
import CadLightSummary from "../cad-light-info/CadLightSummary.vue";
import { useCadObjectInfo } from "./useCadObjectInfo";
import CadObjectDocument from "./CadObjectDocument.vue";
const props = withDefaults(defineProps<{ workspacePath: string; filePath: string; active?: boolean; initialMode?: "full" | "light" }>(), { active: true, initialMode: "full" });
const emit = defineEmits<{ "busy-change": [busy: boolean] }>();
const mode = ref<"full" | "light">(props.initialMode);
const workspace = toRef(props, "workspacePath"), file = toRef(props, "filePath");
const full = useCadObjectInfo(workspace, file, computed(() => props.active && mode.value === "full"));
const light = useCadLightInfo(workspace, file, computed(() => props.active && mode.value === "light"), { appendLog: useAppShell().appendLog });
const busy = computed(() => full.busy.value || light.busy.value);
const error = computed(() => mode.value === "full" ? full.error.value : light.error.value);
const errorCode = computed(() => mode.value === "full" ? full.errorCode.value : light.errorCode.value);
const message = computed(() => mode.value === "full" ? full.message.value : light.message.value);
const result = full.result, lightResult = light.result;
function load() { return mode.value === "full" ? full.load() : light.load(); }
function cancel() { full.cancel(); light.cancel(); }
function selectMode(next: "full" | "light") { if (mode.value !== next) { cancel(); mode.value = next; } }
watch(busy, value => emit("busy-change", value), { immediate: true, flush: "sync" });
</script>

<template>
  <section class="object-info-panel" aria-label="对象信息">
    <header class="object-info-header"><h2>只读对象信息</h2><div>
      <el-button size="small" :disabled="busy || !active || !workspacePath || !filePath" @click="load">重新读取</el-button>
      <el-button v-if="busy" size="small" @click="cancel">取消读取</el-button>
    </div></header>
    <div class="object-info-modes" role="tablist" aria-label="读取方式"><button role="tab" :aria-selected="mode === 'full'" @click="selectMode('full')">完整对象</button><button role="tab" :aria-selected="mode === 'light'" @click="selectMode('light')">轻量摘要</button></div>
    <p v-if="mode === 'full'" class="object-info-hint">显示已保存模型的完整对象文档，不需要 native provider；不修改文件，不更新 CAD 索引。不能以此替代完整扫描或 BOM 交付预检。</p>
    <p v-else class="object-info-hint">轻量摘要需手动点击「重新读取」：只看已保存 XML 的字段与去重源 XLink，不读取完整对象，不修改文件，不更新 CAD 索引；源引用条数不是 BOM 数量。</p>
    <el-alert v-if="error" :title="error" :description="errorCode ? `错误类型：${errorCode}；未显示部分结果，可核对模型后重新读取。` : '未显示部分结果，可核对模型后重新读取。'" type="error" :closable="false" role="alert" />
    <p v-else-if="busy" role="status">正在读取{{ mode === 'full' ? '对象文档' : '轻量摘要' }}…可以取消。</p>
    <p v-else-if="message" role="status">{{ message }}</p>
    <CadObjectDocument v-else-if="mode === 'full' && result" :result="result" />
    <CadLightSummary v-else-if="mode === 'light' && lightResult" :result="lightResult" />
    <p v-else>点击「重新读取」查看对象信息。</p>
  </section>
</template>

<style scoped>
.object-info-panel { display: flex; flex-direction: column; gap: 14px; padding: 16px; }
.object-info-header { display: flex; justify-content: space-between; align-items: center; gap: 12px; }
.object-info-header h2 { margin: 0; font-size: 1rem; }
.object-info-hint { color: var(--muted); line-height: 1.65; font-size: 0.82rem; margin: 0; }
.object-info-modes { display: flex; gap: 8px; } .object-info-modes button { padding: 5px 10px; border: 1px solid var(--border); border-radius: 4px; color: inherit; background: var(--panel-head-bg); cursor: pointer; } .object-info-modes button[aria-selected="true"] { color: var(--primary); }
</style>
