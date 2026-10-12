<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { CAD_LIGHT_FIELD_KEYS, type CadLightInfoResult, type CadLightReferenceStatus } from "./types";
const props = defineProps<{ result: CadLightInfoResult }>();
const page = ref(1), pageSize = 50;
const pages = computed(() => Math.max(1, Math.ceil(props.result.analysis.xlinks.length / pageSize)));
const rows = computed(() => props.result.analysis.xlinks.slice((page.value - 1) * pageSize, page.value * pageSize).map((link, index) => ({ link, diagnostic: props.result.diagnostics.items[(page.value - 1) * pageSize + index] })));
const fields = computed(() => CAD_LIGHT_FIELD_KEYS.filter(key => Object.hasOwn(props.result.analysis.embeddedFields, key)));
const statusLabels: Record<CadLightReferenceStatus, string> = { resolved: "已解析", ambiguous: "多个候选", missing: "未找到", self: "引用自身", non_fcstd: "非 FCStd" };
watch(() => props.result, () => { page.value = 1; });
</script>
<template>
  <section class="cad-light-summary" aria-label="轻量摘要结果">
    <p>Document.xml 原始 {{ result.analysis.documentXmlBytes }} 字节（UTF-8，BOM 若有则计入） · {{ result.analysis.objectCount }} 个对象</p>
    <p class="hint">源文件快照：{{ result.source.file_size }} 字节 · 修改时间 {{ new Date(result.source.mtime_ms).toISOString() }}。仅查看已保存 XML；不是 FreeCAD 运行态或完整对象文档。</p>
    <h3>内嵌字段 embeddedFields</h3>
    <dl v-if="fields.length" class="fields"><template v-for="key in fields" :key="key"><dt>{{ key }}</dt><dd>{{ result.analysis.embeddedFields[key] === '' ? '（空值）' : result.analysis.embeddedFields[key] }}</dd></template></dl>
    <p v-else>未发现内嵌字段。</p>
    <h3>去重源 XLink：{{ result.analysis.xlinks.length }} 条</h3>
    <p class="hint">按原始源路径去重，不表示引用实例数或 BOM 数量。即时分类与候选来自当前磁盘，不写入 CAD 索引；完整交付仍须完整扫描和预检。</p>
    <p v-for="warning in result.warnings" :key="warning" class="warning">{{ warning }}</p>
    <p v-if="!rows.length">没有保存的源 XLink。</p>
    <template v-else>
      <div class="pagination"><span>第 {{ page }} / {{ pages }} 页（每页 {{ pageSize }} 条）</span><button :disabled="page <= 1" @click="page--">上一页</button><button :disabled="page >= pages" @click="page++">下一页</button></div>
      <div class="table-scroll"><table><thead><tr><th>原始源路径</th><th>标签</th><th>即时分类</th><th>目标 / 候选 / 说明</th></tr></thead><tbody>
        <tr v-for="(row, index) in rows" :key="`${page}-${index}`"><td>{{ row.link.file }}</td><td>{{ row.link.label || '（空值）' }}</td><td>{{ statusLabels[row.diagnostic.status] }}</td><td><p v-if="row.diagnostic.targetRelativePath"><span v-if="row.diagnostic.status === 'ambiguous'">建议匹配（未解析）：</span>{{ row.diagnostic.targetRelativePath }}</p><ul v-if="row.diagnostic.candidates.length"><li v-for="candidate in row.diagnostic.candidates" :key="candidate">{{ candidate }}</li></ul><p>{{ row.diagnostic.message }}</p></td></tr>
      </tbody></table></div>
    </template>
  </section>
</template>
<style scoped>
.cad-light-summary { font-size: .82rem; } .hint { color: var(--muted); line-height: 1.6; } h3 { font-size: .9rem; } .fields { display: grid; grid-template-columns: 110px 1fr; gap: 6px 12px; } dt { color: var(--muted); } dd { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; } .warning { padding: 8px; background: var(--phoenix-warning-bg); color: var(--phoenix-warning-text); } .pagination { display: flex; align-items: center; gap: 8px; margin: 10px 0; } .pagination button { color: inherit; background: var(--panel-head-bg); border: 1px solid var(--border); border-radius: 4px; padding: 4px 8px; } .table-scroll { overflow: auto; } table { width: 100%; border-collapse: collapse; } th, td { padding: 6px 8px; border: 1px solid var(--border); text-align: left; vertical-align: top; overflow-wrap: anywhere; } th { background: var(--panel-head-bg); } td p { margin: 0; } td ul { padding-left: 18px; }
</style>
