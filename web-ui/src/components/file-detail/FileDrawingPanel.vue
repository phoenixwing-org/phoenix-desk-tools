<script setup lang="ts">
import { ref, reactive, onMounted, onUnmounted } from "vue";
import { jsonFetch } from "../../api";
import { useFileDetailContext } from "../../composables/useFileDetailContext";
import { useAppShell } from "../../composables/useAppShell";
import { useDrawingBomReadonly } from "../../composables/useDrawingBomReadonly";
const { rel, preview } = useFileDetailContext();
const shell = useAppShell();
const { canOpenSourceModel, openSourceModel } = useDrawingBomReadonly(preview);
interface Inspection {
  source: string; expected_drawing: string; coverage: string; warnings: string[];
  nodes: Array<{name: string; label: string; type: string}>;
  drawings: Array<{rel: string; relation: string; pages: string[]; views: number; dimensions: number}>;
  pdfs: string[];
  templates: {root: string; items: Array<{rel: string; family: string; width: string; height: string}>};
}
interface SyncField {field:string;current:string;proposed:string}
interface SyncReview {id:string;pages:Array<{page:string;label:string;changes:SyncField[];conflicts:SyncField[];unmapped:string[]}>}
const syncReview=ref<SyncReview>();const syncBusy=ref(false);const syncMessage=ref("");
async function titleblockSync(apply=false) {
 if(syncBusy.value)return;
 syncBusy.value=true;error.value="";syncMessage.value="";
 if(!apply)syncReview.value=undefined;
 try {
  const result=await jsonFetch<SyncReview>(`/api/drawing-research/titleblock/${apply?'apply':'preview'}`,{signal:lifetime.signal,method:'POST',body:JSON.stringify({workspace:shell.workspacePath.value,rel:rel.value,id:syncReview.value?.id})});
  if(lifetime.signal.aborted)return;
  if(apply){syncReview.value=undefined;syncMessage.value="FCStd标题栏已同步。已有PDF未更新，请在FreeCAD中重新导出。";}
  else syncReview.value=result;
 } catch(e){if(!lifetime.signal.aborted)error.value=e instanceof Error?e.message:String(e);}
 finally{syncBusy.value=false;}
}
const defaults = reactive({creator:"",approval_person:"",company:"",material:"",tolerances:""});
const saveScope = ref("workspace"); const job = ref<{id:string;status:string;error?:string;outputs?:string[];warnings?:string[]}>();
const lifetime = new AbortController();
const submitting = ref(false);
const settingsSaved = ref(false);
let pollTimer: ReturnType<typeof setTimeout> | undefined;
const data = ref<Inspection>(); const busy = ref(false); const error = ref("");
const templateRoot = ref(""); const template = ref(""); const sourceNode = ref("");
let controller: AbortController | undefined;
onUnmounted(() => {lifetime.abort(); controller?.abort(); if (pollTimer) clearTimeout(pollTimer);});
async function inspect() {
  if (lifetime.signal.aborted) return;
  controller?.abort(); const request = new AbortController(); controller = request;
  busy.value = true; error.value = "";
  try {
    const query = new URLSearchParams({workspace: shell.workspacePath.value, rel: rel.value, template_root: templateRoot.value});
    const result = await jsonFetch<Inspection>(`/api/drawing-research/inspect?${query}`, {signal: request.signal});
    if (request.signal.aborted) return;
    data.value = result; templateRoot.value = result.templates.root;
    sourceNode.value = result.nodes.find(node => node.type === "PartDesign::Body")?.name || result.nodes[0]?.name || "";
    if (!result.templates.items.some(item => item.rel === template.value)) template.value = result.templates.items.find(item => /A4.*Landscape/i.test(item.rel) && !/blank|Default_Template|notitleblock/i.test(item.rel))?.rel || result.templates.items[0]?.rel || "";
  } catch (e) { if (!request.signal.aborted) error.value = e instanceof Error ? e.message : String(e); }
  finally { if (!request.signal.aborted) busy.value = false; }
}
async function saveDefaults() {
  settingsSaved.value = false;
  try {
    await jsonFetch('/api/drawing-research/defaults', {signal:lifetime.signal, method:'PUT', body:JSON.stringify({workspace:shell.workspacePath.value,scope:saveScope.value,defaults:{...defaults,template_root:templateRoot.value,template:template.value}})});
    if (!lifetime.signal.aborted) settingsSaved.value = true;
  } catch(e) { if (!lifetime.signal.aborted) error.value=e instanceof Error?e.message:String(e); }
}
async function pollJob() {
  if (!job.value || lifetime.signal.aborted) return;
  try {
    const result = await jsonFetch<NonNullable<typeof job.value>>(`/api/drawing-research/jobs/${job.value.id}?${new URLSearchParams({workspace:shell.workspacePath.value})}`, {signal:lifetime.signal});
    if (lifetime.signal.aborted) return;
    job.value = result;
    if(result.status==='running') pollTimer=setTimeout(pollJob,1500);
    else await inspect();
  } catch(e) { if (!lifetime.signal.aborted) error.value=e instanceof Error?e.message:String(e); }
}
async function generate() {
  if (submitting.value || job.value?.status === 'running' || lifetime.signal.aborted) return;
  error.value=''; submitting.value = true;
  try {
    const result = await jsonFetch<NonNullable<typeof job.value>>('/api/drawing-research/jobs',{signal:lifetime.signal,method:'POST',body:JSON.stringify({workspace:shell.workspacePath.value,rel:rel.value,node:sourceNode.value,template_root:templateRoot.value,template:template.value,defaults})});
    if (lifetime.signal.aborted) return;
    job.value = result; void pollJob();
  } catch(e) { if (!lifetime.signal.aborted) error.value=e instanceof Error?e.message:String(e); }
  finally { submitting.value = false; }
}
onMounted(async () => {
 if(canOpenSourceModel.value)return;
 try {
   const saved=await jsonFetch<typeof defaults & {template_root:string;template:string}>(`/api/drawing-research/defaults?${new URLSearchParams({workspace:shell.workspacePath.value})}`, {signal:lifetime.signal});
   if (lifetime.signal.aborted) return;
   for (const key of Object.keys(defaults) as Array<keyof typeof defaults>) defaults[key] = saved[key];
   templateRoot.value=saved.template_root;template.value=saved.template;
 } catch(e) { if (!lifetime.signal.aborted) error.value=e instanceof Error?e.message:String(e); }
 await inspect();
});
</script>
<template>
  <div class="drawing-panel">
    <template v-if="canOpenSourceModel">
      <p>请从源零件或总成设置出图。当前是已有图纸。</p>
      <el-button @click="openSourceModel">打开源模型</el-button>
      <h3>同步标题栏</h3>
      <p class="muted">读取图纸文档、页面和来源模型属性；保留人工改过的字段。请先在FreeCAD中保存属性修改。同步后需重新导出PDF。</p>
      <div class="actions"><el-button :loading="syncBusy" @click="titleblockSync()">预览标题栏同步</el-button><el-button type="primary" :disabled="syncBusy || !syncReview?.pages.some(page => page.changes.length)" @click="titleblockSync(true)">应用可更新项</el-button></div>
      <el-alert v-if="error" :title="error" type="error" :closable="false" />
      <el-alert v-if="syncMessage" :title="syncMessage" type="success" :closable="false" />
      <section v-for="page in syncReview?.pages" :key="page.page">
        <h4>{{ page.label }} · 可更新 {{ page.changes.length }} · 保留人工值 {{ page.conflicts.length }}</h4>
        <table v-if="page.changes.length || page.conflicts.length"><thead><tr><th>#</th><th>字段</th><th>当前值</th><th>属性值</th><th>处理</th></tr></thead><tbody>
          <tr v-for="(field,i) in page.changes" :key="'change-'+field.field"><td>{{ i+1 }}</td><td>{{ field.field }}</td><td class="path">{{ field.current }}</td><td class="path">{{ field.proposed }}</td><td>更新</td></tr>
          <tr v-for="(field,i) in page.conflicts" :key="'conflict-'+field.field"><td>{{ page.changes.length+i+1 }}</td><td>{{ field.field }}</td><td class="path">{{ field.current }}</td><td class="path">{{ field.proposed }}</td><td>保留人工值</td></tr>
        </tbody></table>
        <p v-else>没有可同步的差异。</p>
        <p v-if="page.unmapped.length" class="muted">未映射或缺少来源：{{ page.unmapped.join('、') }}</p>
      </section>
    </template>
    <template v-else>
      <header><h3>单件出图研究</h3><el-button :loading="busy" @click="inspect">查找关联图纸</el-button></header>
      <el-alert v-if="error" :title="error" type="error" :closable="false" />
      <section v-if="data">
        <h4>关联图纸</h4>
        <p v-if="!data.drawings.length">未找到关联 Drawing.FCStd。</p>
        <table v-else><thead><tr><th>#</th><th>文件</th><th>关联方式</th><th>页 / 视图 / 尺寸</th></tr></thead><tbody>
          <tr v-for="(item, i) in data.drawings" :key="item.rel"><td>{{ i + 1 }}</td><td class="path"><el-button link type="primary" class="file-link" @click="shell.openFileDetailForRel(item.rel)">{{ item.rel }}</el-button></td><td>{{ item.relation === 'linked' ? '模型引用' : '编号候选' }}</td><td>{{ item.pages.length }} / {{ item.views }} / {{ item.dimensions }}</td></tr>
        </tbody></table>
        <h4>参考 PDF</h4><p v-if="!data.pdfs.length">未找到同编号 PDF。</p><ul v-else><li v-for="pdf in data.pdfs" :key="pdf" class="path">{{ pdf }}</li></ul>
        <p class="muted">{{ data.coverage }}</p>
        <h4>出图设置</h4>
        <label>模型节点<el-select v-model="sourceNode"><el-option v-for="node in data.nodes" :key="node.name" :label="`${node.label} (${node.type})`" :value="node.name" /></el-select></label>
        <label>模板目录<el-input v-model="templateRoot" placeholder="FreeCAD 默认目录或自定义 SVG 目录" @change="inspect" /></label>
        <label>模板<el-select v-model="template" filterable><el-option v-for="item in data.templates.items" :key="item.rel" :label="`${item.rel} · ${item.width} × ${item.height}`" :value="item.rel" /></el-select></label>
        <label>公司<el-input v-model="defaults.company" type="textarea" :rows="2" placeholder="可分行填写公司名称" /></label>
        <label>创建人<el-input v-model="defaults.creator" /></label>
        <label>审批人<el-input v-model="defaults.approval_person" /></label>
        <label>材料默认值<el-input v-model="defaults.material" placeholder="优先读取模型材料；留空则待确认" /></label>
        <label>默认公差<el-input v-model="defaults.tolerances" placeholder="留空则待确认" /></label>
        <div class="actions"><el-select v-model="saveScope" style="width:150px"><el-option label="当前工作区" value="workspace" /><el-option label="本机默认" value="machine" /></el-select><el-button @click="saveDefaults">保存出图设置</el-button><el-button type="primary" :disabled="busy || submitting || !template || !sourceNode || job?.status === 'running'" :loading="submitting || job?.status === 'running'" @click="generate">生成单件初稿</el-button></div>
        <p v-if="settingsSaved" role="status">出图设置已保存。</p>
        <p class="muted">生成同名 Drawing.FCStd、PDF 和 AI 续作说明。已有同名输出会保留。初稿包含两个正交视图、一个轴测视图及部分顶点间尺寸；圆弧外缘、孔径等尺寸需工程师补齐；审批人姓名不代表已审批。</p>
        <el-alert v-if="job" :title="job.status === 'running' ? 'FreeCAD正在生成图纸…' : job.status === 'completed' ? '初稿已生成，请检查图纸与PDF' : (job.error || '生成失败')" :type="job.status === 'failed' ? 'error' : job.status === 'completed' ? 'success' : 'info'" :closable="false" />
        <ul v-if="job?.outputs"><li v-for="output in job.outputs" :key="output" class="path"><el-button v-if="/\.fcstd$/i.test(output)" link type="primary" class="file-link" @click="shell.openFileDetailForRel(output)">{{ output }}</el-button><span v-else>{{ output }}</span></li></ul>
        <p v-for="warning in job?.warnings" :key="warning" class="warning">{{ warning }}</p>
        <p v-for="warning in data.warnings" :key="warning" class="warning">{{ warning }}</p>
      </section>
    </template>
  </div>
</template>
<style scoped>
.actions{display:flex;gap:8px;flex-wrap:wrap}.drawing-panel{padding:16px;overflow:auto;height:100%;box-sizing:border-box}header{display:flex;align-items:center;justify-content:space-between;gap:12px}h3{margin:0}section{margin-top:16px}table{width:100%;border-collapse:collapse}th,td{padding:8px;border:1px solid var(--el-border-color);text-align:left}th:first-child{width:40px}label{display:grid;grid-template-columns:100px minmax(0,1fr);gap:12px;align-items:center;margin:12px 0}.path{overflow-wrap:anywhere}.file-link{white-space:normal;text-align:left;height:auto;line-height:1.5}.file-link :deep(span){overflow-wrap:anywhere;min-width:0}.muted{color:var(--el-text-color-secondary);font-size:12px}.warning{color:var(--el-color-warning)}
</style>
